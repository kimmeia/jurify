/**
 * De qual estado veio o lead.
 *
 * O campo `contatos.uf` existe, e quase nunca está preenchido: quem cria lead
 * é `criarOuReutilizarContato`, que grava nome, telefone, e-mail, CPF, origem e
 * estágio — endereço não. `uf` só entra depois, à mão, no formulário de
 * qualificação da ficha, e isso normalmente só acontece quando o caso já virou
 * peça. Um mapa alimentado só por ele viria quase todo vazio, e o pouco que
 * aparecesse seria enviesado para quem já fechou contrato.
 *
 * O que todo lead de WhatsApp tem é telefone — foi por ele que chegou. O DDD
 * mapeia para exatamente um estado, pela tabela da Anatel.
 *
 * Daí as duas regras que este arquivo implementa:
 *
 *  1. o cadastro ganha do DDD quando existe, porque endereço confirmado é fato
 *     e DDD é aproximação;
 *  2. DDD fora da tabela não vira chute. Número estrangeiro, telefone truncado
 *     ou código que a Anatel nunca emitiu saem como "sem estado" — atribuir
 *     um estado errado é pior que admitir que não dá pra saber, porque o erro
 *     não aparece na tela e a decisão é tomada em cima dele.
 *
 * E a ressalva que a tela precisa repetir: o DDD diz onde a linha foi
 * habilitada, não onde a pessoa mora hoje. Quem se mudou de estado e manteve o
 * número aparece na origem antiga.
 */

/** Os 67 códigos que a Anatel emitiu. Whitelist, não faixa: 20, 23, 26, 29,
 *  30, 36, 39, 40, 50, 52, 56–60, 70, 72, 76, 78, 80 e 90 não existem, e
 *  aceitar faixa jogaria número quebrado dentro de um estado real. */
const DDD_PARA_UF: Record<string, string> = {
  "11": "SP", "12": "SP", "13": "SP", "14": "SP", "15": "SP",
  "16": "SP", "17": "SP", "18": "SP", "19": "SP",
  "21": "RJ", "22": "RJ", "24": "RJ",
  "27": "ES", "28": "ES",
  "31": "MG", "32": "MG", "33": "MG", "34": "MG", "35": "MG", "37": "MG", "38": "MG",
  "41": "PR", "42": "PR", "43": "PR", "44": "PR", "45": "PR", "46": "PR",
  "47": "SC", "48": "SC", "49": "SC",
  "51": "RS", "53": "RS", "54": "RS", "55": "RS",
  "61": "DF",
  "62": "GO", "64": "GO",
  "63": "TO",
  "65": "MT", "66": "MT",
  "67": "MS",
  "68": "AC",
  "69": "RO",
  "71": "BA", "73": "BA", "74": "BA", "75": "BA", "77": "BA",
  "79": "SE",
  "81": "PE", "87": "PE",
  "82": "AL",
  "83": "PB",
  "84": "RN",
  "85": "CE", "88": "CE",
  "86": "PI", "89": "PI",
  "91": "PA", "93": "PA", "94": "PA",
  "92": "AM", "97": "AM",
  "95": "RR",
  "96": "AP",
  "98": "MA", "99": "MA",
};

/** Todas as 27 unidades da federação, na ordem em que o mapa as desenha. */
export const UFS = [
  "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT",
  "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO",
] as const;

export type Uf = (typeof UFS)[number];

/** Estado de um DDD. null quando o código não existe. */
export function ufDoDdd(ddd: string): string | null {
  return DDD_PARA_UF[ddd] ?? null;
}

/**
 * Extrai o DDD de um telefone gravado em qualquer um dos formatos que a base
 * tem hoje: com DDI, sem DDI, com máscara, com 8 ou 9 dígitos.
 *
 * A leitura COM DDI vem primeiro e é a única sem ambiguidade. Ela importa
 * porque a leitura sem DDI colide de verdade: "12125551234" é um número dos
 * EUA de 11 dígitos, e lido como brasileiro daria DDD 12 — São José dos
 * Campos. Números de WhatsApp sempre chegam com o 55 na frente, então a
 * colisão só alcança telefone digitado à mão, e nesse caso o mais provável é
 * mesmo ser brasileiro.
 */
export function dddDoTelefone(telefone: string | null | undefined): string | null {
  let d = String(telefone || "").replace(/\D/g, "");
  if (!d) return null;
  // Prefixo de operadora pra longa distância ("0" + DDD).
  if (d.startsWith("0")) d = d.replace(/^0+/, "");

  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) return d.slice(2, 4);
  if (d.length === 10 || d.length === 11) return d.slice(0, 2);
  return null;
}

