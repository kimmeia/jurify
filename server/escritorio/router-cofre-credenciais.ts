/**
 * Router Cofre de Credenciais.
 *
 * Armazena credenciais (CPF/OAB + senha + 2FA TOTP) que permitem ao
 * motor próprio acessar tribunais autenticados (PJe TJCE, E-SAJ, etc)
 * com a OAB do dono do escritório.
 *
 * SEGURANÇA EM CAMADAS:
 *  1. `protectedProcedure` + gate `exigirAdminProcessos` — apenas
 *     dono/gestor (ou cargos personalizados com `verTodos` em processos)
 *     podem cadastrar/editar credenciais
 *  2. Senha + TOTP secret criptografados com AES-256-GCM
 *     (server/escritorio/crypto-utils.ts) ANTES de tocar disco
 *  3. Backend NUNCA retorna senha/TOTP em claro — só `usernameMascarado`
 *  4. `cofre_credenciais.escritorioId` isola credenciais por escritório
 *  5. Soft delete via status="removida" preserva auditoria
 *
 * Exceção ao gate admin: `listarParaSelecao` é user-level (qualquer
 * colaborador do escritório) pra alimentar dropdown de "selecionar
 * credencial" no fluxo de criar monitoramento.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and, desc, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { cofreCredenciais, cofreSessoes, motorMonitoramentos } from "../../drizzle/schema";
import { encrypt, maskToken } from "./crypto-utils";
import { getEscritorioPorUsuario } from "./db-escritorio";
import { checkPermission } from "./check-permission";
import { createLogger } from "../_core/logger";
import { configPorSistema, tribunalRequerCredencial } from "../processos/tribunais-pdpj";
import { deveReligarMonitoramento } from "./cofre-helpers";
import {
  COFRE_VALIDACOES,
  type CofreCredencialView,
  type SistemaCofre,
  type StatusCredencial,
} from "@shared/cofre-credenciais-types";

/**
 * Cofre é restrito a admin do módulo processos: cargo com `verTodos=true`
 * em processos. Hoje na matriz padrão: dono e gestor passam, atendente/SDR/
 * estagiário ficam bloqueados (têm verProprios mas não verTodos).
 *
 * Cargos personalizados com `verTodos=true` em processos também passam —
 * o gate é por permissão, não por nome de cargo.
 */
async function exigirAdminProcessos(userId: number): Promise<void> {
  const perm = await checkPermission(userId, "processos", "ver");
  if (!perm.verTodos) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "Acesso ao cofre exige permissão administrativa em Processos (ver tudo). " +
        "Solicite ao dono do escritório.",
    });
  }
}

const log = createLogger("cofre-credenciais");

const SISTEMAS_VALIDOS: readonly SistemaCofre[] = [
  "pje_tjce", "pje_tjrj", "pje_tjmg", "pje_tjdft", "pje_tjpe", "pje_tjes",
  "pje_tjpr", "pje_tjrs", "pje_tjgo", "pje_*",
  "esaj_tjsp", "esaj_tjsc", "esaj_tjba", "esaj_tjam", "esaj_tjac",
  "esaj_tjto", "esaj_tjms", "esaj_tjal", "esaj_*",
  "pje_restrito_trt1", "pje_restrito_trt2", "pje_restrito_trt7",
  "pje_restrito_trt15", "pje_restrito_*",
  "eproc_trf2", "eproc_trf4", "eproc_*",
] as const;

async function resolverEscritorioId(userId: number): Promise<number> {
  const esc = await getEscritorioPorUsuario(userId);
  if (!esc) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Cofre de credenciais exige escritório cadastrado. " +
        "Crie um escritório primeiro em /configuracoes.",
    });
  }
  return esc.escritorio.id;
}

