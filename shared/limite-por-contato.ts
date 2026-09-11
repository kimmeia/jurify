/**
 * "Roda por contato" — quantas vezes um cenário do SmartFlow pode começar
 * para a mesma pessoa.
 *
 * A conta é de janela deslizante (24h / 7 dias / 30 dias para trás), não de
 * dia do calendário. Os rótulos dizem isso na letra porque "1x por dia" era
 * lido como "uma vez por dia do calendário" e a diferença aparece justamente
 * quando o cliente escreve à noite e de manhã cedo.
 */

export const LIMITES_POR_CONTATO = ["sempre", "dia", "semana", "mes", "vida"] as const;
export type LimitePorContato = (typeof LIMITES_POR_CONTATO)[number];

export const ROTULO_LIMITE_CONTATO: Record<LimitePorContato, string> = {
  sempre: "Sempre (sem limite)",
  dia: "1x a cada 24h",
  semana: "1x a cada 7 dias",
  mes: "1x a cada 30 dias",
  vida: "1x na vida",
};

/** Como o período aparece no meio de uma frase: "roda 1x a cada 24h por contato". */
export const PERIODO_LIMITE_CONTATO: Record<LimitePorContato, string> = {
  sempre: "sem limite",
  dia: "1x a cada 24h",
  semana: "1x a cada 7 dias",
  mes: "1x a cada 30 dias",
  vida: "1x na vida",
};

/**
 * O recado que fica na conversa quando o limite cala o robô. É interno: quem
 * atende precisa saber que o silêncio é regra, não defeito — sem isso a tela
 * fica idêntica à de um canal sem fluxo nenhum. Nunca vai para o cliente.
 */
export function recadoRoboSilenciado(nomeCenario: string, limite: LimitePorContato): string {
  const nome = (nomeCenario || "").trim();
  const fluxo = nome ? `o fluxo "${nome}"` : "o fluxo";
  return `O robô não respondeu: ${fluxo} roda ${PERIODO_LIMITE_CONTATO[limite]} por contato e já rodou neste período.`;
}
