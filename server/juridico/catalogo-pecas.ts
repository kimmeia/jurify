/**
 * Catálogo de peças que o Agente Jurídico sabe redigir. É CONHECIMENTO injetado
 * no system prompt: cada tipo traz a estrutura (seções, na ordem), o fundamento
 * legal, os requisitos (o que o agente deve exigir/perguntar antes de redigir) e
 * o prazo típico. Extensível — somar um tipo aqui já ensina o agente.
 *
 * Não confundir com `TIPOS_PECA` (peca.ts), que é o caminho antigo de formulário
 * (só revisional). Na conversa, é este catálogo que orienta a redação.
 */

export interface TipoPecaCatalogo {
  id: string;
  label: string;
  grupo: "inicial" | "resposta" | "recurso" | "incidente";
  fundamento?: string;
  prazo?: string;
  estrutura: string[];
  requisitos: string[];
}

export const CATALOGO_PECAS: TipoPecaCatalogo[] = [
  {
    id: "peticao_inicial",
    label: "Petição inicial",
    grupo: "inicial",
    fundamento: "art. 319 do CPC",
    estrutura: ["Endereçamento", "Qualificação das partes", "Dos Fatos", "Do Direito", "Da Tutela de Urgência (se cabível)", "Dos Pedidos", "Do Valor da Causa", "Das Provas"],
    requisitos: ["partes qualificadas", "fatos", "fundamento jurídico", "pedido certo e determinado", "valor da causa"],
  },
  {
    id: "contestacao",
    label: "Contestação",
    grupo: "resposta",
    fundamento: "arts. 335 a 342 do CPC",
    prazo: "15 dias úteis",
    estrutura: ["Endereçamento", "Das Preliminares", "Do Mérito", "Dos Pedidos", "Das Provas"],
    requisitos: ["a petição inicial / o que se contesta", "teses de defesa (preliminares e mérito)"],
  },
  {
    id: "embargos_declaracao",
    label: "Embargos de Declaração",
    grupo: "recurso",
    fundamento: "art. 1.022 do CPC",
    prazo: "5 dias úteis",
    estrutura: ["Endereçamento", "Da Tempestividade", "Do Vício (omissão, contradição, obscuridade ou erro material)", "Do Prequestionamento", "Dos Pedidos"],
    requisitos: ["a decisão embargada", "o vício apontado (omissão/contradição/obscuridade/erro) com indicação exata do ponto"],
  },
  {
    id: "apelacao",
    label: "Apelação",
    grupo: "recurso",
    fundamento: "arts. 1.009 a 1.014 do CPC",
    prazo: "15 dias úteis",
    estrutura: ["Petição de Interposição", "Razões — Da Tempestividade", "Da Síntese da Demanda", "Das Razões de Reforma", "Do Prequestionamento", "Dos Pedidos"],
    requisitos: ["a sentença recorrida", "os pontos a reformar", "comprovante de preparo (se aplicável)"],
  },
  {
    id: "agravo_instrumento",
    label: "Agravo de Instrumento",
    grupo: "recurso",
    fundamento: "arts. 1.015 a 1.020 do CPC",
    prazo: "15 dias úteis",
    estrutura: ["Endereçamento (Tribunal)", "Da Tempestividade e do Cabimento", "Da Decisão Agravada", "Do Efeito Suspensivo / Tutela Recursal", "Das Razões", "Dos Pedidos"],
    requisitos: ["a decisão interlocutória agravada", "hipótese de cabimento do art. 1.015", "peças obrigatórias do instrumento"],
  },
  {
    id: "agravo_interno",
    label: "Agravo Interno",
    grupo: "recurso",
    fundamento: "art. 1.021 do CPC",
    prazo: "15 dias úteis",
    estrutura: ["Endereçamento (órgão colegiado)", "Da Tempestividade", "Da Decisão Monocrática", "Das Razões de Impugnação", "Dos Pedidos"],
    requisitos: ["a decisão monocrática impugnada", "as razões de impugnação"],
  },
];

/** Catálogo condensado pro system prompt (o agente escolhe/aplica a estrutura). */
export function formatarCatalogoParaPrompt(): string {
  return CATALOGO_PECAS.map((p) => {
    const meta = [p.fundamento, p.prazo ? `prazo ${p.prazo}` : null].filter(Boolean).join(", ");
    return (
      `- ${p.label}${meta ? ` (${meta})` : ""}\n` +
      `  Estrutura: ${p.estrutura.join(" · ")}\n` +
      `  Exige: ${p.requisitos.join("; ")}`
    );
  }).join("\n");
}
