/**
 * Lógica reutilizável de fechamento de comissão. Compartilhada entre:
 *  - `router-comissoes.fechar` (mutation manual chamada pelo dono/gestor)
 *  - `cron-comissoes.processarAgendasComissao` (worker que roda a cada
 *     15 min e fecha automaticamente conforme `comissoes_agenda`)
 *
 * A função NÃO valida permissão — o caller é responsável (no router já
 * há `exigirAcaoFinanceiro`/`checkPermission`; no cron é o sistema).
 */

import { getDb } from "../db";
import {
  asaasCobrancas,
  categoriasCobranca,
  categoriasDespesa,
  colaboradores,
  comissoesFechadas,
  comissoesFechadasItens,
  comissoesLancamentosLog,
  despesas,
  users,
} from "../../drizzle/schema";
import { and, asc, between, eq, inArray, isNotNull, sql } from "drizzle-orm";
import {
  criarCategoriaDespesa,
  listarFaixasComissao,
  obterRegraComissao,
} from "./db-financeiro";
import {
  calcularComissao,
  type CobrancaParaComissao,
  type FaixaComissao,
  type MotivoExclusao,
} from "../../shared/calculo-comissao";
import { createLogger } from "../_core/logger";

const log = createLogger("db-comissoes");

const NOME_CATEGORIA_COMISSAO = "Comissões";

const STATUS_PAGOS = ["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"];

/**
 * Retorna mapa de cobranças que JÁ entraram em algum fechamento de
 * comissão do escritório. Usado pra evitar duplicar comissão: uma
 * cobrança só pode entrar em UM fechamento.
 *
 * Mapeia `asaasCobrancaId → comissaoFechadaId` pra o caller mostrar
 * "esta cobrança já está no fechamento #X".
 *
 * Considera SÓ itens com `foiComissionavel = true` — itens que foram
 * registrados como excluídos (override/categoria não-com/abaixo
 * mínimo) não bloqueiam re-tentativa, porque podem ter sido
 * re-classificados depois (ex: categoria mudou).
 */
async function carregarMapaCobrancasJaFechadas(
  escritorioId: number,
): Promise<Map<number, number>> {
  const db = await getDb();
  if (!db) return new Map();

  const rows = await db
    .select({
      asaasCobrancaId: comissoesFechadasItens.asaasCobrancaId,
      comissaoFechadaId: comissoesFechadasItens.comissaoFechadaId,
    })
    .from(comissoesFechadasItens)
    .innerJoin(
      comissoesFechadas,
      eq(comissoesFechadas.id, comissoesFechadasItens.comissaoFechadaId),
    )
    .where(
      and(
        eq(comissoesFechadas.escritorioId, escritorioId),
        eq(comissoesFechadasItens.foiComissionavel, true),
      ),
    );

  const m = new Map<number, number>();
  for (const r of rows) {
    // Se uma cobrança aparece em 2 fechamentos por algum bug histórico,
    // mantém o primeiro (não importa qual — basta saber que JÁ está
    // fechada e não deve entrar de novo).
    if (!m.has(r.asaasCobrancaId)) m.set(r.asaasCobrancaId, r.comissaoFechadaId);
  }
  return m;
}

/**
 * Regra de comissão carregada e normalizada (number, não decimal-string),
 * com faixas opcionais já mapeadas. Estrutura que `simularComissao`
 * consome internamente — extraída pra permitir cache externo (cron
 * mensal com N atendentes do mesmo escritório carrega 1x e passa N
 * vezes, em vez de 2 queries × N atendentes idênticas).
 */
export interface RegraComissaoCarregada {
  aliquotaPercent: number;
  valorMinimo: number;
  modo: "flat" | "faixas";
  baseFaixa: "bruto" | "comissionavel";
  faixas: FaixaComissao[];
  /** Dia do mês seguinte em que a despesa de comissão vence (1-31).
   *  Default 5 quando regra não configurada. Clamp pra último dia do
   *  mês acontece em `calcularVencimentoComissao`. */
  diaVencimentoDespesa: number;
}

/**
 * Carrega regra + faixas pra um escritório, normaliza tipos e devolve
 * a estrutura usada pelo cálculo de comissão. Defaults conservadores
 * quando o escritório ainda não configurou regra: aliquota=0, mínimo=0,
 * modo='flat' (resulta em comissão R$ 0, força operador a configurar).
 */
