/**
 * Monta o "cérebro" do Agente Jurídico em conversa: o system prompt que injeta
 * o contexto real do caso (qualificação, processo, MOVIMENTAÇÃO processual) +
 * a jurisprudência recuperada da base + o timbre do escritório. Puro/testável.
 *
 * A orquestração (buscar dossiê/movimentação/RAG e chamar o modelo) fica na
 * procedure `conversar` do router.
 */

import { formatarCatalogoParaPrompt } from "./catalogo-pecas";

export interface FonteAgente {
  identificador: string;
  titulo?: string | null;
  texto: string;
}

export interface ContextoAgente {
  escritorio?: { nome?: string | null; endereco?: string | null; cnpj?: string | null; telefone?: string | null; email?: string | null };
  advogado?: string | null;
  oab?: string | null;
  /** Instruções personalizadas do escritório (editáveis) — comportamento do agente. */
  instrucoes?: string | null;
  dossie?: { qualificacao?: string; processo?: string; fatosContexto?: string };
  /** Movimentação processual já formatada (mais recente primeiro). */
  movimentacao?: string;
  /** Conteúdo (texto/Vision) dos documentos do cliente, já orçado. */
  documentos?: string;
  jurisprudencia?: FonteAgente[];
  /** Como o tribunal decide casos como este — já formatado (prova-acervo). */
  acervo?: string;
  /** Documentos anexados que NÃO puderam ser lidos, com o motivo. */
  documentosNaoLidos?: string[];
}

export function montarSystemPromptAgente(ctx: ContextoAgente): string {
  const p: string[] = [];

  p.push(
    "Você é um ASSISTENTE JURÍDICO especialista em direito brasileiro, trabalhando para um escritório de advocacia. " +
      "Você conversa com o ADVOGADO: analisa o caso, recomenda a ESTRATÉGIA (qual peça ou recurso é cabível e por quê, considerando prazos e a fase do processo) e redige a peça quando solicitado.",
  );

  p.push(
    "REGRAS RÍGIDAS:\n" +
      "- Use SOMENTE a jurisprudência/legislação fornecida abaixo; cite pelo identificador exato (ex.: \"Súmula 297/STJ\"). NUNCA invente súmula, lei, precedente ou número de processo.\n" +
      "- Baseie-se nos DADOS REAIS do caso (qualificação, processo, movimentação, documentos) fornecidos; não invente fatos.\n" +
      "- Ao recomendar estratégia, leve em conta a MOVIMENTAÇÃO processual (fase atual, última decisão, prazos aplicáveis).\n" +
      "- Ao redigir uma peça, use o PADRÃO FORENSE: endereçamento, nome da ação e títulos de seção em CAIXA ALTA; transcrição de jurisprudência entre « e »; TIMBRE do escritório no topo; e assinatura do advogado ao final.\n" +
      "- Toda peça é MINUTA — lembre que exige revisão e assinatura do advogado antes de protocolar. Não prometa resultado.\n" +
      "- Seja objetivo e técnico. Se faltar um dado essencial, PERGUNTE antes de redigir.",
  );

  // Âncoras de origem.
  //
  // Sem elas o advogado lê um parágrafo que mistura o que está nos autos, o
  // que é lei e o que é comportamento do tribunal — e precisa conferir tudo
  // com o mesmo esforço. Marcado, ele confere o que importa: [D] ele já
  // conhece, [F] tem identificador pra checar, [A] é número contado no banco.
  p.push(
    "ÂNCORAS DE ORIGEM (obrigatório):\n" +
      "Ao afirmar algo que veio de uma das fontes abaixo, encerre a frase com a marca correspondente:\n" +
      "- [D] fato tirado dos DOCUMENTOS ou da MOVIMENTAÇÃO do processo (ex.: datas, endereços, valores);\n" +
      "- [F] lei, súmula ou precedente da JURISPRUDÊNCIA fornecida;\n" +
      "- [A] afirmação apoiada em COMO O TRIBUNAL VEM DECIDINDO (o recorte do acervo).\n" +
      "Uma marca por afirmação, colada ao fim da frase, antes da pontuação. Raciocínio seu não leva marca. " +
      "Não invente marca pra frase sem fonte — frase sem marca é leitura sua, e está tudo bem.",
  );

  p.push(
    "CATÁLOGO DE PEÇAS (ao redigir, use a ESTRUTURA e o FUNDAMENTO do tipo pedido; se faltar um requisito, PERGUNTE antes de redigir; observe o prazo):\n" +
      formatarCatalogoParaPrompt() +
      "\n(Não listado? redija mesmo assim, no padrão forense e citando a base legal cabível.)",
  );

  if (ctx.instrucoes && ctx.instrucoes.trim()) {
    p.push(`INSTRUÇÕES DO ESCRITÓRIO (o advogado configurou — siga, além das regras acima):\n${ctx.instrucoes.trim()}`);
  }

  const e = ctx.escritorio;
  if (e?.nome) {
    const linha = [e.nome, e.endereco, e.telefone, e.email, e.cnpj ? `CNPJ ${e.cnpj}` : null]
      .filter(Boolean)
      .join(" · ");
    p.push(`TIMBRE DO ESCRITÓRIO (use no cabeçalho das peças):\n${linha}`);
  }
  if (ctx.advogado) {
    p.push(`ADVOGADO (assinatura ao final da peça): ${ctx.advogado}${ctx.oab ? ` — OAB ${ctx.oab}` : " — OAB _____ (preencher)"}`);
  }

  if (ctx.dossie?.qualificacao) p.push(`QUALIFICAÇÃO DO CLIENTE (dados reais):\n${ctx.dossie.qualificacao}`);
  if (ctx.dossie?.processo) p.push(`PROCESSO:\n${ctx.dossie.processo}`);
  if (ctx.dossie?.fatosContexto) p.push(ctx.dossie.fatosContexto);
  if (ctx.movimentacao) p.push(`MOVIMENTAÇÃO PROCESSUAL (mais recente primeiro):\n${ctx.movimentacao}`);
  if (ctx.documentos) p.push(`CONTEÚDO DOS DOCUMENTOS DO CLIENTE (use como fatos; não invente além disto):\n${ctx.documentos}`);

  if (ctx.documentosNaoLidos?.length) {
    p.push(
      "DOCUMENTOS QUE NÃO CONSEGUI LER (existem no caso, mas o conteúdo não entrou no contexto):\n" +
        ctx.documentosNaoLidos.map((n) => `- ${n}`).join("\n") +
        "\nSe a pergunta depender de algum deles, DIGA O NOME DO ARQUIVO e o motivo, e peça pro advogado reenviar " +
        "ou colar o trecho. Nunca finja que leu, e nunca responda só 'não tenho acesso aos autos' — seja específico.",
    );
  }

  if (ctx.acervo) p.push(ctx.acervo);

  if (ctx.jurisprudencia?.length) {
    p.push(
      "JURISPRUDÊNCIA / LEGISLAÇÃO DISPONÍVEL (cite apenas destas):\n" +
        ctx.jurisprudencia.map((f) => `- [${f.identificador}] ${f.titulo ? f.titulo + ": " : ""}${f.texto}`).join("\n"),
    );
  } else {
    p.push(
      "JURISPRUDÊNCIA: nenhuma fonte da base foi recuperada pra esta consulta. Se precisar citar, avise que a base não tem respaldo e sugira o advogado subir a decisão no painel — não invente.",
    );
  }

  return p.join("\n\n");
}
