/**
 * Reconstrução dos episódios do histórico.
 *
 * Os episódios só passam a existir a partir do dia em que o módulo subiu. Sem
 * reconstruir o passado, o relatório de atendimentos mostraria os meses já
 * vividos praticamente vazios — e a pergunta que motivou tudo ("quem iniciou
 * atendimento em agosto") continuaria sem resposta pra quem já era cliente.
 *
 * Mora aqui, e não dentro do script, porque quem executa isso é o dono pelo
 * painel: script de terminal pressupõe shell de produção. O script continua
 * existindo como porta alternativa, mas os dois chamam ESTA função —
 * reconstrução divergente entre o botão e o terminal daria dois relatórios
 * diferentes do mesmo mês.
 *
 * Duas propriedades tornam isto seguro de apertar:
 *
 *  - é RETOMÁVEL. Conversa que já tem episódio é pulada, então rodar de novo
 *    depois de um erro (ou de um timeout) continua de onde parou em vez de
 *    duplicar. `atendimentos` não tem UNIQUE que barre duplicata — a garantia
 *    é esta, e por isso ela não pode ser afrouxada;
 *  - tem ORÇAMENTO DE TEMPO. Uma requisição HTTP não pode varrer um banco
 *    inteiro sem saber quanto vai demorar. Ao estourar o orçamento a função
 *    devolve o que fez e quanto falta, e o caller aperta de novo.
 */

import { and, asc, eq, gt, inArray, notExists, sql } from "drizzle-orm";
import { getDb } from "../db";
import { atendimentos, conversas, mensagens } from "../../drizzle/schema";
import { dividirEmEpisodios, type MensagemParaCorte } from "../../shared/atendimento-episodio";

const LOTE = 200;
const ORCAMENTO_PADRAO_MS = 20_000;

export interface ResultadoBackfill {
  /** `false` quando foi só simulação. */
  aplicado: boolean;
  conversasAnalisadas: number;
  episodiosCriados: number;
  /**
   * Conversas que escondiam mais de um atendimento. É o número que mede o
   * problema: cada uma é um cliente que voltou e sumia da contagem.
   */
  conversasComMaisDeUm: number;
  /** Conversas sem mensagem nenhuma — não viram episódio, e nunca virão. */
  conversasVazias: number;
  /** Conversas ainda não percorridas. */
  restantes: number;
  /**
   * Conversas que já tinham episódio criado ao vivo mas cujo começo ficou de
   * fora, e tiveram o histórico anterior recuperado.
   */
  historicoRecuperado: number;
  /** Episódios antigos criados atrás de um episódio que já existia. */
  episodiosAnteriores: number;
  /**
   * Atendimentos em curso cuja data de abertura estava no dia do deploy e
   * voltou pra quando a demanda começou de verdade.
   */
  aberturasCorrigidas: number;
  /** `false` quando o orçamento de tempo acabou antes do fim. */
  completo: boolean;
}

export interface StatusBackfill {
  totalConversas: number;
  conversasComEpisodio: number;
  conversasSemEpisodio: number;
  episodios: number;
}

/** Conversa que ainda não tem nenhum episódio. */
function aindaSemEpisodio(db: NonNullable<Awaited<ReturnType<typeof getDb>>>) {
  return notExists(
    db
      .select({ um: sql`1` })
      .from(atendimentos)
      .where(eq(atendimentos.conversaId, conversas.id)),
  );
}

/** Quanto do histórico já foi reconstruído. */
export async function statusBackfill(): Promise<StatusBackfill | null> {
  const db = await getDb();
  if (!db) return null;

  const [[conv], [atd]] = await Promise.all([
    db.select({ n: sql<number>`COUNT(*)` }).from(conversas),
    db
      .select({
        episodios: sql<number>`COUNT(*)`,
        conversas: sql<number>`COUNT(DISTINCT ${atendimentos.conversaId})`,
      })
      .from(atendimentos),
  ]);

  const total = Number(conv?.n ?? 0);
  const comEpisodio = Number(atd?.conversas ?? 0);
  return {
    totalConversas: total,
    conversasComEpisodio: comEpisodio,
    conversasSemEpisodio: Math.max(0, total - comEpisodio),
    episodios: Number(atd?.episodios ?? 0),
  };
}

