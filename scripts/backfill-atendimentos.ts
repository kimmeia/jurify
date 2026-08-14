/**
 * Reconstrói os episódios de atendimento do histórico.
 *
 * Sem isto o módulo não responde nada sobre o passado: os episódios só passam
 * a existir a partir do dia em que a fatia 1 subiu, e a pergunta que motivou
 * tudo ("quem iniciou atendimento em agosto") continuaria sem resposta pros
 * meses já vividos.
 *
 * É SCRIPT, não migration, e isso é deliberado. As migrations do projeto rodam
 * a cada boot, são rastreadas por nome de arquivo e não têm transação
 * envolvendo o arquivo inteiro: um erro no meio faria o INSERT rodar de novo
 * no próximo boot, e `atendimentos` não tem UNIQUE que barre duplicata. Um
 * script executado à mão, uma vez, com conferência antes, não corre esse risco.
 *
 * A régua é a MESMA do caminho ao vivo (`dividirEmEpisodios`), pra reconstrução
 * e runtime não produzirem relatórios diferentes do mesmo mês.
 *
 * Uso:
 *   pnpm tsx scripts/backfill-atendimentos.ts            # simulação (padrão)
 *   pnpm tsx scripts/backfill-atendimentos.ts --aplicar  # grava
 *
 * Idempotente: conversa que já tem episódio é pulada. Dá pra rodar de novo
 * depois de um erro sem duplicar nada.
 */

import { asc, inArray } from "drizzle-orm";
import { getDb } from "../server/db";
import { atendimentos, conversas, mensagens } from "../drizzle/schema";
import { dividirEmEpisodios, type MensagemParaCorte } from "../shared/atendimento-episodio";

const APLICAR = process.argv.includes("--aplicar");
const LOTE = 200;

async function main() {
  const db = await getDb();
  if (!db) {
    console.error("Sem banco. Defina DATABASE_URL.");
    process.exit(1);
  }

  console.log(APLICAR ? "MODO GRAVAÇÃO" : "MODO SIMULAÇÃO (use --aplicar pra gravar)");

  const todas = await db
    .select({
      id: conversas.id,
      escritorioId: conversas.escritorioId,
      contatoId: conversas.contatoId,
      atendenteId: conversas.atendenteId,
      status: conversas.status,
    })
    .from(conversas)
    .orderBy(asc(conversas.id));

  console.log(`${todas.length} conversas no total.`);

  let processadas = 0;
  let puladas = 0;
  let episodiosCriados = 0;
  let comMultiplos = 0;

  for (let i = 0; i < todas.length; i += LOTE) {
    const lote = todas.slice(i, i + LOTE);
    const ids = lote.map((c) => c.id);

    // Quem já tem episódio fica de fora — é o que torna o script re-executável.
    const jaTem = new Set(
      (await db
        .select({ conversaId: atendimentos.conversaId })
        .from(atendimentos)
        .where(inArray(atendimentos.conversaId, ids)))
        .map((r) => r.conversaId),
    );

    const msgs = await db
      .select({
        conversaId: mensagens.conversaId,
        em: mensagens.createdAt,
        direcao: mensagens.direcao,
        remetenteId: mensagens.remetenteId,
        tipo: mensagens.tipo,
      })
      .from(mensagens)
      .where(inArray(mensagens.conversaId, ids.filter((id) => !jaTem.has(id))))
      .orderBy(asc(mensagens.conversaId), asc(mensagens.createdAt));

    const porConversa = new Map<number, MensagemParaCorte[]>();
    for (const m of msgs) {
      // Mensagem de SISTEMA (transferência, aviso) não é atendimento: contá-la
      // como resposta faria o "tempo de 1ª resposta" virar o tempo até alguém
      // repassar a conversa.
      if (m.tipo === "sistema") continue;
      const lista = porConversa.get(m.conversaId) ?? [];
      lista.push({
        em: m.em,
        daEquipe: m.direcao === "saida",
        remetenteId: m.remetenteId,
      });
      porConversa.set(m.conversaId, lista);
    }

    for (const conv of lote) {
      if (jaTem.has(conv.id)) { puladas++; continue; }

      const eps = dividirEmEpisodios(porConversa.get(conv.id) ?? []);
      if (eps.length === 0) { puladas++; continue; }
      if (eps.length > 1) comMultiplos++;

      const linhas = eps.map((ep, idx) => {
        const ultimo = idx === eps.length - 1;
        // Só o último episódio pode estar aberto — e só se a conversa não
        // estiver resolvida. Os anteriores acabaram quando pararam de falar,
        // e é essa a data que fica, não a de hoje.
        const resolvida = conv.status === "resolvido" || conv.status === "fechado";
        const aberto = ultimo && !resolvida;
        return {
          escritorioId: conv.escritorioId,
          conversaId: conv.id,
          contatoId: conv.contatoId,
          abertoEm: ep.abertoEm,
          fechadoEm: aberto ? null : ep.ultimaMensagemEm,
          motivoFechamento: aberto
            ? null
            : (ultimo && resolvida ? ("resolvido" as const) : ("silencio" as const)),
          // Quem respondeu primeiro NESTE episódio. Sem resposta nenhuma, cai
          // no dono atual da conversa — é o melhor palpite disponível, e vale
          // só pra episódio que ninguém atendeu.
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

      if (APLICAR) await db.insert(atendimentos).values(linhas);
      episodiosCriados += linhas.length;
      processadas++;
    }

    console.log(`  ${Math.min(i + LOTE, todas.length)}/${todas.length}…`);
  }

  console.log("");
  console.log(`conversas processadas ....... ${processadas}`);
  console.log(`conversas puladas ........... ${puladas} (já tinham episódio, ou sem mensagem)`);
  console.log(`episódios criados ........... ${episodiosCriados}`);
  console.log(`conversas com mais de um .... ${comMultiplos}`);
  console.log("");
  console.log(
    comMultiplos > 0
      ? `${comMultiplos} conversas escondiam mais de um atendimento — são exatamente os clientes que voltaram e sumiam da contagem.`
      : "Nenhuma conversa tinha mais de um episódio no histórico.",
  );
  if (!APLICAR) console.log("\nNada foi gravado. Rode com --aplicar pra valer.");

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
