/**
 * Uma conversa só.
 *
 * Antes eram três: "Pesquisar" (acervo público, resposta estruturada com
 * fonte), "Estratégia" (o mesmo acervo cruzado com o histórico do escritório) e
 * "Redigir peça" (dossiê + autos + documentos + base do escritório, texto
 * livre). O advogado tinha que saber, ANTES de perguntar, qual dos três
 * responderia — e escolher errado devolvia recusa: perguntar sobre o caso no
 * modo Pesquisa caía em "preciso de um recorte pra pesquisar".
 *
 * Aqui quem escolhe é o servidor, e ele escolhe TUDO que couber. O recorte do
 * acervo sai da própria pergunta quando ela nomeia tribunal ou tipo de ação, e
 * do processo do cliente quando não nomeia. Nenhum dos dois? A conversa
 * responde com o que tem — o que sumiu foi a recusa, não a fonte.
 *
 * Três invariantes atravessam o arquivo:
 *
 *  1. o NÚMERO do acervo vem de contagem em SQL e o modelo é proibido de
 *     reescrevê-lo (a tela mostra o que saiu do banco);
 *  2. processo do acervo é estatística, não precedente citável — e sentença de
 *     1º grau não vira fundamento de peça;
 *  3. a checagem que falha vira AVISO visível, não descarte silencioso: a
 *     resposta traz peça e análise juntas, e jogar tudo fora por uma frase
 *     perde o trabalho inteiro sem dizer o porquê.
 */

import { chamarIA } from "../_core/ai-call";
import { escritorios } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { montarDossie, montarMovimentacao } from "../juridico/dossie";
import { garantirConteudoDocs } from "../juridico/leitura-documento";
import { montarSystemPromptAgente } from "../juridico/agente-conversa";
import { conversarLLMEscritorio } from "../juridico/llm";
import { recorteDoCaso } from "../juridico/prova-acervo";
import { gerarEmbedding } from "../juridico/embeddings";
import { recuperarFontes } from "../juridico/base";
import { resolverAPIKey } from "../integracoes/router-agentes-ia";
import type { ConsultaFeita } from "../../shared/jurisia-una";
import {
  contemNumeroInventado,
  descreverFiltro,
  filtroVazio,
  montarContextoRecorte,
  normalizarFiltro,
  rotuloResultado,
  type EstatisticaRecorte,
  type FiltroRecorte,
  type FonteRecorte,
} from "../../shared/jurisia-recorte";
import { compararComAcervo, type Comparacao } from "../../shared/jurisia-estrategia";
import { frasearTendencia } from "../../shared/jurisia-tendencia";
import type { ProvaGravada } from "../../shared/jurisia-una";
import { buscarRecorte } from "./buscar-acervo";
import { createLogger } from "../_core/logger";

const log = createLogger("jurisia-una");

/**
 * Quantos processos do recorte entram no contexto.
 *
 * Bem abaixo dos 40 da Pesquisa: lá o recorte era o contexto inteiro, aqui ele
 * divide a janela com o dossiê, a movimentação com teor e o conteúdo dos
 * documentos do cliente. Doze bastam pra descrever o padrão, e o padrão
 * quantitativo já vem contado do banco.
 */
const PROCESSOS_NO_CONTEXTO = 12;

/** Modelo padrão da conversa. Peça longa em modelo barato sai pobre. */
export const MODELO_PADRAO = "gpt-4o";

