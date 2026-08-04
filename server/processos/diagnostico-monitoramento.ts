/**
 * Diagnóstico do monitoramento de processos.
 *
 * A aba mostrava 418 cards vermelhos iguais, cada um com a mensagem crua da
 * exceção escondida dentro do card expandido. Mas 418 cards não são 418
 * problemas: quase sempre são UM problema (a credencial do Cofre caiu)
 * repetido centenas de vezes. Agrupar por causa transforma uma lista
 * intratável em uma frase e um botão.
 *
 * Por isso a classificação vive aqui, separada da tela: ela é o que decide o
 * texto, a cor, a ação sugerida e o agrupamento — e precisa de teste, porque
 * é feita em cima de string de erro, que muda quando o tribunal muda.
 */

export type CausaMonitor =
  | "sessao_expirada"
  | "sem_credencial"
  | "tribunal_sem_suporte"
  | "processo_nao_encontrado"
  | "documento_invalido"
  | "desconhecida";

export type Severidade = "alerta" | "aviso";

export type Causa = {
  causa: CausaMonitor;
  /** Frase da linha da lista — o motivo em português, não a exceção. */
  motivo: string;
  severidade: Severidade;
  /** Manchete do bloco de diagnóstico, com {n} trocado pela contagem. */
  titulo: string;
  /** O parágrafo que explica a consequência e o que resolve. */
  explicacao: string;
  /** Rótulo do botão principal; `null` quando não há ação de um clique só. */
  acao: string | null;
  /** Aba de destino do botão, dentro do módulo Processos. */
  destino: "cofre" | "lista" | null;
};

const CATALOGO: Record<CausaMonitor, Omit<Causa, "causa">> = {
  sessao_expirada: {
    motivo: "Credencial do Cofre expirada — o robô não consegue entrar no tribunal",
    severidade: "alerta",
    titulo: "{n} processos pararam de atualizar",
    explicacao:
      "A credencial cadastrada no Cofre perdeu a sessão no tribunal. Enquanto ela não for " +
      "revalidada, o robô não consegue entrar e nenhuma movimentação nova chega — nem aqui, " +
      "nem na Agenda, nem no resumo diário. Revalidar resolve todos de uma vez.",
    acao: "Revalidar no Cofre",
    destino: "cofre",
  },
  sem_credencial: {
    motivo: "Sem credencial vinculada — escolha qual OAB o robô deve usar",
    severidade: "alerta",
    titulo: "{n} processos sem credencial vinculada",
    explicacao:
      "Esses monitoramentos não têm uma credencial do Cofre associada, então não há com o que " +
      "entrar no sistema do tribunal. Cadastre ou vincule uma credencial da OAB responsável.",
    acao: "Abrir o Cofre",
    destino: "cofre",
  },
  tribunal_sem_suporte: {
    motivo: "Tribunal ainda não suportado pelo robô",
    severidade: "aviso",
    titulo: "{n} processos em tribunal ainda não suportado",
    explicacao:
      "Ainda não temos robô para esse tribunal. O processo fica cadastrado e volta a atualizar " +
      "sozinho assim que o suporte entrar no ar — não é preciso fazer nada.",
    acao: null,
    destino: null,
  },
  processo_nao_encontrado: {
    motivo: "Número não encontrado no tribunal — confira o CNJ",
    severidade: "aviso",
    titulo: "{n} processos não encontrados no tribunal",
    explicacao:
      "O tribunal respondeu, mas não localizou esses números. Costuma ser dígito trocado no CNJ, " +
      "processo em segredo de justiça ou processo que mudou de tribunal.",
    acao: "Conferir os números",
    destino: "lista",
  },
  documento_invalido: {
    motivo: "CPF/CNPJ inválido no cadastro do monitoramento",
    severidade: "aviso",
    titulo: "{n} monitoramentos com CPF/CNPJ inválido",
    explicacao:
      "O documento cadastrado não tem 11 dígitos (CPF) nem 14 (CNPJ), então a busca por parte " +
      "nem chega a ser feita. Corrigir o documento religa o monitoramento.",
    acao: "Conferir os documentos",
    destino: "lista",
  },
  desconhecida: {
    motivo: "Falha na última consulta ao tribunal",
    severidade: "aviso",
    titulo: "{n} processos com falha na última consulta",
    explicacao:
      "A consulta falhou por um motivo que ainda não sabemos agrupar — instabilidade do tribunal, " +
      "captcha ou mudança na página. Tentar atualizar costuma resolver; se insistir, abra o " +
      "processo para ver a mensagem que o tribunal devolveu.",
    acao: "Atualizar todos",
    destino: "lista",
  },
};

/**
 * A ordem importa: "sessão expirada" e "credencial não vinculada" citam ambas
 * a palavra credencial, e o teste mais específico precisa vir primeiro.
 */
const REGRAS: Array<{ causa: CausaMonitor; re: RegExp }> = [
  { causa: "sessao_expirada", re: /sess[aã]o.*(expir|caiu|redirec)|redirec.*login|credencial.*(expir|ca[ií]|inv[aá]lid)|Cofre.*Validar/i },
  { causa: "sem_credencial", re: /credencial\s+n[aã]o\s+vinculada|sem\s+credencial/i },
  { causa: "tribunal_sem_suporte", re: /sem\s+adapter|adapter\s+.*n[aã]o\s+encontrado|n[aã]o\s+suportado/i },
  { causa: "processo_nao_encontrado", re: /n[aã]o\s+localizou|n[aã]o\s+(foi\s+)?encontrado|inexistente|CNJ\s+n[aã]o\s+encontrado/i },
  { causa: "documento_invalido", re: /documento\s+inv[aá]lido|esperava\s+11\s+d[ií]gitos/i },
];

export function classificarErroMonitor(ultimoErro: string | null | undefined): Causa | null {
  const msg = (ultimoErro ?? "").trim();
  if (!msg) return null;
  for (const r of REGRAS) {
    if (r.re.test(msg)) return { causa: r.causa, ...CATALOGO[r.causa] };
  }
  return { causa: "desconhecida", ...CATALOGO.desconhecida };
}

export type GrupoDiagnostico = Causa & { total: number };

/**
 * Agrupa os monitoramentos quebrados por causa, do maior para o menor.
 *
 * Só o maior grupo vira bloco de destaque na tela; o resto é resumido numa
 * linha. Com três blocos grandes ninguém lê nenhum.
 */
export function agruparDiagnostico(
  erros: Array<string | null | undefined>,
): { grupos: GrupoDiagnostico[]; total: number } {
  const mapa = new Map<CausaMonitor, GrupoDiagnostico>();
  let total = 0;
  for (const e of erros) {
    const c = classificarErroMonitor(e);
    if (!c) continue;
    total++;
    const atual = mapa.get(c.causa);
    if (atual) atual.total++;
    else mapa.set(c.causa, { ...c, total: 1 });
  }
  const grupos = [...mapa.values()].sort((a, b) => b.total - a.total);
  return { grupos, total };
}

/** "{n} processos pararam" → "412 processos pararam". */
export function tituloComTotal(g: GrupoDiagnostico): string {
  return g.titulo.replace("{n}", String(g.total));
}
