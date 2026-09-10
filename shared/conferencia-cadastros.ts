/**
 * Conferência de cadastros — as regras que a tela, o PDF e a planilha
 * compartilham. Fica em `shared` porque a página precisa dos mesmos rótulos e
 * o servidor das mesmas decisões; duas cópias divergiriam na primeira mudança.
 *
 * "Divergência" tem definição fixa (decisão do dono, 09/09/2026): dentro de um
 * grupo de fichas com o mesmo telefone ou o mesmo CPF, conta como divergente
 * o campo que está preenchido nas duas fichas COM VALORES DIFERENTES. Uma ficha
 * vazia e outra cheia não é divergência: é "só falta preencher", e é isso que
 * o Mesclar resolve sem risco.
 */

import { chaveTelefoneBR } from "./telefone";

export type Divergencia = "cpf" | "nome" | "email" | "responsavel" | "telefone";
export type ClasseGrupo = "cpfs_diferentes" | "com_divergencia" | "so_falta";
export type TipoGrupo = "telefone" | "cpf";

export const FILTROS_GRUPO = ["todos", "divergencia", "cpfs_diferentes", "so_falta"] as const;
export type FiltroGrupo = (typeof FILTROS_GRUPO)[number];

export const ROTULO_FILTRO: Record<FiltroGrupo, string> = {
  todos: "Todos",
  divergencia: "Com divergência",
  cpfs_diferentes: "CPFs diferentes",
  so_falta: "Só falta preencher",
};

export const FALTA_TIPOS = [
  "sem_telefone",
  "telefone_invalido",
  "cliente_sem_cpf",
  "cpf_invalido",
  "email_invalido",
  "so_nome_perfil",
] as const;
export type FaltaTipo = (typeof FALTA_TIPOS)[number];

export const ROTULO_FALTA: Record<FaltaTipo, string> = {
  sem_telefone: "Sem telefone",
  telefone_invalido: "Telefone inválido",
  cliente_sem_cpf: "Cliente sem CPF/CNPJ",
  cpf_invalido: "CPF/CNPJ inválido",
  email_invalido: "E-mail inválido",
  so_nome_perfil: "Só o nome do perfil",
};

export const COMO_DECIDE_FALTA: Record<FaltaTipo, string> = {
  sem_telefone: "Campo vazio e nenhum telefone secundário",
  telefone_invalido: "Menos de 10 dígitos, DDD inexistente, ou DDI de outro país (fica fora da regra do 9)",
  cliente_sem_cpf: "Estágio Cliente com o campo vazio — lead sem CPF é normal",
  cpf_invalido: "Dígito verificador não bate, ou tamanho fora de 11/14",
  email_invalido: "Sem @ ou sem domínio",
  so_nome_perfil: "Lead vindo do WhatsApp, sem CPF, sem e-mail, sem processo (a mesma régua da unificação automática)",
};

export const ROTULO_DIVERGENCIA: Record<Divergencia, string> = {
  cpf: "CPFs diferentes",
  nome: "nomes diferentes",
  email: "e-mails diferentes",
  responsavel: "responsáveis diferentes",
  telefone: "telefones diferentes",
};

export const MENSAGEM_CPFS_DIFERENTES =
  "As duas fichas têm CPF/CNPJ e eles são diferentes — confirme na tela qual seria descartado.";

/**
 * Mesclar fica com o CPF da ficha que sobrevive e descarta o da outra. Com os
 * dois lados preenchidos e diferentes pode ser duas pessoas (casal com o mesmo
 * telefone) — aí a mesclagem só passa com confirmação explícita. Um lado vazio
 * não é conflito: o valor entra sem tirar nada de ninguém.
 */
export function cpfsConflitam(a: string | null | undefined, b: string | null | undefined): boolean {
  const digA = (a ?? "").replace(/\D/g, "");
  const digB = (b ?? "").replace(/\D/g, "");
  return !!digA && !!digB && digA !== digB;
}

