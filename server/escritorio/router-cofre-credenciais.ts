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
import { cofreCredencialTribunais, cofreCredenciais, cofreSessoes, motorMonitoramentos } from "../../drizzle/schema";
import { encrypt, maskToken } from "./crypto-utils";
import { getEscritorioPorUsuario } from "./db-escritorio";
import { checkPermission } from "./check-permission";
import { createLogger } from "../_core/logger";
import {
  configPorSistema,
  sistemaAtendeTribunal,
  getConfigTribunal,
  SISTEMA_PJE_NACIONAL,
  tribunalDoSistema,
  tribunaisPjeDisponiveis,
  tribunalRequerCredencial,
} from "../processos/tribunais-pdpj";
import { deveReligarMonitoramento } from "./cofre-helpers";
import { classificarErroMonitor } from "../processos/diagnostico-monitoramento";
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

/**
 * O que o cadastro aceita.
 *
 * Antes eram 26 ids, incluindo e-SAJ, e-Proc e TRT — nenhum deles com adapter.
 * O cofre guardava a senha de um advogado criptografada pra um sistema que
 * nunca ia conseguir usá-la: segredo parado no banco sem propósito, e uma
 * credencial que só falharia no dia em que alguém dependesse dela.
 *
 * Agora sai do registro do motor. Ligar um sistema novo é ligá-lo no motor.
 */