const SYSTEM_RECORTE = `Você lê a pergunta de um advogado e decide se ela pede uma consulta ao ACERVO PÚBLICO de processos judiciais brasileiros (base do DataJud/CNJ) — e, se pedir, com que recorte.

Devolva JSON:
{
  "tribunal": "TJCE" | null,
  "classeTermo": "..." | null,
  "assuntoTermo": "..." | null,
  "orgaoTermo": "..." | null,
  "desdeAno": 2020 | null
}

Regras:
- Os termos são casados como SUBSTRING do nome oficial (classe processual, assunto da TPU, nome do órgão julgador). Prefira UMA palavra discriminante ou expressão curta, sem artigo e sem plural desnecessário. "revisão" casa melhor que "ação revisional de contrato bancário".
- CLASSE é o VEÍCULO processual: "Apelação", "Execução Fiscal", "Busca e Apreensão em Alienação Fiduciária", "Mandado de Segurança". ASSUNTO é a MATÉRIA discutida: "alimentos", "revisão contratual", "usucapião", "adicional de insalubridade".
- Quando a pergunta juntar os dois — "agravo de busca e apreensão", "apelação em ação de alimentos" — SEPARE: o recurso/ação vai em classeTermo e a matéria vai em assuntoTermo.
- "tribunal" é a sigla (TJCE, TJSP, TRF5, STJ). Só preencha se a pergunta disser o tribunal ou o estado. Nunca deduza.
- Se a pergunta NÃO for sobre como os tribunais decidem — "redija a apelação", "quais documentos faltam", "deixa mais enxuto", "qual o prazo" — devolva todos os campos null. Não force recorte: quem já tem um caso escolhido recebe o recorte do próprio processo dele.
- Campo que a pergunta não determina vai null. Chutar recorte é pior que devolver null.`;

/**
 * Quem manda no recorte.
 *
 * A pergunta ganha da ficha do processo, porque "como o STJ decide isso?" é uma
 * pergunta sobre o STJ mesmo quando o caso aberto corre no TJCE. Quando a
 * pergunta não nomeia tribunal, o do caso completa — tribunal é o único campo
 * que dá pra herdar sem risco: os outros vêm de texto livre digitado pelo
 * advogado e, sobrepostos a um recorte já montado, produzem interseção vazia
 * com mais frequência do que acertam.
 */
export function escolherRecorte(
  daPergunta: FiltroRecorte,
  doCaso: FiltroRecorte | null,
): FiltroRecorte | null {
  if (filtroVazio(daPergunta)) return doCaso;
  if (!daPergunta.tribunal && doCaso?.tribunal) {
    return { ...daPergunta, tribunal: doCaso.tribunal };
  }
  return daPergunta;
}

/**
 * A trava numérica, aplicada só onde ela vale.
 *
 * Na Pesquisa a resposta inteira falava do acervo, e qualquer percentual era
 * invenção. Aqui a mesma resposta pode conter juros de 1% ao mês, prazo de 15
 * dias e fls. 12 de 40 — tudo legítimo, tudo pego pelo detector genérico. O que
 * separa é a marca de origem: o modelo carimba [A] no que veio do acervo, e é
 * só nessas frases que medir é proibido.
 */
export function percentualSobreAcervo(texto: string): string | null {
  for (const frase of texto.split(/(?<=[.!?;:])\s+|\n+/)) {
    if (!frase.includes("[A]")) continue;
    const achado = contemNumeroInventado(frase);
    if (achado) return achado;
  }
  return null;
}

const CNJ_NO_TEXTO = /\b\d{7}-?\d{2}\.?\d{4}\.?\d\.?\d{2}\.?\d{4}\b/g;

/**
 * Processo citado que não estava no contexto.
 *
 * A regra "não invente número de processo" está no prompt desde sempre, e
 * prompt não é garantia. O advogado que lê "conforme o processo 0812345-..."
 * numa minuta assume que aquilo existe; se o número não veio nem do acervo
 * medido nem dos autos do próprio cliente, ele saiu do modelo.
 *
 * Devolve os números órfãos, já normalizados só em dígitos pra comparação (o
 * modelo formata com pontuação ou sem, indiferentemente).
 */
export function cnjsForaDoContexto(texto: string, permitidos: string[]): string[] {
  const conhecidos = new Set(permitidos.map((c) => c.replace(/\D/g, "")).filter(Boolean));
  const orfaos = new Set<string>();
  for (const m of texto.matchAll(CNJ_NO_TEXTO)) {
    const digitos = m[0].replace(/\D/g, "");
    if (digitos.length === 20 && !conhecidos.has(digitos)) orfaos.add(m[0]);
  }
  return [...orfaos];
}

