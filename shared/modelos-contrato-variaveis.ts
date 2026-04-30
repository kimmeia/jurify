/**
 * Catálogo + resolvedor de variáveis usadas em modelos de contrato.
 *
 * Compartilhado entre backend (server-side rendering do DOCX) e
 * frontend (UI de mapeamento de placeholders no wizard de upload).
 *
 * Convenção:
 *  - Variável é uma string com path tipo `cliente.profissao`,
 *    `cliente.endereco.cidade`, `escritorio.cnpj`, `data.hoje`
 *  - O catálogo é fixo (não inclui campos personalizados —
 *    aqueles entram via lookup no router quando necessário)
 */

export interface VariavelCatalogo {
  /** Path completo, ex: "cliente.endereco.cidade". */
  path: string;
  /** Label amigável pra UI, ex: "Cidade". */
  label: string;
  /** Grupo pra UI agrupar no Select, ex: "Cliente — Endereço". */
  grupo: string;
  /** Exemplo do valor renderizado, ex: "Fortaleza". */
  exemplo: string;
}

export const VARIAVEIS_CLIENTE: VariavelCatalogo[] = [
  { path: "cliente.nome", label: "Nome completo", grupo: "Cliente", exemplo: "Maria da Silva" },
  { path: "cliente.cpfCnpj", label: "CPF/CNPJ", grupo: "Cliente", exemplo: "123.456.789-00" },
  { path: "cliente.telefone", label: "Telefone", grupo: "Cliente", exemplo: "(85) 99999-0000" },
  { path: "cliente.email", label: "Email", grupo: "Cliente", exemplo: "maria@exemplo.com" },
  { path: "cliente.profissao", label: "Profissão", grupo: "Cliente", exemplo: "Engenheira civil" },
  { path: "cliente.estadoCivil", label: "Estado civil", grupo: "Cliente", exemplo: "Casado(a)" },
  { path: "cliente.nacionalidade", label: "Nacionalidade", grupo: "Cliente", exemplo: "Brasileira" },
];

export const VARIAVEIS_ENDERECO: VariavelCatalogo[] = [
  { path: "cliente.endereco.cep", label: "CEP", grupo: "Cliente — Endereço", exemplo: "60000-000" },
  { path: "cliente.endereco.logradouro", label: "Logradouro", grupo: "Cliente — Endereço", exemplo: "Av. Beira Mar" },
  { path: "cliente.endereco.numero", label: "Número", grupo: "Cliente — Endereço", exemplo: "1234" },
  { path: "cliente.endereco.complemento", label: "Complemento", grupo: "Cliente — Endereço", exemplo: "Apto 502" },
  { path: "cliente.endereco.bairro", label: "Bairro", grupo: "Cliente — Endereço", exemplo: "Meireles" },
  { path: "cliente.endereco.cidade", label: "Cidade", grupo: "Cliente — Endereço", exemplo: "Fortaleza" },
  { path: "cliente.endereco.uf", label: "UF", grupo: "Cliente — Endereço", exemplo: "CE" },
  { path: "cliente.endereco.completo", label: "Endereço completo (formatado)", grupo: "Cliente — Endereço", exemplo: "Av. Beira Mar, 1234, Apto 502, Meireles, Fortaleza/CE — CEP 60000-000" },
];

export const VARIAVEIS_ESCRITORIO: VariavelCatalogo[] = [
  { path: "escritorio.nome", label: "Nome do escritório", grupo: "Escritório", exemplo: "Silva & Associados" },
  { path: "escritorio.cnpj", label: "CNPJ", grupo: "Escritório", exemplo: "00.000.000/0001-00" },
  { path: "escritorio.email", label: "Email", grupo: "Escritório", exemplo: "contato@escritorio.com" },
  { path: "escritorio.telefone", label: "Telefone", grupo: "Escritório", exemplo: "(85) 3333-4444" },
];

export const VARIAVEIS_DATA: VariavelCatalogo[] = [
  { path: "data.hoje", label: "Data por extenso", grupo: "Data", exemplo: "30 de abril de 2026" },
  { path: "data.hojeISO", label: "Data ISO", grupo: "Data", exemplo: "2026-04-30" },
  { path: "data.hojeBR", label: "Data BR", grupo: "Data", exemplo: "30/04/2026" },
];

export const CATALOGO_BASE: VariavelCatalogo[] = [
  ...VARIAVEIS_CLIENTE,
  ...VARIAVEIS_ENDERECO,
  ...VARIAVEIS_ESCRITORIO,
  ...VARIAVEIS_DATA,
];

const ESTADO_CIVIL_LABEL: Record<string, string> = {
  solteiro: "Solteiro(a)",
  casado: "Casado(a)",
  divorciado: "Divorciado(a)",
  viuvo: "Viúvo(a)",
  uniao_estavel: "União estável",
};

const MESES_PT = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

function formatarDataExtenso(d: Date): string {
  return `${d.getDate()} de ${MESES_PT[d.getMonth()]} de ${d.getFullYear()}`;
}

function formatarDataISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatarDataBR(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

/** Junta os componentes de endereço numa string única. Pula campos vazios. */
function formatarEnderecoCompleto(end: Record<string, string | null | undefined>): string {
  const parts: string[] = [];
  if (end.logradouro) {
    parts.push(end.numero ? `${end.logradouro}, ${end.numero}` : end.logradouro);
  } else if (end.numero) {
    parts.push(`Nº ${end.numero}`);
  }
  if (end.complemento) parts.push(end.complemento);
  if (end.bairro) parts.push(end.bairro);
  if (end.cidade && end.uf) parts.push(`${end.cidade}/${end.uf}`);
  else if (end.cidade) parts.push(end.cidade);
  else if (end.uf) parts.push(end.uf);
  if (end.cep) parts.push(`CEP ${end.cep}`);
  return parts.join(", ");
}

export interface ContextoContrato {
  cliente?: {
    nome?: string | null;
    cpfCnpj?: string | null;
    telefone?: string | null;
    email?: string | null;
    profissao?: string | null;
    estadoCivil?: string | null;
    nacionalidade?: string | null;
    cep?: string | null;
    logradouro?: string | null;
    numeroEndereco?: string | null;
    complemento?: string | null;
    bairro?: string | null;
    cidade?: string | null;
    uf?: string | null;
    /** Campos personalizados ({chave: valor}). */
    campos?: Record<string, unknown> | null;
  } | null;
  escritorio?: {
    nome?: string | null;
    cnpj?: string | null;
    email?: string | null;
    telefone?: string | null;
  } | null;
  /** Data de referência. Default = `new Date()`. */
  hoje?: Date;
}

/** Resolve um path de variável (ex: "cliente.endereco.cidade") no contexto.
 *  Retorna string vazia se não existir/vier null. */
export function resolverVariavel(path: string, ctx: ContextoContrato): string {
  const hoje = ctx.hoje || new Date();

  // Cliente — campos top-level
  if (path === "cliente.nome") return ctx.cliente?.nome || "";
  if (path === "cliente.cpfCnpj") return ctx.cliente?.cpfCnpj || "";
  if (path === "cliente.telefone") return ctx.cliente?.telefone || "";
  if (path === "cliente.email") return ctx.cliente?.email || "";
  if (path === "cliente.profissao") return ctx.cliente?.profissao || "";
  if (path === "cliente.estadoCivil") {
    const raw = ctx.cliente?.estadoCivil;
    return raw ? ESTADO_CIVIL_LABEL[raw] || raw : "";
  }
  if (path === "cliente.nacionalidade") return ctx.cliente?.nacionalidade || "";

  // Endereço
  if (path === "cliente.endereco.cep") return ctx.cliente?.cep || "";
  if (path === "cliente.endereco.logradouro") return ctx.cliente?.logradouro || "";
  if (path === "cliente.endereco.numero") return ctx.cliente?.numeroEndereco || "";
  if (path === "cliente.endereco.complemento") return ctx.cliente?.complemento || "";
  if (path === "cliente.endereco.bairro") return ctx.cliente?.bairro || "";
  if (path === "cliente.endereco.cidade") return ctx.cliente?.cidade || "";
  if (path === "cliente.endereco.uf") return ctx.cliente?.uf || "";
  if (path === "cliente.endereco.completo") {
    return formatarEnderecoCompleto({
      logradouro: ctx.cliente?.logradouro,
      numero: ctx.cliente?.numeroEndereco,
      complemento: ctx.cliente?.complemento,
      bairro: ctx.cliente?.bairro,
      cidade: ctx.cliente?.cidade,
      uf: ctx.cliente?.uf,
      cep: ctx.cliente?.cep,
    });
  }

  // Escritório
  if (path === "escritorio.nome") return ctx.escritorio?.nome || "";
  if (path === "escritorio.cnpj") return ctx.escritorio?.cnpj || "";
  if (path === "escritorio.email") return ctx.escritorio?.email || "";
  if (path === "escritorio.telefone") return ctx.escritorio?.telefone || "";

  // Data
  if (path === "data.hoje") return formatarDataExtenso(hoje);
  if (path === "data.hojeISO") return formatarDataISO(hoje);
  if (path === "data.hojeBR") return formatarDataBR(hoje);

  // Campos personalizados — `cliente.campos.<chave>`
  if (path.startsWith("cliente.campos.")) {
    const chave = path.slice("cliente.campos.".length);
    const v = ctx.cliente?.campos?.[chave];
    if (v === null || v === undefined) return "";
    return String(v);
  }

  return "";
}

// ─── Placeholder schema ────────────────────────────────────────────────────

export type Placeholder =
  | { numero: number; tipo: "variavel"; variavel: string }
  | { numero: number; tipo: "manual"; label: string; dica?: string };

/** Detecta `{{N}}` (números) num texto bruto. Retorna lista ordenada de
 *  números únicos detectados. Ex: "{{1}} e {{3}} e {{1}}" → [1, 3]. */
export function detectarPlaceholdersNumerados(texto: string): number[] {
  const matches = texto.matchAll(/\{\{\s*(\d+)\s*\}\}/g);
  const numeros = new Set<number>();
  for (const m of matches) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0) numeros.add(n);
  }
  return Array.from(numeros).sort((a, b) => a - b);
}
