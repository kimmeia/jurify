/**
 * O robô que busca ementa nos sites oficiais, de tempos em tempos.
 *
 * Três decisões carregam o resto:
 *
 * 1. **Fonte nasce desligada e só o painel liga.** Subir uma versão não pode
 *    ligar robô contra o site de um tribunal. Antes de ligar, a sondagem
 *    (`sondar-fontes.ts`) diz se a fonte responde DO NOSSO SERVIDOR — o que
 *    responde do computador de casa não prova nada sobre a faixa de IP do
 *    Railway.
 * 2. **Uma requisição por fonte por rodada, com pausa entre fontes.** Isto é
 *    coleta incremental, não varredura: o portal é de terceiro e a conta que
 *    importa é não ser barrado.
 * 3. **O estado fica gravado, não no response.** Falha vira `erro` com a
 *    mensagem na linha da fonte, e a tela mostra — é a regra da casa sobre
 *    integração que quebra em silêncio.
 */

import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import { jurisiaEmentas, jurisiaFontesColeta } from "../../drizzle/schema";
import {
  FONTES_OFICIAIS,
  coletaDevida,
  enderecoDaFonte,
  fonteCitavel,
  fonteOficialPorId,
  ligarTemChance,
  urlDeBusca,
  type FonteOficial,
} from "@shared/fontes-oficiais";
import { extrairEmentasDeHtml, extrairEmentasDeJson, type EmentaBruta } from "./extrair-ementas";
import { colherSumulas, type SumulaBruta } from "./extrair-sumulas";
import { createLogger } from "../_core/logger";

const log = createLogger("coletor-ementas");

const TIMEOUT_MS = 25_000;
const PAUSA_ENTRE_FONTES_MS = 2_000;
const UA = "JuridFlow/1.0 (coleta de jurisprudencia publica; respeita a cadencia de cada fonte)";

/**
 * O que se busca quando ninguém pediu nada.
 *
 * Coletar "tudo" não existe em portal de jurisprudência: a busca exige termo.
 * Estes são os assuntos que o produto já vende, e é por eles que o acervo
 * começa a existir. Termo novo entra aqui.
 */
export const TERMOS_PADRAO = [
  "revisão de contrato bancário",
  "busca e apreensão alienação fiduciária",
  "capitalização de juros",
  "tarifa de avaliação do bem",
  "repetição de indébito",
];

export interface ResultadoColeta {
  fonteId: string;
  buscou: number;
  novas: number;
  status: "ok" | "erro" | "bloqueada";
  erro: string | null;
  /** Súmulas marcadas como canceladas que ficaram de fora, de propósito. */
  canceladas?: number;
}

/** Garante a linha de estado da fonte. Idempotente. */
async function garantirLinha(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, fonteId: string) {
  await db
    .insert(jurisiaFontesColeta)
    .values({ fonteId })
    .onDuplicateKeyUpdate({ set: { fonteId } });
  const [linha] = await db
    .select()
    .from(jurisiaFontesColeta)
    .where(eq(jurisiaFontesColeta.fonteId, fonteId))
    .limit(1);
  return linha ?? null;
}

async function buscarCorpo(url: string): Promise<{ ok: true; corpo: string; tipo: string } | { ok: false; status: number | null; erro: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json, text/html;q=0.9" },
      signal: ctrl.signal,
    });
    const corpo = await resp.text();
    if (!resp.ok) {
      return { ok: false, status: resp.status, erro: `HTTP ${resp.status}` };
    }
    return { ok: true, corpo, tipo: resp.headers.get("content-type") || "" };
  } catch (err) {
    return { ok: false, status: null, erro: (err as Error).message.slice(0, 300) };
  } finally {
    clearTimeout(t);
  }
}

/** Lê o corpo conforme o formato declarado, caindo pro outro quando não bate. */
export function lerEmentas(fonte: FonteOficial, corpo: string, url: string): EmentaBruta[] {
  const pareceJson = corpo.trimStart().startsWith("{") || corpo.trimStart().startsWith("[");
  if (fonte.formato === "json" || pareceJson) {
    try {
      return extrairEmentasDeJson(JSON.parse(corpo));
    } catch {
      // Portal que promete JSON e devolve HTML de erro é comum demais pra
      // tratar como falha: tenta o outro leitor antes de desistir.
    }
  }
  return extrairEmentasDeHtml(corpo, url);
}