export async function carregarRegraComissao(
  escritorioId: number,
): Promise<RegraComissaoCarregada> {
  const regraRow = await obterRegraComissao(escritorioId);
  const aliquotaPercent = regraRow ? Number(regraRow.aliquotaPercent) : 0;
  const valorMinimo = regraRow ? Number(regraRow.valorMinimoCobranca) : 0;
  const modo = regraRow?.modo ?? "flat";
  const baseFaixa = regraRow?.baseFaixa ?? "comissionavel";
  const diaVencimentoDespesa = regraRow?.diaVencimentoDespesa ?? 5;

  const faixasRows = modo === "faixas" ? await listarFaixasComissao(escritorioId) : [];
  const faixas: FaixaComissao[] = faixasRows.map((f) => ({
    limiteAte: f.limiteAte === null ? null : Number(f.limiteAte),
    aliquotaPercent: Number(f.aliquotaPercent),
  }));

  return { aliquotaPercent, valorMinimo, modo, baseFaixa, faixas, diaVencimentoDespesa };
}

/** Simula comissão detalhada de um atendente em um período. Lê regra
 *  vigente, faixas (se modo=faixas) e cobranças com JOIN em categoria.
 *  Retorna estrutura usada por UI e por `fecharComissao`.
 *
 *  Pode receber `regraCarregada` pré-carregada — caller que invoca em
 *  loop (cron mensal por atendente do mesmo escritório) economiza N×2
 *  queries idênticas. UI manual (uma chamada por clique) ignora o
 *  parâmetro e a função carrega normalmente. */
export async function simularComissao(
  escritorioId: number,
  atendenteId: number,
  periodoInicio: string,
  periodoFim: string,
  regraCarregada?: RegraComissaoCarregada,
) {
  const db = await getDb();
  if (!db) throw new Error("Database indisponível");

  const regra = regraCarregada ?? (await carregarRegraComissao(escritorioId));
  const { aliquotaPercent, valorMinimo, modo, baseFaixa, faixas } = regra;

  // Cobranças que já entraram em algum fechamento (de qualquer atendente)
  // — são excluídas pra impedir comissão duplicada. O vínculo "fechei
  // contrato dia X" fica preservado: a cobrança foi originalmente do
  // atendente A; mesmo que o cliente seja transferido pro B depois, as
  // parcelas continuam apontando pro A (atendenteId não muda na cobrança)
  // e ficam bloqueadas após o 1º fechamento.
  //
  // Implementado como NOT EXISTS no SQL em vez de carregar todos os IDs
  // pra memória + `NOT IN (...)`. Em escritórios com 2+ anos de histórico
  // (50 atendentes × 200 cob/mês × 24 meses = 240k IDs), o NOT IN ficava
  // O(n) só no parsing do SQL. NOT EXISTS usa índice e escala flat.
  // Filtra por `foiComissionavelItem=TRUE` pra ser consistente com o
  // helper `carregarMapaCobrancasJaFechadas` (itens marcados não-com.
  // num fechamento antigo podem re-entrar — semântica preservada).
  const condicoes = [
    eq(asaasCobrancas.escritorioId, escritorioId),
    eq(asaasCobrancas.atendenteId, atendenteId),
    isNotNull(asaasCobrancas.dataPagamento),
    between(asaasCobrancas.dataPagamento, periodoInicio, periodoFim),
    inArray(asaasCobrancas.status, STATUS_PAGOS),
    sql`NOT EXISTS (
      SELECT 1 FROM ${comissoesFechadasItens}
      INNER JOIN ${comissoesFechadas}
        ON ${comissoesFechadas.id} = ${comissoesFechadasItens.comissaoFechadaId}
      WHERE ${comissoesFechadasItens.asaasCobrancaId} = ${asaasCobrancas.id}
        AND ${comissoesFechadas.escritorioId} = ${escritorioId}
        AND ${comissoesFechadasItens.foiComissionavel} = TRUE
    )`,
  ];

  const linhas = await db
    .select({
      id: asaasCobrancas.id,
      valor: asaasCobrancas.valor,
      dataPagamento: asaasCobrancas.dataPagamento,
      status: asaasCobrancas.status,
      atendenteId: asaasCobrancas.atendenteId,
      categoriaId: asaasCobrancas.categoriaId,
      comissionavelOverride: asaasCobrancas.comissionavelOverride,
      categoriaNome: categoriasCobranca.nome,
      categoriaComissionavel: categoriasCobranca.comissionavel,
      descricao: asaasCobrancas.descricao,
      asaasPaymentId: asaasCobrancas.asaasPaymentId,
    })
    .from(asaasCobrancas)
    .leftJoin(categoriasCobranca, eq(categoriasCobranca.id, asaasCobrancas.categoriaId))
    .where(and(...condicoes))
    .orderBy(asc(asaasCobrancas.dataPagamento));

  const cobrancasParaCalculo: CobrancaParaComissao[] = linhas.map((l) => ({
    id: l.id,
    valor: Number(l.valor),
    dataPagamento: new Date(l.dataPagamento + "T00:00:00"),
    atendenteId: l.atendenteId,
    categoriaComissionavel: l.categoriaComissionavel ?? null,
    comissionavelOverride: l.comissionavelOverride ?? null,
  }));

  const resultado = calcularComissao(cobrancasParaCalculo, {
    modo,
    aliquotaPercent,
    valorMinimo,
    faixas,
    baseFaixa,
  });

  const linhasMap = new Map(linhas.map((l) => [l.id, l]));
  const enriquecer = (id: number, motivo?: MotivoExclusao) => {
    const l = linhasMap.get(id)!;
    return {
      id: l.id,
      asaasPaymentId: l.asaasPaymentId,
      valor: Number(l.valor),
      dataPagamento: l.dataPagamento,
      descricao: l.descricao,
      categoriaNome: l.categoriaNome,
      categoriaComissionavel: l.categoriaComissionavel,
      comissionavelOverride: l.comissionavelOverride,
      motivoExclusao: motivo ?? null,
    };
  };

  return {
    regra: { aliquotaPercent, valorMinimo, modo, baseFaixa, faixas, diaVencimentoDespesa: regra.diaVencimentoDespesa },
    aliquotaAplicada: resultado.aliquotaAplicada,
    faixaAplicada: resultado.faixaAplicada ?? null,
    comissionaveis: resultado.comissionaveis.map((c) => enriquecer(c.id)),
    naoComissionaveis: resultado.naoComissionaveis.map((n) =>
      enriquecer(n.cobranca.id, n.motivo),
    ),
    totais: resultado.totais,
  };
}

