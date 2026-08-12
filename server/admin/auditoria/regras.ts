/**
 * Catálogo de invariantes do robô auditor.
 *
 * Cada regra é uma afirmação sobre o banco que precisa valer sempre. A
 * função `detectar` devolve as linhas que a violam — lista vazia é o
 * estado saudável.
 *
 * Regras usam o query builder do Drizzle, não SQL cru: as colunas físicas
 * têm nome diferente das propriedades TS (`saldo` → `saldoJCred`), então
 * string solta apodrece silenciosamente na primeira renomeação. Com o
 * builder, `pnpm check` acusa.
 *
 * Toda consulta aqui é SELECT. Não importe nada que escreva neste arquivo.
 */

import { and, eq, isNotNull, isNull, lt, ne, or, sql } from "drizzle-orm";
import {
  asaasCobrancas,
  clienteProcessos,
  cofreCredenciais,
  colaboradores,
  comissoesFechadas,
  comissoesFechadasItens,
  contatos,
  convitesColaborador,
  escritorioCreditos,
  escritorioTransacoes,
  kanbanCards,
  motorMonitoramentos,
  smartflowExecucoes,
} from "../../../drizzle/schema";
import { ORDEM_SEVERIDADE, type Regra } from "./tipos";

/**
 * Status do Asaas que significam dinheiro recebido. Mesma lista que
 * `db-comissoes.ts` e o DRE usam — se divergir, o robô passa a acusar o
 * que o financeiro considera normal.
 */
const STATUS_PAGOS = ["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"];

/** Execução órfã parada além disso já não retoma sozinha. */
const HORAS_EXECUCAO_ORFA = 48;

/**
 * Folga sobre o `retomarEm` vencido. O scheduler roda a cada 60s, então
 * retomada atrasada em horas significa que ele não está pegando aquela
 * linha — não que está ocupado.
 */
const HORAS_RETOMADA_ATRASADA = 2;