export interface RecorteMedido {
  filtro: FiltroRecorte;
  prova: ProvaGravada;
  /** A estatística crua — é dela que sai o cruzamento com o histórico da casa. */
  estatistica: EstatisticaRecorte;
  /** O que o recorte decide HOJE, em palavras. null quando não deu pra medir. */
  fraseTendencia: string | null;
  /** Os processos, já formatados pro contexto do modelo. */
  texto: string;
  fontes: FonteRecorte[];
  /** CNJs do recorte — o que o modelo pode citar sem virar invenção. */
  cnjs: string[];
}

/**
 * Mede o recorte e formata o que o modelo vai ler.
 *
 * Recorte sem nenhum processo decidido volta null: uma distribuição de zeros
 * ocuparia espaço no prompt pra dizer nada, e na tela viraria um painel de
 * barras vazias ao lado de uma resposta que não falou do acervo.
 */
export async function medirRecorte(filtro: FiltroRecorte): Promise<RecorteMedido | null> {
  try {
    const r = await buscarRecorte(filtro, { maxFontes: PROCESSOS_NO_CONTEXTO });
    if (r.estatistica.comResultado === 0) return null;

    const ctx = montarContextoRecorte(r.processos, { maxFontes: PROCESSOS_NO_CONTEXTO });
    return {
      filtro,
      estatistica: r.estatistica,
      fraseTendencia: r.tendencia ? frasearTendencia(r.tendencia) : null,
      prova: {
        rotulo: [filtro.tribunal?.toUpperCase(), filtro.classeTermo, filtro.assuntoTermo]
          .filter(Boolean)
          .join(" · "),
        descricaoFiltro: descreverFiltro(filtro),
        total: r.estatistica.total,
        comResultado: r.estatistica.comResultado,
        fatias: r.estatistica.fatias.map((f) => ({
          resultado: f.resultado,
          rotulo: rotuloResultado(f.resultado),
          quantidade: f.quantidade,
          percentual: f.percentual,
        })),
        jurisprudencia: r.natureza.jurisprudencia,
        amostraPequena: r.estatistica.amostraPequena,
      },
      texto: ctx.texto,
      fontes: ctx.fontes,
      cnjs: r.processos.slice(0, PROCESSOS_NO_CONTEXTO).map((p) => p.cnj),
    };
  } catch (err) {
    // Acervo fora do ar não derruba a conversa: o caso, os documentos e a base
    // do escritório continuam disponíveis, que é o que ela sempre teve.
    log.warn({ err: String(err), filtro }, "Falha ao medir o recorte");
    return null;
  }
}

/**
 * O bloco do acervo dentro do prompt.
 *
 * Traz o número pra o modelo poder escolher a tese que o recorte sustenta, e
 * proíbe reescrevê-lo. Sem a proibição ele repete "em 81% dos casos" no corpo
 * da peça, e passa a existir na tela um percentual que ninguém contou.
 *
 * Os processos vêm junto porque descrever o padrão exige lê-los — mas com a
 * separação de instância explícita: sentença de vara prevê a vara, não o
 * tribunal, e é essa confusão que o advogado leva pro processo.
 */
