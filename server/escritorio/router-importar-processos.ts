/**
 * Importação em massa de processos a partir de export Advbox (XLSX).
 *
 * 2 procedures:
 *   preview  — parseia + faz dedupe contra DB, retorna o que vai criar.
 *   executar — recebe linhas confirmadas e cria contatos + vínculos.
 *
 * O cliente envia o arquivo em base64 no `preview`. Pra evitar timeout
 * em planilhas grandes (500+ linhas), o `executar` processa chunks de até
 * 100 itens — o cliente faz N chamadas em sequência mostrando progresso.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { contatos, clienteProcessos } from "../../drizzle/schema";
import { checkPermission } from "./check-permission";
import { verificarLimite } from "../billing/plan-limits";
import { parseAdvboxXlsx, type LinhaAdvbox } from "../processos/parser-advbox";
import { createLogger } from "../_core/logger";

const log = createLogger("importar-processos");

const TAG_IMPORT = "advbox-import";
/** Limite de upload em base64 (XLSX típico fica em 100-500KB; cap em ~5MB binary). */
const MAX_BASE64_BYTES = 7_500_000;
/** Máx de linhas processadas por chamada de `executar`. */
const MAX_LINHAS_POR_CHAMADA = 100;

/** Versão "leve" de LinhaAdvbox que o cliente devolve no executar — só o
 *  necessário pra recriar a inserção sem reparsear o XLSX. */
const linhaExecucaoSchema = z.object({
  linhaNum: z.number().int().positive(),
  cnj: z.string().nullable(),
  cnjOriginal: z.string(),
  cnjValido: z.boolean(),
  tribunal: z.string().nullable(),
  classe: z.string().nullable(),
  valorCausaCentavos: z.number().int().nullable(),
  clientes: z.array(
    z.object({
      nome: z.string().min(1).max(255),
      cpfCnpj: z.string().nullable(),
      tipoDoc: z.enum(["cpf", "cnpj"]).nullable(),
    }),
  ).min(1),
});

export type LinhaExecucao = z.infer<typeof linhaExecucaoSchema>;

export type PreviewLinha = LinhaAdvbox & {
  status:
    | "novo"
    | "ja_existe_processo"
    | "cnj_em_outro_cliente"
    | "sem_cliente"
    | "sem_cnj_invalido";
  /** Quando o cliente principal (1º da linha) já existe por CPF/CNPJ ou nome. */
  contatoExistenteId: number | null;
  contatoExistenteNome: string | null;
  /** Quando o vínculo (contato+CNJ) já existe. */
  processoExistenteId: number | null;
  /** Outros contatos do escritório que já têm esse CNJ vinculado. Usado pra
   *  detectar potencial duplicata acidental (ex: cliente cadastrado antes
   *  com nome diferente) sem bloquear litisconsórcio real. Vazio quando o
   *  CNJ ainda não está no escritório. */
  cnjEmOutrosContatos: { contatoId: number; contatoNome: string }[];
};