/**
 * Uma passada numa fonte. Nunca lança: devolve o que aconteceu.
 *
 * `termos` vazio usa os padrão. Cada termo é uma requisição — por isso o teto
 * de 2 por rodada: a cadência resolve o resto ao longo dos dias.
 */
export async function coletarFonte(fonteId: string, opts?: { termos?: string[] }): Promise<ResultadoColeta> {
  const fonte = fonteOficialPorId(fonteId);
  const base: ResultadoColeta = { fonteId, buscou: 0, novas: 0, status: "ok", erro: null };
  if (!fonte || !fonteCitavel(fonte)) {
    return { ...base, status: "erro", erro: "Fonte desconhecida ou que não traz material citável." };
  }

  const db = await getDb();
  if (!db) return { ...base, status: "erro", erro: "Base de dados indisponível." };

  await garantirLinha(db, fonteId);
  await db
    .update(jurisiaFontesColeta)
    .set({ status: "coletando", ultimoErro: null })
    .where(eq(jurisiaFontesColeta.fonteId, fonteId));

  const passada =
    fonte.material === "sumula"
      ? await colherListaDeSumulas(fonte)
      : await colherEmentasPorTermo(fonte, opts?.termos);
  const { buscou, novas, erro, bloqueada, canceladas } = passada;

  const status: ResultadoColeta["status"] = bloqueada ? "bloqueada" : erro ? "erro" : "ok";
  const agora = new Date();
  const [{ total = 0 } = { total: 0 }] = await db
    .select({ total: sql<number>`COUNT(*)` })
    .from(jurisiaEmentas)
    .where(eq(jurisiaEmentas.fonteId, fonteId));

  await db
    .update(jurisiaFontesColeta)
    .set({
      status,
      ultimaColetaEm: agora,
      proximaEm: new Date(agora.getTime() + fonte.cadenciaHoras * 3_600_000),
      itens: Number(total),
      ultimoErro: erro ? erro.slice(0, 500) : null,
    })
    .where(eq(jurisiaFontesColeta.fonteId, fonteId));

  log.info({ fonteId, buscou, novas, status }, "[coletor] fonte percorrida");
  return { fonteId, buscou, novas, status, erro, canceladas };
}

interface Passada {
  buscou: number;
  novas: number;
  erro: string | null;
  bloqueada: boolean;
  canceladas: number;
}

/** Ementa se busca por termo: o acervo não acaba, então se volta sempre. */
async function colherEmentasPorTermo(fonte: FonteOficial, termos?: string[]): Promise<Passada> {
  const lista = (termos?.length ? termos : TERMOS_PADRAO).slice(0, 2);
  const p: Passada = { buscou: 0, novas: 0, erro: null, bloqueada: false, canceladas: 0 };

  for (const termo of lista) {
    const url = urlDeBusca(fonte, termo);
    if (!url) {
      p.erro = "Fonte sem endereço de busca conhecido — rode a sondagem.";
      break;
    }
    const r = await buscarCorpo(url);
    if (!r.ok) {
      // 403/401 é o tribunal recusando QUEM chama, não o que foi pedido: é a
      // diferença entre "consertar a busca" e "rodar de outro lugar".
      p.bloqueada = r.status === 403 || r.status === 401;
      p.erro = r.erro;
      break;
    }
    const achadas = lerEmentas(fonte, r.corpo, url);
    p.buscou += achadas.length;
    p.novas += await gravarEmentas(fonte, achadas);
    await new Promise((res) => setTimeout(res, PAUSA_ENTRE_FONTES_MS));
  }
  return p;
}

/**
 * Súmula se pega inteira, numa requisição.
 *
 * Sem termo de busca de propósito: o conjunto é fechado e cabe todo. Buscar
 * súmula por palavra traria um pedaço do que caberia completo, e depois
 * ninguém saberia qual pedaço falta.
 */