export function formatarAcervoParaPrompt(m: RecorteMedido, comparacao?: Comparacao | null): string {
  const linhas = m.prova.fatias
    .filter((f) => f.quantidade > 0)
    .map((f) => `- ${f.rotulo}: ${f.quantidade} de ${m.prova.comResultado}`)
    .join("\n");

  const alerta = m.prova.amostraPequena
    ? "\nATENÇÃO: a amostra é pequena. Trate como indício, não como tese firmada, e diga isso ao advogado."
    : "";

  // Em palavras, não em número: o modelo é proibido de medir, então o que ele
  // recebe sobre a casa já vem qualitativo. Só a tela mostra a diferença em
  // pontos, com o que saiu da contagem.
  const casa = comparacao && comparacao.escritorioTotal > 0
    ? [
      "",
      "HISTÓRICO DESTE ESCRITÓRIO EM CASOS DO MESMO TIPO:",
      comparacao.destaque
        ? `Em ${comparacao.destaque.resultado}, o escritório fica ${comparacao.destaque.diferencaPp > 0 ? "acima" : "abaixo"} do tribunal.`
        : comparacao.amostraPequena
          ? "Amostra pequena demais pra afirmar diferença em relação ao tribunal — trate como pista e diga isso."
          : "Sem diferença relevante em relação ao tribunal.",
    ].join("\n")
    : "";

  // A janela recente manda mais que a média histórica: num tribunal que virou
  // o entendimento, aconselhar pela média antiga é aconselhar pelo lado que
  // perdeu. Vem em palavras porque medir continua sendo proibido.
  const hoje = m.fraseTendencia
    ? `\nO QUE ESTE RECORTE DECIDE HOJE (mais importante que a média acima):\n${m.fraseTendencia}`
    : "";

  return [
    `COMO ESTE TRIBUNAL VEM DECIDINDO CASOS COMO ESTE (acervo público do CNJ — recorte ${m.prova.descricaoFiltro}, ` +
      `${m.prova.comResultado} processos já decididos, ${m.prova.jurisprudencia} deles em segunda instância):`,
    linhas + alerta,
    hoje,
    casa,
    "",
    "PROCESSOS DESTE RECORTE (leia pra descrever o padrão):",
    m.texto,
    "",
    "REGRAS DESTE BLOCO:",
    "- NUNCA escreva percentual, fração ou \"X de Y casos\" numa frase marcada [A]. O número é mostrado à parte, contado no banco. Refira-se assim: \"o recorte deste tribunal sustenta a preliminar\".",
    "- Estes processos são ESTATÍSTICA, não precedente citável: não os use como fundamento de peça nem transcreva ementa deles.",
    "- RESPEITE A INSTÂNCIA. Só decisão de órgão colegiado sustenta \"o tribunal entende\"; sentença de juiz singular mostra como aquela vara costuma decidir e nada além.",
    "- DOIS EIXOS DE DESFECHO, e eles não se misturam. \"Procedente/improcedente\" é o mérito do pedido, julgado na origem. \"Provido/não provido/não conhecido\" é o desfecho do RECURSO: réu que recorre e ganha teve o recurso PROVIDO e o pedido do autor rejeitado. Use a palavra do eixo que a fonte traz.",
    "- \"Não conhecido\" não é derrota no mérito — o recurso nem foi examinado, faltou requisito de admissibilidade. Se é isso que domina o recorte, diga exatamente isso: é a informação mais útil que o advogado pode receber antes de recorrer.",
    "- Não escreva número de processo que não esteja aqui ou nos autos do seu cliente.",
  ].join("\n");
}

/** Traduz a pergunta em recorte. Falha de interpretação vira recorte vazio. */
export async function interpretarRecorte(args: {
  escritorioId: number;
  pergunta: string;
  historico: Array<{ papel: "usuario" | "assistente"; texto: string }>;
}): Promise<FiltroRecorte> {
  const conversa = args.historico
    .slice(-4)
    .map((m) => `${m.papel === "usuario" ? "Advogado" : "Você"}: ${m.texto.slice(0, 400)}`)
    .join("\n");

  try {
    const bruto = await chamarIA({
      escritorioId: args.escritorioId,
      system: SYSTEM_RECORTE,
      user: [conversa ? `CONVERSA ATÉ AQUI:\n${conversa}\n` : "", `PERGUNTA:\n${args.pergunta}`]
        .filter(Boolean)
        .join("\n"),
      json: true,
      maxTokens: 300,
      temperature: 0,
      timeoutMs: 30_000,
    });
    return normalizarFiltro(bruto);
  } catch (err) {
    // Interpretador indisponível não pode virar recusa: sem recorte da
    // pergunta, o do caso assume, e sem caso a conversa responde do mesmo
    // jeito com o que tem.
    log.warn({ err: String(err), escritorioId: args.escritorioId }, "Falha ao interpretar o recorte");
    return normalizarFiltro(null);
  }
}

