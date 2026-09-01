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
  comissaoGestao,
  comissoesFechadas,
  comissoesFechadasItens,
  comissoesLancamentosLog,
  contatos,
  despesas,
  leads,
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
import { STATUS_PAGO_ASAAS } from "../_core/asaas-status";
import { diaCivilEmTz } from "../_core/dates";

const log = createLogger("db-comissoes");

const NOME_CATEGORIA_COMISSAO = "Comissões";

/**
 * O que conta como dinheiro recebido para efeito de comissão.
 *
 * Vem da constante compartilhada, não de lista própria: a lista local aqui
 * omitia DUNNING_RECEIVED (cliente que paga depois de negativado), então a
 * cobrança entrava no caixa e no DRE — que já usam a constante — e ficava
 * de fora da base de comissão. O atendente perdia comissão sobre dinheiro
 * que o escritório recebeu de verdade, e o próprio diagnóstico, que existe
 * para explicar diferenças, também não listava a cobrança.
 */
const STATUS_PAGOS = STATUS_PAGO_ASAAS as unknown as string[];

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

/**
 * Trilha de GESTÃO: o gestor ganha sobre o recebido de todos os clientes
 * que fecharam contrato a partir de `dataCorte`, não importa quem vendeu.
 *
 * `dataCorteEm` é a mesma data já resolvida no fuso do escritório — a
 * comparação com `leads.fechadoEm` (timestamp) tem que acontecer no fuso
 * certo, e não no do servidor.
 */
export interface OpcoesGestao {
  /** YYYY-MM-DD, pra exibir e congelar no snapshot. */
  dataCorte: string;
  /** Início do dia de `dataCorte` no fuso do escritório. */
  dataCorteEm: Date;
  /** Mesmo fuso do corte — é o que decide em que DIA o contrato fechou.
   *  Sem ele, um fechamento às 22h em Fortaleza viraria o dia seguinte na
   *  tela e o operador leria uma data diferente da que a regra usou. */
  fusoHorario: string;
  aliquotaPercent: number;
}

/** Simula comissão detalhada de um atendente em um período. Lê regra
 *  vigente, faixas (se modo=faixas) e cobranças com JOIN em categoria.
 *  Retorna estrutura usada por UI e por `fecharComissao`.
 *
 *  Pode receber `regraCarregada` pré-carregada — caller que invoca em
 *  loop (cron mensal por atendente do mesmo escritório) economiza N×2
 *  queries idênticas. UI manual (uma chamada por clique) ignora o
 *  parâmetro e a função carrega normalmente.
 *
 *  Com `gestao`, muda a trilha: some o filtro por atendente da cobrança
 *  (o gestor ganha sobre tudo), entra o corte por data de fechamento do
 *  cliente, e o anti-duplicidade passa a ser o do próprio gestor — dois
 *  gestores podem comissionar a mesma cobrança, o mesmo gestor não. */
