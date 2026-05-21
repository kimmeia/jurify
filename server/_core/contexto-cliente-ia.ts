/**
 * Monta o bloco de contexto do cliente pra injetar no system prompt da IA.
 *
 * O fluxo de captura automática salva valores em `contatos.camposPersonalizados`,
 * mas a IA do SmartFlow não os lia — então repetia perguntas mesmo após o cliente
 * já ter respondido. Este helper resolve isso, gerando uma string segura e
 * tamanho-controlada pra anexar no fim do system prompt.
 *
 * Garantias (defesa em profundidade):
 *  - Input inválido (null/empty/JSON malformado) → retorna ""
 *  - Chaves com nome sensível (CPF, RG, cartão, senha, token) → puladas
 *  - Valores null/empty/whitespace → pulados
 *  - Total truncado em 2000 chars
 *  - Formata por tipo: data BR, boolean Sim/Não, número BR
 */

const CHAVES_SENSIVEIS = [
  "cpf", "cnpj", "rg", "cnh", "passaporte",
  "senha", "password", "token", "secret", "api_key", "apikey",
  "cartao", "cartão", "credit_card", "ccnumber",
  "ssn", "tax_id",
];

const LIMITE_CHARS = 2000;

export interface DefinicaoCampo {
  chave: string;
  label: string;
  tipo: string; // "texto" | "numero" | "data" | "textarea" | "select" | "boolean"
}

/**
 * Verifica se a chave de um campo personalizado é considerada sensível.
 * Match contém (não exact), case-insensitive, contra a blacklist.
 */
export function ehChaveSensivel(chave: string): boolean {
  const c = chave.toLowerCase();
  return CHAVES_SENSIVEIS.some((alvo) => c.includes(alvo));
}

/**
 * Formata um valor pra exibição humana baseado no tipo do campo.
 * Tolera tipos não conhecidos retornando String(valor).
 */
export function formatarValorParaPrompt(valor: unknown, tipo: string): string {
  if (valor === null || valor === undefined) return "";
  const s = String(valor).trim();
  if (!s) return "";

  switch (tipo) {
    case "boolean":
      if (s === "true" || s.toLowerCase() === "sim") return "Sim";
      if (s === "false" || s.toLowerCase() === "não" || s.toLowerCase() === "nao") return "Não";
      return s;
    case "data": {
      const match = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (match) return `${match[3]}/${match[2]}/${match[1]}`;
      return s;
    }
    case "numero": {
      // Detecta formato: se tem vírgula, é BR (ponto = milhar, vírgula = decimal).
      // Se só tem ponto(s), é ISO (ponto = decimal).
      const limpo = s.includes(",")
        ? s.replace(/\./g, "").replace(",", ".")
        : s;
      const n = Number(limpo);
      if (Number.isFinite(n)) {
        return new Intl.NumberFormat("pt-BR").format(n);
      }
      return s;
    }
    default:
      return s;
  }
}

/**
 * Constrói o bloco de contexto. Empty input (null/JSON inválido/sem campos
 * válidos) → empty output (string vazia), pra não alterar o prompt em nada.
 */
export function montarContextoCliente(
  camposPersonalizados: string | null | undefined,
  definicoes: DefinicaoCampo[],
): string {
  if (!camposPersonalizados || !definicoes || definicoes.length === 0) return "";

  let valores: Record<string, unknown>;
  try {
    const parsed = JSON.parse(camposPersonalizados);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "";
    valores = parsed as Record<string, unknown>;
  } catch {
    return "";
  }

  const linhas: string[] = [];
  for (const def of definicoes) {
    if (ehChaveSensivel(def.chave)) continue;
    const v = valores[def.chave];
    const formatado = formatarValorParaPrompt(v, def.tipo);
    if (!formatado) continue;
    linhas.push(`- ${def.label}: ${formatado}`);
  }

  if (linhas.length === 0) return "";

  const cabecalho = "## Dados já coletados deste cliente nesta conversa";
  const instrucao = "IMPORTANTE: use estes dados pra evitar perguntar de novo. Avance pra próxima etapa do atendimento.";

  const blocoCompleto = [cabecalho, ...linhas, "", instrucao].join("\n");
  if (blocoCompleto.length <= LIMITE_CHARS) return blocoCompleto;

  // Excede: monta versão truncada preservando cabeçalho e instrução final.
  // Calcula quantas linhas cabem entre cabeçalho e instrução (com margem pra
  // marcador "[…]" indicando truncamento).
  const marcador = "[…]";
  const fixosLen = cabecalho.length + 1 + 1 + instrucao.length + marcador.length + 2; // newlines
  const orcamentoLinhas = LIMITE_CHARS - fixosLen;

  const linhasCabidas: string[] = [];
  let usado = 0;
  for (const linha of linhas) {
    if (usado + linha.length + 1 > orcamentoLinhas) break;
    linhasCabidas.push(linha);
    usado += linha.length + 1;
  }

  return [cabecalho, ...linhasCabidas, marcador, "", instrucao].join("\n");
}
