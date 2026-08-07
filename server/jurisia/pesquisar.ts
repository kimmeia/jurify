/**
 * Uma pesquisa jurisprudencial no acervo público.
 *
 * Duas chamadas ao modelo, com papéis bem separados:
 *
 * 1. INTERPRETAR — vira a pergunta em recorte ("revisional bancária no TJCE" →
 *    tribunal + termo de assunto). Só isso; nenhuma resposta sai daqui.
 * 2. RESPONDER — lê os processos do recorte e escreve o padrão, citando caso
 *    concreto.
 *
 * Entre as duas roda SQL, e é o SQL que produz a estatística. O modelo nunca
 * conta nada: ele narra o que os processos mostram, e `contemNumeroInventado`
 * recusa o turno se ele tentar medir o acervo por conta própria.
 */

import { chamarIA } from "../_core/ai-call";
import { validarResposta, type RespostaJurisIA } from "../../shared/jurisia-resposta";
import {
  descreverFiltro,
  filtroVazio,
  montarContextoRecorte,
  normalizarFiltro,
  numeroInventadoNaResposta,
  type EstatisticaRecorte,
  type FiltroRecorte,
  type FonteRecorte,
} from "../../shared/jurisia-recorte";
import { buscarRecorte } from "./buscar-acervo";

const SYSTEM_INTERPRETAR = `Você traduz a pergunta de um advogado em um RECORTE de busca sobre uma base de processos judiciais brasileiros.

Devolva JSON:
{
  "tribunal": "TJCE" | null,
  "classeTermo": "..." | null,
  "assuntoTermo": "..." | null,
  "orgaoTermo": "..." | null,
  "desdeAno": 2020 | null
}

Regras:
- Os termos são casados como SUBSTRING do nome oficial (classe processual, assunto da TPU, nome do órgão julgador). Por isso prefira UMA palavra discriminante ou expressão curta, sem artigo e sem plural desnecessário. "revisão" casa melhor que "ação revisional de contrato bancário".
- "tribunal" é a sigla (TJCE, TJSP, TRF5, STJ). Só preencha se a pergunta disser o tribunal ou o estado. Nunca deduza.
- "orgaoTermo" só quando a pergunta citar vara, câmara ou comarca.
- Campo que a pergunta não determina vai null. Chutar recorte é pior que devolver null — recorte errado responde com estatística de outra coisa.`;

const SYSTEM_RESPONDER = `Você é um assistente de pesquisa jurisprudencial. Recebe processos reais de um recorte do acervo, marcados como [FONTE <id>], e responde ao advogado o que esse conjunto mostra.

Devolva JSON:
{
  "achou": true|false,
  "afirmacoes": [{ "texto": "...", "fontes": [<id>, ...] }],
  "conclusao": "..." | null
}

Regras:
- Cada afirmação PRECISA citar os ids dos processos que a sustentam. Só ids que aparecem no contexto.
- NÃO PRODUZA NÚMEROS SOBRE O CONJUNTO. Nada de percentual, nada de "X de Y processos", nada de contagem. A estatística já foi calculada e é exibida ao lado da sua resposta — se você escrever um número diferente, a resposta inteira é descartada. Descreva o padrão em palavras ("a maioria", "é raro", "praticamente sempre") e aponte processos concretos.
- Pode citar número de CNJ, nome de vara, ano e artigo de lei que estejam nas fontes. O que não pode é medir o acervo.
- Nunca cite súmula, tese ou acórdão que não esteja nas fontes.
- Se os processos não respondem a pergunta, devolva "achou": false e diga o que faltou. É uma resposta boa.
- "conclusao" é sua leitura prática pro advogado — o único trecho sem fonte, e também sem número.
- Português do Brasil, direto, sem saudação. Fale como quem conversa com advogado.`;

export interface ResultadoPesquisa {
  ok: boolean;
  resposta: RespostaJurisIA | null;
  recusa: string | null;
  fontes: FonteRecorte[];
  filtro: FiltroRecorte;
  descricaoFiltro: string;
  estatistica: EstatisticaRecorte;
  /** true quando nem chegou a consultar o modelo de resposta. */
  semBase: boolean;
}