/**
 * Diagnóstico: compara o que aparece na aba Cobranças (cobranças pagas
 * no período) com o que entra na comissão (subset, após cascata de
 * elegibilidade) e devolve a diferença explicada cobrança por cobrança.
 *
 * Útil quando o operador questiona "por que minha comissão é menor
 * que o total recebido no período" — a resposta vem com motivo claro
 * pra cada cobrança excluída (override, categoria não-comissionável,
 * abaixo do mínimo, ou atendente da cobrança difere do filtrado).
 */
export async function diagnosticarComissao(
  escritorioId: number,
  atendenteId: number,
  periodoInicio: string,
  periodoFim: string,
) {
  const db = await getDb();
  if (!db) throw new Error("Database indisponível");

  // 1. TODAS as cobranças pagas no período do escritório (sem filtrar
  //    atendente). Isso é "o que aparece na aba Cobranças quando o user
  //    filtra por dataPagamento + status pago".
  const todasPagas = await db
    .select({
      id: asaasCobrancas.id,
      asaasPaymentId: asaasCobrancas.asaasPaymentId,
      valor: asaasCobrancas.valor,
      dataPagamento: asaasCobrancas.dataPagamento,
      status: asaasCobrancas.status,
      atendenteId: asaasCobrancas.atendenteId,
      categoriaId: asaasCobrancas.categoriaId,
      comissionavelOverride: asaasCobrancas.comissionavelOverride,
      categoriaNome: categoriasCobranca.nome,
      categoriaComissionavel: categoriasCobranca.comissionavel,
      descricao: asaasCobrancas.descricao,
    })
    .from(asaasCobrancas)
    .leftJoin(categoriasCobranca, eq(categoriasCobranca.id, asaasCobrancas.categoriaId))
    .where(
      and(
        eq(asaasCobrancas.escritorioId, escritorioId),
        isNotNull(asaasCobrancas.dataPagamento),
        between(asaasCobrancas.dataPagamento, periodoInicio, periodoFim),
        inArray(asaasCobrancas.status, STATUS_PAGOS),
      ),
    )
    .orderBy(asc(asaasCobrancas.dataPagamento));

  // 2. Simulação da comissão pro atendente (mesma lógica de fechamento).
  const sim = await simularComissao(escritorioId, atendenteId, periodoInicio, periodoFim);
  const idsComissionaveis = new Set(sim.comissionaveis.map((c) => c.id));
  const naoComissionaveisMap = new Map(
    sim.naoComissionaveis.map((n) => [n.id, n.motivoExclusao]),
  );

  // 2b. Mapa "cobrança X já está no fechamento Y" — pra explicar quando o
  //     motivo da exclusão for "já entrou em outro fechamento" (anti-duplicate).
  const jaFechadasMap = await carregarMapaCobrancasJaFechadas(escritorioId);

  // 3. Pra cada cobrança paga, decide categoria:
  //    - "comissionavel": entra na comissão
  //    - "ja_fechada": já entrou em outro fechamento (anti-duplicate)
  //    - "atendente_diferente": pertence a outro atendente
  //    - "override_manual" / "categoria_nao_comissionavel" / "abaixo_minimo": excluída
  type LinhaDiag = {
    id: number;
    asaasPaymentId: string | null;
    valor: number;
    dataPagamento: string;
    descricao: string | null;
    categoriaNome: string | null;
    atendenteIdCobranca: number | null;
    motivo: "comissionavel" | "atendente_diferente" | "override_manual" |
            "categoria_nao_comissionavel" | "abaixo_minimo" | "ja_fechada";
    detalhe: string;
    /** ID do fechamento que já incluiu essa cobrança (só pra motivo=ja_fechada). */
    fechamentoExistenteId?: number;
  };

  const linhas: LinhaDiag[] = todasPagas.map((c) => {
    const valorNum = Number(c.valor);
    const base = {
      id: c.id,
      asaasPaymentId: c.asaasPaymentId,
      valor: valorNum,
      dataPagamento: c.dataPagamento ?? "",
      descricao: c.descricao,
      categoriaNome: c.categoriaNome,
      atendenteIdCobranca: c.atendenteId,
    };

    if (idsComissionaveis.has(c.id)) {
      return { ...base, motivo: "comissionavel" as const, detalhe: "Entra na comissão." };
    }

    // Já-fechada vence override/categoria/atendente — é o motivo MAIS forte
    // (a cobrança JÁ foi paga em outra ocasião, não importa o resto).
    const fechamentoId = jaFechadasMap.get(c.id);
    if (fechamentoId) {
      return {
        ...base,
        motivo: "ja_fechada" as const,
        detalhe: `Já entrou no fechamento #${fechamentoId}. Não conta de novo (anti-duplicate).`,
        fechamentoExistenteId: fechamentoId,
      };
    }

    const motivoExclusao = naoComissionaveisMap.get(c.id);
    if (motivoExclusao) {
      const detalhes: Record<MotivoExclusao, string> = {
        override_manual: "Marcada como NÃO comissionável manualmente (comissionavelOverride=false).",
        categoria_nao_comissionavel: `Categoria "${c.categoriaNome ?? "—"}" não é comissionável.`,
        abaixo_minimo: "Valor abaixo do mínimo configurado na regra de comissão.",
      };
      return { ...base, motivo: motivoExclusao, detalhe: detalhes[motivoExclusao] };
    }

    // Não está em nenhum dos casos acima → atendente da cobrança != atendente filtrado
    return {
      ...base,
      motivo: "atendente_diferente" as const,
      detalhe: c.atendenteId === null
        ? "Cobrança sem atendente atribuído (não conta na comissão de ninguém)."
        : `Cobrança pertence ao atendente #${c.atendenteId}, não ao filtrado (#${atendenteId}).`,
    };
  });

  const totalPago = linhas.reduce((s, l) => s + l.valor, 0);
  const totalComissionavel = linhas
    .filter((l) => l.motivo === "comissionavel")
    .reduce((s, l) => s + l.valor, 0);

  return {
    totalPago,
    totalComissionavel,
    diferenca: totalPago - totalComissionavel,
    quantidadeTotal: linhas.length,
    quantidadeComissionavel: linhas.filter((l) => l.motivo === "comissionavel").length,
    linhas,
  };
}

