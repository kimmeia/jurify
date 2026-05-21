/**
 * Identifica o polo (ativo/passivo/terceiro) do cliente monitorado dentro
 * da lista de partes retornada pelo scraper de detalhe.
 *
 * Usado pelo cron de "novas ações" para evitar alertar quando o próprio
 * cliente é o autor da ação (polo ativo). O caso de uso real é:
 * "alguém entrou COM uma ação CONTRA meu cliente" — só polo passivo
 * (e terceiros interessados) interessam.
 *
 * Estratégia de match em duas camadas:
 *   1. Por documento (CPF/CNPJ sanitizado) — preferido, exato.
 *   2. Por nome (NFD-normalizado, sem pontuação) — fallback quando o
 *      scraper não conseguiu extrair o documento da parte (o PJe TJCE
 *      às vezes mostra só o nome).
 *
 * Se o cliente aparece em mais de um polo (raro mas acontece em ações
 * com múltiplas partes do mesmo CPF), prioriza passivo > terceiro >
 * ativo — qualquer ocorrência em passivo já justifica o alerta.
 */

export type Polo = "ativo" | "passivo" | "terceiro";
export type PoloIdentificado = Polo | "desconhecido";

export interface ParteParaMatch {
  nome: string;
  polo: Polo;
  documento: string | null;
}

/**
 * Normaliza nome pra comparação tolerante a variações de caixa, acentos
 * e pontuação. "Maria José da Silva" e "MARIA JOSE DA SILVA" colapsam
 * pro mesmo valor.
 */
export function normalizarNome(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // diacritics block
    .toLowerCase()
    .replace(/[^\p{L}\s]/gu, " ") // mantém letras (qualquer alfabeto) e espaços
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Mantém só os dígitos. Aceita formato livre ("123.456.789-00",
 * "12345678900", "CPF: 123.456.789-00").
 */
export function digitosDe(documento: string | null | undefined): string {
  return (documento ?? "").replace(/\D/g, "");
}

/**
 * Decide se dois nomes representam a mesma pessoa.
 *
 * Critérios (em ordem):
 *   1. Igualdade exata após normalização.
 *   2. Um contém o outro (com >= 10 chars no menor) — cobre variações
 *      tipo "MARIA SILVA" vs "MARIA SILVA SANTOS".
 *
 * Não usa fuzzy distance (Levenshtein etc) pra evitar match acidental
 * entre nomes parecidos ("João Silva" vs "Pedro Silva").
 */
export function nomesIguais(a: string, b: string): boolean {
  const na = normalizarNome(a);
  const nb = normalizarNome(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // Containment só com nome longo o suficiente pra não dar match
  // espúrio (primeiro nome curto numa string maior).
  const menor = na.length <= nb.length ? na : nb;
  const maior = menor === na ? nb : na;
  if (menor.length >= 10 && maior.includes(menor)) return true;
  return false;
}

/**
 * Identifica em qual polo o cliente está, ou "desconhecido" se não
 * conseguiu match.
 *
 * @param apelido Nome do cliente (do contato, salvo em motor_monitoramentos.apelido).
 *                Pode ser null em monitoramentos legados — neste caso
 *                só conta o match por documento.
 * @param searchKey CPF/CNPJ do cliente sem máscara (já sanitizado pelo backend).
 * @param partes Lista de partes do processo extraída do detail scrape.
 *
 * @returns "passivo" | "terceiro" | "ativo" | "desconhecido"
 *   - "desconhecido" significa "scraper não confirmou em nenhum polo"
 *     — o caller decide o que fazer (hoje: tratar como relevante por
 *     segurança).
 */
export function identificarPoloDoCliente(
  apelido: string | null | undefined,
  searchKey: string,
  partes: ParteParaMatch[],
): PoloIdentificado {
  if (!Array.isArray(partes) || partes.length === 0) return "desconhecido";

  const searchKeyDigitos = digitosDe(searchKey);
  const polosEncontrados = new Set<Polo>();

  // Camada 1: match por documento (preferido)
  for (const parte of partes) {
    const docDigitos = digitosDe(parte.documento);
    if (docDigitos && searchKeyDigitos && docDigitos === searchKeyDigitos) {
      polosEncontrados.add(parte.polo);
    }
  }

  // Camada 2: match por nome (só se não achou por documento)
  if (polosEncontrados.size === 0 && apelido) {
    for (const parte of partes) {
      if (nomesIguais(apelido, parte.nome)) {
        polosEncontrados.add(parte.polo);
      }
    }
  }

  if (polosEncontrados.size === 0) return "desconhecido";

  // Prioridade: passivo > terceiro > ativo. Cliente aparecendo como
  // passivo (mesmo que também apareça como ativo, ex: reconvenção) é
  // alerta válido.
  if (polosEncontrados.has("passivo")) return "passivo";
  if (polosEncontrados.has("terceiro")) return "terceiro";
  return "ativo";
}