export async function simularComissao(
  escritorioId: number,
  atendenteId: number,
  periodoInicio: string,
  periodoFim: string,
  regraCarregada?: RegraComissaoCarregada,
  gestao?: OpcoesGestao,
) {
  const db = await getDb();
  if (!db) throw new Error("Database indisponível");

  const regraEscritorio = regraCarregada ?? (await carregarRegraComissao(escritorioId));
  // Na gestão o percentual é o do gestor e o modo é sempre flat — faixas
  // progressivas são instrumento de meta de venda. Valor mínimo e dia de
  // vencimento da despesa continuam sendo os do escritório: são regras
  // sobre a cobrança e sobre o caixa, não sobre quem recebe.
  const regra: RegraComissaoCarregada = gestao
    ? {
      ...regraEscritorio,
      aliquotaPercent: gestao.aliquotaPercent,
      modo: "flat",
      faixas: [],
    }
    : regraEscritorio;
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
    isNotNull(asaasCobrancas.dataPagamento),
    between(asaasCobrancas.dataPagamento, periodoInicio, periodoFim),
    inArray(asaasCobrancas.status, STATUS_PAGOS),
  ];

  if (!gestao) {
    condicoes.push(eq(asaasCobrancas.atendenteId, atendenteId));
    // `tipo = 'venda'` não muda nada no acervo atual (toda linha gravada
    // até aqui é de venda) — separa as trilhas daqui pra frente, pra que
    // uma cobrança comissionada na gestão não suma da comissão do vendedor.
    condicoes.push(sql`NOT EXISTS (
      SELECT 1 FROM ${comissoesFechadasItens}
      INNER JOIN ${comissoesFechadas}
        ON ${comissoesFechadas.id} = ${comissoesFechadasItens.comissaoFechadaId}
      WHERE ${comissoesFechadasItens.asaasCobrancaId} = ${asaasCobrancas.id}
        AND ${comissoesFechadas.escritorioId} = ${escritorioId}
        AND ${comissoesFechadas.tipo} = 'venda'
        AND ${comissoesFechadasItens.foiComissionavel} = TRUE
    )`);
  }

  // Na gestão a cobrança já comissionada NÃO sai da consulta: ela aparece
  // na lista de "ficou de fora" com o motivo. Some do cálculo sem sumir da
  // tela — é como o operador confere que a parcela não foi paga duas vezes.
  const jaComissionadaSql = gestao
    ? sql<number>`EXISTS (
        SELECT 1 FROM ${comissoesFechadasItens}
        INNER JOIN ${comissoesFechadas}
          ON ${comissoesFechadas.id} = ${comissoesFechadasItens.comissaoFechadaId}
        WHERE ${comissoesFechadasItens.asaasCobrancaId} = ${asaasCobrancas.id}
          AND ${comissoesFechadas.escritorioId} = ${escritorioId}
          AND ${comissoesFechadas.tipo} = 'gestao'
          AND ${comissoesFechadas.atendenteId} = ${atendenteId}
          AND ${comissoesFechadasItens.foiComissionavel} = TRUE
      )`
    : sql<number>`FALSE`;

  // Cliente real = COALESCE(beneficiário, pagador), o mesmo critério do
  // resto do módulo. Basta UM fechamento a partir do corte pra o cliente
  // entrar; `fechouEm` (o fechamento mais recente) é só pra exibir.
  const dentroDoCorteSql = gestao
    ? sql<number>`EXISTS (
        SELECT 1 FROM ${leads}
        WHERE ${leads.escritorioId} = ${escritorioId}
          AND ${leads.etapaFunil} = 'fechado_ganho'
          AND ${leads.contatoId} = COALESCE(${asaasCobrancas.contatoBeneficiarioId}, ${asaasCobrancas.contatoId})
          AND ${leads.fechadoEm} >= ${gestao.dataCorteEm}
      )`
    : sql<number>`FALSE`;

  const fechouEmSql = gestao
    ? sql<Date | null>`(
        SELECT MAX(${leads.fechadoEm}) FROM ${leads}
        WHERE ${leads.escritorioId} = ${escritorioId}
          AND ${leads.etapaFunil} = 'fechado_ganho'
          AND ${leads.contatoId} = COALESCE(${asaasCobrancas.contatoBeneficiarioId}, ${asaasCobrancas.contatoId})
      )`
    : sql<Date | null>`NULL`;

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
      contatoNome: contatos.nome,
      // Quem vendeu. Na gestão as cobranças vêm de todos os atendentes do
      // escritório, então sem o nome não dá pra conferir a lista.
      atendenteNome: users.name,
      asaasPaymentId: asaasCobrancas.asaasPaymentId,
      parcelaAtual: asaasCobrancas.parcelaAtual,
      parcelaTotal: asaasCobrancas.parcelaTotal,
      fechouEm: fechouEmSql,
      dentroDoCorte: dentroDoCorteSql,
      jaComissionada: jaComissionadaSql,
    })
    .from(asaasCobrancas)
    .leftJoin(categoriasCobranca, eq(categoriasCobranca.id, asaasCobrancas.categoriaId))
    // Cliente real via COALESCE(beneficiário, pagador) — mesmo padrão do
    // dashboard/relatórios comerciais. Caso "esposa paga pelo marido":
    // contatoId=NULL + contatoBeneficiarioId=marido não é órfã, e sem o
    // COALESCE o relatório de comissão saía sem nome de cliente.
    .leftJoin(
      contatos,
      sql`${contatos.id} = COALESCE(${asaasCobrancas.contatoBeneficiarioId}, ${asaasCobrancas.contatoId})`,
    )
    // 1:1 pelas chaves primárias — não multiplica linha nem muda o cálculo.
    .leftJoin(colaboradores, eq(colaboradores.id, asaasCobrancas.atendenteId))
    .leftJoin(users, eq(users.id, colaboradores.userId))
    .where(and(...condicoes))
    .orderBy(asc(asaasCobrancas.dataPagamento));

  // Exclusões que dependem do banco (data de fechamento do cliente e
  // fechamentos anteriores do gestor) são resolvidas aqui, antes do cálculo
  // puro. `calcularComissao` continua vendo só a cascata de elegibilidade
  // por categoria/mínimo, que é o que ele sabe fazer.
  const preExcluidas = new Map<number, MotivoExclusao>();
  if (gestao) {
    for (const l of linhas) {
      if (Number(l.jaComissionada) === 1) preExcluidas.set(l.id, "ja_comissionada");
      else if (Number(l.dentroDoCorte) !== 1) preExcluidas.set(l.id, "fechou_antes_do_corte");
    }
  }

  const cobrancasParaCalculo: CobrancaParaComissao[] = linhas
    .filter((l) => !preExcluidas.has(l.id))
    .map((l) => ({
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
      contatoNome: l.contatoNome,
      atendenteNome: l.atendenteNome ?? null,
      categoriaNome: l.categoriaNome,
      categoriaComissionavel: l.categoriaComissionavel,
      comissionavelOverride: l.comissionavelOverride,
      parcelaAtual: l.parcelaAtual ?? null,
      parcelaTotal: l.parcelaTotal ?? null,
      // "YYYY-MM-DD" como o resto da tela: dataPagamento e dataCorte chegam
      // assim, e o formatador do client parte a string em três.
      fechouEm: l.fechouEm && gestao
        ? diaCivilEmTz(new Date(l.fechouEm), gestao.fusoHorario)
        : null,
      motivoExclusao: motivo ?? null,
    };
  };

  const naoComissionaveis = [
    ...resultado.naoComissionaveis.map((n) => enriquecer(n.cobranca.id, n.motivo)),
    ...Array.from(preExcluidas).map(([id, motivo]) => enriquecer(id, motivo)),
  ].sort((a, b) => (a.dataPagamento ?? "").localeCompare(b.dataPagamento ?? ""));

  // O bruto é tudo que entrou no período, inclusive o que a gestão descartou
  // por corte ou por já ter sido comissionado — senão o card "Bruto recebido"
  // mudaria de significado entre as duas trilhas.
  const brutoTotal = linhas.reduce((soma, l) => soma + Number(l.valor), 0);
  const totais = gestao
    ? {
      bruto: +brutoTotal.toFixed(2),
      comissionavel: resultado.totais.comissionavel,
      naoComissionavel: +(brutoTotal - resultado.totais.comissionavel).toFixed(2),
      valorComissao: resultado.totais.valorComissao,
    }
    : resultado.totais;

  return {
    regra: { aliquotaPercent, valorMinimo, modo, baseFaixa, faixas, diaVencimentoDespesa: regra.diaVencimentoDespesa },
    tipo: gestao ? ("gestao" as const) : ("venda" as const),
    dataCorte: gestao?.dataCorte ?? null,
    aliquotaAplicada: resultado.aliquotaAplicada,
    faixaAplicada: resultado.faixaAplicada ?? null,
    comissionaveis: resultado.comissionaveis.map((c) => enriquecer(c.id)),
    naoComissionaveis,
    totais,
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
    motivo: "comissionavel" | "atendente_diferente" | "ja_fechada" | MotivoExclusao;
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
        // Motivos da trilha de gestão. O diagnóstico roda sobre a trilha de
        // venda, então na prática não caem aqui — o Record só não pode ter
        // buraco, e um texto explícito é melhor que um `??` mudo.
        fechou_antes_do_corte: "Cliente fechou contrato antes da data de corte da comissão de gestão.",
        ja_comissionada: "Já entrou num fechamento anterior de comissão de gestão deste gestor.",
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
  /** Trilha de gestão. Presente = comissão do gestor sobre o recebido dos
   *  clientes fechados a partir do corte; ausente = comissão de venda. */
  gestao?: OpcoesGestao;
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

  // Dedup cross-origem em 2 camadas:
  //  (1) Check SELECT pré-INSERT — UX-first: retorna `FechamentoJaExisteError`
  //      estruturado com id e origem pra UI mostrar "Ver existente / Recriar".
  //  (2) UNIQUE no DB (escritorio, atendente, inicio, fim, versao) — fecha
  //      a janela de race entre o check (1) e o INSERT abaixo. Sem essa
  //      camada, cron `processarAgendasComissao` e clique manual disparados
  //      no mesmo segundo passam ambos pelo check e criam 2 fechamentos
  //      duplicados + 2 despesas pendentes.
  //
  // Re-fechamento legítimo após correção: caller passa `forcarDuplicado=true`
  // → pula check (1) e calcula `versao` incremental via MAX+1. UNIQUE
  // permite múltiplos fechamentos com versões diferentes.
  // A trilha entra em toda chave de dedup: um gestor que também vende tem
  // dois fechamentos legítimos no mesmo período, um de cada tipo.
  const tipo = params.gestao ? ("gestao" as const) : ("venda" as const);

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
          eq(comissoesFechadas.tipo, tipo),
          eq(comissoesFechadas.periodoInicio, params.periodoInicio),
          eq(comissoesFechadas.periodoFim, params.periodoFim),
          eq(comissoesFechadas.versao, 0),
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

  // Versão = 0 pro fechamento primário (default); MAX+1 quando o operador
  // forçar re-fechamento. Lê só rows do mesmo (escritório, atendente,
  // período) — não afeta outros períodos.
  let versao = 0;
  if (params.forcarDuplicado) {
    const [maxRow] = await db
      .select({
        max: sql<number>`COALESCE(MAX(${comissoesFechadas.versao}), -1)`,
      })
      .from(comissoesFechadas)
      .where(
        and(
          eq(comissoesFechadas.escritorioId, params.escritorioId),
          eq(comissoesFechadas.atendenteId, params.atendenteId),
          eq(comissoesFechadas.tipo, tipo),
          eq(comissoesFechadas.periodoInicio, params.periodoInicio),
          eq(comissoesFechadas.periodoFim, params.periodoFim),
        ),
      );
    versao = Number(maxRow?.max ?? -1) + 1;
  }

  const sim = await simularComissao(
    params.escritorioId,
    params.atendenteId,
    params.periodoInicio,
    params.periodoFim,
    params.regraCarregada,
    params.gestao,
  );

  let novo: { id: number };
  try {
    [novo] = await db
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
        versao,
        tipo,
        dataCorteUsada: params.gestao?.dataCorte ?? null,
      })
      .$returningId();
  } catch (err: unknown) {
    // ER_DUP_ENTRY = race condition: outro caller (cron ou manual)
    // inseriu mesma (escritório, atendente, período, versao) entre nosso
    // check pré-INSERT e o INSERT. Drizzle envolve mysql2; código real
    // fica em err.cause.code/errno.
    const errAny = err as { cause?: { code?: string; errno?: number } };
    const isDupKey =
      errAny?.cause?.code === "ER_DUP_ENTRY" || errAny?.cause?.errno === 1062;
    if (isDupKey && !params.forcarDuplicado) {
      // Refetch o vencedor pra retornar erro estruturado idêntico ao do
      // check pré-INSERT. UI segue tratando como "já existe — recriar?".
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
            eq(comissoesFechadas.tipo, tipo),
            eq(comissoesFechadas.periodoInicio, params.periodoInicio),
            eq(comissoesFechadas.periodoFim, params.periodoFim),
            eq(comissoesFechadas.versao, 0),
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
    throw err;
  }

  const itens = [
    ...sim.comissionaveis.map((c) => ({
      comissaoFechadaId: novo.id,
      asaasCobrancaId: c.id,
      valor: c.valor.toFixed(2),
      foiComissionavel: true,
      motivoExclusao: null,
    })),
    // "já comissionada" não vira item: a cobrança pertence ao fechamento
    // anterior, e gravá-la de novo criaria duas linhas pra mesma cobrança
    // dentro da mesma trilha, atrapalhando qualquer conferência futura.
    ...sim.naoComissionaveis
      .filter((c) => c.motivoExclusao !== "ja_comissionada")
      .map((c) => ({
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
      const rotulo = tipo === "gestao" ? "Comissão de gestão" : "Comissão";
      const descricao = `${rotulo} ${nomeAtendente} — ${formatarDataBR(params.periodoInicio)} a ${formatarDataBR(params.periodoFim)}`;
      const [despNova] = await db
        .insert(despesas)
        .values({
          escritorioId: params.escritorioId,
          categoriaId,
          descricao,
          valor: sim.totais.valorComissao.toFixed(2),
          vencimento,
          status: "pendente",
          origem: "comissao",
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

// ─── Configuração da comissão de gestão ──────────────────────────────────────

/** Gestores configurados no escritório, com nome pra exibir. Traz também os
 *  inativos: desligar é reversível e a lista é a tela de configuração. */
export async function listarComissoesGestao(escritorioId: number) {
  const db = await getDb();
  if (!db) return [];
  const linhas = await db
    .select({
      id: comissaoGestao.id,
      colaboradorId: comissaoGestao.colaboradorId,
      aliquotaPercent: comissaoGestao.aliquotaPercent,
      dataCorte: comissaoGestao.dataCorte,
      ativo: comissaoGestao.ativo,
      nome: users.name,
      email: users.email,
      cargo: colaboradores.cargo,
    })
    .from(comissaoGestao)
    .innerJoin(colaboradores, eq(colaboradores.id, comissaoGestao.colaboradorId))
    .leftJoin(users, eq(users.id, colaboradores.userId))
    .where(eq(comissaoGestao.escritorioId, escritorioId))
    .orderBy(asc(comissaoGestao.id));
  return linhas.map((l) => ({
    ...l,
    aliquotaPercent: Number(l.aliquotaPercent),
  }));
}

/** Config de um gestor. `null` quando ele não está cadastrado ou está
 *  desligado — nos dois casos não há comissão de gestão a calcular. */
export async function obterComissaoGestaoAtiva(
  escritorioId: number,
  colaboradorId: number,
): Promise<{ aliquotaPercent: number; dataCorte: string } | null> {
  const db = await getDb();
  if (!db) return null;
  const [linha] = await db
    .select({
      aliquotaPercent: comissaoGestao.aliquotaPercent,
      dataCorte: comissaoGestao.dataCorte,
    })
    .from(comissaoGestao)
    .where(and(
      eq(comissaoGestao.escritorioId, escritorioId),
      eq(comissaoGestao.colaboradorId, colaboradorId),
      eq(comissaoGestao.ativo, true),
    ))
    .limit(1);
  if (!linha) return null;
  return {
    aliquotaPercent: Number(linha.aliquotaPercent),
    dataCorte: linha.dataCorte,
  };
}

/** Cria ou atualiza a config de um gestor (UNIQUE escritório+colaborador). */
export async function salvarComissaoGestao(params: {
  escritorioId: number;
  colaboradorId: number;
  aliquotaPercent: number;
  dataCorte: string;
  ativo: boolean;
  criadoPorUserId: number;
}): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database indisponível");
  const [existente] = await db
    .select({ id: comissaoGestao.id })
    .from(comissaoGestao)
    .where(and(
      eq(comissaoGestao.escritorioId, params.escritorioId),
      eq(comissaoGestao.colaboradorId, params.colaboradorId),
    ))
    .limit(1);

  if (existente) {
    await db
      .update(comissaoGestao)
      .set({
        aliquotaPercent: params.aliquotaPercent.toFixed(2),
        dataCorte: params.dataCorte,
        ativo: params.ativo,
      })
      .where(eq(comissaoGestao.id, existente.id));
    return;
  }

  await db.insert(comissaoGestao).values({
    escritorioId: params.escritorioId,
    colaboradorId: params.colaboradorId,
    aliquotaPercent: params.aliquotaPercent.toFixed(2),
    dataCorte: params.dataCorte,
    ativo: params.ativo,
    criadoPorUserId: params.criadoPorUserId,
  });
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
