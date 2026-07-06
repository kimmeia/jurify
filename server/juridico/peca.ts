/**
 * Redator de peças — Incremento 3 (backend).
 *
 * Redige a peça (texto jurídico) usando SÓ as fontes recuperadas, citando por
 * identificador. Depois, um verificador varre a peça atrás de citações de
 * súmula/REsp/RE/Tema que NÃO batem com nenhuma fonte recuperada — o alerta
 * anti-invenção que o advogado revisa antes de protocolar.
 *
 * Puro/injetável (`chamarLLM` vem de fora) — testável sem API.
 */
import type { FonteContexto } from "./avaliacao";

export type TipoPeca = { id: string; label: string; secoes: string[]; area: string };

export const TIPOS_PECA: Record<string, TipoPeca> = {
  peticao_inicial_revisional: {
    id: "peticao_inicial_revisional",
    label: "Petição inicial — Revisional de contrato bancário",
    secoes: ["Dos Fatos", "Do Direito", "Dos Pedidos"],
    area: "revisional_bancaria",
  },
};

export type Caso = { fatos: string; teses?: string[]; resumoAvaliacao?: string };

/** Monta system+user pro modelo redigir a peça, injetando as fontes. */
export function montarPromptPeca(caso: Caso, fontes: FonteContexto[], tipo: TipoPeca): { system: string; user: string } {
  const system =
    `Você é advogado(a) redator(a). Redija uma "${tipo.label}" em português jurídico formal, ` +
    `estruturada nas seções: ${tipo.secoes.join(", ")}.\n` +
    `Regras rígidas:\n` +
    `- Use SOMENTE as fontes fornecidas; cite pelo identificador exatamente como veio (ex.: "Súmula 297/STJ").\n` +
    `- NÃO invente súmula, lei, precedente nem número de processo.\n` +
    `- NÃO invente fatos além dos informados. Não prometa resultado.\n` +
    `- Escreva o texto corrido da peça (sem JSON, sem comentários fora da peça).`;
  const fontesTxt = fontes.length
    ? fontes.map((f) => `- [${f.identificador}] ${f.titulo ? f.titulo + ": " : ""}${f.texto}`).join("\n")
    : "(nenhuma fonte)";
  const teses = caso.teses?.length ? `\nTESES: ${caso.teses.join("; ")}` : "";
  const aval = caso.resumoAvaliacao ? `\nRESUMO DA VIABILIDADE: ${caso.resumoAvaliacao}` : "";
  const user = `FATOS:\n${caso.fatos}${teses}${aval}\n\nFONTES (use só estas, cite pelo identificador):\n${fontesTxt}`;
  return { system, user };
}

// Citações de alto risco de invenção (jurisprudência). Artigos de código são
// baixo risco e ficam de fora do alerta.
const RE_CITACAO = /(?:s[úu]mula(?:\s+vinculante)?\s+\d+|resp\s+[\d.\/-]+|\bre\s+[\d.\/-]+|tema\s+\d+)/gi;

export function extrairCitacoes(texto: string): string[] {
  return (String(texto).match(RE_CITACAO) || []).map((s) => s.trim());
}

/** Reduz uma citação/identificador a {tipo, num} pra comparar por número. */
export function tokensCitacao(s: string): { tipo: string; num: string } | null {
  const t = String(s).toLowerCase();
  let m: RegExpMatchArray | null;
  if ((m = t.match(/s[úu]mula(?:\s+vinculante)?\s+(\d+)/))) return { tipo: "sumula", num: m[1] };
  if ((m = t.match(/resp\s+([\d.\/-]+)/))) return { tipo: "resp", num: m[1].replace(/\D/g, "") };
  if ((m = t.match(/\bre\s+([\d.\/-]+)/))) return { tipo: "re", num: m[1].replace(/\D/g, "") };
  if ((m = t.match(/tema\s+(\d+)/))) return { tipo: "tema", num: m[1] };
  return null;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export type VerificacaoCitacoes = {
  /** Identificadores de fontes recuperadas detectados na peça. */
  fontesUsadas: string[];
  /** Citações de jurisprudência na peça que NÃO batem com nenhuma fonte (alerta). */
  suspeitas: string[];
};

/**
 * Confere a peça contra as fontes recuperadas: quais fontes foram usadas e
 * quais citações de jurisprudência não têm respaldo (possível invenção).
 */
export function verificarCitacoesPeca(texto: string, fontes: FonteContexto[]): VerificacaoCitacoes {
  const textoNorm = norm(texto);
  const fonteTokens = fontes.map((f) => ({ id: f.identificador, tok: tokensCitacao(f.identificador) }));

  // Fontes usadas: por token (súmula/resp...) OU por substring do identificador.
  const fontesUsadas: string[] = [];
  for (const f of fontes) {
    const tk = tokensCitacao(f.identificador);
    let usada = false;
    if (tk) {
      for (const c of extrairCitacoes(texto)) {
        const ct = tokensCitacao(c);
        if (ct && ct.tipo === tk.tipo && ct.num === tk.num) { usada = true; break; }
      }
    }
    if (!usada && norm(f.identificador).length >= 5 && textoNorm.includes(norm(f.identificador))) usada = true;
    if (usada) fontesUsadas.push(f.identificador);
  }

  // Suspeitas: citação de jurisprudência na peça sem fonte correspondente.
  const suspeitas: string[] = [];
  const vistos = new Set<string>();
  for (const c of extrairCitacoes(texto)) {
    const ct = tokensCitacao(c);
    if (!ct) continue;
    const bate = fonteTokens.some((f) => f.tok && f.tok.tipo === ct.tipo && f.tok.num === ct.num);
    const chave = `${ct.tipo}:${ct.num}`;
    if (!bate && !vistos.has(chave)) {
      vistos.add(chave);
      suspeitas.push(c);
    }
  }
  return { fontesUsadas, suspeitas };
}

/**
 * Orquestra a redação: monta o prompt, chama o modelo (injetado) e verifica as
 * citações. Retorna o texto da peça + a verificação, ou um erro claro.
 */
export async function gerarPeca(
  caso: Caso,
  fontes: FonteContexto[],
  tipo: TipoPeca,
  chamarLLM: (system: string, user: string) => Promise<string | null>,
): Promise<{ texto: string | null; verificacao: VerificacaoCitacoes | null; erro?: string }> {
  if (fontes.length === 0) {
    return { texto: null, verificacao: null, erro: "Nenhuma fonte na base pra fundamentar — rode o seed/indexação da base jurídica." };
  }
  const { system, user } = montarPromptPeca(caso, fontes, tipo);
  const texto = await chamarLLM(system, user);
  if (!texto) return { texto: null, verificacao: null, erro: "A IA não retornou a peça. Tente de novo ou troque o modelo." };
  return { texto, verificacao: verificarCitacoesPeca(texto, fontes) };
}