/** DDDs em uso no Brasil. Fora daqui o número não é de telefone brasileiro. */
export const DDDS_BR = new Set<number>([
  11, 12, 13, 14, 15, 16, 17, 18, 19,
  21, 22, 24, 27, 28,
  31, 32, 33, 34, 35, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48, 49,
  51, 53, 54, 55,
  61, 62, 63, 64, 65, 66, 67, 68, 69,
  71, 73, 74, 75, 77, 79,
  81, 82, 83, 84, 85, 86, 87, 88, 89,
  91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

function digitos(v: string | null | undefined): string {
  return String(v ?? "").replace(/\D/g, "");
}

/**
 * Telefone preenchido que não é um número brasileiro válido. Vazio NÃO é
 * inválido — é "sem telefone", categoria própria.
 */
export function telefoneInvalido(telefone: string | null | undefined): boolean {
  const d = digitos(telefone);
  if (!d) return false;
  let n = d;
  if (n.startsWith("55") && (n.length === 12 || n.length === 13)) n = n.slice(2);
  if (n.length !== 10 && n.length !== 11) return true;
  if (!DDDS_BR.has(Number(n.slice(0, 2)))) return true;
  if (n.length === 11 && n[2] !== "9") return true;
  if (/^(\d)\1+$/.test(n)) return true;
  return false;
}

const PARTICULAS = new Set(["de", "da", "do", "das", "dos", "e", "d"]);

/** Minúsculas, sem acento, sem pontuação, sem partículas ("de", "da"…). */
export function normalizarNome(nome: string | null | undefined): string[] {
  return String(nome ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !PARTICULAS.has(t));
}

/**
 * Dois nomes são compatíveis quando o mais curto "cabe" no mais longo, na
 * ordem, aceitando abreviação: "Maria C. Bezerra" cabe em "Maria Clara Sousa
 * Bezerra", "Fran" cabe em "Francisco Nogueira Lima". "Joana Matos Ribeiro"
 * NÃO cabe em "Pedro Henrique Matos" — aí é divergência de nome.
 */
export function nomesCompativeis(a: string | null | undefined, b: string | null | undefined): boolean {
  const ta = normalizarNome(a);
  const tb = normalizarNome(b);
  if (ta.length === 0 || tb.length === 0) return true;
  const [curto, longo] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  let i = 0;
  for (const token of curto) {
    let achou = false;
    while (i < longo.length) {
      const l = longo[i++];
      if (l.startsWith(token) || token.startsWith(l)) { achou = true; break; }
    }
    if (!achou) return false;
  }
  return true;
}

/** Nomes compatíveis mas não iguais: "Francisco" × "Francisco Nogueira Lima". */
export function nomeIncompletoEntre(nomes: Array<string | null | undefined>): boolean {
  const norm = nomes.map((n) => normalizarNome(n).join(" "));
  const distintos = new Set(norm.filter(Boolean));
  if (distintos.size < 2) return false;
  for (let i = 0; i < nomes.length; i++) {
    for (let j = i + 1; j < nomes.length; j++) {
      if (!nomesCompativeis(nomes[i], nomes[j])) return false;
    }
  }
  return true;
}

/** CPF `529.982.***-25`, CNPJ `12.345.*** / 0001-95` — o miolo nunca aparece na tela nem no PDF. */
export function mascararCpfCnpj(valor: string | null | undefined): string {
  const d = digitos(valor);
  if (!d) return "";
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.***-${d.slice(9)}`;
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.***/${d.slice(8, 12)}-${d.slice(12)}`;
  if (d.length >= 5) return `${d.slice(0, 2)}***${d.slice(-2)}`;
  return "***";
}

export type FichaParaDivergencia = {
  nome: string;
  cpfCnpj: string | null;
  email: string | null;
  responsavelId: number | null;
  telefone: string | null;
};

/**
 * O que difere dentro do grupo. Ordem fixa (cpf, nome, email, responsavel,
 * telefone) pra chip, PDF e planilha listarem igual.
 */
export function divergenciasDoGrupo(fichas: FichaParaDivergencia[], tipo: TipoGrupo): Divergencia[] {
  const out: Divergencia[] = [];
  const distintos = (valores: Array<string | null | undefined>) =>
    new Set(valores.map((v) => (v ?? "").trim()).filter(Boolean)).size;

  if (tipo === "telefone" && distintos(fichas.map((f) => digitos(f.cpfCnpj))) > 1) out.push("cpf");

  let nomeDiverge = false;
  for (let i = 0; i < fichas.length && !nomeDiverge; i++) {
    for (let j = i + 1; j < fichas.length; j++) {
      if (!nomesCompativeis(fichas[i].nome, fichas[j].nome)) { nomeDiverge = true; break; }
    }
  }
  if (nomeDiverge) out.push("nome");

  if (distintos(fichas.map((f) => (f.email ?? "").toLowerCase())) > 1) out.push("email");
  if (new Set(fichas.map((f) => f.responsavelId).filter((r): r is number => r != null)).size > 1) out.push("responsavel");

  if (tipo === "cpf") {
    const chaves = fichas.map((f) => chaveTelefoneBR(f.telefone) ?? digitos(f.telefone));
    if (distintos(chaves) > 1) out.push("telefone");
  }
  return out;
}

export function classeDoGrupo(divergencias: Divergencia[]): ClasseGrupo {
  if (divergencias.includes("cpf")) return "cpfs_diferentes";
  if (divergencias.length > 0) return "com_divergencia";
  return "so_falta";
}

export function grupoPassaNoFiltro(classe: ClasseGrupo, filtro: FiltroGrupo): boolean {
  if (filtro === "todos") return true;
  if (filtro === "divergencia") return classe !== "so_falta";
  return classe === filtro;
}