export interface FecharComissaoParams {
  escritorioId: number;
  atendenteId: number;
  periodoInicio: string;
  periodoFim: string;
  /** Pra origem='automatico' use o dono do escritório como autor
   *  "fictício" — auditoria depende disso. */
  fechadoPorUserId: number;
  origem?: "manual" | "automatico";
  agendaId?: number | null;
  observacoes?: string | null;
  /** Regra pré-carregada. Caller que invoca em loop (cron mensal por
   *  atendente do mesmo escritório) pode passar pra evitar reler a
   *  regra do DB em cada iteração. UI manual omite. */
  regraCarregada?: RegraComissaoCarregada;
  /**
   * Quando `false` (default), bloqueia criação se já existe fechamento pro
   * mesmo `(escritorioId, atendenteId, periodoInicio, periodoFim)` —
   * independente de origem. Lança `FechamentoJaExisteError` com o id
   * existente pra caller decidir o que fazer.
   *
   * Quando `true`, permite criar duplicado (caso documentado de
   * "re-fechamento após correção"). UI manual deve confirmar com o
   * operador antes de passar `true`.
   *
   * O cron sempre usa `false` (dedup silencioso — pula no caller).
   */
  forcarDuplicado?: boolean;
}

/** Lançado por `fecharComissao` quando já existe fechamento pro período
 *  e `forcarDuplicado` não foi usado. Caller decide se pula (cron) ou
 *  pergunta ao operador (UI manual). */