async function rowParaView(
  row: typeof cofreCredenciais.$inferSelect,
): Promise<CofreCredencialView> {
  const { decrypt } = await import("./crypto-utils");
  let usernameClean = "";
  try {
    usernameClean = decrypt(row.usernameEnc, row.usernameIv, row.usernameTag);
  } catch {
    usernameClean = "??";
  }
  return {
    id: row.id,
    escritorioId: row.escritorioId,
    sistema: row.sistema as SistemaCofre,
    apelido: row.apelido,
    usernameMascarado: maskToken(usernameClean, 4),
    tem2fa: !!row.totpSecretEnc,
    status: row.status as StatusCredencial,
    ultimoLoginSucessoEm: row.ultimoLoginSucessoEm?.toISOString() ?? null,
    ultimoLoginTentativaEm: row.ultimoLoginTentativaEm?.toISOString() ?? null,
    ultimoErro: row.ultimoErro,
    criadoEm: row.createdAt.toISOString(),
    atualizadoEm: row.updatedAt.toISOString(),
  };
}

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/**
 * Marca da pausa que NÓS causamos ao remover a credencial.
 *
 * `deveReligarMonitoramento` se recusa a religar o que está pausado, e com
 * razão: pausa costuma ser escolha de quem usa, e desfazê-la por baixo seria
 * ignorar essa escolha. Esta pausa é a exceção — foi efeito colateral de uma
 * remoção, não decisão sobre o processo. Sem a marca, quem removesse a
 * credencial e depois cadastrasse outra encontraria os processos parados pra
 * sempre, sem nada indicando o que fazer.
 */
const PAUSA_POR_REMOCAO = "Pausado: credencial removida do cofre";

/**
 * Quantos monitoramentos dependem desta credencial, e quem poderia assumir.
 *
 * O candidato a destino é sempre do MESMO sistema e está ativo. Nunca devolve
 * a própria credencial — e quando não há candidato, devolver `null` é a
 * resposta certa: significa que remover vai parar processo.
 */
async function calcularImpacto(db: Db, escritorioId: number, credencialId: number) {
  const [cred] = await db
    .select({ sistema: cofreCredenciais.sistema, apelido: cofreCredenciais.apelido })
    .from(cofreCredenciais)
    .where(
      and(eq(cofreCredenciais.id, credencialId), eq(cofreCredenciais.escritorioId, escritorioId)),
    )
    .limit(1);

  const [linha] = await db
    .select({ total: sql<number>`COUNT(*)` })
    .from(motorMonitoramentos)
    .where(
      and(
        eq(motorMonitoramentos.escritorioId, escritorioId),
        eq(motorMonitoramentos.credencialId, credencialId),
      ),
    );

  const [destino] = cred
    ? await db
        .select({ id: cofreCredenciais.id, apelido: cofreCredenciais.apelido })
        .from(cofreCredenciais)
        .where(
          and(
            eq(cofreCredenciais.escritorioId, escritorioId),
            eq(cofreCredenciais.sistema, cred.sistema),
            eq(cofreCredenciais.status, "ativa"),
            ne(cofreCredenciais.id, credencialId),
          ),
        )
        .orderBy(desc(cofreCredenciais.ultimoLoginSucessoEm))
        .limit(1)
    : [];

  return {
    apelido: cred?.apelido ?? null,
    sistema: cred?.sistema ?? null,
    monitoramentos: Number(linha?.total ?? 0),
    destinoSugerido: destino ?? null,
  };
}

/**
 * Aponta os monitoramentos de uma credencial pra outra.
 *
 * Além de trocar o vínculo, limpa o erro dos que pararam POR CAUSA da
 * credencial — senão o processo continuaria exibindo "sessão expirada" até a
 * próxima varredura e pareceria que repontar não fez nada. Erro de outra
 * natureza (CNJ inválido, por exemplo) fica onde está: apagá-lo seria mentir.
 */
interface Alvos {
  /** Podem ir pro destino: precisam de credencial e são do tribunal dele. */
  aceitos: Array<{ id: number; status: string; ultimoErro: string | null }>;
  /** Estavam presos na credencial mas o destino não atende o tribunal deles. */
  sobram: number[];
}