/**
 * Quantos turnos anteriores vão junto — e por que o último é diferente.
 *
 * "Deixa mais enxuto" só funciona se a peça inteira do turno anterior estiver
 * no contexto; cortá-la faz o modelo reescrever de memória e inventar seções.
 * Os turnos mais antigos entram resumidos: eles servem pra manter o fio da
 * conversa, não pra serem reescritos.
 */
export const TURNOS_NO_CONTEXTO = 8;
const CORTE_TURNO_ANTIGO = 1_500;

export function montarMensagens(
  historico: Array<{ papel: "usuario" | "assistente"; texto: string }>,
  pergunta: string,
): Array<{ role: "user" | "assistant"; content: string }> {
  const recentes = historico.slice(-TURNOS_NO_CONTEXTO).filter((m) => m.texto.trim());
  const ultimoAssistente = recentes.map((m) => m.papel).lastIndexOf("assistente");

  const msgs = recentes.map((m, i) => {
    const inteiro = i === ultimoAssistente || m.texto.length <= CORTE_TURNO_ANTIGO;
    return {
      role: (m.papel === "usuario" ? "user" : "assistant") as "user" | "assistant",
      content: inteiro ? m.texto : `${m.texto.slice(0, CORTE_TURNO_ANTIGO)}\n[…turno anterior abreviado]`,
    };
  });

  msgs.push({ role: "user", content: pergunta });
  return msgs;
}

export interface RespostaUna {
  texto: string;
  erro: string | null;
  prova: ProvaGravada | null;
  consulta: ConsultaFeita;
  naoLidos: string[];
  avisos: string[];
  caso: { nome: string | null; processo: string | null } | null;
}

/** Embeddings são sempre OpenAI; sem chave, a conversa segue sem RAG. */
async function chaveOpenAI(escritorioId: number): Promise<string | null> {
  try {
    const r = await resolverAPIKey(escritorioId, null, "openai");
    return r && r.provider === "openai" ? r.key : null;
  } catch {
    return null;
  }
}

/**
 * Um turno da conversa única.
 *
 * A ordem importa: primeiro o caso (é ele que define o recorte quando a
 * pergunta não define), depois o acervo, depois o modelo. Cada fonte é
 * opcional e nenhuma delas derruba as outras — o que falta vira contagem zero
 * no painel "o que ela consultou", e o que falhou vira aviso na tela.
 */
