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

import { and, desc, eq, gt, inArray, isNotNull, isNull, lt, ne, or, sql } from "drizzle-orm";
import {
  agendamentos,
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
  eventosProcesso,
  kanbanCards,
  kanbanMovimentacoes,
  leads,
  motorMonitoramentos,
  smartflowExecucoes,
  tarefas,
} from "../../../drizzle/schema";
import { lerDocumentoNoRotulo } from "../../../shared/documento-no-rotulo";
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
 * Teto por lado da lista da Agenda sem janela de datas (`agenda.listar`).
 * Acima disso a aba Eventos deixa de mostrar tudo — e o que some é sempre o
 * extremo mais distante de hoje.
 */
const TETO_LISTA_AGENDA = 300;

/**
 * Quantos candidatos puxar antes de filtrar em JS na MOV-01. O rótulo só se
 * lê com regex de verdade, e SQL só consegue estreitar; sem folga, a regra
 * devolveria menos linhas do que existem por ter jogado fora as que não
 * casaram no filtro grosso.
 */
const FOLGA_CANDIDATOS = 6;

/**
 * Folga sobre o `retomarEm` vencido. O scheduler roda a cada 60s, então
 * retomada atrasada em horas significa que ele não está pegando aquela
 * linha — não que está ocupado.
 */
const HORAS_RETOMADA_ATRASADA = 2;