/**
 * Separa quem o destino consegue atender de quem não consegue.
 *
 * Fica separado da escrita porque a decisão de remover depende deste número:
 * pedir confirmação DEPOIS de já ter gravado metade seria deixar o banco num
 * estado que ninguém escolheu.
 *
 * Duas exclusões, por motivos diferentes. Tribunal de consulta pública
 * (TRF-5) roda SEM cofre, e o vínculo nulo dele é proposital, não órfão —
 * amarrá-lo a uma OAB do TJCE seria inventar uma dependência que não existe.
 * E a credencial só serve o tribunal DELA: uma do TJCE não abre processo do
 * TJMG. Comparar o "sistema" das duas pontas não bastava, porque no caminho
 * `de = null` não existe ponta de origem pra comparar.
 */
async function separarAlvos(
  db: Db,
  escritorioId: number,
  de: number | null,
  sistemaDestino: string,
): Promise<Alvos> {
  const candidatos = await db
    .select({
      id: motorMonitoramentos.id,
      status: motorMonitoramentos.status,
      ultimoErro: motorMonitoramentos.ultimoErro,
      tribunal: motorMonitoramentos.tribunal,
    })
    .from(motorMonitoramentos)
    .where(
      and(
        eq(motorMonitoramentos.escritorioId, escritorioId),
        de == null
          ? isNull(motorMonitoramentos.credencialId)
          : eq(motorMonitoramentos.credencialId, de),
      ),
    );

  const tribunalDestino = configPorSistema(sistemaDestino)?.tribunal ?? null;
  const aceitos: Alvos["aceitos"] = [];
  const sobram: number[] = [];
  for (const c of candidatos) {
    if (!tribunalRequerCredencial(c.tribunal)) continue;
    if (c.tribunal === tribunalDestino) {
      aceitos.push({ id: c.id, status: c.status, ultimoErro: c.ultimoErro });
    } else {
      sobram.push(c.id);
    }
  }
  return { aceitos, sobram };
}

/**
 * Aponta os monitoramentos aceitos pra nova credencial.
 *
 * Além de trocar o vínculo, limpa o erro dos que pararam POR CAUSA da
 * credencial — senão o processo continuaria exibindo "sessão expirada" até a
 * próxima varredura e pareceria que reapontar não fez nada. Erro de outra
 * natureza (CNJ inválido, por exemplo) fica onde está: apagá-lo seria mentir.
 */
async function aplicarRepontar(db: Db, aceitos: Alvos["aceitos"], para: number): Promise<number> {
  if (aceitos.length === 0) return 0;

  await db
    .update(motorMonitoramentos)
    .set({ credencialId: para })
    .where(inArray(motorMonitoramentos.id, aceitos.map((a) => a.id)));

  const religar = aceitos
    .filter((a) => deveReligarMonitoramento(a) || a.ultimoErro?.startsWith(PAUSA_POR_REMOCAO))
    .map((a) => a.id);
  if (religar.length > 0) {
    await db
      .update(motorMonitoramentos)
      .set({ status: "ativo", ultimoErro: null })
      .where(inArray(motorMonitoramentos.id, religar));
  }
  return aceitos.length;
}

/**
 * Desliga o vínculo dos que ficaram sem quem os atenda.
 *
 * Pausado e não "erro": nada falhou, foi consequência de uma remoção. Deixar
 * o vínculo apontando pra credencial apagada seria recriar exatamente o
 * problema que este código veio consertar.
 */
async function pausarSemCredencial(
  db: Db,
  ids: number[],
  apelidoRemovido: string,
): Promise<number> {
  if (ids.length === 0) return 0;
  await db
    .update(motorMonitoramentos)
    .set({
      credencialId: null,
      status: "pausado",
      ultimoErro: `${PAUSA_POR_REMOCAO} ("${apelidoRemovido}"). Cadastre outra credencial e reaponte estes processos.`,
    })
    .where(inArray(motorMonitoramentos.id, ids));
  return ids.length;
}