export class FechamentoJaExisteError extends Error {
  constructor(
    public readonly comissaoFechadaId: number,
    public readonly origem: "manual" | "automatico",
  ) {
    super(`Fechamento já existe (id=${comissaoFechadaId}, origem=${origem})`);
    this.name = "FechamentoJaExisteError";
  }
}

/** Persiste cabeçalho + itens. Função pura: NÃO valida permissões.
 *  Por default rejeita duplicatas — passe `forcarDuplicado:true` pra
 *  permitir re-fechamento após correção (UI deve confirmar antes). */
export async function fecharComissao(
  params: FecharComissaoParams,
): Promise<{ id: number; totais: { bruto: number; comissionavel: number; naoComissionavel: number; valorComissao: number } }> {
  const db = await getDb();
  if (!db) throw new Error("Database indisponível");

  // Dedup cross-origem: protege tanto cron quanto manual de criar
  // fechamento duplicado pro mesmo período. Cron pula silencioso; UI
  // manual deve mostrar dialog "já existe" antes de re-tentar com
  // `forcarDuplicado:true`.
  if (!params.forcarDuplicado) {
    const [existente] = await db
      .select({
        id: comissoesFechadas.id,
        origem: comissoesFechadas.origem,
      })
      .from(comissoesFechadas)
      .where(
        and(
          eq(comissoesFechadas.escritorioId, params.escritorioId),
          eq(comissoesFechadas.atendenteId, params.atendenteId),
          eq(comissoesFechadas.periodoInicio, params.periodoInicio),
          eq(comissoesFechadas.periodoFim, params.periodoFim),
        ),
      )
      .limit(1);
    if (existente) {
      throw new FechamentoJaExisteError(
        existente.id,
        existente.origem as "manual" | "automatico",
      );
    }
  }

  const sim = await simularComissao(
    params.escritorioId,
    params.atendenteId,
    params.periodoInicio,
    params.periodoFim,
    params.regraCarregada,
  );

  const [novo] = await db
    .insert(comissoesFechadas)
    .values({
      escritorioId: params.escritorioId,
      atendenteId: params.atendenteId,
      periodoInicio: params.periodoInicio,
      periodoFim: params.periodoFim,
      totalBrutoRecebido: sim.totais.bruto.toFixed(2),
      totalComissionavel: sim.totais.comissionavel.toFixed(2),
      totalNaoComissionavel: sim.totais.naoComissionavel.toFixed(2),
      totalComissao: sim.totais.valorComissao.toFixed(2),
      aliquotaUsada: sim.aliquotaAplicada.toFixed(2),
      modoUsado: sim.regra.modo,
      baseFaixaUsada: sim.regra.modo === "faixas" ? sim.regra.baseFaixa : null,
      faixasUsadas: sim.regra.modo === "faixas" ? JSON.stringify(sim.regra.faixas) : null,
      valorMinimoUsado: sim.regra.valorMinimo.toFixed(2),
      fechadoPorUserId: params.fechadoPorUserId,
      observacoes: params.observacoes ?? null,
      origem: params.origem ?? "manual",
      agendaId: params.agendaId ?? null,
    })
    .$returningId();

  const itens = [
    ...sim.comissionaveis.map((c) => ({
      comissaoFechadaId: novo.id,
      asaasCobrancaId: c.id,
      valor: c.valor.toFixed(2),
      foiComissionavel: true,
      motivoExclusao: null,
    })),
    ...sim.naoComissionaveis.map((c) => ({
      comissaoFechadaId: novo.id,
      asaasCobrancaId: c.id,
      valor: c.valor.toFixed(2),
      foiComissionavel: false,
      motivoExclusao: c.motivoExclusao ?? null,
    })),
  ];

  if (itens.length > 0) {
    await db.insert(comissoesFechadasItens).values(itens);
  }

  // Cria despesa pendente automática vinculada ao fechamento. Não-fatal:
  // se algo falhar (categoria deletada, DB transitoriamente fora, etc.)
  // o fechamento sobrevive — usuário pode lançar manualmente depois.
  if (sim.totais.valorComissao > 0) {
    try {
      const categoriaId = await garantirCategoriaComissoes(params.escritorioId);
      // sim.regra é a estrutura usada pelo cálculo, traz diaVencimentoDespesa
      // direto da config (default 5 quando não setado).
      const vencimento = calcularVencimentoComissao(
        params.periodoFim,
        sim.regra.diaVencimentoDespesa,
      );
      // Nome do atendente pra descrição amigável da despesa.
      // Tolerante a falha: se não achar, usa fallback "atendente #id".
      let nomeAtendente = `Atendente #${params.atendenteId}`;
      try {
        const [linha] = await db
          .select({ nome: users.name })
          .from(colaboradores)
          .leftJoin(users, eq(users.id, colaboradores.userId))
          .where(eq(colaboradores.id, params.atendenteId))
          .limit(1);
        if (linha?.nome) nomeAtendente = linha.nome;
      } catch {
        /* fallback acima */
      }
      const descricao = `Comissão ${nomeAtendente} — ${formatarDataBR(params.periodoInicio)} a ${formatarDataBR(params.periodoFim)}`;
      const [despNova] = await db
        .insert(despesas)
        .values({
          escritorioId: params.escritorioId,
          categoriaId,
          descricao,
          valor: sim.totais.valorComissao.toFixed(2),
          vencimento,
          status: "pendente",
          criadoPorUserId: params.fechadoPorUserId,
        })
        .$returningId();
      await db
        .update(comissoesFechadas)
        .set({ despesaId: despNova.id })
        .where(eq(comissoesFechadas.id, novo.id));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(
        { err: msg, escritorioId: params.escritorioId, comissaoFechadaId: novo.id },
        "Falha ao criar despesa automática — fechamento mantido sem despesa",
      );
    }
  }

  return { id: novo.id, totais: sim.totais };
}