const ESTATISTICA_VAZIA: EstatisticaRecorte = {
  total: 0,
  comResultado: 0,
  emAndamento: 0,
  fatias: [],
  amostraPequena: true,
};

function semBase(
  filtro: FiltroRecorte,
  estatistica: EstatisticaRecorte,
  conclusao: string,
): ResultadoPesquisa {
  return {
    ok: true,
    resposta: { achou: false, afirmacoes: [], conclusao, fontesUsadas: [] },
    recusa: null,
    fontes: [],
    filtro,
    descricaoFiltro: descreverFiltro(filtro),
    estatistica,
    semBase: true,
  };
}

export async function pesquisarNoAcervo(args: {
  escritorioId: number;
  pergunta: string;
  historico?: Array<{ papel: "usuario" | "assistente"; texto: string }>;
}): Promise<ResultadoPesquisa> {
  const conversa = (args.historico ?? [])
    .slice(-6)
    .map((m) => `${m.papel === "usuario" ? "Advogado" : "Você"}: ${m.texto}`)
    .join("\n");

  const brutoFiltro = await chamarIA({
    escritorioId: args.escritorioId,
    system: SYSTEM_INTERPRETAR,
    user: [
      conversa ? `CONVERSA ATÉ AQUI:\n${conversa}\n` : "",
      `PERGUNTA:\n${args.pergunta}`,
    ]
      .filter(Boolean)
      .join("\n"),
    json: true,
    maxTokens: 300,
    temperature: 0,
    timeoutMs: 30_000,
  });

  const filtro = normalizarFiltro(brutoFiltro);

  if (filtroVazio(filtro)) {
    return semBase(
      filtro,
      ESTATISTICA_VAZIA,
      "Preciso de um recorte pra pesquisar: diga pelo menos o tribunal e o tipo de ação — por exemplo, \"revisão de contrato bancário no TJCE\".",
    );
  }

  const recorte = await buscarRecorte(filtro);

  if (recorte.estatistica.total === 0) {
    return semBase(
      filtro,
      recorte.estatistica,
      `Não há nada no acervo para ${descreverFiltro(filtro)}. Ou o recorte não existe, ou esse tribunal ainda não foi coletado.`,
    );
  }

  const ctx = montarContextoRecorte(recorte.processos);
  if (ctx.fontes.length === 0) {
    return semBase(
      filtro,
      recorte.estatistica,
      `O recorte ${descreverFiltro(filtro)} existe no acervo, mas nenhum processo dele pôde ser citado.`,
    );
  }

  const user = [
    `RECORTE: ${descreverFiltro(filtro)}`,
    "",
    "PROCESSOS DO RECORTE:",
    ctx.texto,
    conversa ? `\nCONVERSA ATÉ AQUI:\n${conversa}` : "",
    `\nPERGUNTA DO ADVOGADO:\n${args.pergunta}`,
  ]
    .filter(Boolean)
    .join("\n");

  const bruto = await chamarIA({
    escritorioId: args.escritorioId,
    system: SYSTEM_RESPONDER,
    user,
    json: true,
    maxTokens: 1600,
    temperature: 0.2,
    timeoutMs: 45_000,
  });

  const base = {
    filtro,
    descricaoFiltro: descreverFiltro(filtro),
    estatistica: recorte.estatistica,
    semBase: false,
  };

  const v = validarResposta(bruto, ctx.fontes.map((f) => f.id));
  if (!v.ok) {
    return { ok: false, resposta: null, recusa: v.motivo, fontes: ctx.fontes, ...base };
  }

  const numero = numeroInventadoNaResposta(v.resposta);
  if (numero) {
    return {
      ok: false,
      resposta: null,
      recusa: `estatística inventada pelo modelo: "${numero}"`,
      fontes: ctx.fontes,
      ...base,
    };
  }

  const usadas = new Set(v.resposta.fontesUsadas);
  return {
    ok: true,
    resposta: v.resposta,
    recusa: null,
    fontes: ctx.fontes.filter((f) => usadas.has(f.id)),
    ...base,
  };
}