export async function responderUna(
  db: any,
  args: {
    escritorioId: number;
    escritorioNome: string;
    advogado: string | null;
    pergunta: string;
    historico: Array<{ papel: "usuario" | "assistente"; texto: string }>;
    contatoId?: number | null;
    processoId?: number | null;
    modelo: string;
  },
): Promise<RespostaUna> {
  const dossie = args.contatoId
    ? await montarDossie(db, args.escritorioId, args.contatoId, args.processoId ?? undefined)
    : null;
  const movimentacao = dossie?.cnj
    ? await montarMovimentacao(db, args.escritorioId, dossie.cnj)
    : "";
  const docs = args.contatoId
    ? await garantirConteudoDocs(db, args.escritorioId, args.contatoId, args.modelo)
    : { texto: "", lidos: 0, total: 0, ignorados: 0, notas: [] as string[] };

  // O recorte do acervo: a pergunta manda, o processo do cliente completa.
  const daPergunta = await interpretarRecorte({
    escritorioId: args.escritorioId,
    pergunta: args.pergunta,
    historico: args.historico,
  });
  const filtro = escolherRecorte(daPergunta, dossie?.processoRef ? recorteDoCaso(dossie.processoRef) : null);
  const medido = filtro ? await medirRecorte(filtro) : null;

  // O escritório contra o tribunal. Reclassificado com o MESMO classificador do
  // acervo — `eventos_processo.desfecho` é relativo ao polo e compará-lo com
  // "procedente" seria erro de unidade.
  let comparacao: Comparacao | null = null;
  if (medido) {
    try {
      const { historicoDoEscritorio } = await import("./historico-escritorio");
      const h = await historicoDoEscritorio(args.escritorioId, medido.filtro);
      comparacao = compararComAcervo(medido.estatistica, h.estatistica);
    } catch (err) {
      log.warn({ err: String(err) }, "Falha ao cruzar o histórico do escritório");
    }
  }

  // Base própria do escritório (RAG na pergunta + o processo, quando há).
  let jurisprudencia: Array<{ identificador: string; titulo: string | null; texto: string }> = [];
  const key = await chaveOpenAI(args.escritorioId);
  if (key) {
    try {
      const emb = await gerarEmbedding([args.pergunta, dossie?.processo].filter(Boolean).join("\n"), key);
      const fontes = await recuperarFontes(db, emb, { escritorioId: args.escritorioId, topK: 6 });
      jurisprudencia = fontes.map((f: { identificador: string; titulo: string | null; texto: string }) => ({
        identificador: f.identificador,
        titulo: f.titulo,
        texto: f.texto,
      }));
    } catch {
      /* sem base do escritório a conversa continua */
    }
  }

  const [escRow] = await db
    .select({
      nome: escritorios.nome,
      endereco: escritorios.endereco,
      cnpj: escritorios.cnpj,
      oab: escritorios.oab,
      telefone: escritorios.telefone,
      email: escritorios.email,
      instrucoes: escritorios.instrucoesAgenteJuridico,
    })
    .from(escritorios)
    .where(eq(escritorios.id, args.escritorioId))
    .limit(1);

  const system = montarSystemPromptAgente({
    escritorio: escRow ?? { nome: args.escritorioNome },
    advogado: args.advogado,
    oab: escRow?.oab ?? null,
    instrucoes: escRow?.instrucoes ?? null,
    dossie: dossie ?? undefined,
    movimentacao,
    documentos: docs.texto || undefined,
    jurisprudencia,
    acervo: medido ? formatarAcervoParaPrompt(medido, comparacao) : undefined,
    documentosNaoLidos: docs.notas.length ? docs.notas : undefined,
    semCaso: !dossie,
  });

  const consulta: ConsultaFeita = {
    documentosLidos: docs.lidos,
    documentosTotal: docs.total,
    movimentacoes: movimentacao ? movimentacao.split("\n").filter((l) => l.trim()).length : 0,
    fontesEscritorio: jurisprudencia.length,
    acervo: medido?.prova.comResultado ?? 0,
  };
  const caso = dossie
    ? {
      nome: (dossie.qualificacao?.split("\n")[0] ?? "").replace(/^Nome:\s*/i, "").trim() || null,
      processo: dossie.processo ?? null,
    }
    : null;
  const prova = medido ? { ...medido.prova, comparacao } : null;

  const r = await conversarLLMEscritorio(args.escritorioId, {
    system,
    mensagens: montarMensagens(args.historico, args.pergunta),
    modelo: args.modelo,
  });

  if (!r.texto) {
    return {
      texto: "",
      erro: r.erro || "A IA não respondeu. Tente de novo ou troque o modelo.",
      prova,
      consulta,
      naoLidos: docs.notas,
      avisos: [],
      caso,
    };
  }

  const avisos: string[] = [];
  const numero = medido ? percentualSobreAcervo(r.texto) : null;
  if (numero) {
    avisos.push(
      `A IA escreveu “${numero}” numa afirmação sobre o acervo. O número correto é o do painel abaixo — ele vem de contagem no banco.`,
    );
  }
  const orfaos = cnjsForaDoContexto(r.texto, [...(medido?.cnjs ?? []), dossie?.cnj ?? ""]);
  if (orfaos.length) {
    avisos.push(
      `A IA citou processo que não está nas fontes desta conversa: ${orfaos.join(", ")}. Confira antes de usar.`,
    );
  }
  if (avisos.length) {
    log.warn({ escritorioId: args.escritorioId, avisos }, "Checagem da conversa única acusou");
  }

  return { texto: r.texto, erro: null, prova, consulta, naoLidos: docs.notas, avisos, caso };
}
