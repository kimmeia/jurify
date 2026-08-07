/**
 * Contrato de resposta do JurisIA — a trava contra citação inventada.
 *
 * Advogado já foi multado no Brasil por peticionar jurisprudência que a IA
 * criou. Aqui a regra é estrutural, não um pedido no prompt: toda AFIRMAÇÃO
 * sobre o caso precisa apontar para um documento que foi de fato entregue no
 * contexto. Se o modelo citar um id que não existe, a resposta inteira é
 * recusada — id inventado não é um deslize pontual, é sinal de que aquele
 * turno não está ancorado em nada.
 *
 * A conclusão é o único trecho sem fonte, e por isso vem separada: ela é a
 * leitura do advogado-máquina sobre os fatos acima, e a tela a apresenta como
 * tal em vez de misturar com o que está escrito nos autos.
 */

export interface TrechoAncorado {
  texto: string;
  /** Ids de fonte (eventoId) — sempre pelo menos um, sempre existentes. */
  fontes: number[];
}

export interface RespostaJurisIA {
  /** false = não havia base no contexto; `afirmacoes` vem vazio, e tudo bem. */
  achou: boolean;
  afirmacoes: TrechoAncorado[];
  /** Recomendação/leitura. Sem fonte por natureza. */
  conclusao: string | null;
  /** União ordenada das fontes citadas — é o que a coluna da direita lista. */
  fontesUsadas: number[];
}

export type ResultadoValidacao =
  | { ok: true; resposta: RespostaJurisIA }
  | { ok: false; motivo: string };

const MIN_TEXTO = 12;

function texto(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Valida a saída bruta do modelo contra as fontes que foram entregues a ele.
 *
 * `fontesDisponiveis` é a lista de ids que o contexto realmente continha —
 * não a lista que o modelo diz ter usado.
 */
export function validarResposta(bruto: unknown, fontesDisponiveis: number[]): ResultadoValidacao {
  let obj: any = bruto;
  if (typeof bruto === "string") {
    try {
      obj = JSON.parse(bruto);
    } catch {
      return { ok: false, motivo: "resposta não é JSON válido" };
    }
  }
  if (!obj || typeof obj !== "object") return { ok: false, motivo: "resposta vazia" };

  const permitidas = new Set(fontesDisponiveis);
  const conclusao = texto(obj.conclusao) || null;

  // "Não achei" é resposta legítima e o caminho que a tela promete quando o
  // acervo não tem o assunto. Não exige afirmação nenhuma.
  if (obj.achou === false) {
    return {
      ok: true,
      resposta: { achou: false, afirmacoes: [], conclusao, fontesUsadas: [] },
    };
  }

  const brutas = Array.isArray(obj.afirmacoes) ? obj.afirmacoes : [];
  const afirmacoes: TrechoAncorado[] = [];
  const usadas: number[] = [];

  for (const a of brutas) {
    const t = texto(a?.texto);
    if (t.length < MIN_TEXTO) continue;

    const cru: unknown[] = Array.isArray(a?.fontes) ? a.fontes : [];
    const ids: number[] = cru.filter((n): n is number => Number.isInteger(n));
    if (ids.length === 0) {
      return { ok: false, motivo: `afirmação sem fonte: "${t.slice(0, 60)}"` };
    }
    for (const id of ids) {
      if (!permitidas.has(id)) {
        return { ok: false, motivo: `fonte inexistente citada: ${id}` };
      }
    }

    const unicas = [...new Set(ids)];
    afirmacoes.push({ texto: t, fontes: unicas });
    for (const id of unicas) if (!usadas.includes(id)) usadas.push(id);
  }

  // Afirmou que achou e não trouxe nada verificável: pior que dizer "não
  // achei", porque a tela mostraria uma conclusão flutuando sozinha.
  if (afirmacoes.length === 0) {
    return { ok: false, motivo: "nenhuma afirmação ancorada" };
  }

  return { ok: true, resposta: { achou: true, afirmacoes, conclusao, fontesUsadas: usadas } };
}