/** Normaliza nome pra match: maiúscula, trim, colapsa espaços, remove acentos. */
function normalizarNome(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Concatena tag no campo `tags` (separado por vírgula) sem duplicar. */
function adicionarTag(existente: string | null, tag: string): string {
  const partes = (existente ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!partes.includes(tag)) partes.push(tag);
  return partes.join(", ");
}

/**
 * Carrega 2 mapas de dedupe pro escritório inteiro: contatos por CPF/CNPJ +
 * por nome normalizado. 1 query.
 */
async function carregarMapaContatos(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  escritorioId: number,
): Promise<{
  porDoc: Map<string, { id: number; nome: string }>;
  porNome: Map<string, { id: number; nome: string }>;
}> {
  const rows = await db
    .select({ id: contatos.id, nome: contatos.nome, cpfCnpj: contatos.cpfCnpj })
    .from(contatos)
    .where(eq(contatos.escritorioId, escritorioId));
  const porDoc = new Map<string, { id: number; nome: string }>();
  const porNome = new Map<string, { id: number; nome: string }>();
  for (const r of rows) {
    const digs = (r.cpfCnpj ?? "").replace(/\D/g, "");
    if (digs) porDoc.set(digs, { id: r.id, nome: r.nome });
    porNome.set(normalizarNome(r.nome), { id: r.id, nome: r.nome });
  }
  return { porDoc, porNome };
}

export type MapaProcessos = {
  /** chave "contatoId|cnjNormalizado" → processoId. Detecta duplicata exata. */
  porContatoECnj: Map<string, number>;
  /** chave cnjNormalizado → lista de contatos vinculados. Detecta
   *  "mesmo CNJ vinculado a outro cliente do escritório" (possível
   *  duplicata acidental ou litisconsórcio legítimo). */
  porCnj: Map<string, { contatoId: number; contatoNome: string }[]>;
};

/**
 * Decide status de cada linha + se há contato/processo existente. Pura — só
 * mexe nos mapas que o caller carregou. Exportada pra testar isolado.
 */
export function decidirPreview(
  processos: LinhaAdvbox[],
  porDoc: Map<string, { id: number; nome: string }>,
  porNome: Map<string, { id: number; nome: string }>,
  mapaProcessos: MapaProcessos,
): PreviewLinha[] {
  return processos.map((p) => {
    let contatoExistenteId: number | null = null;
    let contatoExistenteNome: string | null = null;
    const primeiroCliente = p.clientes[0];
    if (primeiroCliente) {
      const m = primeiroCliente.cpfCnpj
        ? porDoc.get(primeiroCliente.cpfCnpj)
        : porNome.get(normalizarNome(primeiroCliente.nome));
      if (m) {
        contatoExistenteId = m.id;
        contatoExistenteNome = m.nome;
      }
    }

    let processoExistenteId: number | null = null;
    if (contatoExistenteId && p.cnj) {
      processoExistenteId =
        mapaProcessos.porContatoECnj.get(`${contatoExistenteId}|${p.cnj}`) ?? null;
    }

    // Lista de outros contatos que já têm esse CNJ. Filtra o próprio
    // contatoExistenteId pra não duplicar com `processoExistenteId`.
    const cnjEmOutrosContatos = p.cnj
      ? (mapaProcessos.porCnj.get(p.cnj) ?? []).filter(
          (c) => c.contatoId !== contatoExistenteId,
        )
      : [];

    let status: PreviewLinha["status"];
    if (p.clientes.length === 0) status = "sem_cliente";
    else if (!p.cnj || !p.cnjValido) status = "sem_cnj_invalido";
    else if (processoExistenteId) status = "ja_existe_processo";
    else if (cnjEmOutrosContatos.length > 0) status = "cnj_em_outro_cliente";
    else status = "novo";

    return {
      ...p,
      status,
      contatoExistenteId,
      contatoExistenteNome,
      processoExistenteId,
      cnjEmOutrosContatos,
    };
  });
}

export function resumirPreview(linhas: PreviewLinha[]): {
  novos: number;
  jaExistem: number;
  cnjEmOutroCliente: number;
  semCliente: number;
  semCnjOuInvalido: number;
} {
  return {
    novos: linhas.filter((l) => l.status === "novo").length,
    jaExistem: linhas.filter((l) => l.status === "ja_existe_processo").length,
    cnjEmOutroCliente: linhas.filter((l) => l.status === "cnj_em_outro_cliente").length,
    semCliente: linhas.filter((l) => l.status === "sem_cliente").length,
    semCnjOuInvalido: linhas.filter((l) => l.status === "sem_cnj_invalido").length,
  };
}

/**
 * Carrega ambos mapas de dedupe de processo em uma query única:
 *  - porContatoECnj: dedup exato (mesmo cliente + mesmo CNJ)
 *  - porCnj: detecta CNJ vinculado a outro cliente do escritório
 */
async function carregarMapaProcessos(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  escritorioId: number,
): Promise<MapaProcessos> {
  const rows = await db
    .select({
      id: clienteProcessos.id,
      contatoId: clienteProcessos.contatoId,
      numeroCnj: clienteProcessos.numeroCnj,
      contatoNome: contatos.nome,
    })
    .from(clienteProcessos)
    .innerJoin(contatos, eq(contatos.id, clienteProcessos.contatoId))
    .where(and(
      eq(clienteProcessos.escritorioId, escritorioId),
      isNotNull(clienteProcessos.numeroCnj),
    ));
  const porContatoECnj = new Map<string, number>();
  const porCnj = new Map<string, { contatoId: number; contatoNome: string }[]>();
  for (const r of rows) {
    if (!r.numeroCnj) continue;
    const cnjKey = r.numeroCnj.replace(/\D/g, "");
    porContatoECnj.set(`${r.contatoId}|${cnjKey}`, r.id);
    const lista = porCnj.get(cnjKey) ?? [];
    lista.push({ contatoId: r.contatoId, contatoNome: r.contatoNome });
    porCnj.set(cnjKey, lista);
  }
  return { porContatoECnj, porCnj };
}

export const importarProcessosRouter = router({
  /** Parseia o XLSX em memória + cruza com DB pra mostrar o que será criado/
   *  pulado. Não escreve nada. */
  previewAdvbox: protectedProcedure
    .input(z.object({
      xlsxBase64: z.string().min(1).max(MAX_BASE64_BYTES),
    }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "clientes", "criar");
      if (!perm.allowed) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão para importar processos." });
      }
      const permProc = await checkPermission(ctx.user.id, "clientes", "editar");
      if (!permProc.allowed) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão para vincular processos." });
      }

      const buf = Buffer.from(input.xlsxBase64, "base64");
      let parsed;
      try {
        parsed = await parseAdvboxXlsx(buf);
      } catch (err: any) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: err?.message ?? "Não foi possível ler a planilha.",
        });
      }

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível." });

      const { porDoc, porNome } = await carregarMapaContatos(db, perm.escritorioId);
      const mapaProcessos = await carregarMapaProcessos(db, perm.escritorioId);

      const linhas = decidirPreview(parsed.processos, porDoc, porNome, mapaProcessos);
      const resumo = resumirPreview(linhas);

      return {
        totalLinhas: parsed.totalLinhas,
        resumo,
        linhas,
      };
    }),

  /** Cria contato + vínculo de cada linha aprovada. Aceita até 100 linhas
   *  por chamada — UI deve quebrar em chunks pra dar feedback de progresso. */
  executarAdvbox: protectedProcedure
    .input(z.object({
      linhas: z.array(linhaExecucaoSchema).min(1).max(MAX_LINHAS_POR_CHAMADA),
    }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "clientes", "criar");
      if (!perm.allowed) throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão." });
      const permProc = await checkPermission(ctx.user.id, "clientes", "editar");
      if (!permProc.allowed) throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão." });

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível." });

      // Verifica limite de plano só uma vez, pelo total que vai criar.
      // Conservador: conta TODOS os clientes da request (mesmo que alguns
      // sejam dedupe — pior caso = bloqueia antes de tentar).
      const totalClientesPotenciais = input.linhas.reduce((sum, l) => sum + l.clientes.length, 0);
      if (totalClientesPotenciais > 0) {
        const limite = await verificarLimite(perm.escritorioId, ctx.user.id, "clientes");
        if (!limite.permitido) {
          throw new TRPCError({ code: "FORBIDDEN", message: limite.mensagem });
        }
      }

      // Mapas atualizados a cada inserção pra evitar duplicatas DENTRO do mesmo lote
      // (planilha pode ter o mesmo cliente em 5 linhas — só cria 1x).
      const { porDoc, porNome } = await carregarMapaContatos(db, perm.escritorioId);
      const mapaProcessos = await carregarMapaProcessos(db, perm.escritorioId);

      const resultado = {
        contatosCriados: 0,
        contatosReutilizados: 0,
        processosCriados: 0,
        processosJaExistiam: 0,
        erros: [] as { linhaNum: number; motivo: string }[],
      };

      for (const linha of input.linhas) {
        try {
          if (linha.clientes.length === 0) {
            resultado.erros.push({ linhaNum: linha.linhaNum, motivo: "Sem cliente." });
            continue;
          }
          if (!linha.cnj || !linha.cnjValido) {
            resultado.erros.push({ linhaNum: linha.linhaNum, motivo: "CNJ ausente ou inválido." });
            continue;
          }

          // 1) Cria/encontra cada cliente da linha. Vínculo do processo vai
          //    pro primeiro só (limitação do schema: contatoId é único por
          //    cliente_processos.row).
          const contatoIds: number[] = [];
          for (const c of linha.clientes) {
            const chaveDoc = c.cpfCnpj;
            const chaveNome = normalizarNome(c.nome);
            let achado = chaveDoc ? porDoc.get(chaveDoc) : porNome.get(chaveNome);

            if (!achado) {
              const [r] = await db.insert(contatos).values({
                escritorioId: perm.escritorioId,
                nome: c.nome,
                cpfCnpj: c.cpfCnpj ?? null,
                origem: "manual",
                tags: adicionarTag(null, TAG_IMPORT),
                responsavelId: perm.colaboradorId,
                documentacaoPendente: c.cpfCnpj === null,
              });
              const novoId = (r as { insertId: number }).insertId;
              achado = { id: novoId, nome: c.nome };
              if (chaveDoc) porDoc.set(chaveDoc, achado);
              porNome.set(chaveNome, achado);
              resultado.contatosCriados++;
            } else {
              resultado.contatosReutilizados++;
            }
            contatoIds.push(achado.id);
          }

          // 2) Vincula processo ao primeiro cliente.
          const contatoPrincipal = contatoIds[0];
          const chaveProc = `${contatoPrincipal}|${linha.cnj}`;
          if (mapaProcessos.porContatoECnj.has(chaveProc)) {
            resultado.processosJaExistiam++;
            continue;
          }

          const [r] = await db.insert(clienteProcessos).values({
            escritorioId: perm.escritorioId,
            contatoId: contatoPrincipal,
            numeroCnj: linha.cnj,
            tribunal: linha.tribunal ?? null,
            classe: linha.classe ?? null,
            valorCausa: linha.valorCausaCentavos ?? null,
            polo: "ativo",
            tipo: "litigioso",
            criadoPor: ctx.user.id,
          });
          const novoProcId = (r as { insertId: number }).insertId;
          mapaProcessos.porContatoECnj.set(chaveProc, novoProcId);
          // Atualiza também o mapaPorCnj pra dedupe cross-cliente DENTRO do
          // batch (linha A cria CNJ X com cliente 1; linha B com CNJ X em
          // cliente 2 deve ser detectada como duplicata na 2ª iteração).
          const listaCnj = mapaProcessos.porCnj.get(linha.cnj) ?? [];
          listaCnj.push({ contatoId: contatoPrincipal, contatoNome: linha.clientes[0]?.nome ?? "" });
          mapaProcessos.porCnj.set(linha.cnj, listaCnj);
          resultado.processosCriados++;
        } catch (err: any) {
          log.warn(
            { linhaNum: linha.linhaNum, err: err?.message },
            "Erro ao importar linha — pulando",
          );
          resultado.erros.push({
            linhaNum: linha.linhaNum,
            motivo: err?.message ?? "Erro inesperado.",
          });
        }
      }

      return resultado;
    }),
});

// Re-exports usados nos testes (helpers internos viram públicos só pro test).
export const __test = { normalizarNome, adicionarTag };
