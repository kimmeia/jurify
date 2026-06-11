/**
 * Seleção de atendente do bloco SmartFlow "Distribuir > Setor".
 *
 * Algoritmo (aprovado pelo dono após o caso "tudo ia pro mesmo
 * atendente"):
 *  1. Pool online-first: havendo ≥1 atendente online (atividade na
 *     janela de 30min), distribui SÓ entre os online; todos offline →
 *     distribui entre todos, um a um. Com `somenteOnline=true` o pool é
 *     estritamente os online (ninguém → null, saída "sem_atendente" /
 *     transbordo).
 *  2. Round-robin PURO dentro do pool: quem recebeu há mais tempo
 *     (`ultimaDistribuicao`) recebe agora; nunca recebeu = prioridade.
 *  3. Capacidade é TRAVA, não ranking: quem está no limite de
 *     atendimentos simultâneos é pulado no rodízio; todos no limite →
 *     rodízio mesmo assim (fila cheia distribuída > fila parada).
 *
 * O modelo anterior usava "menor carga proporcional" como critério
 * primário — com acervo de conversas abertas antigas desbalanceado,
 * o atendente com menos abertas ganhava TODAS as distribuições e o
 * round-robin (que era só o 3º desempate) nunca atuava.
 */

export const JANELA_ONLINE_MS = 30 * 60 * 1000;

export interface CandidatoDistribuicao {
  id: number;
  ultimaAtividade: Date | string | null;
  maxSimultaneos: number | null;
  ultimaDistribuicao: Date | string | null;
}

export function selecionarAtendenteRodizio(
  candidatos: CandidatoDistribuicao[],
  cargaPorId: ReadonlyMap<number, number>,
  opts?: { somenteOnline?: boolean; agora?: Date },
): number | null {
  if (candidatos.length === 0) return null;

  const agora = opts?.agora ?? new Date();
  const limiteOnline = agora.getTime() - JANELA_ONLINE_MS;
  const online = candidatos.filter(
    (c) => !!c.ultimaAtividade && new Date(c.ultimaAtividade).getTime() >= limiteOnline,
  );

  const pool = opts?.somenteOnline
    ? online
    : online.length > 0
      ? online
      : candidatos;
  if (pool.length === 0) return null;

  const ordemRodizio = [...pool].sort((a, b) => {
    const aT = a.ultimaDistribuicao ? new Date(a.ultimaDistribuicao).getTime() : 0;
    const bT = b.ultimaDistribuicao ? new Date(b.ultimaDistribuicao).getTime() : 0;
    if (aT !== bT) return aT - bT;
    return a.id - b.id;
  });

  const comFolga = ordemRodizio.filter(
    (c) => (cargaPorId.get(c.id) ?? 0) < Math.max(1, c.maxSimultaneos || 5),
  );

  return (comFolga[0] ?? ordemRodizio[0]).id;
}