export const cofreCredenciaisRouter = router({
  /** Lista credenciais do escritório. Apenas admin de processos (dono/gestor). */
  listarMinhas: protectedProcedure.query(async ({ ctx }) => {
    await exigirAdminProcessos(ctx.user.id);
    const db = await getDb();
    if (!db) return [];
    const escritorioId = await resolverEscritorioId(ctx.user.id);
    const rows = await db
      .select()
      .from(cofreCredenciais)
      .where(
        and(
          eq(cofreCredenciais.escritorioId, escritorioId),
          ne(cofreCredenciais.status, "removida"),
        ),
      )
      .orderBy(desc(cofreCredenciais.createdAt));
    return Promise.all(rows.map(rowParaView));
  }),

  /**
   * Variante de `listarMinhas` SEM gate de admin — qualquer colaborador
   * do escritório pode chamar pra preencher dropdown de "selecionar
   * credencial" no fluxo de criar monitoramento. Retorna a mesma view
   * mascarada (sem expor senha/secret).
   *
   * Justificativa: criar monitoramento é operação user-level (qualquer
   * colaborador com permissão `processos.editar` pode), mas só donos/
   * gestores podem CADASTRAR/EDITAR credenciais (`listarMinhas`).
   */
  listarParaSelecao: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return [];
    const escritorioId = await resolverEscritorioId(ctx.user.id);
    const rows = await db
      .select()
      .from(cofreCredenciais)
      .where(
        and(
          eq(cofreCredenciais.escritorioId, escritorioId),
          ne(cofreCredenciais.status, "removida"),
        ),
      )
      .orderBy(desc(cofreCredenciais.createdAt));
    return Promise.all(rows.map(rowParaView));
  }),

  /**
   * Lista os sistemas de tribunal disponíveis pra cadastro no cofre.
   * Hoje só `pje_tjce` tem adapter de login automatizado; outros aparecem
   * como "em desenvolvimento" pra setar expectativa correta no dropdown.
   */
  listarMinhasSistemasSuportados: protectedProcedure.query(() => {
    return [
      { id: "pje_tjce", label: "PJe TJCE — 1º grau (disponível)", disponivel: true },
      { id: "esaj_tjsp", label: "E-SAJ TJSP — em desenvolvimento", disponivel: false },
      { id: "pje_tjrj", label: "PJe TJRJ — em desenvolvimento", disponivel: false },
      { id: "pje_tjmg", label: "PJe TJMG — em desenvolvimento", disponivel: false },
      { id: "pje_restrito_trt7", label: "PJe TRT-7 — em desenvolvimento", disponivel: false },
    ];
  }),

  /** Cadastra credencial pessoal. */
  cadastrarMinha: protectedProcedure
    .input(
      z.object({
        sistema: z.enum(SISTEMAS_VALIDOS as readonly [SistemaCofre, ...SistemaCofre[]]),
        apelido: z.string().min(COFRE_VALIDACOES.apelidoMinLen).max(COFRE_VALIDACOES.apelidoMaxLen),
        username: z.string().min(COFRE_VALIDACOES.usernameMinLen).max(COFRE_VALIDACOES.usernameMaxLen),
        password: z.string().min(COFRE_VALIDACOES.passwordMinLen).max(COFRE_VALIDACOES.passwordMaxLen),
        totpSecret: z.string().min(COFRE_VALIDACOES.totpSecretMinLen).max(COFRE_VALIDACOES.totpSecretMaxLen).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await exigirAdminProcessos(ctx.user.id);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });
      const escritorioId = await resolverEscritorioId(ctx.user.id);

      const userEnc = encrypt(input.username);
      const passEnc = encrypt(input.password);
      const totpEnc = input.totpSecret ? encrypt(input.totpSecret) : null;

      const result = await db.insert(cofreCredenciais).values({
        escritorioId,
        sistema: input.sistema,
        apelido: input.apelido,
        usernameEnc: userEnc.encrypted,
        usernameIv: userEnc.iv,
        usernameTag: userEnc.tag,
        passwordEnc: passEnc.encrypted,
        passwordIv: passEnc.iv,
        passwordTag: passEnc.tag,
        totpSecretEnc: totpEnc?.encrypted,
        totpSecretIv: totpEnc?.iv,
        totpSecretTag: totpEnc?.tag,
        status: "validando",
        criadoPor: ctx.user.id,
      });
      const insertId =
        (result as unknown as { insertId: number }[])[0]?.insertId ??
        (result as unknown as { insertId: number }).insertId;

      log.info(
        { user: ctx.user.id, escritorioId, sistema: input.sistema, credencialId: insertId },
        "[cofre] credencial cadastrada",
      );

      const [row] = await db
        .select()
        .from(cofreCredenciais)
        .where(eq(cofreCredenciais.id, insertId))
        .limit(1);
      return rowParaView(row);
    }),

  /** Soft delete da credencial — apenas admin de processos (dono/gestor). */
  /**
   * O que quebra se esta credencial for removida.
   *
   * Existe porque remover era silencioso: os monitoramentos guardam o ID da
   * credencial, e apagar a credencial deixava todos apontando pro vazio. O
   * dono via a lista limpar e descobria dias depois que o robô tinha parado.
   */
  impactoRemocao: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      await exigirAdminProcessos(ctx.user.id);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });
      const escritorioId = await resolverEscritorioId(ctx.user.id);
      const impacto = await calcularImpacto(db, escritorioId, input.id);
      if (!impacto.destinoSugerido || impacto.monitoramentos === 0) {
        return { ...impacto, vaoMudar: 0, vaoPausar: impacto.monitoramentos };
      }
      // A tela precisa da divisão, não do total: dizer "todos passam para X"
      // seria falso quando o destino não atende o tribunal de alguns deles.
      const { aceitos, sobram } = await separarAlvos(
        db,
        escritorioId,
        input.id,
        impacto.sistema ?? "",
      );
      return { ...impacto, vaoMudar: aceitos.length, vaoPausar: sobram.length };
    }),

  /**
   * Monitoramentos apontando pra credencial que não pode mais atender.
   *
   * Nenhuma tela mostrava esse vínculo, então um processo podia ficar parado
   * indefinidamente apontando pra uma credencial removida sem que nada na
   * interface dissesse o motivo.
   */
  vinculosOrfaos: protectedProcedure.query(async ({ ctx }) => {
    await exigirAdminProcessos(ctx.user.id);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });
    const escritorioId = await resolverEscritorioId(ctx.user.id);

    const grupos = await db
      .select({
        credencialId: motorMonitoramentos.credencialId,
        total: sql<number>`COUNT(*)`,
      })
      .from(motorMonitoramentos)
      .where(
        and(
          eq(motorMonitoramentos.escritorioId, escritorioId),
          isNotNull(motorMonitoramentos.credencialId),
        ),
      )
      .groupBy(motorMonitoramentos.credencialId);

    const credenciais = await db
      .select({
        id: cofreCredenciais.id,
        apelido: cofreCredenciais.apelido,
        sistema: cofreCredenciais.sistema,
        status: cofreCredenciais.status,
      })
      .from(cofreCredenciais)
      .where(eq(cofreCredenciais.escritorioId, escritorioId));

    const porId = new Map(credenciais.map((c) => [c.id, c]));
    return grupos
      .map((g) => {
        const cred = g.credencialId != null ? porId.get(g.credencialId) : undefined;
        return {
          credencialId: g.credencialId,
          total: Number(g.total),
          apelido: cred?.apelido ?? null,
          sistema: cred?.sistema ?? null,
          status: cred?.status ?? null,
          // Sem credencial, removida ou caída: em qualquer um dos três o
          // processo não roda até alguém repontar.
          saudavel: cred?.status === "ativa",
        };
      })
      .filter((g) => !g.saudavel)
      .sort((a, b) => b.total - a.total);
  }),

  /**
   * Move os monitoramentos de uma credencial pra outra.
   *
   * É o conserto de quem já ficou órfão. A credencial de destino tem que ser
   * do MESMO sistema — repontar um processo do TJCE pra uma credencial de
   * outro tribunal produziria falha de login com cara de senha errada.
   */
  repontarMonitoramentos: protectedProcedure
    .input(
      z.object({
        de: z.number().int().positive().nullable(),
        para: z.number().int().positive(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await exigirAdminProcessos(ctx.user.id);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });
      const escritorioId = await resolverEscritorioId(ctx.user.id);

      const [destino] = await db
        .select()
        .from(cofreCredenciais)
        .where(
          and(
            eq(cofreCredenciais.id, input.para),
            eq(cofreCredenciais.escritorioId, escritorioId),
          ),
        )
        .limit(1);
      if (!destino) throw new TRPCError({ code: "NOT_FOUND", message: "Credencial de destino não encontrada" });
      if (destino.status === "removida") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "A credencial de destino está removida.",
        });
      }

      if (input.de != null) {
        const [origem] = await db
          .select({ sistema: cofreCredenciais.sistema })
          .from(cofreCredenciais)
          .where(
            and(
              eq(cofreCredenciais.id, input.de),
              eq(cofreCredenciais.escritorioId, escritorioId),
            ),
          )
          .limit(1);
        if (origem && origem.sistema !== destino.sistema) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              `Sistemas diferentes: os processos são de ${origem.sistema} e a credencial ` +
              `escolhida é de ${destino.sistema}.`,
          });
        }
      }

      const { aceitos } = await separarAlvos(db, escritorioId, input.de, destino.sistema);
      const movidos = await aplicarRepontar(db, aceitos, destino.id);
      log.info(
        { user: ctx.user.id, escritorioId, de: input.de, para: destino.id, movidos },
        "[cofre] monitoramentos repontados",
      );
      return { movidos, destino: destino.apelido };
    }),

  removerMinha: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        /**
         * Só necessário quando não há outra credencial pra assumir. Sem isto,
         * remover pausaria processos em silêncio — que é exatamente o que
         * acontecia antes.
         */
        confirmarPausarMonitoramentos: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await exigirAdminProcessos(ctx.user.id);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });
      const escritorioId = await resolverEscritorioId(ctx.user.id);

      const [existente] = await db
        .select()
        .from(cofreCredenciais)
        .where(
          and(
            eq(cofreCredenciais.id, input.id),
            eq(cofreCredenciais.escritorioId, escritorioId),
          ),
        )
        .limit(1);
      if (!existente) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Credencial não encontrada" });
      }

      // Os monitoramentos guardam o ID da credencial. Removê-la sem tratar o
      // vínculo deixava todos eles apontando pro vazio — e como nada na tela
      // mostrava isso, o robô parava e o motivo ficava invisível.
      const impacto = await calcularImpacto(db, escritorioId, input.id);

      // Tudo é decidido ANTES de qualquer escrita. Pedir confirmação depois de
      // já ter movido metade deixaria o banco num estado que ninguém escolheu.
      const { aceitos, sobram } = impacto.destinoSugerido
        ? await separarAlvos(db, escritorioId, input.id, existente.sistema)
        : { aceitos: [], sobram: [] as number[] };

      // Quem vai parar: os que nenhum destino atende, mais todos os vinculados
      // quando não existe destino nenhum.
      const vaoPausar = impacto.destinoSugerido
        ? sobram
        : (
            await db
              .select({ id: motorMonitoramentos.id })
              .from(motorMonitoramentos)
              .where(
                and(
                  eq(motorMonitoramentos.escritorioId, escritorioId),
                  eq(motorMonitoramentos.credencialId, input.id),
                ),
              )
          ).map((m) => m.id);

      if (vaoPausar.length > 0 && !input.confirmarPausarMonitoramentos) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            `${vaoPausar.length} processo(s) monitorado(s) vão ficar sem credencial e serão ` +
            `pausados${impacto.destinoSugerido ? ` (a credencial "${impacto.destinoSugerido.apelido}" não atende o tribunal deles)` : ""}. ` +
            `Confirme se é isso mesmo que você quer.`,
        });
      }

      const repontados = await aplicarRepontar(db, aceitos, impacto.destinoSugerido?.id ?? 0);
      const pausados = await pausarSemCredencial(db, vaoPausar, existente.apelido);

      await db
        .update(cofreCredenciais)
        .set({ status: "removida" })
        .where(eq(cofreCredenciais.id, input.id));

      // A sessão vive noutra tabela e o cookie dela continua válido por até
      // 90 minutos. Deixá-la para trás mantém uma porta aberta pro tribunal
      // com um login que o dono acabou de apagar.
      await db.delete(cofreSessoes).where(eq(cofreSessoes.credencialId, input.id));

      log.info(
        { user: ctx.user.id, escritorioId, credencialId: input.id, repontados, pausados },
        "[cofre] credencial removida",
      );
      return {
        ok: true,
        repontados,
        pausados,
        destino: impacto.destinoSugerido?.apelido ?? null,
      };
    }),

  /** Validar credencial — login real no tribunal. Apenas admin de processos (dono/gestor). */
  validarMinha: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      await exigirAdminProcessos(ctx.user.id);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });
      const escritorioId = await resolverEscritorioId(ctx.user.id);

      const [row] = await db
        .select()
        .from(cofreCredenciais)
        .where(
          and(
            eq(cofreCredenciais.id, input.id),
            eq(cofreCredenciais.escritorioId, escritorioId),
          ),
        )
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Credencial não encontrada" });

      const { buscarCredencialDecriptada, atualizarStatusAposLogin, salvarSessao } =
        await import("./cofre-helpers");
      const cred = await buscarCredencialDecriptada(input.id);
      if (!cred) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Credencial não pode ser decriptada",
        });
      }

      log.info(
        { user: ctx.user.id, credencialId: input.id, sistema: cred.sistema },
        "[cofre] validando credencial via login real",
      );

      const cfgTribunal = configPorSistema(cred.sistema);
      if (cfgTribunal) {
        const { PjeTjceScraper } = await import(
          "../../scripts/spike-motor-proprio/poc-2-esaj-login/adapters/pje-tjce"
        );
        const scraper = new PjeTjceScraper(
          {
            username: cred.username,
            password: cred.password,
            totpSecret: cred.totpSecret,
          },
          cfgTribunal,
        );
        const resultado = await scraper.testarLogin();

        if (resultado.ok && resultado.totpSecretConfigurado) {
          const totpEnc = encrypt(resultado.totpSecretConfigurado);
          await db
            .update(cofreCredenciais)
            .set({
              totpSecretEnc: totpEnc.encrypted,
              totpSecretIv: totpEnc.iv,
              totpSecretTag: totpEnc.tag,
            })
            .where(eq(cofreCredenciais.id, input.id));
        }

        await atualizarStatusAposLogin(input.id, {
          ok: resultado.ok,
          mensagemErro: resultado.ok
            ? null
            : `${resultado.mensagem}${resultado.detalhes ? ` (${resultado.detalhes})` : ""}`,
        });

        if (resultado.ok && resultado.storageStateJson) {
          const expira = new Date(Date.now() + 90 * 60 * 1000);
          await salvarSessao(input.id, resultado.storageStateJson, expira);
        }

        return {
          ok: resultado.ok,
          mensagem: resultado.mensagem,
          latenciaMs: resultado.latenciaMs,
          /**
           * Devolvido UMA vez, e só quando o robô teve que configurar o 2FA
           * do zero porque o tribunal exigiu.
           *
           * Devolver secret contraria a regra do cofre — nada sai depois de
           * entrar. A exceção existe porque aqui o segredo não é do cofre: é
           * da conta PJe do advogado, e a partir de agora é ele que o portal
           * vai pedir em qualquer login pelo navegador. Guardar sem mostrar
           * trancaria o advogado pra fora da própria conta, com a chave em
           * poder de um robô. A tela mostra agora e nunca mais.
           */
          totpSecretNovo: resultado.totpSecretConfigurado ?? null,
        };
      }

      await db
        .update(cofreCredenciais)
        .set({
          ultimoLoginTentativaEm: new Date(),
          ultimoErro: `Validação automática não implementada para "${cred.sistema}" — apenas pje_tjce`,
        })
        .where(eq(cofreCredenciais.id, input.id));

      return {
        ok: false,
        mensagem: `Sistema "${cred.sistema}" ainda sem adapter automatizado.`,
      };
    }),
});
