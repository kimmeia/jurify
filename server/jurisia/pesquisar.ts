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
import type { PerfilRecorte } from "../../shared/jurisia-perfil";
import { compararComAcervo, type Comparacao } from "../../shared/jurisia-estrategia";
import { avisoDeNatureza, type ComposicaoNatureza } from "../../shared/jurisia-grau";
import { buscarRecorte, perfilDoRecorte } from "./buscar-acervo";

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
- RESPEITE A INSTÂNCIA de cada fonte. Só a decisão de órgão colegiado é jurisprudência — sentença de juiz singular mostra como aquela vara costuma decidir e nada além. Não escreva "o tribunal entende", "é entendimento consolidado" nem "a jurisprudência é" apoiado em sentença de 1º grau; nesse caso fale da vara ("nessa vara, o pedido costuma ser acolhido"). Quando o recorte não tiver nenhuma decisão colegiada, diga isso ao advogado.
- Se os processos não respondem a pergunta, devolva "achou": false e diga o que faltou. É uma resposta boa.
- "conclusao" é sua leitura prática pro advogado — o único trecho sem fonte, e também sem número.
- Português do Brasil, direto, sem saudação. Fale como quem conversa com advogado.`;

const SYSTEM_ESTRATEGIA = `Você aconselha um advogado que está decidindo se PEGA um caso — ou como conduzi-lo.

Recebe processos reais de um recorte do acervo público, marcados como [FONTE <id>], e, quando existe, o histórico do próprio escritório em casos do mesmo tipo.

Devolva JSON:
{
  "achou": true|false,
  "afirmacoes": [{ "texto": "...", "fontes": [<id>, ...] }],
  "conclusao": "..." | null
}

Regras:
- Cada afirmação PRECISA citar os ids dos processos que a sustentam. Só ids do contexto.
- NÃO PRODUZA NÚMEROS. Os percentuais e as contagens já estão calculados e aparecem na tela ao lado; escrever um número diferente descarta a resposta inteira. Fale em palavras ("a maioria", "é raro", "quase o dobro").
- A "conclusao" é o conselho, e é o que o advogado mais lê. Ela deve terminar em AÇÃO: o documento que falta, a pergunta a fazer ao cliente, o pedido a incluir. "Depende do caso" não é conselho.
- Se o histórico do escritório for pequeno, trate-o como pista, não como prova — e diga isso.
- RESPEITE A INSTÂNCIA de cada fonte. Sentença de juiz singular prevê a vara; só decisão de órgão colegiado sustenta "o tribunal entende". Se o conselho depende de como a 2ª instância decide e o recorte não tem acórdão, diga que essa parte está em aberto em vez de responder com sentença.
- Não prometa resultado. Você descreve padrão; quem decide é o advogado.
- Português do Brasil, direto, sem saudação.`;

export type ModoPesquisa = "pesquisar" | "estrategia";

export interface ResultadoPesquisa {
  ok: boolean;
  resposta: RespostaJurisIA | null;
  recusa: string | null;
  fontes: FonteRecorte[];
  filtro: FiltroRecorte;
  descricaoFiltro: string;
  estatistica: EstatisticaRecorte;
  /**
   * Perfil temporal e procedimental. NÃO vai pro contexto do modelo de
   * propósito: é número, e número é da tela. Mandar pra ele só criaria a
   * tentação de reescrever a mediana com outras palavras.
   */
  perfil: PerfilRecorte | null;
  /** true quando nem chegou a consultar o modelo de resposta. */
  semBase: boolean;
  /** Só no modo estratégia: o cruzamento com o histórico do escritório. */
  comparacao: Comparacao | null;
  /** Quanto do recorte é acórdão e quanto é sentença de 1º grau. */
  natureza: ComposicaoNatureza;
  /** A ressalva que a tela mostra. null quando não há o que ressalvar. */
  avisoNatureza: string | null;
}

const ESTATISTICA_VAZIA: EstatisticaRecorte = {
  total: 0,
  comResultado: 0,
  emAndamento: 0,
  fatias: [],
  amostraPequena: true,
};

const NATUREZA_VAZIA: ComposicaoNatureza = {
  jurisprudencia: 0,
  estatistica: 0,
  indefinido: 0,
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
    perfil: null,
    semBase: true,
    comparacao: null,
    natureza: NATUREZA_VAZIA,
    avisoNatureza: null,
  };
}

export async function pesquisarNoAcervo(args: {
  escritorioId: number;
  pergunta: string;
  modo?: ModoPesquisa;
  historico?: Array<{ papel: "usuario" | "assistente"; texto: string }>;
}): Promise<ResultadoPesquisa> {
  const modo: ModoPesquisa = args.modo ?? "pesquisar";
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

  // Só depois de saber que o recorte existe: perfil de recorte vazio é query
  // gasta pra devolver nada.
  const perfil = recorte.estatistica.comResultado > 0 ? await perfilDoRecorte(filtro) : null;

  // O histórico do escritório é reclassificado com o MESMO classificador do
  // acervo — `eventos_processo.desfecho` é relativo ao polo e compará-lo com
  // "procedente" seria erro de unidade.
  const comparacao = modo === "estrategia"
    ? await (async () => {
      const { historicoDoEscritorio } = await import("./historico-escritorio");
      const h = await historicoDoEscritorio(args.escritorioId, filtro);
      return compararComAcervo(recorte.estatistica, h.estatistica);
    })()
    : null;

  const ctx = montarContextoRecorte(recorte.processos);
  if (ctx.fontes.length === 0) {
    return semBase(
      filtro,
      recorte.estatistica,
      `O recorte ${descreverFiltro(filtro)} existe no acervo, mas nenhum processo dele pôde ser citado.`,
    );
  }

  const blocoEscritorio = comparacao && comparacao.escritorioTotal > 0
    ? [
      "",
      "HISTÓRICO DESTE ESCRITÓRIO EM CASOS DO MESMO TIPO:",
      `${comparacao.escritorioTotal} caso(s), ${comparacao.escritorioDecididos} já decidido(s).`,
      comparacao.destaque
        ? `Diferença que se destaca: ${comparacao.destaque.resultado} — o escritório fica ${comparacao.destaque.diferencaPp > 0 ? "acima" : "abaixo"} do tribunal.`
        : comparacao.amostraPequena
          ? "Amostra pequena demais pra afirmar diferença em relação ao tribunal."
          : "Sem diferença relevante em relação ao tribunal.",
    ].join("\n")
    : "";

  const user = [
    `RECORTE: ${descreverFiltro(filtro)}`,
    "",
    "PROCESSOS DO RECORTE:",
    ctx.texto,
    blocoEscritorio,
    conversa ? `\nCONVERSA ATÉ AQUI:\n${conversa}` : "",
    `\nPERGUNTA DO ADVOGADO:\n${args.pergunta}`,
  ]
    .filter(Boolean)
    .join("\n");

  const bruto = await chamarIA({
    escritorioId: args.escritorioId,
    system: modo === "estrategia" ? SYSTEM_ESTRATEGIA : SYSTEM_RESPONDER,
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
    perfil,
    semBase: false,
    comparacao,
    natureza: recorte.natureza,
    avisoNatureza: avisoDeNatureza(recorte.natureza),
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