async function colherListaDeSumulas(fonte: FonteOficial): Promise<Passada> {
  const p: Passada = { buscou: 0, novas: 0, erro: null, bloqueada: false, canceladas: 0 };
  const url = enderecoDaFonte(fonte, "");
  if (!url) {
    p.erro = "Fonte de súmula sem endereço de lista — rode a sondagem.";
    return p;
  }
  const r = await buscarCorpo(url);
  if (!r.ok) {
    p.bloqueada = r.status === 403 || r.status === 401;
    p.erro = r.erro;
    return p;
  }

  const colheita = colherSumulas(r.corpo, fonte.tribunal);
  p.buscou = colheita.sumulas.length;
  p.canceladas = colheita.canceladas;
  p.novas = await gravarSumulas(fonte, colheita.sumulas, url);
  if (p.buscou === 0) {
    // Distinguir "a porta abriu e não tinha texto" de "a porta não abriu" é o
    // que evita trocar o endereço de uma fonte que está viva.
    p.erro = "A página respondeu, mas não trazia o texto dos enunciados (provavelmente é só o índice).";
  }
  return p;
}

/**
 * O caminho manual: o texto oficial colado uma vez.
 *
 * Existe porque "a informação é pública" e "o nosso servidor consegue ler" são
 * coisas diferentes — o STJ publica todas as súmulas aberto e barra a faixa de
 * IP do servidor. Súmula muda poucas vezes por ano; esperar o robô conseguir
 * entrar seria deixar a base vazia por um detalhe de rede.
 *
 * Passa pelo MESMO extrator da coleta automática, então o que entra colado é
 * idêntico ao que entraria sozinho.
 */
export async function importarSumulasDeTexto(opts: {
  fonteId: string;
  texto: string;
}): Promise<ResultadoColeta> {
  const fonte = fonteOficialPorId(opts.fonteId);
  const base: ResultadoColeta = { fonteId: opts.fonteId, buscou: 0, novas: 0, status: "ok", erro: null };
  if (!fonte || fonte.material !== "sumula") {
    return { ...base, status: "erro", erro: "Essa fonte não é de súmulas." };
  }
  const db = await getDb();
  if (!db) return { ...base, status: "erro", erro: "Base de dados indisponível." };

  const colheita = colherSumulas(opts.texto, fonte.tribunal);
  if (colheita.sumulas.length === 0) {
    return {
      ...base,
      status: "erro",
      canceladas: colheita.canceladas,
      erro: "Não achei nenhum enunciado nesse texto. Ele precisa ter o número junto do texto, como \"Súmula 297 — O Código de Defesa do Consumidor…\".",
    };
  }

  const url = fonte.listaCompleta || `https://www.${fonte.tribunal.toLowerCase()}.jus.br/`;
  const novas = await gravarSumulas(fonte, colheita.sumulas, url);

  await garantirLinha(db, opts.fonteId);
  const agora = new Date();
  const [{ total = 0 } = { total: 0 }] = await db
    .select({ total: sql<number>`COUNT(*)` })
    .from(jurisiaEmentas)
    .where(eq(jurisiaEmentas.fonteId, opts.fonteId));
  await db
    .update(jurisiaFontesColeta)
    .set({ status: "ok", ultimaColetaEm: agora, itens: Number(total), ultimoErro: null })
    .where(eq(jurisiaFontesColeta.fonteId, opts.fonteId));

  log.info(
    { fonteId: opts.fonteId, achadas: colheita.sumulas.length, novas },
    "[coletor] súmulas importadas de texto",
  );
  return {
    fonteId: opts.fonteId,
    buscou: colheita.sumulas.length,
    novas,
    status: "ok",
    erro: null,
    canceladas: colheita.canceladas,
  };
}

/**
 * Grava súmula no mesmo acervo das ementas.
 *
 * Mesma tabela de propósito: quem busca jurisprudência não quer procurar em
 * dois lugares, e o FULLTEXT que acha ementa acha enunciado. O endereço
 * gravado é a página oficial de onde o texto saiu — é o que o advogado abre
 * antes de assinar.
 */
async function gravarSumulas(fonte: FonteOficial, sumulas: SumulaBruta[], url: string): Promise<number> {
  const db = await getDb();
  if (!db || sumulas.length === 0) return 0;

  let novas = 0;
  for (const s of sumulas) {
    try {
      const [existente] = await db
        .select({ id: jurisiaEmentas.id })
        .from(jurisiaEmentas)
        .where(
          and(eq(jurisiaEmentas.fonteId, fonte.id), eq(jurisiaEmentas.identificador, s.identificador)),
        )
        .limit(1);
      if (existente) continue;

      await db.insert(jurisiaEmentas).values({
        fonteId: fonte.id,
        tribunal: fonte.tribunal,
        identificador: s.identificador,
        orgao: s.vinculante ? "Súmula vinculante" : "Súmula",
        relator: null,
        julgadoEm: null,
        ementa: s.texto,
        url,
      });
      novas++;
    } catch (err) {
      log.warn({ fonte: fonte.id, err: (err as Error).message }, "[coletor] súmula não gravada");
    }
  }
  return novas;
}