const SISTEMAS_VALIDOS: readonly SistemaCofre[] = [
  SISTEMA_PJE_NACIONAL as SistemaCofre,
  ...tribunaisPjeDisponiveis().map(
    (t) => `pje_${t === "tjdf" ? "tjdft" : t}` as SistemaCofre,
  ),
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
 * O que se pode escrever dentro de uma transação.
 *
 * As funções de escrita recebem isto, e não o banco inteiro, porque todas elas
 * fazem mais de um UPDATE: rodar fora de transação deixaria estados
 * intermediários que ninguém escolheu.
 */
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

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
// O texto entra no `ultimoErro` do monitoramento, e é ele que
// `classificarErroMonitor` lê pra dizer a causa na tela do processo. Sem as
// palavras "sem credencial" o diagnóstico caía em "desconhecida" e o processo
// parado não dizia por quê.
const PAUSA_POR_REMOCAO = "Pausado: sem credencial — a do cofre foi removida";

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

  // Quem pode assumir é quem ATENDE os tribunais desses processos — não quem
  // tem o mesmo texto no campo `sistema`. Comparar a string deixava uma
  // credencial nacional de fora como destino de uma credencial de um estado
  // só, mesmo servindo aquele tribunal perfeitamente: o sistema concluía "não
  // há destino" e pausava os processos com a solução ali do lado.
  const tribunaisEmJogo = [
    ...new Set(
      (
        await db
          .select({ tribunal: motorMonitoramentos.tribunal })
          .from(motorMonitoramentos)
          .where(
            and(
              eq(motorMonitoramentos.escritorioId, escritorioId),
              eq(motorMonitoramentos.credencialId, credencialId),
            ),
          )
      ).map((m) => m.tribunal),
    ),
  ].filter((t) => tribunalRequerCredencial(t));

  const candidatas = cred
    ? await db
        .select({
          id: cofreCredenciais.id,
          apelido: cofreCredenciais.apelido,
          sistema: cofreCredenciais.sistema,
        })
        .from(cofreCredenciais)
        .where(
          and(
            eq(cofreCredenciais.escritorioId, escritorioId),
            eq(cofreCredenciais.status, "ativa"),
            ne(cofreCredenciais.id, credencialId),
          ),
        )
        .orderBy(desc(cofreCredenciais.ultimoLoginSucessoEm))
    : [];

  // A melhor é a que cobre MAIS processos. Empate fica com a mais recente,
  // que é a ordem que veio do banco.
  const destino = candidatas
    .map((c) => ({
      c,
      cobre: tribunaisEmJogo.filter((t) => sistemaAtendeTribunal(c.sistema, t)).length,
    }))
    .filter((x) => x.cobre > 0)
    .sort((a, b) => b.cobre - a.cobre)[0]?.c;

  return {
    apelido: cred?.apelido ?? null,
    sistema: cred?.sistema ?? null,
    monitoramentos: Number(linha?.total ?? 0),
    destinoSugerido: destino ? { id: destino.id, apelido: destino.apelido } : null,
    sistemaDestino: destino?.sistema ?? null,
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
type Monitorado = { id: number; status: string; ultimoErro: string | null };

interface Alvos {
  /** Podem ir pro destino: precisam de credencial e são do tribunal dele. */
  aceitos: Monitorado[];
  /** Presos na credencial, mas o destino não atende o tribunal deles. */
  sobram: Monitorado[];
  /**
   * Tribunal de consulta pública amarrado a uma credencial que ele nunca
   * precisou. Não vira pausa — só perde o vínculo, e segue rodando.
   */
  desvincular: number[];
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
 * E o destino precisa ATENDER o tribunal do processo: uma credencial do TJCE
 * não abre processo do TJMG, mas uma de alcance nacional abre os dois. Por
 * isso a pergunta é "atende?", e não "tem o mesmo texto no campo sistema?".
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

  const aceitos: Monitorado[] = [];
  const sobram: Monitorado[] = [];
  const desvincular: number[] = [];
  for (const c of candidatos) {
    const linha = { id: c.id, status: c.status, ultimoErro: c.ultimoErro };
    // Descartar em silêncio era pior que não filtrar: o vínculo continuava
    // apontando pra credencial removida, que é o próprio bug. Cada candidato
    // sai daqui em exatamente um dos três baldes.
    if (!tribunalRequerCredencial(c.tribunal)) desvincular.push(c.id);
    else if (sistemaAtendeTribunal(sistemaDestino, c.tribunal)) aceitos.push(linha);
    else sobram.push(linha);
  }
  return { aceitos, sobram, desvincular };
}

/**
 * Aponta os monitoramentos aceitos pra nova credencial.
 *
 * Além de trocar o vínculo, limpa o erro dos que pararam POR CAUSA da
 * credencial — senão o processo continuaria exibindo "sessão expirada" até a
 * próxima varredura e pareceria que reapontar não fez nada. Erro de outra
 * natureza (CNJ inválido, por exemplo) fica onde está: apagá-lo seria mentir.
 */
async function aplicarRepontar(db: Tx, aceitos: Alvos["aceitos"], para: number): Promise<number> {
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
  db: Tx,
  alvos: Monitorado[],
  apelidoRemovido: string,
): Promise<number> {
  if (alvos.length === 0) return 0;

  // Quem JÁ estava pausado continua como estava. A pausa dele foi decisão do
  // escritório, e sobrescrever o motivo faria o reapontar seguinte religar um
  // processo que alguém desligou de propósito — voltando a consumir crédito
  // sem ninguém ter pedido. Perde só o vínculo.
  const jaPausados = alvos.filter((a) => a.status === "pausado").map((a) => a.id);
  if (jaPausados.length > 0) {
    await db
      .update(motorMonitoramentos)
      .set({ credencialId: null })
      .where(inArray(motorMonitoramentos.id, jaPausados));
  }

  const motivo = `${PAUSA_POR_REMOCAO} ("${apelidoRemovido}"). Cadastre outra credencial e reaponte estes processos.`;
  for (const a of alvos) {
    if (a.status === "pausado") continue;
    // Erro de outra natureza (CNJ inválido, por exemplo) não pode ser
    // apagado: quando o processo voltar, o diagnóstico antigo ainda vale, e
    // aqui é o único lugar onde ele existe.
    const anterior = a.ultimoErro?.trim();
    const outraNatureza =
      anterior && classificarErroMonitor(anterior)?.causa !== "sessao_expirada" &&
      classificarErroMonitor(anterior)?.causa !== "sem_credencial";
    await db
      .update(motorMonitoramentos)
      .set({
        credencialId: null,
        status: "pausado",
        ultimoErro: outraNatureza ? `${motivo} Erro anterior: ${anterior}`.slice(0, 1000) : motivo,
      })
      .where(eq(motorMonitoramentos.id, a.id));
  }
  return alvos.length;
}

/**
 * Tira o vínculo sem pausar.
 *
 * Para tribunal de consulta pública, que roda sem cofre: o vínculo era
 * acidente, e o processo continua funcionando exatamente igual sem ele.
 */
async function desvincularSemPausar(db: Tx, ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  await db
    .update(motorMonitoramentos)
    .set({ credencialId: null })
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
   * Sistemas oferecidos no cadastro.
   *
   * Derivada do registro do motor, e não escrita à mão: a lista fixa divergiu
   * — prometia E-SAJ TJSP e TRT-7, que não têm adapter, enquanto escondia 9
   * estados que o motor já atendia. Ligar um estado novo continua sendo uma
   * linha no registro, e a tela acompanha sozinha.
   */
  listarMinhasSistemasSuportados: protectedProcedure.query(() => {
    const estados = tribunaisPjeDisponiveis();
    return [
      {
        id: SISTEMA_PJE_NACIONAL,
        label: `PJe — todos os estados (${estados.length})`,
        disponivel: true,
        nacional: true,
      },
      ...estados.map((t: string) => ({
        id: `pje_${t === "tjdf" ? "tjdft" : t}`,
        label: `PJe ${t.toUpperCase()} — 1º grau`,
        disponivel: true,
        nacional: false,
      })),
    ];
  }),

  /**
   * Situação da credencial em cada PJe.
   *
   * Devolve TODOS os estados que o motor atende, e não só os já testados: o
   * "não testado" é a informação principal aqui. Dos 12, só o TJCE foi
   * validado com login real — os outros têm a URL derivada do padrão do TJCE
   * e podem exigir ajuste, como o TJDF já exigiu.
   */
  tribunaisDaCredencial: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      await exigirAdminProcessos(ctx.user.id);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });
      const escritorioId = await resolverEscritorioId(ctx.user.id);

      const [cred] = await db
        .select({ sistema: cofreCredenciais.sistema })
        .from(cofreCredenciais)
        .where(
          and(eq(cofreCredenciais.id, input.id), eq(cofreCredenciais.escritorioId, escritorioId)),
        )
        .limit(1);
      if (!cred) throw new TRPCError({ code: "NOT_FOUND", message: "Credencial não encontrada" });

      const registros = await db
        .select()
        .from(cofreCredencialTribunais)
        .where(eq(cofreCredencialTribunais.credencialId, input.id));
      const porTribunal = new Map(registros.map((r) => [r.tribunal, r]));

      const proprio = tribunalDoSistema(cred.sistema);
      const alcance = proprio ? [proprio] : tribunaisPjeDisponiveis();

      const processos = await db
        .select({
          tribunal: motorMonitoramentos.tribunal,
          total: sql<number>`COUNT(*)`,
        })
        .from(motorMonitoramentos)
        .where(
          and(
            eq(motorMonitoramentos.escritorioId, escritorioId),
            eq(motorMonitoramentos.credencialId, input.id),
          ),
        )
        .groupBy(motorMonitoramentos.tribunal);
      const contagem = new Map(processos.map((p) => [p.tribunal, Number(p.total)]));

      return {
        nacional: proprio == null,
        tribunais: alcance.map((t) => {
          const r = porTribunal.get(t);
          return {
            tribunal: t,
            status: r?.status ?? ("nao_testado" as const),
            ultimoErro: r?.ultimoErro ?? null,
            ultimoSucessoEm: r?.ultimoSucessoEm?.toISOString() ?? null,
            processos: contagem.get(t) ?? 0,
          };
        }),
      };
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
        impacto.sistemaDestino ?? "",
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

    // Sem `isNotNull`: o vínculo NULO é justamente o estado que a remoção
    // cria quando não há outra credencial pra assumir. Filtrá-lo fora deixava
    // esses processos invisíveis na única tela que existe pra consertá-los —
    // e a mensagem da pausa mandava reapontar por um caminho que não existia.
    const grupos = await db
      .select({
        credencialId: motorMonitoramentos.credencialId,
        tribunal: motorMonitoramentos.tribunal,
        total: sql<number>`COUNT(*)`,
      })
      .from(motorMonitoramentos)
      .where(eq(motorMonitoramentos.escritorioId, escritorioId))
      .groupBy(motorMonitoramentos.credencialId, motorMonitoramentos.tribunal);

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
    // Quem serve cada tribunal. A tela oferecia todas as credenciais ativas,
    // e escolher uma que não atende aquele tribunal movia zero processos: a
    // linha do painel não sumia e nada explicava por quê.
    const atendem = (tribunal: string) =>
      credenciais
        .filter((c) => c.status === "ativa" && sistemaAtendeTribunal(c.sistema, tribunal))
        .map((c) => ({ id: c.id, apelido: c.apelido }));

    return grupos
      // Tribunal de consulta pública roda sem cofre: vínculo nulo ali é o
      // normal, não uma pendência.
      .filter((g) => tribunalRequerCredencial(g.tribunal))
      .map((g) => {
        const cred = g.credencialId != null ? porId.get(g.credencialId) : undefined;
        const semVinculo = g.credencialId == null || !cred;
        // Duas pendências diferentes, e tratá-las igual empurrava o dono a
        // mover centenas de processos quando o conserto era clicar "Validar":
        // credencial caída volta sozinha no relogin; credencial removida (ou
        // vínculo nulo) exige escolher outra.
        const acao: "reapontar" | "revalidar" =
          semVinculo || cred?.status === "removida" ? "reapontar" : "revalidar";
        return {
          credencialId: g.credencialId,
          tribunal: g.tribunal,
          total: Number(g.total),
          apelido: cred?.apelido ?? null,
          sistema: cred?.sistema ?? null,
          status: cred?.status ?? null,
          acao,
          destinos: atendem(g.tribunal),
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

      const { aceitos } = await separarAlvos(db, escritorioId, input.de, destino.sistema);
      if (aceitos.length === 0) {
        // Antes isto era uma comparação de textos entre os dois `sistema`, que
        // recusava uma credencial nacional por não ser "igual" à de origem.
        // O que importa é se ela atende o tribunal dos processos.
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `"${destino.apelido}" não atende o tribunal desses processos.`,
        });
      }
      let movidos = 0;
      await db.transaction(async (tx) => {
        movidos = await aplicarRepontar(tx, aceitos, destino.id);
      });
      log.info(
        { user: ctx.user.id, escritorioId, de: input.de, para: destino.id, movidos },
        "[cofre] monitoramentos repontados",
      );
      return { movidos, destino: destino.apelido };
    }),

  /**
   * Troca o alcance de uma credencial que já existe.
   *
   * Existe pra remover-e-cadastrar-de-novo deixar de ser o caminho. Essa
   * sequência é a mesma que parou 420 processos: a remoção mexe em vínculo,
   * sessão e monitoramento, e não há razão pra passar por ela só pra mudar um
   * campo. Aqui a senha, o 2FA e os vínculos ficam exatamente onde estão.
   */
  alterarAlcance: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        sistema: z.enum(SISTEMAS_VALIDOS as readonly [SistemaCofre, ...SistemaCofre[]]),
        /** Necessário quando estreitar o alcance deixa processo sem credencial. */
        confirmarPausarMonitoramentos: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await exigirAdminProcessos(ctx.user.id);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });
      const escritorioId = await resolverEscritorioId(ctx.user.id);

      const [cred] = await db
        .select()
        .from(cofreCredenciais)
        .where(
          and(eq(cofreCredenciais.id, input.id), eq(cofreCredenciais.escritorioId, escritorioId)),
        )
        .limit(1);
      if (!cred) throw new TRPCError({ code: "NOT_FOUND", message: "Credencial não encontrada" });
      if (cred.status === "removida") {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Credencial removida." });
      }
      if (cred.sistema === input.sistema) return { ok: true, pausados: 0, desvinculados: 0 };

      // Ampliar (um estado → nacional) não tira nada de ninguém. Estreitar
      // tira: os processos dos estados que saem do alcance ficam sem quem os
      // atenda, e isso precisa ser dito antes, não descoberto depois.
      const { sobram, desvincular } = await separarAlvos(db, escritorioId, input.id, input.sistema);

      if (sobram.length > 0 && !input.confirmarPausarMonitoramentos) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            `${sobram.length} processo(s) monitorado(s) são de tribunais que esse alcance não ` +
            `cobre e vão ser pausados. Confirme se é isso mesmo que você quer.`,
        });
      }

      let pausados = 0;
      let desvinculados = 0;
      await db.transaction(async (tx) => {
        pausados = await pausarSemCredencial(tx, sobram, cred.apelido);
        desvinculados = await desvincularSemPausar(tx, desvincular);

        await tx
          .update(cofreCredenciais)
          .set({ sistema: input.sistema })
          .where(eq(cofreCredenciais.id, input.id));

        // Sessão de tribunal que saiu do alcance não serve mais pra nada, e
        // deixá-la guardada é manter cookie de portal que a credencial não
        // atende mais.
        const foraDoAlcance = tribunaisPjeDisponiveis().filter(
          (t) => !sistemaAtendeTribunal(input.sistema, t),
        );
        if (foraDoAlcance.length > 0) {
          await tx
            .delete(cofreSessoes)
            .where(
              and(
                eq(cofreSessoes.credencialId, input.id),
                inArray(cofreSessoes.tribunal, foraDoAlcance),
              ),
            );
        }
      });

      log.info(
        { user: ctx.user.id, credencialId: input.id, de: cred.sistema, para: input.sistema, pausados },
        "[cofre] alcance alterado",
      );
      return { ok: true, pausados, desvinculados };
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
      // Sem destino, o "sistemaDestino" não existe: passar string vazia faz
      // `tribunalDestino` virar null e TODOS os que precisam de credencial
      // caírem em `sobram`, que é exatamente o certo — vão todos pausar.
      const { aceitos, sobram, desvincular } = await separarAlvos(
        db,
        escritorioId,
        input.id,
        impacto.sistemaDestino ?? "",
      );

      const vaoPausar = sobram;

      if (vaoPausar.length > 0 && !input.confirmarPausarMonitoramentos) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            `${vaoPausar.length} processo(s) monitorado(s) vão ficar sem credencial e serão ` +
            `pausados${impacto.destinoSugerido ? ` (a credencial "${impacto.destinoSugerido.apelido}" não atende o tribunal deles)` : ""}. ` +
            `Confirme se é isso mesmo que você quer.`,
        });
      }

      // Tudo numa transação. São quatro escritas, e morrer entre a terceira e
      // a quarta deixaria os processos já desvinculados com a credencial ainda
      // viva na lista — um estado que ninguém escolheu e que a tela não
      // saberia explicar.
      let repontados = 0;
      let pausados = 0;
      let desvinculados = 0;
      await db.transaction(async (tx) => {
        repontados = await aplicarRepontar(tx, aceitos, impacto.destinoSugerido?.id ?? 0);
        pausados = await pausarSemCredencial(tx, vaoPausar, existente.apelido);
        desvinculados = await desvincularSemPausar(tx, desvincular);

        await tx
          .update(cofreCredenciais)
          .set({ status: "removida" })
          .where(eq(cofreCredenciais.id, input.id));

        // A sessão vive noutra tabela e o cookie dela continua válido por até
        // 90 minutos. Deixá-la para trás mantém uma porta aberta pro tribunal
        // com um login que o dono acabou de apagar.
        await tx.delete(cofreSessoes).where(eq(cofreSessoes.credencialId, input.id));
      });

      log.info(
        { user: ctx.user.id, escritorioId, credencialId: input.id, repontados, pausados, desvinculados },
        "[cofre] credencial removida",
      );
      return {
        ok: true,
        repontados,
        pausados,
        desvinculados,
        destino: impacto.destinoSugerido?.apelido ?? null,
      };
    }),

  /** Validar credencial — login real no tribunal. Apenas admin de processos (dono/gestor). */
  validarMinha: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        /** Em qual PJe testar. Obrigatório na prática pra credencial nacional. */
        tribunal: z.string().max(16).optional(),
      }),
    )
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

      const { buscarCredencialDecriptada, atualizarStatusAposLogin, salvarSessao, registrarTribunal } =
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

      // Qual portal testar. Credencial de alcance nacional não nomeia estado,
      // então quem chama escolhe — e o padrão é o TJCE, único validado até
      // aqui. Testar "a credencial" sem dizer onde não significa nada quando
      // ela vale em doze lugares.
      const tribunalAlvo = input.tribunal ?? tribunalDoSistema(cred.sistema) ?? "tjce";
      const cfgTribunal = getConfigTribunal(tribunalAlvo);
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

        const motivoErro = resultado.ok
          ? null
          : `${resultado.mensagem}${resultado.detalhes ? ` (${resultado.detalhes})` : ""}`;

        await atualizarStatusAposLogin(input.id, { ok: resultado.ok, mensagemErro: motivoErro });
        // O resultado é DAQUELE tribunal. Sem registrar por estado, uma falha
        // em MG faria o CE — que funciona — aparecer quebrado junto.
        await registrarTribunal(input.id, tribunalAlvo, {
          ok: resultado.ok,
          motivo: motivoErro ?? undefined,
        });

        if (resultado.ok && resultado.storageStateJson) {
          const expira = new Date(Date.now() + 90 * 60 * 1000);
          await salvarSessao(input.id, tribunalAlvo, resultado.storageStateJson, expira);
        }

        return {
          ok: resultado.ok,
          tribunal: tribunalAlvo,
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
