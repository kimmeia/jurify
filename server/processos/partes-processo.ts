/**
 * Partes do processo para exibição.
 *
 * O monitoramento já coleta a capa (e persiste em `motor_monitoramentos
 * .partes_json`), mas a UI de movimentações mostrava só o apelido — e quando
 * o monitoramento não tem apelido, caía no CNJ. Resultado: o card exibia o
 * mesmo número duas vezes e não dizia de quem era o processo.
 *
 * Quem lê a movimentação precisa de "Fulano × Banco Tal" antes de qualquer
 * outra coisa: é assim que o advogado reconhece o caso.
 */

export type PoloParte = "ativo" | "passivo" | "terceiro";

export type ParteResumo = {
  nome: string;
  polo: PoloParte;
  documento: string | null;
};

export type PartesDoProcesso = {
  autores: string[];
  reus: string[];
  /** "Fulano × Banco Tal" — o jeito como o advogado se refere ao caso. */
  rotulo: string | null;
  /** Quem é o NOSSO cliente, quando dá pra identificar. */
  cliente: string | null;
  clientePolo: PoloParte | null;
};

const VAZIO: PartesDoProcesso = {
  autores: [],
  reus: [],
  rotulo: null,
  cliente: null,
  clientePolo: null,
};

function digitos(s: string | null | undefined): string {
  return (s ?? "").replace(/\D/g, "");
}

function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Tolerante a JSON quebrado e a formatos antigos — nunca lança. */
export function parsearPartes(json: string | null | undefined): ParteResumo[] {
  if (!json) return [];
  let bruto: unknown;
  try {
    bruto = JSON.parse(json);
  } catch {
    return [];
  }
  // Já houve formato { partes: [...] } e formato array puro.
  const lista = Array.isArray(bruto)
    ? bruto
    : Array.isArray((bruto as { partes?: unknown })?.partes)
      ? (bruto as { partes: unknown[] }).partes
      : [];

  const out: ParteResumo[] = [];
  for (const p of lista) {
    const o = p as Record<string, unknown>;
    const nome = typeof o?.nome === "string" ? o.nome.trim() : "";
    if (!nome) continue;
    const polo: PoloParte =
      o?.polo === "passivo" ? "passivo" : o?.polo === "terceiro" ? "terceiro" : "ativo";
    out.push({
      nome: nome.slice(0, 160),
      polo,
      documento: typeof o?.documento === "string" ? o.documento : null,
    });
  }
  return out;
}

/**
 * Encurta nome de parte para caber num card sem virar sopa de letras.
 * Mantém primeiro e último nome — é como o processo é citado na prática.
 */
export function nomeCurto(nome: string, maxPalavras = 3): string {
  const partes = nome.trim().split(/\s+/);
  // 3 palavras cobre razão social curta ("Banco Exemplo S/A") sem cortar;
  // acima disso é nome de pessoa, e "Maria … Nascimento" já identifica.
  if (partes.length <= maxPalavras) return nome.trim();
  return `${partes[0]} ${partes[partes.length - 1]}`;
}

/**
 * Monta o resumo das partes e identifica o cliente.
 *
 * A identificação segue a mesma ordem de confiança do polo-matcher: documento
 * bate > nome bate com o apelido > desconhecido. Chutar "o autor é o nosso
 * cliente" seria errado com frequência — metade da carteira de um escritório
 * costuma ser defesa.
 */
export function resumirPartes(
  partes: ParteResumo[],
  opts?: { searchKey?: string | null; apelido?: string | null },
): PartesDoProcesso {
  if (!partes.length) {
    // Sem capa coletada ainda: o apelido, quando existe, é o melhor que temos.
    const apelido = opts?.apelido?.trim();
    return apelido ? { ...VAZIO, cliente: apelido } : VAZIO;
  }

  const autores = partes.filter((p) => p.polo === "ativo").map((p) => p.nome);
  const reus = partes.filter((p) => p.polo === "passivo").map((p) => p.nome);

  const rotulo =
    autores.length && reus.length
      ? `${nomeCurto(autores[0])} × ${nomeCurto(reus[0])}`
      : autores.length
        ? nomeCurto(autores[0])
        : reus.length
          ? nomeCurto(reus[0])
          : null;

  // 1) documento da busca bate com o de alguma parte
  const chave = digitos(opts?.searchKey);
  let cliente: ParteResumo | undefined;
  if (chave.length >= 11) {
    cliente = partes.find((p) => digitos(p.documento) && digitos(p.documento) === chave);
  }

  // 2) apelido do monitoramento bate com o nome de alguma parte
  if (!cliente && opts?.apelido) {
    const alvo = normalizar(opts.apelido);
    if (alvo.length >= 4) {
      cliente =
        partes.find((p) => normalizar(p.nome) === alvo) ??
        partes.find((p) => normalizar(p.nome).includes(alvo) || alvo.includes(normalizar(p.nome)));
    }
  }

  return {
    autores,
    reus,
    rotulo,
    cliente: cliente?.nome ?? opts?.apelido?.trim() ?? null,
    clientePolo: cliente?.polo ?? null,
  };
}