/**
 * Percorre as conversas que ainda não têm episódio e reconstrói os delas.
 *
 * `aplicar: false` faz a passada sem gravar nada — é o que responde "quanto
 * isso vai mexer" antes de mexer.
 */
export async function reconstruirEpisodios(opts: {
  aplicar: boolean;
  orcamentoMs?: number;
  aoProgredir?: (parcial: { conversasAnalisadas: number; episodiosCriados: number }) => void;
}): Promise<ResultadoBackfill> {
  const db = await getDb();
  if (!db) throw new Error("Sem banco: DATABASE_URL não definida.");

  const orcamento = opts.orcamentoMs ?? ORCAMENTO_PADRAO_MS;
  const inicio = Date.now();

  const res: ResultadoBackfill = {
    aplicado: opts.aplicar,
    conversasAnalisadas: 0,
    episodiosCriados: 0,
    conversasComMaisDeUm: 0,
    conversasVazias: 0,
    restantes: 0,
    historicoRecuperado: 0,
    episodiosAnteriores: 0,
    aberturasCorrigidas: 0,
    completo: false,
  };

  // Cursor por id, não OFFSET: na simulação nada é gravado, então a janela do
  // "ainda sem episódio" não anda sozinha e paginar por offset repetiria as
  // mesmas linhas pra sempre.
  let cursor = 0;

  for (;;) {
    const lote = await db
      .select({
        id: conversas.id,
        escritorioId: conversas.escritorioId,
        contatoId: conversas.contatoId,
        atendenteId: conversas.atendenteId,
        status: conversas.status,
      })
      .from(conversas)
      .where(and(gt(conversas.id, cursor), aindaSemEpisodio(db)))
      .orderBy(asc(conversas.id))
      .limit(LOTE);

    if (lote.length === 0) {
      res.completo = true;
      break;
    }

    const ids = lote.map((c) => c.id);
    const msgs = await db
      .select({
        conversaId: mensagens.conversaId,
        em: mensagens.createdAt,
        direcao: mensagens.direcao,
        remetenteId: mensagens.remetenteId,
        tipo: mensagens.tipo,
      })
      .from(mensagens)
      .where(inArray(mensagens.conversaId, ids))
      .orderBy(asc(mensagens.conversaId), asc(mensagens.createdAt));

    const porConversa = new Map<number, MensagemParaCorte[]>();
    for (const m of msgs) {
      // Mensagem de SISTEMA (transferência, aviso) não é atendimento: contá-la
      // como resposta faria o "tempo de 1ª resposta" virar o tempo até alguém
      // repassar a conversa.
      if (m.tipo === "sistema") continue;
      const lista = porConversa.get(m.conversaId) ?? [];
      lista.push({ em: m.em, daEquipe: m.direcao === "saida", remetenteId: m.remetenteId });
      porConversa.set(m.conversaId, lista);
    }

    for (const conv of lote) {
      const eps = dividirEmEpisodios(porConversa.get(conv.id) ?? []);
      res.conversasAnalisadas++;

      if (eps.length === 0) {
        res.conversasVazias++;
        continue;
      }
      if (eps.length > 1) res.conversasComMaisDeUm++;

      const resolvida = conv.status === "resolvido" || conv.status === "fechado";
      const linhas = eps.map((ep, idx) => {
        const ultimo = idx === eps.length - 1;
        // Só o último episódio pode estar aberto, e só se a conversa não
        // estiver resolvida. Os anteriores acabaram quando pararam de falar —
        // é essa data que fica, não a de hoje.
        const aberto = ultimo && !resolvida;
        return {
          escritorioId: conv.escritorioId,
          conversaId: conv.id,
          contatoId: conv.contatoId,
          abertoEm: ep.abertoEm,
          fechadoEm: aberto ? null : ep.ultimaMensagemEm,
          motivoFechamento: aberto
            ? null
            : ultimo && resolvida
              ? ("resolvido" as const)
              : ("silencio" as const),
          // Sem resposta nenhuma no episódio, cai no dono atual da conversa —
          // é o melhor palpite disponível, e vale só pra episódio que ninguém
          // atendeu.
          atendenteAbriu: ep.atendenteAbriu ?? conv.atendenteId ?? null,
          // O dono de hoje só vale pro último; nos anteriores, quem abriu é
          // quem ficou.
          atendenteAtual: ultimo
            ? (conv.atendenteId ?? ep.atendenteAbriu ?? null)
            : (ep.atendenteAbriu ?? null),
          ultimaMensagemEm: ep.ultimaMensagemEm,
          primeiraRespostaEm: ep.primeiraRespostaEm,
        };
      });

      if (opts.aplicar) await db.insert(atendimentos).values(linhas);
      res.episodiosCriados += linhas.length;
    }

    cursor = ids[ids.length - 1]!;
    opts.aoProgredir?.({
      conversasAnalisadas: res.conversasAnalisadas,
      episodiosCriados: res.episodiosCriados,
    });

    if (Date.now() - inicio > orcamento) break;
  }

  // O que falta é o que está ADIANTE do cursor. Conversa sem mensagem fica
  // pra trás sem episódio pra sempre — contá-la como pendente faria a barra
  // nunca chegar ao fim e o dono apertar o botão eternamente.
  const [restante] = await db
    .select({ n: sql<number>`COUNT(*)` })
    .from(conversas)
    .where(and(gt(conversas.id, cursor), aindaSemEpisodio(db)));

  res.restantes = Number(restante?.n ?? 0);

  const faseDoisCompleta =
    res.restantes === 0 && Date.now() - inicio <= orcamento
      ? await recuperarComecoPerdido(db, opts.aplicar, res, inicio, orcamento)
      : false;

  res.completo = res.restantes === 0 && faseDoisCompleta;
  return res;
}

