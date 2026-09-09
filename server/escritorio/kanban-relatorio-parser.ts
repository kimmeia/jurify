/**
 * Lê de volta o relatório de cards que este mesmo sistema exporta.
 *
 * Serve pra restaurar card apagado: quando uma coluna é excluída os cards vão
 * junto e não sobra nada no banco além de histórico órfão, que não guarda o
 * nome. O PDF que alguém emitiu antes do estrago vira o único lugar onde
 * aqueles nomes ainda existem.
 *
 * NÃO USA as larguras de `kanban-cards-pdf.ts`. Seria a amarração óbvia — e
 * errada: o relatório que precisa ser lido foi emitido por uma versão
 * anterior do gerador, com uma coluna ETAPA que hoje não existe mais (o
 * layout atual agrupa por coluna em vez de ter a coluna). Um leitor preso ao
 * formato de hoje falharia exatamente nos arquivos que importam, que são os
 * velhos. Por isso as posições saem do cabeçalho impresso em cada página.
 */

import { createLogger } from "../_core/logger";

const log = createLogger("kanban-restaurar");

/** Os cabeçalhos que já apareceram em alguma versão do relatório. */
const CABECALHOS = [
  "CLIENTE",
  "CARD",
  "FUNIL",
  "ETAPA",
  "RESPONSÁVEL",
  "CADASTRADO",
  "TEMPO",
  "PRAZO",
  "VALOR",
] as const;

type Cabecalho = (typeof CABECALHOS)[number];

export interface LinhaRelatorio {
  cliente: string;
  card: string;
  etapa: string;
  responsavel: string;
  /** dd/mm/aaaa, como impresso. */
  cadastrado: string;
  prazo: string;
  valor: string;
}

export interface RelatorioLido {
  linhas: LinhaRelatorio[];
  /** O que o rodapé do PDF declara. Se divergir de `linhas`, algo se perdeu. */
  totalDeclarado: number | null;
  emitidoEm: string | null;
}

interface Palavra {
  texto: string;
  x: number;
  y: number;
}

const RE_DATA = /^\d{2}\/\d{2}\/\d{4}$/;

/**
 * Junta palavras que estão na mesma linha visual.
 *
 * O PDF não tem noção de linha — cada pedaço de texto vem com sua coordenada.
 * Duas palavras da mesma linha podem diferir uns décimos de ponto no y, então
 * a tolerância é o que define "mesma linha".
 */
function agruparEmLinhas(palavras: Palavra[]): Palavra[][] {
  const porY = new Map<number, Palavra[]>();
  for (const p of palavras) {
    const chave = Math.round(p.y / 3);
    const atual = porY.get(chave);
    if (atual) atual.push(p);
    else porY.set(chave, [p]);
  }
  return [...porY.entries()]
    .sort((a, b) => b[0] - a[0]) // y do PDF cresce pra cima: maior = mais alto
    .map(([, ps]) => ps.sort((a, b) => a.x - b.x));
}

/** Acha o x de cada cabeçalho. Devolve null se a linha não for o cabeçalho. */
function limitesDaLinha(linha: Palavra[]): Array<[Cabecalho, number]> | null {
  const achados = new Map<Cabecalho, number>();
  for (const p of linha) {
    const t = p.texto.trim().toUpperCase();
    const cab = CABECALHOS.find((c) => c === t);
    if (cab && !achados.has(cab)) achados.set(cab, p.x);
  }
  // "CLIENTE" sozinho também aparece em nome de coluna do quadro
  // ("CLIENTES COM PENDENCIAS"), então exige o conjunto que só o cabeçalho
  // tem.
  if (!achados.has("CARD") || !achados.has("CADASTRADO") || !achados.has("VALOR")) return null;
  return [...achados.entries()].sort((a, b) => a[1] - b[1]);
}

function montarLinha(linha: Palavra[], limites: Array<[Cabecalho, number]>): LinhaRelatorio | null {
  const celulas = new Map<Cabecalho, string[]>();
  for (const [nome] of limites) celulas.set(nome, []);

  for (const p of linha) {
    // margem de 2pt: o texto é impresso alinhado ao cabeçalho, mas o
    // arredondamento da fonte desloca frações de ponto.
    let alvo = limites[0][0];
    for (const [nome, x] of limites) {
      if (p.x >= x - 2) alvo = nome;
    }
    celulas.get(alvo)!.push(p.texto);
  }

  const ler = (c: Cabecalho) => (celulas.get(c) ?? []).join(" ").replace(/\s+/g, " ").trim();
  const cadastrado = ler("CADASTRADO");
  // A data de cadastro é o âncora: linha sem ela é cabeçalho de grupo,
  // rodapé, título ou legenda — nunca um card.
  if (!RE_DATA.test(cadastrado)) return null;
  const card = ler("CARD");
  if (!card) return null;

  return {
    cliente: ler("CLIENTE"),
    card,
    etapa: ler("ETAPA"),
    responsavel: ler("RESPONSÁVEL"),
    cadastrado,
    prazo: ler("PRAZO"),
    valor: ler("VALOR"),
  };
}

export async function lerRelatorioDeCards(buffer: Buffer): Promise<RelatorioLido> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    verbosity: 0,
  }).promise;

  const linhas: LinhaRelatorio[] = [];
  let totalDeclarado: number | null = null;
  let emitidoEm: string | null = null;
  // O cabeçalho se repete a cada página, mas se alguma vier sem ele o
  // último visto ainda vale — as colunas não mudam no meio do documento.
  let limites: Array<[Cabecalho, number]> | null = null;

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const palavras: Palavra[] = content.items
      .map((it: any) => ({
        texto: String(it.str ?? ""),
        x: Array.isArray(it.transform) ? Number(it.transform[4]) : 0,
        y: Array.isArray(it.transform) ? Number(it.transform[5]) : 0,
      }))
      .filter((p: Palavra) => p.texto.trim().length > 0);

    for (const linha of agruparEmLinhas(palavras)) {
      const talvezCabecalho = limitesDaLinha(linha);
      if (talvezCabecalho) {
        limites = talvezCabecalho;
        continue;
      }

      const texto = linha.map((p) => p.texto).join(" ");
      const total = texto.match(/Total\s*—\s*(\d+)\s*cards?/i);
      if (total) totalDeclarado = Number(total[1]);
      const emitido = texto.match(/EMITIDO EM\s*(.+)$/i);
      if (emitido) emitidoEm = emitido[1].trim();

      if (!limites) continue;
      const lida = montarLinha(linha, limites);
      if (lida) linhas.push(lida);
    }
  }

  if (totalDeclarado !== null && totalDeclarado !== linhas.length) {
    log.warn(
      { totalDeclarado, lidas: linhas.length },
      "o rodapé do relatório declara um total diferente do que foi lido",
    );
  }

  return { linhas, totalDeclarado, emitidoEm };
}
