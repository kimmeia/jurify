/**
 * A ponte entre o caso do cliente e o acervo público.
 *
 * O redator sempre soube ler o processo, os documentos e as fontes do
 * escritório. O que ele não enxergava era como o tribunal decide casos como
 * aquele — isso vivia só na Pesquisa do JurisIA, numa base separada.
 *
 * Aqui o recorte é derivado do próprio processo (tribunal + classe) e a
 * estatística é contada em SQL. A regra que vale na Pesquisa vale aqui: o
 * NÚMERO vem do banco e o modelo não escreve percentual. Ele recebe a
 * distribuição em texto pra raciocinar, com a ordem explícita de não
 * reescrevê-la — quem mostra o número é a tela, com o dado que saiu da
 * contagem.
 */

import { buscarRecorte } from "../jurisia/buscar-acervo";
import { rotuloResultado, type FiltroRecorte } from "../../shared/jurisia-recorte";
import { createLogger } from "../_core/logger";

const log = createLogger("juridico-prova");

/** Amostra abaixo disto é anedota — não vira prova de peça. */
export const MINIMO_PARA_PROVA = 30;

export interface ProvaAcervo {
  filtro: FiltroRecorte;
  /** Rótulo curto do recorte, pra tela ("TJCE · Busca e apreensão"). */
  rotulo: string;
  total: number;
  comResultado: number;
  fatias: Array<{ resultado: string; rotulo: string; quantidade: number; percentual: number }>;
  /** Quantos do recorte são acórdão (jurisprudência) vs sentença de 1º grau. */
  jurisprudencia: number;
  soEstatistica: number;
  /** Amostra pequena demais pra sustentar tese — a tela avisa em vez de esconder. */
  amostraPequena: boolean;
}

/**
 * Recorte a partir do processo do cliente.
 *
 * Só tribunal + classe. Assunto ficaria tentador, mas o campo do processo do
 * escritório é texto livre digitado pelo advogado, e casar isso por LIKE
 * contra o assunto do CNJ produz recorte vazio com mais frequência do que
 * acerta — recorte vazio aqui é pior que recorte largo, porque some da peça
 * sem dizer por quê.
 */
export function recorteDoCaso(processo: {
  tribunal?: string | null;
  classe?: string | null;
}): FiltroRecorte | null {
  const tribunal = (processo.tribunal || "").trim().toLowerCase();
  const classe = (processo.classe || "").trim();
  if (!tribunal && !classe) return null;
  return {
    tribunal: tribunal || null,
    classeTermo: classe || null,
    assuntoTermo: null,
    orgaoTermo: null,
    desdeAno: null,
  };
}

export async function provaDoAcervo(filtro: FiltroRecorte): Promise<ProvaAcervo | null> {
  try {
    const r = await buscarRecorte(filtro, { maxFontes: 0 });
    if (r.estatistica.comResultado === 0) return null;

    return {
      filtro,
      rotulo: [filtro.tribunal?.toUpperCase(), filtro.classeTermo].filter(Boolean).join(" · "),
      total: r.estatistica.total,
      comResultado: r.estatistica.comResultado,
      fatias: r.estatistica.fatias.map((f) => ({
        resultado: f.resultado,
        rotulo: rotuloResultado(f.resultado),
        quantidade: f.quantidade,
        percentual: f.percentual,
      })),
      jurisprudencia: r.natureza.jurisprudencia,
      soEstatistica: r.natureza.estatistica,
      amostraPequena: r.estatistica.comResultado < MINIMO_PARA_PROVA,
    };
  } catch (err) {
    // Acervo indisponível não pode derrubar a conversa: o redator continua
    // funcionando com o caso e as fontes do escritório, que é o que ele
    // sempre teve.
    log.warn({ err: String(err), filtro }, "Falha ao medir o recorte do caso");
    return null;
  }
}

/**
 * O texto que entra no prompt.
 *
 * Traz o número pro modelo poder raciocinar (escolher a tese que o recorte
 * sustenta), e proíbe reescrevê-lo. Sem a proibição o modelo repete "em 81%
 * dos casos" no corpo da peça — e aí passa a existir um percentual na tela que
 * ninguém contou, exatamente o que `contemNumeroInventado` impede na Pesquisa.
 */
export function formatarProvaParaPrompt(p: ProvaAcervo): string {
  const linhas = p.fatias
    .filter((f) => f.quantidade > 0)
    .map((f) => `- ${f.rotulo}: ${f.quantidade} de ${p.comResultado}`)
    .join("\n");

  const alerta = p.amostraPequena
    ? "\nATENÇÃO: a amostra é pequena. Trate como indício, não como tese firmada, e diga isso ao advogado."
    : "";

  return (
    `COMO ESTE TRIBUNAL VEM DECIDINDO CASOS COMO ESTE (acervo público do CNJ — recorte ${p.rotulo}, ` +
    `${p.comResultado} processos já decididos, ${p.jurisprudencia} deles em segunda instância):\n` +
    linhas +
    alerta +
    "\n\nUSE ISTO para escolher a tese e a ordem dos pedidos — o que o recorte sustenta vem primeiro. " +
    "NUNCA escreva percentual, fração ou 'a maioria dos casos' no texto: o número é mostrado à parte, " +
    "contado no banco. Refira-se assim: \"o recorte deste tribunal sustenta a preliminar\". " +
    "Não cite processo do acervo como precedente — o recorte é estatística, não jurisprudência citável."
  );
}