/**
 * Recupera o histórico das conversas que ganharam episódio ao vivo antes de o
 * passado ter sido reconstruído.
 *
 * A primeira fase pula conversa que já tem episódio — é o que impede duplicata.
 * Mas conversa que recebeu mensagem depois do deploy ganhou um episódio
 * começando NAQUELE INSTANTE, e a primeira fase então nunca olha o passado
 * dela. Sobram dois defeitos, e o segundo é o que estraga relatório:
 *
 *  - os atendimentos antigos dela não existem;
 *  - o atendimento EM CURSO consta como aberto no dia do deploy, e não quando
 *    a demanda começou. Num filtro por mês isso passa batido; num recorte de
 *    dias, o atendimento aparece fora da janela em que aconteceu.
 *
 * Roda depois da primeira fase e some sozinha: uma vez recuperado o começo, a
 * primeira mensagem passa a coincidir com o primeiro episódio e a conversa
 * deixa de ser candidata.
 */
async function recuperarComecoPerdido(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  aplicar: boolean,
  res: ResultadoBackfill,
  inicio: number,
  orcamento: number,
): Promise<boolean> {
  // Candidata é a conversa cuja primeira mensagem é anterior ao primeiro
  // episódio: prova de que o começo dela ficou de fora. Depois de corrigida as
  // duas datas coincidem, então ela não volta na próxima passada.
  const alvos = (await db.execute(sql`
    SELECT a.conversaIdAtd AS conversaId
      FROM atendimentos a
      JOIN mensagens m
        ON m.conversaIdMsg = a.conversaIdAtd AND m.tipoMsg <> 'sistema'
     GROUP BY a.conversaIdAtd
    HAVING MIN(m.createdAtMsg) < MIN(a.abertoEmAtd)
     LIMIT 500
  `)) as unknown as Array<Array<{ conversaId: number }>>;

  const ids = (alvos[0] ?? []).map((r) => Number(r.conversaId)).filter(Number.isFinite);
  if (ids.length === 0) return true;

  for (const conversaId of ids) {
    if (Date.now() - inicio > orcamento) return false;

    const [conv] = await db
      .select({
        id: conversas.id,
        escritorioId: conversas.escritorioId,
        contatoId: conversas.contatoId,
        atendenteId: conversas.atendenteId,
      })
      .from(conversas)
      .where(eq(conversas.id, conversaId))
      .limit(1);
    if (!conv) continue;

    const [primeiroEp] = await db
      .select({
        id: atendimentos.id,
        abertoEm: atendimentos.abertoEm,
        primeiraRespostaEm: atendimentos.primeiraRespostaEm,
        atendenteAbriu: atendimentos.atendenteAbriu,
      })
      .from(atendimentos)
      .where(eq(atendimentos.conversaId, conversaId))
      .orderBy(asc(atendimentos.abertoEm), asc(atendimentos.id))
      .limit(1);
    if (!primeiroEp) continue;

    const msgs = await db
      .select({
        em: mensagens.createdAt,
        direcao: mensagens.direcao,
        remetenteId: mensagens.remetenteId,
        tipo: mensagens.tipo,
      })
      .from(mensagens)
      .where(eq(mensagens.conversaId, conversaId))
      .orderBy(asc(mensagens.createdAt));

    const eps = dividirEmEpisodios(
      msgs
        .filter((m) => m.tipo !== "sistema")
        .map((m) => ({ em: m.em, daEquipe: m.direcao === "saida", remetenteId: m.remetenteId })),
    );
    if (eps.length === 0) continue;

    // O episódio que já existe é a continuação de um dos reconstruídos: o
    // último que começou antes (ou junto com) ele. Os anteriores a esse é que
    // se perderam.
    const marco = new Date(primeiroEp.abertoEm).getTime();
    let k = -1;
    for (let i = 0; i < eps.length; i++) {
      if (eps[i]!.abertoEm.getTime() <= marco) k = i;
    }
    // Sem correspondência, o episódio existente começa antes de qualquer
    // mensagem — situação que não sabemos explicar. Mexer no escuro aqui é
    // pior que deixar como está.
    if (k < 0) continue;

    const anteriores = eps.slice(0, k);
    const meu = eps[k]!;

    if (anteriores.length > 0) {
      const linhas = anteriores.map((ep) => ({
        escritorioId: conv.escritorioId,
        conversaId: conv.id,
        contatoId: conv.contatoId,
        abertoEm: ep.abertoEm,
        // Todos morreram de silêncio: se ainda estivessem vivos, o episódio de
        // hoje seria eles.
        fechadoEm: ep.ultimaMensagemEm,
        motivoFechamento: "silencio" as const,
        atendenteAbriu: ep.atendenteAbriu ?? conv.atendenteId ?? null,
        atendenteAtual: ep.atendenteAbriu ?? null,
        ultimaMensagemEm: ep.ultimaMensagemEm,
        primeiraRespostaEm: ep.primeiraRespostaEm,
      }));
      if (aplicar) await db.insert(atendimentos).values(linhas);
      res.episodiosAnteriores += linhas.length;
    }

    const respostaAtual = primeiroEp.primeiraRespostaEm
      ? new Date(primeiroEp.primeiraRespostaEm).getTime()
      : null;
    const respostaReal = meu.primeiraRespostaEm?.getTime() ?? null;
    const adiantaResposta = respostaReal != null && (respostaAtual == null || respostaReal < respostaAtual);

    if (meu.abertoEm.getTime() < marco || adiantaResposta) {
      if (aplicar) {
        await db
          .update(atendimentos)
          .set({
            abertoEm: meu.abertoEm,
            ...(adiantaResposta
              ? {
                  primeiraRespostaEm: meu.primeiraRespostaEm,
                  // Quem respondeu primeiro de verdade destrona o palpite que
                  // o registro ao vivo gravou (o dono da conversa naquele
                  // instante).
                  atendenteAbriu: meu.atendenteAbriu ?? primeiroEp.atendenteAbriu ?? null,
                }
              : {}),
          })
          .where(eq(atendimentos.id, primeiroEp.id));
      }
      res.aberturasCorrigidas++;
    }

    res.historicoRecuperado++;
  }

  // Na simulação nada foi gravado, então as mesmas conversas continuariam
  // aparecendo: só dá pra afirmar que acabou quando a passada foi de verdade.
  return aplicar ? ids.length < 500 : true;
}