/** Retorna ID da categoria "Comissões" do escritório, criando se não existir.
 *  Idempotente. Reusa `criarCategoriaDespesa` (db-financeiro.ts). */
export async function garantirCategoriaComissoes(
  escritorioId: number,
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database indisponível");
  const [existente] = await db
    .select({ id: categoriasDespesa.id })
    .from(categoriasDespesa)
    .where(
      and(
        eq(categoriasDespesa.escritorioId, escritorioId),
        eq(categoriasDespesa.nome, NOME_CATEGORIA_COMISSAO),
      ),
    )
    .limit(1);
  if (existente) return existente.id;
  return criarCategoriaDespesa(escritorioId, NOME_CATEGORIA_COMISSAO);
}

/** Converte ISO "YYYY-MM-DD" → "DD/MM/YYYY". Usado pra montar descrição
 *  amigável da despesa de comissão. Idempotente em strings já BR. */
export function formatarDataBR(iso: string): string {
  const [ano, mes, dia] = iso.split("-");
  if (!ano || !mes || !dia) return iso;
  return `${dia}/${mes}/${ano}`;
}

/** Calcula data de vencimento da despesa de comissão a partir do
 *  fim do período fechado e do dia configurado pelo escritório.
 *
 *  `dia` (default 5) é o dia do mês seguinte. Quando o dia escolhido
 *  não existe no mês seguinte (ex: dia 31 e o próximo mês tem 30),
 *  aplica clamp pro último dia disponível.
 *
 *  Exemplos:
 *    ("2026-03-31", 5)  → "2026-04-05"
 *    ("2026-12-31", 5)  → "2027-01-05" (virada de ano)
 *    ("2026-03-31", 31) → "2026-04-30" (abril não tem 31, clamp)
 *    ("2026-01-31", 31) → "2026-02-28" (fev não-bissexto)
 *    ("2024-01-31", 31) → "2024-02-29" (fev bissexto)
 */