export const REGRAS: Regra[] = [
  {
    id: "AGD-01",
    titulo: "Evento com responsável de outro escritório",
    severidade: "critico",
    dominio: "multi_tenant",
    nivel: "C",
    tabela: "agendamentos / tarefas",
    invariante:
      "O responsável de um compromisso ou tarefa tem que ser colaborador do " +
      "MESMO escritório do evento. `responsavelId` é um int livre que chega " +
      "do cliente e nada no schema o amarra a colaboradores.",
    correcaoPrevista:
      "Nenhuma automática. Escolher entre apagar o vínculo e reatribuir " +
      "exige saber de quem era o trabalho — e chutar move evento entre " +
      "escritórios.",
    shadow: true,
    async detectar(db, limite) {
      const ags = await db
        .select({
          id: agendamentos.id,
          escritorioId: agendamentos.escritorioId,
          responsavelId: agendamentos.responsavelId,
          titulo: agendamentos.titulo,
          escritorioDoColaborador: colaboradores.escritorioId,
        })
        .from(agendamentos)
        .leftJoin(colaboradores, eq(colaboradores.id, agendamentos.responsavelId))
        .where(and(
          isNotNull(agendamentos.responsavelId),
          or(
            isNull(colaboradores.id),
            ne(colaboradores.escritorioId, agendamentos.escritorioId),
          )!,
        ))
        .limit(limite);

      const trs = await db
        .select({
          id: tarefas.id,
          escritorioId: tarefas.escritorioId,
          responsavelId: tarefas.responsavelId,
          titulo: tarefas.titulo,
          escritorioDoColaborador: colaboradores.escritorioId,
        })
        .from(tarefas)
        .leftJoin(colaboradores, eq(colaboradores.id, tarefas.responsavelId))
        .where(and(
          isNotNull(tarefas.responsavelId),
          or(
            isNull(colaboradores.id),
            ne(colaboradores.escritorioId, tarefas.escritorioId),
          )!,
        ))
        .limit(limite);

      return [
        ...ags.map((l) => ({
          escritorioId: l.escritorioId,
          alvoId: l.id,
          descricao: `Compromisso ${l.id} "${l.titulo}" aponta pro colaborador ${l.responsavelId}`,
          valores: {
            fonte: "compromisso",
            responsavelId: l.responsavelId,
            escritorioDoEvento: l.escritorioId,
            escritorioDoColaborador: l.escritorioDoColaborador ?? "colaborador inexistente",
          },
        })),
        ...trs.map((l) => ({
          escritorioId: l.escritorioId,
          alvoId: l.id,
          descricao: `Tarefa ${l.id} "${l.titulo}" aponta pro colaborador ${l.responsavelId}`,
          valores: {
            fonte: "tarefa",
            responsavelId: l.responsavelId,
            escritorioDoEvento: l.escritorioId,
            escritorioDoColaborador: l.escritorioDoColaborador ?? "colaborador inexistente",
          },
        })),
      ].slice(0, limite);
    },
  },

  {
    id: "AGD-02",
    titulo: "Prazo com data fatal antes da data inicial",
    severidade: "medio",
    dominio: "agenda",
    nivel: "B",
    tabela: "agendamentos / tarefas",
    invariante:
      "Num par de datas de prazo, a fatal não pode ser anterior à inicial. " +
      "Invertidas, o evento nasce vencido antes de começar e cai no balde de " +
      "atrasados no mesmo dia em que foi criado.",
    correcaoPrevista:
      "Trocar as duas de lugar é o palpite óbvio e é justamente o que não dá " +
      "pra fazer sozinho: pode ser que a fatal esteja certa e a inicial " +
      "digitada errada. Vira proposta.",
    shadow: true,
    async detectar(db, limite) {
      const ags = await db
        .select({
          id: agendamentos.id,
          escritorioId: agendamentos.escritorioId,
          titulo: agendamentos.titulo,
          dataInicio: agendamentos.dataInicio,
          dataFim: agendamentos.dataFim,
        })
        .from(agendamentos)
        .where(and(
          isNotNull(agendamentos.dataFim),
          lt(agendamentos.dataFim, agendamentos.dataInicio),
        ))
        .limit(limite);

      const trs = await db
        .select({
          id: tarefas.id,
          escritorioId: tarefas.escritorioId,
          titulo: tarefas.titulo,
          dataInicial: tarefas.dataInicial,
          dataVencimento: tarefas.dataVencimento,
        })
        .from(tarefas)
        .where(and(
          isNotNull(tarefas.dataInicial),
          isNotNull(tarefas.dataVencimento),
          lt(tarefas.dataVencimento, tarefas.dataInicial),
        ))
        .limit(limite);

      return [
        ...ags.map((l) => ({
          escritorioId: l.escritorioId,
          alvoId: l.id,
          descricao: `Compromisso ${l.id} "${l.titulo}" termina antes de começar`,
          valores: {
            fonte: "compromisso",
            dataInicial: l.dataInicio?.toISOString() ?? null,
            dataFatal: l.dataFim?.toISOString() ?? null,
          },
        })),
        ...trs.map((l) => ({
          escritorioId: l.escritorioId,
          alvoId: l.id,
          descricao: `Tarefa ${l.id} "${l.titulo}" vence antes de começar`,
          valores: {
            fonte: "tarefa",
            dataInicial: l.dataInicial?.toISOString() ?? null,
            dataFatal: l.dataVencimento?.toISOString() ?? null,
          },
        })),
      ].slice(0, limite);
    },
  },

  {
    id: "AGD-03",
    titulo: "Escritório com mais eventos abertos do que a lista mostra",
    severidade: "alto",
    dominio: "observabilidade",
    nivel: "C",
    tabela: "agendamentos / tarefas",
    invariante:
      "A aba Eventos da Agenda busca sem janela de datas e corta em " +
      `${TETO_LISTA_AGENDA} por lado (próximos e passados). Acima disso ela ` +
      "deixa de mostrar tudo, e some justamente o extremo mais distante de " +
      "hoje — sem avisar ninguém.",
    correcaoPrevista:
      "Não é corrigível no banco: é sinal de que o teto precisa subir ou de " +
      "que a lista precisa paginar. Serve pra decidir isso antes de alguém " +
      "perder um prazo por ele não estar na tela.",
    shadow: true,
    async detectar(db, limite) {
      const porAgendamento = await db
        .select({
          escritorioId: agendamentos.escritorioId,
          total: sql<number>`COUNT(*)`.as("total"),
        })
        .from(agendamentos)
        .where(or(eq(agendamentos.status, "pendente"), eq(agendamentos.status, "em_andamento")))
        .groupBy(agendamentos.escritorioId)
        .having(sql`COUNT(*) > ${TETO_LISTA_AGENDA}`)
        .limit(limite);

      const porTarefa = await db
        .select({
          escritorioId: tarefas.escritorioId,
          total: sql<number>`COUNT(*)`.as("total"),
        })
        .from(tarefas)
        .where(or(eq(tarefas.status, "pendente"), eq(tarefas.status, "em_andamento")))
        .groupBy(tarefas.escritorioId)
        .having(sql`COUNT(*) > ${TETO_LISTA_AGENDA}`)
        .limit(limite);

      return [
        ...porAgendamento.map((l) => ({
          escritorioId: l.escritorioId,
          alvoId: l.escritorioId,
          descricao: `Escritório ${l.escritorioId}: ${Number(l.total)} compromissos abertos (teto ${TETO_LISTA_AGENDA})`,
          valores: { fonte: "compromisso", abertos: Number(l.total), teto: TETO_LISTA_AGENDA },
        })),
        ...porTarefa.map((l) => ({
          escritorioId: l.escritorioId,
          alvoId: l.escritorioId,
          descricao: `Escritório ${l.escritorioId}: ${Number(l.total)} tarefas abertas (teto ${TETO_LISTA_AGENDA})`,
          valores: { fonte: "tarefa", abertos: Number(l.total), teto: TETO_LISTA_AGENDA },
        })),
      ].slice(0, limite);
    },
  },

  {
    id: "MOV-01",
    titulo: "Movimentação dita “sem documento” com peça identificada no rótulo",
    severidade: "alto",
    dominio: "motor",
    nivel: "B",
    tabela: "eventos_processo",
    invariante:
      "`sem_documento` afirma que o tribunal não anexou peça nenhuma. Se o " +
      "rótulo do próprio movimento traz número e tipo da peça " +
      "(“… 226277277 - Despacho”), a afirmação é falsa: o documento existe e " +
      "o que faltou foi caminho até ele.",
    correcaoPrevista:
      "Regravar o status como `pendente` e preencher documentoIdTribunal a " +
      "partir do rótulo. É recálculo puro, mas fica em B enquanto a leitura " +
      "do rótulo não tiver histórico contra os formatos reais do tribunal.",
    shadow: true,
    async detectar(db, limite) {
      // Ordena do mais novo pro mais antigo de propósito: achado recente
      // significa que a leitura do rótulo está falhando AGORA; achado só em
      // linha velha é acervo de antes da correção.
      const candidatos = await db
        .select({
          id: eventosProcesso.id,
          escritorioId: eventosProcesso.escritorioId,
          conteudo: eventosProcesso.conteudo,
          cnj: eventosProcesso.cnjAfetado,
          dataEvento: eventosProcesso.dataEvento,
          documentoIdTribunal: eventosProcesso.documentoIdTribunal,
        })
        .from(eventosProcesso)
        .where(and(
          eq(eventosProcesso.tipo, "movimentacao"),
          eq(eventosProcesso.teorStatus, "sem_documento"),
          // Estreitamento grosso: sem pelo menos 6 dígitos seguidos não há
          // id de peça possível. O julgamento final é do parser.
          sql`${eventosProcesso.conteudo} REGEXP '[0-9]{6,12}'`,
        ))
        .orderBy(desc(eventosProcesso.dataEvento))
        .limit(limite * FOLGA_CANDIDATOS);

      const achados = [];
      for (const c of candidatos) {
        const doc = lerDocumentoNoRotulo(c.conteudo);
        if (!doc) continue;
        achados.push({
          escritorioId: c.escritorioId,
          alvoId: c.id,
          descricao: `${c.cnj ?? "sem CNJ"}: ${doc.tipo ?? "Documento"} nº ${doc.id} existe, mas o evento diz que não há peça`,
          valores: {
            documentoId: doc.id,
            documentoTipo: doc.tipo,
            jaGravado: c.documentoIdTribunal,
            dataEvento: c.dataEvento?.toISOString() ?? null,
            rotulo: c.conteudo.slice(0, 160),
          },
        });
        if (achados.length >= limite) break;
      }
      return achados;
    },
  },

  {
    id: "KAN-02",
    titulo: "Histórico de movimentação apontando pra card que não existe mais",
    severidade: "alto",
    dominio: "kanban",
    nivel: "C",
    tabela: "kanban_movimentacoes",
    invariante:
      "`kanban_movimentacoes.cardId` não tem FK. Excluir uma coluna apaga os " +
      "cards dela e deixa o histórico apontando pro vazio — que é a única " +
      "prova de que aqueles cards existiram, e por onde passaram.",
    correcaoPrevista:
      "Nenhuma automática. Apagar o histórico destruiria a evidência; " +
      "recriar o card exige decidir nome, coluna e responsável a partir de " +
      "um rastro parcial. Serve pra reconstruir à mão o que foi perdido.",
    shadow: true,
    async detectar(db, limite) {
      const orfaos = await db
        .select({
          cardId: kanbanMovimentacoes.cardId,
          movimentos: sql<number>`COUNT(*)`.as("movimentos"),
          ultimaEm: sql<string>`MAX(${kanbanMovimentacoes.createdAt})`.as("ultima_em"),
          ultimaColuna: sql<number>`MAX(${kanbanMovimentacoes.colunaDestinoId})`.as("ultima_coluna"),
        })
        .from(kanbanMovimentacoes)
        .leftJoin(kanbanCards, eq(kanbanCards.id, kanbanMovimentacoes.cardId))
        .where(isNull(kanbanCards.id))
        .groupBy(kanbanMovimentacoes.cardId)
        .limit(limite);

      return orfaos.map((l) => ({
        // A tabela de movimentações não guarda escritório: o card levava essa
        // informação, e ele é justamente o que sumiu.
        escritorioId: null,
        alvoId: l.cardId,
        descricao: `Card ${l.cardId} não existe mais, mas deixou ${Number(l.movimentos)} movimento(s) no histórico`,
        valores: {
          movimentos: Number(l.movimentos),
          ultimaMovimentacaoEm: l.ultimaEm ? String(l.ultimaEm) : null,
          ultimaColunaDestino: Number(l.ultimaColuna),
        },
      }));
    },
  },

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
    id: "LEA-01",
    titulo: "Lead fechado sem data de fechamento",
    severidade: "alto",
    dominio: "comissoes",
    nivel: "B",
    tabela: "leads",
    invariante:
      "Lead em etapa fechada (ganho ou perdido) precisa ter fechadoEm. " +
      "Todo relatório de fechamento recorta o período por essa coluna — sem " +
      "ela o negócio existe no funil e não aparece em mês nenhum.",
    correcaoPrevista:
      "Preencher com a data de criação do lead, que é o que a migration de " +
      "backfill usou. Escolher data de fechamento retroativa mexe em base de " +
      "comissão, então passa por decisão humana.",
    shadow: true,
    async detectar(db, limite) {
      // Guarda a unificação: os painéis e relatórios de fechamento passaram
      // a recortar por fechadoEm. Se algum caminho novo de escrita esquecer
      // de preencher a coluna, o lead sumiria dos números em silêncio — em
      // vez disso, aparece aqui.
      const linhas = await db
        .select({
          id: leads.id,
          escritorioId: leads.escritorioId,
          etapaFunil: leads.etapaFunil,
          responsavelId: leads.responsavelId,
          valorEstimado: leads.valorEstimado,
          createdAt: leads.createdAt,
        })
        .from(leads)
        .where(
          and(
            inArray(leads.etapaFunil, ["fechado_ganho", "fechado_perdido"]),
            isNull(leads.fechadoEm),
          ),
        )
        .limit(limite);

      return linhas.map((l) => ({
        escritorioId: l.escritorioId,
        alvoId: l.id,
        descricao: `Lead ${l.id} está em "${l.etapaFunil}" sem data de fechamento`,
        valores: {
          etapaFunil: l.etapaFunil,
          responsavelId: l.responsavelId,
          valorEstimado: l.valorEstimado,
          criadoEm: l.createdAt?.toISOString() ?? null,
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
