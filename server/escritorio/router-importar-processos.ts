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
import { and, eq, isNotNull } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  contatos,
  clienteProcessos,
  motorMonitoramentos,
  cofreCredenciais,
} from "../../drizzle/schema";
import { checkPermission } from "./check-permission";
import { verificarLimite } from "../billing/plan-limits";
import { parseAdvboxXlsx, type LinhaAdvbox } from "../processos/parser-advbox";
import { sistemaCofrePorTribunal } from "../processos/cnj-parser";
import { mascararCnj } from "../../scripts/spike-motor-proprio/lib/parser-utils";
import { createLogger } from "../_core/logger";

/** Custo em créditos pra monitorar 1 processo por mês. Bate com `CUSTOS.monitorar_processo_mes` em routers/processos.ts. */
const CUSTO_MONITORAMENTO_MES = 2;

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
  codigoTribunal: z.string().nullable(),
  temMotorProprio: z.boolean(),
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
  /** Pra cada sistema de cofre (ex: "pje_tjce"), quantas linhas "novas"
   *  são elegíveis pra monitoramento automático. UI usa pra calcular
   *  custo de créditos e filtrar credenciais úteis no dropdown. */
  monitoraveisPorSistema: Record<string, number>;
  /** Tribunais com motor próprio sem cofre (TRF-5 consulta pública). UI
   *  mostra como elegível sem dropdown de credencial. */
  monitoraveisConsultaPublica: number;
} {
  const novos = linhas.filter((l) => l.status === "novo");
  // Monitor é independente do vínculo: linhas "novo" + "ja_existe_processo"
  // podem ambas ser monitoradas (vínculo já criado antes via import anterior
  // ou cadastro manual continua sendo válido pra ativar monitor agora).
  const monitoraveis = linhas.filter(
    (l) => l.status === "novo" || l.status === "ja_existe_processo",
  );
  const monitoraveisPorSistema: Record<string, number> = {};
  // Tribunais com motor próprio MAS sem credencial (consulta pública —
  // TRF-5 etc). Contabilizados separado porque UI não pede credencial
  // pra ativar — só toggle. Custo de crédito é o mesmo.
  let monitoraveisConsultaPublica = 0;
  for (const l of monitoraveis) {
    if (!l.temMotorProprio || !l.codigoTribunal) continue;
    const sistema = sistemaCofrePorTribunal(l.codigoTribunal);
    if (sistema) {
      monitoraveisPorSistema[sistema] = (monitoraveisPorSistema[sistema] ?? 0) + 1;
    } else {
      // temMotorProprio=true + sistemaCofre=null = consulta pública.
      monitoraveisConsultaPublica++;
    }
  }
  return {
    novos: novos.length,
    jaExistem: linhas.filter((l) => l.status === "ja_existe_processo").length,
    cnjEmOutroCliente: linhas.filter((l) => l.status === "cnj_em_outro_cliente").length,
    semCliente: linhas.filter((l) => l.status === "sem_cliente").length,
    semCnjOuInvalido: linhas.filter((l) => l.status === "sem_cnj_invalido").length,
    monitoraveisPorSistema,
    monitoraveisConsultaPublica,
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
   *  por chamada — UI deve quebrar em chunks pra dar feedback de progresso.
   *
   *  Quando `monitorar=true` + `credencialId` válido, também ativa monitor
   *  automático de movimentações nos processos elegíveis (tribunal tem
   *  motor próprio E credencial é do mesmo sistema do tribunal). Cobra
   *  CUSTO_MONITORAMENTO_MES créditos por processo monitorado. Sem saldo
   *  → linha vira vínculo só (não monitora; registra em erros). */
  executarAdvbox: protectedProcedure
    .input(z.object({
      linhas: z.array(linhaExecucaoSchema).min(1).max(MAX_LINHAS_POR_CHAMADA),
      monitorar: z.boolean().optional(),
      credencialId: z.number().int().positive().optional(),
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

      // Se vai monitorar, valida credencial (se passada) uma vez fora do
      // loop. Credencial é OPCIONAL agora: TRF-5 e demais consulta pública
      // monitoram sem ela. Pra processos que EXIGEM credencial (PJe-TJ),
      // a linha cai como "não elegível" quando credencialSistema=null.
      let credencialSistema: string | null = null;
      if (input.monitorar && input.credencialId) {
        const [cred] = await db
          .select()
          .from(cofreCredenciais)
          .where(and(
            eq(cofreCredenciais.id, input.credencialId),
            eq(cofreCredenciais.escritorioId, perm.escritorioId),
            eq(cofreCredenciais.status, "ativa"),
          ))
          .limit(1);
        if (!cred) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Credencial não encontrada ou inativa.",
          });
        }
        credencialSistema = cred.sistema;
      }

      // Mapas atualizados a cada inserção pra evitar duplicatas DENTRO do mesmo lote
      // (planilha pode ter o mesmo cliente em 5 linhas — só cria 1x).
      const { porDoc, porNome } = await carregarMapaContatos(db, perm.escritorioId);
      const mapaProcessos = await carregarMapaProcessos(db, perm.escritorioId);

      // Mapa de CNJs já monitorados (independente de qual credencial). Evita
      // criar monitoramento duplicado quando o user já ativou manualmente
      // antes ou quando re-importa a mesma planilha.
      const cnjsJaMonitorados = new Set<string>();
      if (input.monitorar) {
        const monsExistentes = await db
          .select({ searchKey: motorMonitoramentos.searchKey })
          .from(motorMonitoramentos)
          .where(and(
            eq(motorMonitoramentos.escritorioId, perm.escritorioId),
            eq(motorMonitoramentos.tipoMonitoramento, "movimentacoes"),
          ));
        for (const m of monsExistentes) {
          if (m.searchKey) cnjsJaMonitorados.add(m.searchKey.replace(/\D/g, ""));
        }
      }

      const resultado = {
        contatosCriados: 0,
        contatosReutilizados: 0,
        processosCriados: 0,
        processosJaExistiam: 0,
        monitoramentosCriados: 0,
        monitoramentosJaExistiam: 0,
        monitoramentosNaoElegiveis: 0,
        creditosConsumidos: 0,
        erros: [] as { linhaNum: number; motivo: string }[],
      };

      // `consumirCreditosEscritorio` é dinâmico pra evitar import circular
      // do billing (que importa o schema, que importa este router).
      const { consumirCreditosEscritorio } = input.monitorar
        ? await import("../billing/escritorio-creditos")
        : { consumirCreditosEscritorio: null as any };

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

          // 2) Vincula processo ao primeiro cliente — só insere se ainda
          //    não existe. Se já existe (re-import ou cadastro manual
          //    anterior), prossegue pra etapa de monitor: o user pode
          //    estar re-importando JUSTO pra ativar monitor que não foi
          //    ligado na 1ª vez.
          const contatoPrincipal = contatoIds[0];
          const chaveProc = `${contatoPrincipal}|${linha.cnj}`;
          if (mapaProcessos.porContatoECnj.has(chaveProc)) {
            resultado.processosJaExistiam++;
          } else {
            await db.insert(clienteProcessos).values({
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
            // Atualiza o mapaPorCnj pra dedupe cross-cliente DENTRO do
            // batch (linha A cria CNJ X com cliente 1; linha B com CNJ X
            // em cliente 2 deve ser detectada como duplicata na 2ª iteração).
            const listaCnj = mapaProcessos.porCnj.get(linha.cnj) ?? [];
            listaCnj.push({ contatoId: contatoPrincipal, contatoNome: linha.clientes[0]?.nome ?? "" });
            mapaProcessos.porCnj.set(linha.cnj, listaCnj);
            // Marca chave como criada — evita re-tentar em chunk seguinte.
            mapaProcessos.porContatoECnj.set(chaveProc, 0);
            resultado.processosCriados++;
          }

          // 3) Ativa monitoramento automático se pedido + elegível.
          //    Linha elegível = tem motor próprio E uma das 2 condições:
          //      (a) tribunal usa cofre + credencial bate com sistema
          //      (b) tribunal é consulta pública (TRF-5) — credencial irrelevante
          //    Falhas aqui (sem créditos, etc) não desfazem o vínculo já
          //    criado — só registram em erros pra UI mostrar.
          if (input.monitorar) {
            try {
              if (!linha.temMotorProprio || !linha.codigoTribunal) {
                resultado.monitoramentosNaoElegiveis++;
              } else {
                const sistemaDoTribunal = sistemaCofrePorTribunal(linha.codigoTribunal);
                const consultaPublica = sistemaDoTribunal === null;
                const credBate =
                  sistemaDoTribunal !== null &&
                  credencialSistema !== null &&
                  sistemaDoTribunal === credencialSistema;

                if (!consultaPublica && !credBate) {
                  // Precisa de credencial mas a escolhida não bate (ou não foi
                  // escolhida).
                  resultado.monitoramentosNaoElegiveis++;
                } else if (cnjsJaMonitorados.has(linha.cnj)) {
                  resultado.monitoramentosJaExistiam++;
                } else {
                  await consumirCreditosEscritorio(
                    perm.escritorioId,
                    ctx.user.id,
                    CUSTO_MONITORAMENTO_MES,
                    "monitorar_processo_mes",
                    `Import Advbox CNJ ${linha.cnj} (${linha.tribunal ?? "?"})`,
                  );
                  const cnjMascarado = mascararCnj(linha.cnj);
                  await db.insert(motorMonitoramentos).values({
                    escritorioId: perm.escritorioId,
                    criadoPor: ctx.user.id,
                    tipoMonitoramento: "movimentacoes",
                    searchType: "lawsuit_cnj",
                    searchKey: cnjMascarado,
                    apelido: cnjMascarado,
                    tribunal: linha.codigoTribunal,
                    // TRF-5 etc não usa credencial — fica NULL no schema
                    credencialId: consultaPublica ? null : input.credencialId,
                    status: "ativo",
                    recurrenceHoras: 6,
                    ultimaCobrancaEm: new Date(),
                  });
                  cnjsJaMonitorados.add(linha.cnj);
                  resultado.monitoramentosCriados++;
                  resultado.creditosConsumidos += CUSTO_MONITORAMENTO_MES;
                }
              }
            } catch (err: any) {
              log.warn(
                { linhaNum: linha.linhaNum, cnj: linha.cnj, err: err?.message },
                "Falha ao ativar monitoramento — vínculo já foi criado",
              );
              resultado.erros.push({
                linhaNum: linha.linhaNum,
                motivo: `Monitor não criado: ${err?.message ?? "erro desconhecido"}`,
              });
            }
          }
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