/**
 * Grava o que veio, sem duplicar.
 *
 * Ementa sem URL não entra: o endereço oficial é o que separa citação de
 * invenção, e sem ele o advogado não confere antes de assinar.
 */
async function gravarEmentas(fonte: FonteOficial, brutas: EmentaBruta[]): Promise<number> {
  const db = await getDb();
  if (!db || brutas.length === 0) return 0;

  let novas = 0;
  for (const b of brutas) {
    const url = b.url;
    if (!url) continue;
    try {
      const [existente] = await db
        .select({ id: jurisiaEmentas.id })
        .from(jurisiaEmentas)
        .where(
          and(
            eq(jurisiaEmentas.fonteId, fonte.id),
            eq(jurisiaEmentas.identificador, b.identificador),
          ),
        )
        .limit(1);
      if (existente) continue;

      await db.insert(jurisiaEmentas).values({
        fonteId: fonte.id,
        tribunal: fonte.tribunal,
        identificador: b.identificador,
        orgao: b.orgao,
        relator: b.relator,
        julgadoEm: b.julgadoEm,
        ementa: b.ementa,
        url,
      });
      novas++;
    } catch (err) {
      // Duplicata por corrida cai aqui e é normal — o UNIQUE é quem manda.
      log.warn({ fonte: fonte.id, err: (err as Error).message }, "[coletor] ementa não gravada");
    }
  }
  return novas;
}

/**
 * A rodada do cron: percorre só as fontes LIGADAS cuja cadência venceu.
 *
 * Fonte desligada nem é consultada — é o que garante que o robô não começa a
 * bater em portal nenhum sozinho.
 */
export async function rodarColetaDevida(agora = Date.now()): Promise<ResultadoColeta[]> {
  const db = await getDb();
  if (!db) return [];

  const linhas = await db.select().from(jurisiaFontesColeta).where(eq(jurisiaFontesColeta.ligada, true));
  const feitos: ResultadoColeta[] = [];

  for (const linha of linhas) {
    const fonte = fonteOficialPorId(linha.fonteId);
    if (!fonte || !fonteCitavel(fonte)) continue;
    if (!coletaDevida(fonte, linha.ultimaColetaEm, agora)) continue;
    feitos.push(await coletarFonte(linha.fonteId));
  }
  return feitos;
}

/** Estado de todas as fontes declaradas, com o que o banco sabe de cada uma. */
export async function estadoDasFontes() {
  const db = await getDb();
  const linhas = db ? await db.select().from(jurisiaFontesColeta) : [];
  const porId = new Map(linhas.map((l) => [l.fonteId, l]));

  return FONTES_OFICIAIS.map((f) => {
    const l = porId.get(f.id);
    return {
      id: f.id,
      nome: f.nome,
      orgao: f.orgao,
      escopo: f.escopo,
      material: f.material,
      entrega: f.entrega,
      cadenciaHoras: f.cadenciaHoras,
      situacao: f.situacao,
      notaDaSondagem: f.notaDaSondagem ?? null,
      ligarTemChance: ligarTemChance(f),
      ligada: l?.ligada ?? false,
      status: l?.status ?? ("nunca" as const),
      ultimaColetaEm: l?.ultimaColetaEm ?? null,
      proximaEm: l?.proximaEm ?? null,
      itens: l?.itens ?? 0,
      ultimoErro: l?.ultimoErro ?? null,
    };
  });
}

/** Liga/desliga uma fonte. Ligar não coleta na hora — quem coleta é a cadência. */
export async function ligarFonte(fonteId: string, ligada: boolean): Promise<void> {
  const fonte = fonteOficialPorId(fonteId);
  if (!fonte || !fonteCitavel(fonte)) throw new Error("Fonte desconhecida.");
  const db = await getDb();
  if (!db) throw new Error("Base de dados indisponível.");
  await garantirLinha(db, fonteId);
  await db
    .update(jurisiaFontesColeta)
    .set({ ligada })
    .where(eq(jurisiaFontesColeta.fonteId, fonteId));
}
