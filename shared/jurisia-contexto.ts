/**
 * Monta o contexto de um processo para o JurisIA.
 *
 * O acervo já vem pré-digerido: `analiseJson` guarda título, pontos e desfecho
 * de cada movimentação. Por isso um processo inteiro cabe em poucos milhares
 * de tokens sem banco vetorial — é a vantagem de ter analisado na entrada em
 * vez de na pergunta.
 *
 * O que este módulo decide é o CORTE, quando o processo é grande demais: qual
 * movimentação entra e qual fica de fora. Errar aqui é pior que errar no
 * prompt, porque o modelo só sabe responder sobre o que recebeu — e a trava de
 * citação vai (corretamente) recusar qualquer coisa fora daqui.
 */

export interface EventoContexto {
  id: number;
  /** ISO. */
  dataEvento: string;
  /** Manchete da análise, ou o rótulo cru do tribunal. */
  titulo: string;
  /** Pontos já filtrados de enchimento. */
  pontos?: string[];
  ato?: string | null;
  desfecho?: "favoravel" | "desfavoravel" | "parcial" | "neutro" | null;
  relevancia?: "relevante" | "rotina" | null;
  /** Inteiro teor, quando foi capturado. */
  teor?: string | null;
}

export interface FonteContexto {
  id: number;
  rotulo: string;
  data: string;
}

export interface ContextoProcesso {
  fontes: FonteContexto[];
  /** Bloco pronto pra ir no `user` da chamada. */
  texto: string;
  /** Quantas movimentações ficaram de fora do corte. */
  omitidas: number;
}

const MAX_FONTES = 60;
const MAX_CHARS_TEOR = 1400;

const dataCurta = (iso: string) => {
  const d = iso.slice(0, 10).split("-");
  return d.length === 3 ? `${d[2]}/${d[1]}/${d[0]}` : iso.slice(0, 10);
};

/**
 * Ordena por "vale a pena caber": o que tem desfecho é o que responde a
 * maioria das perguntas de advogado, e some por último. Rotina some primeiro.
 * Dentro do mesmo peso, o mais recente vence.
 */
function peso(e: EventoContexto): number {
  if (e.desfecho && e.desfecho !== "neutro") return 3;
  if (e.teor) return 2;
  if (e.relevancia === "rotina") return 0;
  return 1;
}

export function montarContextoProcesso(
  eventos: EventoContexto[],
  opts?: { maxFontes?: number },
): ContextoProcesso {
  const maxFontes = opts?.maxFontes ?? MAX_FONTES;

  const ordenados = [...eventos].sort((a, b) => {
    const p = peso(b) - peso(a);
    if (p !== 0) return p;
    return b.dataEvento.localeCompare(a.dataEvento);
  });

  const escolhidos = ordenados.slice(0, maxFontes);
  const omitidas = Math.max(0, eventos.length - escolhidos.length);

  // Na hora de escrever, volta pra ordem cronológica: a história do processo
  // só faz sentido lida do começo ao fim, mesmo que o corte tenha sido por
  // relevância.
  escolhidos.sort((a, b) => a.dataEvento.localeCompare(b.dataEvento));

  const fontes: FonteContexto[] = [];
  const blocos: string[] = [];

  for (const e of escolhidos) {
    const rotulo = e.titulo.trim() || "(sem título)";
    fontes.push({ id: e.id, rotulo, data: dataCurta(e.dataEvento) });

    const linhas = [`[FONTE ${e.id}] ${dataCurta(e.dataEvento)} — ${rotulo}`];
    if (e.ato) linhas.push(`ato: ${e.ato}`);
    if (e.desfecho) linhas.push(`desfecho: ${e.desfecho}`);
    for (const p of e.pontos ?? []) linhas.push(`- ${p}`);
    if (e.teor) {
      const t = e.teor.trim();
      linhas.push(`teor: ${t.length > MAX_CHARS_TEOR ? `${t.slice(0, MAX_CHARS_TEOR)}…` : t}`);
    }
    blocos.push(linhas.join("\n"));
  }

  const aviso = omitidas > 0
    ? `\n\n(${omitidas} movimentação(ões) de rotina ficaram fora deste recorte.)`
    : "";

  return { fontes, texto: blocos.join("\n\n") + aviso, omitidas };
}