export function calcularVencimentoComissao(
  periodoFim: string,
  dia: number = 5,
): string {
  const [ano, mes] = periodoFim.split("-").map(Number);
  if (!ano || !mes || Number.isNaN(ano) || Number.isNaN(mes)) {
    throw new Error(`periodoFim inválido: ${periodoFim}`);
  }
  if (!Number.isInteger(dia) || dia < 1 || dia > 31) {
    throw new Error(`dia inválido (esperado 1-31): ${dia}`);
  }
  const proxAno = mes === 12 ? ano + 1 : ano;
  const proxMes = mes === 12 ? 1 : mes + 1;
  // Último dia do mês seguinte = dia 0 do mês após o seguinte.
  const ultimoDia = new Date(Date.UTC(proxAno, proxMes, 0)).getUTCDate();
  const diaEfetivo = Math.min(dia, ultimoDia);
  return `${proxAno}-${String(proxMes).padStart(2, "0")}-${String(diaEfetivo).padStart(2, "0")}`;
}

// ─── Helpers de período ─────────────────────────────────────────────────────

/** Retorna primeiro e último dia do mês ANTERIOR à data de referência,
 *  no formato YYYY-MM-DD. Ex: ref=2026-04-01 → ['2026-03-01','2026-03-31']. */
export function periodoMesAnterior(referencia: Date): { inicio: string; fim: string } {
  const ano = referencia.getFullYear();
  const mes = referencia.getMonth();
  const inicio = new Date(ano, mes - 1, 1);
  const fim = new Date(ano, mes, 0);
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { inicio: fmt(inicio), fim: fmt(fim) };
}

// ─── Log helpers ────────────────────────────────────────────────────────────

/** Reserva uma execução no log. Retorna `null` se já existe registro
 *  (concluído ou em andamento) — caller deve pular. Race ⇒ INSERT do
 *  segundo worker falha (UNIQUE) e retornamos null. */
export async function reservarExecucao(params: {
  escritorioId: number;
  agendaId: number;
  atendenteId: number;
  periodoInicio: string;
  periodoFim: string;
}): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;

  const existente = await db
    .select({ id: comissoesLancamentosLog.id, status: comissoesLancamentosLog.status })
    .from(comissoesLancamentosLog)
    .where(
      and(
        eq(comissoesLancamentosLog.escritorioId, params.escritorioId),
        eq(comissoesLancamentosLog.agendaId, params.agendaId),
        eq(comissoesLancamentosLog.atendenteId, params.atendenteId),
        eq(comissoesLancamentosLog.periodoInicio, params.periodoInicio),
        eq(comissoesLancamentosLog.periodoFim, params.periodoFim),
      ),
    )
    .limit(1);

  if (existente.length > 0) {
    const ex = existente[0];
    if (ex.status === "concluido" || ex.status === "em_andamento") return null;
    // 'falhou' → limpa pra permitir retry
    await db.delete(comissoesLancamentosLog).where(eq(comissoesLancamentosLog.id, ex.id));
  }

  try {
    const [r] = await db
      .insert(comissoesLancamentosLog)
      .values({
        escritorioId: params.escritorioId,
        agendaId: params.agendaId,
        atendenteId: params.atendenteId,
        periodoInicio: params.periodoInicio,
        periodoFim: params.periodoFim,
        status: "em_andamento",
      })
      .$returningId();
    return r.id;
  } catch {
    return null;
  }
}

export async function marcarExecucaoConcluida(
  logId: number,
  comissaoFechadaId: number,
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(comissoesLancamentosLog)
    .set({ status: "concluido", comissaoFechadaId, finalizadoEm: new Date() })
    .where(eq(comissoesLancamentosLog.id, logId));
}

export async function marcarExecucaoFalhou(logId: number, mensagem: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(comissoesLancamentosLog)
    .set({ status: "falhou", mensagemErro: mensagem.slice(0, 1000), finalizadoEm: new Date() })
    .where(eq(comissoesLancamentosLog.id, logId));
}
