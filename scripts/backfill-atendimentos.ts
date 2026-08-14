/**
 * Reconstrói os episódios de atendimento do histórico, pelo terminal.
 *
 * A reconstrução em si mora em `server/atendimento/backfill.ts` — aqui é só a
 * casca de linha de comando. O caminho normal é o botão em Configurações →
 * Manutenção do painel admin; este script existe pra quem tem shell e prefere
 * ver o progresso rolando.
 *
 * É script, e não migration, de propósito: as migrations rodam a cada boot,
 * são rastreadas por nome de arquivo e não têm transação envolvendo o arquivo
 * inteiro. Um erro no meio faria o INSERT rodar de novo no próximo boot, e
 * `atendimentos` não tem UNIQUE que barre duplicata.
 *
 * Uso:
 *   pnpm tsx scripts/backfill-atendimentos.ts            # simulação (padrão)
 *   pnpm tsx scripts/backfill-atendimentos.ts --aplicar  # grava
 */

import { reconstruirEpisodios, statusBackfill } from "../server/atendimento/backfill";

const APLICAR = process.argv.includes("--aplicar");

async function main() {
  const status = await statusBackfill();
  if (!status) {
    console.error("Sem banco. Defina DATABASE_URL.");
    process.exit(1);
  }

  console.log(APLICAR ? "MODO GRAVAÇÃO" : "MODO SIMULAÇÃO (use --aplicar pra gravar)");
  console.log(
    `${status.totalConversas} conversas, ${status.conversasComEpisodio} já reconstruídas, ` +
      `${status.conversasSemEpisodio} pendentes.`,
  );

  const r = await reconstruirEpisodios({
    aplicar: APLICAR,
    // Terminal não tem requisição pra estourar: varre até o fim.
    orcamentoMs: Number.POSITIVE_INFINITY,
    aoProgredir: ({ conversasAnalisadas }) => console.log(`  ${conversasAnalisadas}…`),
  });

  console.log("");
  console.log(`conversas analisadas ........ ${r.conversasAnalisadas}`);
  console.log(`sem mensagem (ignoradas) .... ${r.conversasVazias}`);
  console.log(`episódios ${APLICAR ? "criados" : "que seriam criados"} .${APLICAR ? "........." : "..."} ${r.episodiosCriados}`);
  console.log(`conversas com mais de um .... ${r.conversasComMaisDeUm}`);
  console.log("");
  console.log(
    r.conversasComMaisDeUm > 0
      ? `${r.conversasComMaisDeUm} conversas escondiam mais de um atendimento — são exatamente os clientes que voltaram e sumiam da contagem.`
      : "Nenhuma conversa tinha mais de um episódio no histórico.",
  );
  if (!APLICAR) console.log("\nNada foi gravado. Rode com --aplicar pra valer.");

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
