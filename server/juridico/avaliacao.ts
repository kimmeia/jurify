/**
 * Avaliação de sucesso (viabilidade) — Incremento 2.
 *
 * A IA recebe SÓ as fontes recuperadas da base e devolve uma análise
 * ESTRUTURADA e citada: nota qualitativa (alta/média/baixa), fatores a favor
 * e contra, e força por tese. Nada de percentual inventado. Toda citação é
 * conferida contra as fontes recuperadas (grounding).
 *
 * Funções puras (prompt, parsing, verificação) + um orquestrador que recebe
 * `chamarLLM` injetado — testável sem API.
 */

export type FonteContexto = { identificador: string; titulo: string | null; texto: string };
export type CasoViabilidade = { fatos: string; area: string; teses?: string[] };

export type Nota = "alta" | "media" | "baixa";
export type Fator = { texto: string; fonte: string | null; fonteVerificada: boolean };
export type TeseForca = { nome: string; forca: Nota; observacao?: string };
export type Avaliacao = {
  nota: Nota;
  resumo: string;
  fatoresFavor: Fator[];
  fatoresContra: Fator[];
  teses: TeseForca[];
};

const INSTRUCOES = `Você é um analista jurídico. Avalie a VIABILIDADE de uma ação usando SOMENTE as fontes fornecidas.
Regras rígidas:
- NÃO invente súmula, lei ou precedente. Cite apenas os "identificador" das fontes fornecidas.
- NÃO dê porcentagem de sucesso. Use nota qualitativa: "alta", "media" ou "baixa".
- Seja objetivo e honesto: aponte também o que enfraquece a tese.
Responda APENAS com JSON válido, sem texto fora do JSON, no formato:
{"nota":"alta|media|baixa","resumo":"...","fatoresFavor":[{"texto":"...","fonte":"<identificador>"}],"fatoresContra":[{"texto":"...","fonte":"<identificador ou null>"}],"teses":[{"nome":"...","forca":"alta|media|baixa","observacao":"..."}]}`;

/** Monta system+user pro modelo, injetando as fontes recuperadas. */
export function montarPromptViabilidade(caso: CasoViabilidade, fontes: FonteContexto[]): { system: string; user: string } {
  const fontesTxt = fontes.length
    ? fontes.map((f) => `- [${f.identificador}] ${f.titulo ? f.titulo + ": " : ""}${f.texto}`).join("\n")
    : "(nenhuma fonte recuperada)";
  const teses = caso.teses?.length ? `\n\nTESES PRETENDIDAS:\n- ${caso.teses.join("\n- ")}` : "";
  const user =
    `ÁREA: ${caso.area}\n\nFATOS DO CASO:\n${caso.fatos}${teses}\n\n` +
    `FONTES DISPONÍVEIS (use só estas, cite pelo identificador entre colchetes):\n${fontesTxt}`;
  return { system: INSTRUCOES, user };
}

function normalizarNota(v: unknown): Nota {
  const s = String(v ?? "").toLowerCase();
  if (s.includes("alta")) return "alta";
  if (s.includes("baix")) return "baixa";
  return "media";
}

/** Extrai o JSON do texto do modelo (tolera cercas ```json) e faz parse frouxo. */
export function parseAvaliacaoBruta(raw: string | null | undefined): any | null {
  if (!raw) return null;
  let s = String(raw).trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  else {
    const a = s.indexOf("{");
    const b = s.lastIndexOf("}");
    if (a >= 0 && b > a) s = s.slice(a, b + 1);
  }
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function chaveNorm(s: string): string {
  return s.toLowerCase().replace(/[\s.º°]/g, "").replace(/[^a-z0-9/]/g, "");
}

/**
 * Normaliza o JSON bruto em `Avaliacao` e marca `fonteVerificada` conferindo
 * cada citação contra os identificadores realmente recuperados (grounding).
 */
export function comporAvaliacao(bruta: any, identificadoresValidos: string[]): Avaliacao {
  const validos = identificadoresValidos.map(chaveNorm);
  const verifica = (fonte: unknown): { fonte: string | null; ok: boolean } => {
    const f = fonte == null ? null : String(fonte).trim();
    if (!f) return { fonte: null, ok: false };
    const fn = chaveNorm(f);
    const ok = validos.some((v) => v && (v === fn || fn.includes(v) || v.includes(fn)));
    return { fonte: f, ok };
  };
  const mapFatores = (arr: any): Fator[] =>
    (Array.isArray(arr) ? arr : [])
      .map((x) => {
        const texto = String(x?.texto ?? "").trim();
        if (!texto) return null;
        const v = verifica(x?.fonte);
        return { texto, fonte: v.fonte, fonteVerificada: v.ok };
      })
      .filter((x): x is Fator => x !== null);
  const teses: TeseForca[] = (Array.isArray(bruta?.teses) ? bruta.teses : [])
    .map((t: any) => {
      const nome = String(t?.nome ?? "").trim();
      if (!nome) return null;
      return { nome, forca: normalizarNota(t?.forca), observacao: t?.observacao ? String(t.observacao) : undefined };
    })
    .filter(Boolean) as TeseForca[];

  return {
    nota: normalizarNota(bruta?.nota),
    resumo: String(bruta?.resumo ?? "").trim(),
    fatoresFavor: mapFatores(bruta?.fatoresFavor),
    fatoresContra: mapFatores(bruta?.fatoresContra),
    teses,
  };
}

/**
 * Orquestra a avaliação: monta o prompt com as fontes, chama o modelo
 * (injetado), faz parse e grounding. `chamarLLM` devolve o texto cru do modelo
 * (ou null). Retorna a avaliação ou um erro claro.
 */
export async function avaliarViabilidade(
  caso: CasoViabilidade,
  fontes: FonteContexto[],
  chamarLLM: (system: string, user: string) => Promise<string | null>,
): Promise<{ avaliacao: Avaliacao | null; erro?: string }> {
  if (fontes.length === 0) {
    return { avaliacao: null, erro: "Nenhuma fonte na base pra fundamentar — rode o seed/indexação da base jurídica." };
  }
  const { system, user } = montarPromptViabilidade(caso, fontes);
  const raw = await chamarLLM(system, user);
  const bruta = parseAvaliacaoBruta(raw);
  if (!bruta) return { avaliacao: null, erro: "A IA não retornou uma análise válida. Tente de novo ou troque o modelo." };
  return { avaliacao: comporAvaliacao(bruta, fontes.map((f) => f.identificador)) };
}