export const REGRAS: Regra[] = [
  {
    id: "CRED-01",
    titulo: "Saldo de créditos diverge do extrato",
    severidade: "critico",
    dominio: "financeiro",
    nivel: "A",
    tabela: "escritorio_creditos",
    invariante:
      "O saldo em escritorio_creditos deve ser igual ao saldoDepois da última " +
      "transação do escritório. O saldo é cache; o extrato é a fonte da verdade.",
    correcaoPrevista:
      "Regravar o saldo com o saldoDepois da última transação e registrar " +
      "antes/depois no audit_log.",
    shadow: true,
    async detectar(db, limite) {
      // consumirCreditosEscritorio faz UPDATE do saldo e INSERT da transação
      // em statements separados — se o segundo falha, o saldo fica adiantado.
      const ultimaTx = db
        .select({
          escritorioId: escritorioTransacoes.escritorioId,
          ultimoId: sql<number>`MAX(${escritorioTransacoes.id})`.as("ultimo_id"),
        })
        .from(escritorioTransacoes)
        .groupBy(escritorioTransacoes.escritorioId)
        .as("ultima_tx");

      const linhas = await db
        .select({
          id: escritorioCreditos.id,
          escritorioId: escritorioCreditos.escritorioId,
          saldo: escritorioCreditos.saldo,
          saldoLedger: escritorioTransacoes.saldoDepois,
          operacao: escritorioTransacoes.operacao,
          transacaoId: escritorioTransacoes.id,
          transacaoEm: escritorioTransacoes.createdAt,
        })
        .from(escritorioCreditos)
        .innerJoin(ultimaTx, eq(ultimaTx.escritorioId, escritorioCreditos.escritorioId))
        .innerJoin(escritorioTransacoes, eq(escritorioTransacoes.id, ultimaTx.ultimoId))
        .where(ne(escritorioCreditos.saldo, escritorioTransacoes.saldoDepois))
        .limit(limite);

      return linhas.map((l) => ({
        escritorioId: l.escritorioId,
        alvoId: l.id,
        descricao: `Escritório ${l.escritorioId}: saldo ${l.saldo}, extrato ${l.saldoLedger}`,
        valores: {
          saldoGravado: l.saldo,
          saldoDoExtrato: l.saldoLedger,
          diferenca: l.saldo - l.saldoLedger,
          ultimaOperacao: l.operacao,
          ultimaTransacaoId: l.transacaoId,
          ultimaTransacaoEm: l.transacaoEm?.toISOString() ?? null,
        },
      }));
    },
  },

  {
    id: "TEN-01",
    titulo: "Processo vinculado a cliente de outro escritório",
    severidade: "critico",
    dominio: "multi_tenant",
    nivel: "C",
    tabela: "cliente_processos",
    invariante:
      "O escritorioId de cliente_processos deve ser igual ao escritorioId do " +
      "contato vinculado. Divergência é vazamento entre inquilinos.",
    correcaoPrevista:
      "Nenhuma automática. Decidir qual dos dois lados está certo exige " +
      "saber quem cadastrou o quê — e escolher errado move dado de cliente " +
      "entre escritórios.",
    shadow: true,
    async detectar(db, limite) {
      const linhas = await db
        .select({
          id: clienteProcessos.id,
          escritorioProcesso: clienteProcessos.escritorioId,
          escritorioContato: contatos.escritorioId,
          contatoId: contatos.id,
          contatoNome: contatos.nome,
          cnj: clienteProcessos.numeroCnj,
        })
        .from(clienteProcessos)
        .innerJoin(contatos, eq(contatos.id, clienteProcessos.contatoId))
        .where(ne(clienteProcessos.escritorioId, contatos.escritorioId))
        .limit(limite);

      return linhas.map((l) => ({
        escritorioId: l.escritorioProcesso,
        alvoId: l.id,
        descricao: `Processo ${l.cnj ?? l.id} do escritório ${l.escritorioProcesso} aponta pra cliente do ${l.escritorioContato}`,
        valores: {
          escritorioDoProcesso: l.escritorioProcesso,
          escritorioDoCliente: l.escritorioContato,
          contatoId: l.contatoId,
          contatoNome: l.contatoNome,
          cnj: l.cnj,
        },
      }));
    },
  },

  {
    id: "FIN-02",
    titulo: "Cobrança paga sem data de pagamento",
    severidade: "alto",
    dominio: "financeiro",
    nivel: "B",
    tabela: "asaas_cobrancas",
    invariante:
      "Cobrança com status de recebido precisa ter dataPagamento preenchida. " +
      "Sem ela a receita existe no banco mas some do DRE, que filtra por data.",
    correcaoPrevista:
      "Preencher com a data do evento de webhook que confirmou o pagamento. " +
      "Quando não houver evento, a data é uma escolha — vira proposta.",
    shadow: true,
    async detectar(db, limite) {
      const linhas = await db
        .select({
          id: asaasCobrancas.id,
          escritorioId: asaasCobrancas.escritorioId,
          status: asaasCobrancas.status,
          valor: asaasCobrancas.valor,
          vencimento: asaasCobrancas.vencimento,
          descricao: asaasCobrancas.descricao,
          asaasPaymentId: asaasCobrancas.asaasPaymentId,
        })
        .from(asaasCobrancas)
        .where(
          and(
            sql`${asaasCobrancas.status} IN ${STATUS_PAGOS}`,
            or(isNull(asaasCobrancas.dataPagamento), eq(asaasCobrancas.dataPagamento, "")),
          ),
        )
        .limit(limite);

      return linhas.map((l) => ({
        escritorioId: l.escritorioId,
        alvoId: l.id,
        descricao: `Cobrança ${l.id} (${l.descricao ?? "sem descrição"}) está ${l.status} sem data de pagamento`,
        valores: {
          status: l.status,
          valor: l.valor,
          vencimento: l.vencimento,
          dataPagamento: null,
          asaasPaymentId: l.asaasPaymentId,
        },
      }));
    },
  },

  {
    id: "COM-01",
    titulo: "Fechamento de comissão diverge da soma dos itens",
    severidade: "alto",
    dominio: "comissoes",
    nivel: "C",
    tabela: "comissoes_fechadas",
    invariante:
      "O totalComissionavel de um fechamento deve ser igual à soma dos itens " +
      "marcados como comissionáveis daquele fechamento.",
    correcaoPrevista:
      "Nenhuma automática. Fechamento é dinheiro já comunicado ao " +
      "colaborador; recalcular por conta própria muda o que alguém vai receber.",
    shadow: true,
    async detectar(db, limite) {
      const somaItens = db
        .select({
          comissaoId: comissoesFechadasItens.comissaoFechadaId,
          soma: sql<string>`SUM(CASE WHEN ${comissoesFechadasItens.foiComissionavel} = 1 THEN ${comissoesFechadasItens.valor} ELSE 0 END)`.as(
            "soma_comissionavel",
          ),
        })
        .from(comissoesFechadasItens)
        .groupBy(comissoesFechadasItens.comissaoFechadaId)
        .as("soma_itens");

      const linhas = await db
        .select({
          id: comissoesFechadas.id,
          escritorioId: comissoesFechadas.escritorioId,
          atendenteId: comissoesFechadas.atendenteId,
          periodoInicio: comissoesFechadas.periodoInicio,
          periodoFim: comissoesFechadas.periodoFim,
          totalComissionavel: comissoesFechadas.totalComissionavel,
          somaItens: somaItens.soma,
        })
        .from(comissoesFechadas)
        .innerJoin(somaItens, eq(somaItens.comissaoId, comissoesFechadas.id))
        // Centavo de folga: decimal somado no MySQL não bate bit a bit com o
        // total gravado quando o fechamento arredondou.
        .where(sql`ABS(COALESCE(${comissoesFechadas.totalComissionavel}, 0) - ${somaItens.soma}) > 0.01`)
        .limit(limite);

      return linhas.map((l) => ({
        escritorioId: l.escritorioId,
        alvoId: l.id,
        descricao: `Fechamento ${l.id} (${l.periodoInicio}–${l.periodoFim}) grava ${l.totalComissionavel}, itens somam ${l.somaItens}`,
        valores: {
          totalGravado: l.totalComissionavel,
          somaDosItens: l.somaItens,
          atendenteId: l.atendenteId,
          periodo: `${l.periodoInicio} a ${l.periodoFim}`,
        },
      }));
    },
  },

  {
    id: "MON-03",
    titulo: "Monitoramento ativo com credencial removida",
    severidade: "medio",
    dominio: "motor",
    nivel: "B",
    tabela: "motor_monitoramentos",
    invariante:
      "Monitoramento ativo que aponta pra uma credencial do cofre exige que " +
      "essa credencial ainda exista. Sem ela o cron falha toda rodada em silêncio.",
    correcaoPrevista:
      "Pausar o monitoramento e avisar o escritório. Pausar é reversível, mas " +
      "para a coleta de um processo — o dono do escritório decide.",
    shadow: true,
    async detectar(db, limite) {
      const linhas = await db
        .select({
          id: motorMonitoramentos.id,
          escritorioId: motorMonitoramentos.escritorioId,
          apelido: motorMonitoramentos.apelido,
          tribunal: motorMonitoramentos.tribunal,
          credencialId: motorMonitoramentos.credencialId,
          searchKey: motorMonitoramentos.searchKey,
          ultimaConsultaEm: motorMonitoramentos.ultimaConsultaEm,
        })
        .from(motorMonitoramentos)
        .leftJoin(cofreCredenciais, eq(cofreCredenciais.id, motorMonitoramentos.credencialId))
        .where(
          and(
            eq(motorMonitoramentos.status, "ativo"),
            isNotNull(motorMonitoramentos.credencialId),
            isNull(cofreCredenciais.id),
          ),
        )
        .limit(limite);

      return linhas.map((l) => ({
        escritorioId: l.escritorioId,
        alvoId: l.id,
        descricao: `Monitoramento ${l.apelido ?? l.searchKey} (${l.tribunal}) usa credencial ${l.credencialId}, que não existe mais`,
        valores: {
          credencialId: l.credencialId,
          tribunal: l.tribunal,
          ultimaConsultaEm: l.ultimaConsultaEm?.toISOString() ?? null,
        },
      }));
    },
  },

  {
    id: "INT-02",
    titulo: "Convite marcado como enviado, com erro de e-mail registrado",
    severidade: "medio",
    dominio: "observabilidade",
    nivel: "A",
    tabela: "convites_colaborador",
    invariante:
      "emailEnviado e ultimoErroEmail se excluem: ou o envio deu certo, ou " +
      "guardou o erro. Os dois juntos mostram “ok” no painel pra um convite que falhou.",
    correcaoPrevista:
      "Regravar emailEnviado como false, devolvendo o convite ao estado de " +
      "falha para que o botão de reenviar apareça.",
    shadow: true,
    async detectar(db, limite) {
      const linhas = await db
        .select({
          id: convitesColaborador.id,
          escritorioId: convitesColaborador.escritorioId,
          email: convitesColaborador.email,
          status: convitesColaborador.status,
          ultimoErroEmail: convitesColaborador.ultimoErroEmail,
          createdAt: convitesColaborador.createdAt,
        })
        .from(convitesColaborador)
        .where(
          and(
            eq(convitesColaborador.emailEnviado, true),
            isNotNull(convitesColaborador.ultimoErroEmail),
          ),
        )
        .limit(limite);

      return linhas.map((l) => ({
        escritorioId: l.escritorioId,
        alvoId: l.id,
        descricao: `Convite para ${l.email} consta enviado, mas guardou erro de envio`,
        valores: {
          emailEnviado: "true",
          ultimoErroEmail: l.ultimoErroEmail,
          statusConvite: l.status,
          criadoEm: l.createdAt?.toISOString() ?? null,
        },
      }));
    },
  },

  {
    id: "FLW-05",
    titulo: "Execução do SmartFlow travada",
    severidade: "medio",
    dominio: "smartflow",
    nivel: "B",
    tabela: "smartflow_execucoes",
    invariante:
      "Execução com status “rodando” deve ter quem a retome: um retomarEm " +
      "no futuro ou um contato de quem se espera resposta. Sem nenhum dos " +
      "dois, ou com retomarEm vencido há horas, ela não sai do lugar.",
    correcaoPrevista:
      "Marcar como erro para liberar o contato para novos fluxos. Encerrar " +
      "execução é decisão de produto — o passo pode ter parado no meio de algo.",
    shadow: true,
    async detectar(db, limite) {
      // "rodando" NÃO significa ocupada: é também o estado de quem espera.
      // Um passo `esperar 7 dias` e um `aguardar resposta` com timeout de
      // 24h ficam rodando e parados legitimamente — a primeira versão desta
      // regra acusava os dois e devolveu 14 falsos positivos em produção.
      const orfaDesde = new Date(Date.now() - HORAS_EXECUCAO_ORFA * 60 * 60 * 1000);
      const retomadaVencidaEm = new Date(Date.now() - HORAS_RETOMADA_ATRASADA * 60 * 60 * 1000);

      const linhas = await db
        .select({
          id: smartflowExecucoes.id,
          escritorioId: smartflowExecucoes.escritorioId,
          cenarioId: smartflowExecucoes.cenarioId,
          contatoId: smartflowExecucoes.contatoId,
          passoAtual: smartflowExecucoes.passoAtual,
          updatedAt: smartflowExecucoes.updatedAt,
          retomarEm: smartflowExecucoes.retomarEm,
          aguardandoContatoId: smartflowExecucoes.aguardandoMensagemContatoId,
        })
        .from(smartflowExecucoes)
        .where(
          and(
            eq(smartflowExecucoes.status, "rodando"),
            or(
              // Órfã: ninguém vai retomar, e faz tempo que não anda.
              and(
                isNull(smartflowExecucoes.retomarEm),
                isNull(smartflowExecucoes.aguardandoMensagemContatoId),
                lt(smartflowExecucoes.updatedAt, orfaDesde),
              ),
              // A hora de retomar passou e o scheduler não pegou.
              lt(smartflowExecucoes.retomarEm, retomadaVencidaEm),
            ),
          ),
        )
        .limit(limite);

      return linhas.map((l) => {
        const orfa = !l.retomarEm && !l.aguardandoContatoId;
        return {
          escritorioId: l.escritorioId,
          alvoId: l.id,
          descricao: orfa
            ? `Execução ${l.id} do cenário ${l.cenarioId} parada no passo ${l.passoAtual}, sem nada que a retome`
            : `Execução ${l.id} do cenário ${l.cenarioId} devia ter retomado em ${l.retomarEm?.toISOString()}`,
          valores: {
            motivo: orfa ? "sem retomada agendada" : "retomada vencida",
            cenarioId: l.cenarioId,
            contatoId: l.contatoId,
            passoAtual: l.passoAtual,
            retomarEm: l.retomarEm?.toISOString() ?? null,
            aguardandoContatoId: l.aguardandoContatoId,
            paradaDesde: l.updatedAt?.toISOString() ?? null,
          },
        };
      });
    },
  },

  {
    id: "COL-01",
    titulo: "Colaborador ativo com data de remoção",
    severidade: "medio",
    dominio: "permissoes",
    nivel: "B",
    tabela: "colaboradores",
    invariante:
      "ativo=true e removidoEm preenchido é estado contraditório. Dependendo " +
      "de qual campo o gate consultar, quem saiu do escritório continua entrando.",
    correcaoPrevista:
      "Desativar o colaborador. Mexe em acesso, então passa por decisão " +
      "humana mesmo sendo uma contradição óbvia.",
    shadow: true,
    async detectar(db, limite) {
      const linhas = await db
        .select({
          id: colaboradores.id,
          escritorioId: colaboradores.escritorioId,
          userId: colaboradores.userId,
          cargo: colaboradores.cargo,
          removidoEm: colaboradores.removidoEm,
          removidoPor: colaboradores.removidoPor,
        })
        .from(colaboradores)
        .where(and(eq(colaboradores.ativo, true), isNotNull(colaboradores.removidoEm)))
        .limit(limite);

      return linhas.map((l) => ({
        escritorioId: l.escritorioId,
        alvoId: l.id,
        descricao: `Colaborador ${l.id} (${l.cargo}) consta ativo, removido em ${l.removidoEm?.toISOString().slice(0, 10)}`,
        valores: {
          ativo: "true",
          removidoEm: l.removidoEm?.toISOString() ?? null,
          removidoPor: l.removidoPor,
          cargo: l.cargo,
          userId: l.userId,
        },
      }));
    },
  },

  {
    id: "KAN-01",
    titulo: "Card do Kanban com responsável desligado",
    severidade: "baixo",
    dominio: "kanban",
    nivel: "B",
    tabela: "kanban_cards",
    invariante:
      "Card não arquivado deve apontar pra colaborador ativo. Card de quem " +
      "saiu não aparece em nenhum filtro por responsável e fica órfão no funil.",
    correcaoPrevista:
      "Reatribuir ao gestor do funil ou limpar o responsável. Escolher o " +
      "novo dono é decisão de quem toca o funil.",
    shadow: true,
    async detectar(db, limite) {
      const linhas = await db
        .select({
          id: kanbanCards.id,
          escritorioId: kanbanCards.escritorioId,
          titulo: kanbanCards.titulo,
          responsavelId: kanbanCards.responsavelId,
          colaboradorAtivo: colaboradores.ativo,
          removidoEm: colaboradores.removidoEm,
        })
        .from(kanbanCards)
        .innerJoin(colaboradores, eq(colaboradores.id, kanbanCards.responsavelId))
        .where(
          and(
            eq(kanbanCards.arquivado, false),
            or(eq(colaboradores.ativo, false), isNotNull(colaboradores.removidoEm)),
          ),
        )
        .limit(limite);

      return linhas.map((l) => ({
        escritorioId: l.escritorioId,
        alvoId: l.id,
        descricao: `Card "${l.titulo}" está com responsável ${l.responsavelId}, que não é mais colaborador ativo`,
        valores: {
          responsavelId: l.responsavelId,
          colaboradorAtivo: String(l.colaboradorAtivo),
          removidoEm: l.removidoEm?.toISOString() ?? null,
        },
      }));
    },
  },
];

/** Metadados das regras, sem as funções — é o que vai pro client. */
export function listarRegras() {
  return [...REGRAS]
    .sort(
      (a, b) =>
        ORDEM_SEVERIDADE[a.severidade] - ORDEM_SEVERIDADE[b.severidade] ||
        a.id.localeCompare(b.id),
    )
    .map(({ detectar: _detectar, ...meta }) => meta);
}

export function buscarRegra(id: string): Regra | undefined {
  return REGRAS.find((r) => r.id === id);
}