/** Estado deduzido do telefone. null quando não dá pra deduzir. */
export function ufDoTelefone(telefone: string | null | undefined): string | null {
  const ddd = dddDoTelefone(telefone);
  return ddd ? ufDoDdd(ddd) : null;
}

/**
 * O estado de um lead. Um critério só: o DDD.
 *
 * Recebe o contato inteiro (e não só o telefone) de propósito — a assinatura
 * documenta que `uf` existe e está sendo deliberadamente ignorado aqui, em vez
 * de parecer esquecimento pra quem ler depois.
 */
export function estadoDoLead(c: { telefone?: string | null }): string | null {
  return ufDoTelefone(c.telefone);
}

/**
 * Piso pra mostrar conversão por estado.
 *
 * Com 4 leads, um fechamento a mais move a taxa de 0% para 25%. O número
 * diria mais sobre o acaso que sobre o estado, e é justamente esse tipo de
 * número que vira decisão de onde investir. Abaixo do piso a tela mostra
 * travessão e diz por quê.
 */
export const MINIMO_PARA_CONVERSAO = 10;

export interface LinhaEstado {
  uf: string;
  leads: number;
  /** Quantos DESTES leads já fecharam contrato, até hoje. */
  ganhos: number;
  /** ganhos ÷ leads DO ESTADO, em %. null abaixo de `MINIMO_PARA_CONVERSAO`. */
  conversao: number | null;
}

export interface LeadsPorEstado {
  /** Estados com pelo menos um lead, do maior volume pro menor. */
  estados: LinhaEstado[];
  /** Leads cujo DDD identificou um estado. */
  comEstado: number;
  /** Leads sem telefone, ou com DDD que não existe na tabela da Anatel. */
  semEstado: number;
  /**
   * Leads da coorte que já fecharam, COM e SEM estado identificado.
   *
   * Existe pra tela poder mostrar o total ao lado das partes: sem ele o leitor
   * soma a coluna dos estados, não bate com nada, e conclui que o relatório
   * está errado — quando na verdade faltava o pedaço de quem não tem DDD
   * reconhecível.
   */
  ganhos: number;
}

/**
 * Agrega os leads do período por estado.
 *
 * Roda em memória de propósito, em vez de virar um CASE de 67 ramos no SQL: o
 * volume é o de um mês de um escritório (centenas), a regra do DDD muda quando
 * a Anatel emite código novo, e regra que vive numa função pura é testável sem
 * banco. O `ganho` entra como booleano já resolvido pelo chamador porque o
 * nome da etapa é assunto do funil, não deste arquivo.
 *
 * O que sai daqui é uma COORTE: leads que ENTRARAM no período, e quantos deles
 * já fecharam até hoje. Não é a mesma pergunta do KPI "taxa de conversão" do
 * relatório, que conta o que FECHOU no período tenha entrado quando tiver.
 * Numerador e denominador aqui saem do mesmo conjunto — é o que garante que
 * `ganhos` nunca passe de `leads` — e o preço é que o número se move depois:
 * um lead de agosto que fechar em dezembro muda o agosto. Quem desenha a tela
 * precisa dizer isso, senão os dois números viram uma contradição na cara do
 * leitor.
 */
export function agregarLeadsPorEstado(
  linhas: Array<{ telefone?: string | null; ganho: boolean }>,
): LeadsPorEstado {
  const porUf = new Map<string, { leads: number; ganhos: number }>();
  let comEstado = 0;
  let semEstado = 0;
  let ganhos = 0;

  for (const l of linhas) {
    if (l.ganho) ganhos++;
    const uf = estadoDoLead(l);
    if (!uf) {
      semEstado++;
      continue;
    }
    comEstado++;
    const atual = porUf.get(uf) ?? { leads: 0, ganhos: 0 };
    atual.leads++;
    if (l.ganho) atual.ganhos++;
    porUf.set(uf, atual);
  }

  const estados: LinhaEstado[] = [...porUf.entries()]
    .map(([uf, v]) => ({
      uf,
      leads: v.leads,
      ganhos: v.ganhos,
      conversao: v.leads >= MINIMO_PARA_CONVERSAO ? Math.round((v.ganhos / v.leads) * 100) : null,
    }))
    // Empate resolvido pela sigla: sem isso a ordem entre dois estados de
    // mesmo volume muda a cada consulta e a lista "pisca" entre recarregamentos.
    .sort((a, b) => b.leads - a.leads || a.uf.localeCompare(b.uf));

  return { estados, comEstado, semEstado, ganhos };
}
