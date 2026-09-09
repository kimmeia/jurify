/**
 * Conferência de cadastros — um cálculo, três saídas (tela, PDF, planilha).
 *
 * O servidor monta a conferência uma vez a partir das fichas do escritório:
 * agrupa por telefone com a régua de sempre (`agruparPorTelefone`), agrupa por
 * CPF pelos dígitos, cruza os dois, marca divergências, conta faltas e
 * inválidos. Tela, arquivo e o botão "Possíveis duplicados" leem o MESMO
 * resultado — é o que garante que o 341 do cabeçalho é o 341 do card e do
 * arquivo. `montarConferencia` é pura de propósito: recebe tudo carregado e
 * não toca no banco, então o teste alimenta fichas na mão.
 */

import { and, eq, sql } from "drizzle-orm";
import {
  asaasCobrancas, clienteProcessos, colaboradores, contatos, contatosNaoDuplicados, conversas, users,
} from "../../drizzle/schema";
import { chaveTelefoneBR, mascararTelefoneBR } from "../../shared/telefone";
import { validarCpfCnpj, validarEmail } from "../../shared/validacoes";
import {
  type ClasseGrupo, type Divergencia, type FaltaTipo, type FiltroGrupo, type TipoGrupo,
  FALTA_TIPOS,
  classeDoGrupo, divergenciasDoGrupo, grupoPassaNoFiltro, mascararCpfCnpj, nomeIncompletoEntre, telefoneInvalido,
} from "../../shared/conferencia-cadastros";
import { agruparPorTelefone, ehFichaMagra, escolherSobrevivente } from "./reconhecer-cadastro";
import { toIsoString } from "../_core/dates";

export type FichaBase = {
  id: number;
  nome: string;
  telefone: string | null;
  telefonesSecundarios: string | null;
  cpfCnpj: string | null;
  email: string | null;
  estagio: "lead" | "cliente";
  origem: string;
  createdAt: Date | string | null;
  responsavelId: number | null;
};

export type Contagens = {
  conversas: Map<number, number>;
  cobrancas: Map<number, number>;
  processos: Map<number, number>;
};

export type Ignorado = { tipo: TipoGrupo; chave: string; marcadoPor: number | null; createdAt: Date | string | null };

export type BaseConferencia = {
  fichas: FichaBase[];
  contagens: Contagens;
  responsaveis: Map<number, string>;
  ignorados: Ignorado[];
};

export type FichaConf = {
  id: number;
  nome: string;
  estagio: "lead" | "cliente";
  origem: string;
  createdAt: string | null;
  /** Como está gravado. A tela mascara; a planilha leva inteiro (decisão 4). */
  telefone: string | null;
  cpfCnpj: string | null;
  email: string | null;
  responsavelId: number | null;
  responsavelNome: string | null;
  conversas: number;
  cobrancas: number;
  processos: number;
};

export type GrupoConf = {
  tipo: TipoGrupo;
  chave: string;
  /** Telefone com máscara ou CPF com o miolo escondido — o que a tela mostra no cabeçalho do grupo. */
  rotulo: string;
  sobreviventeId: number;
  /** Sobrevivente primeiro. */
  fichas: FichaConf[];
  divergencias: Divergencia[];
  classe: ClasseGrupo;
  nomeIncompleto: boolean;
  /** Só em grupo de CPF: pelo menos duas fichas também dividem o telefone. */
  tambemNoTelefone: boolean;
  ignorado: Ignorado | null;
};

export type FaltaConf = {
  ids: number[];
  clientes: number;
  leads: number;
  exemplo: { id: number; nome: string; origem: string; createdAt: string | null } | null;
};

export type Conferencia = {
  fichas: { total: number; clientes: number; leads: number };
  /** Todas as fichas projetadas — a planilha lista as faltas com dados completos. */
  todas: FichaConf[];
  gruposTelefone: GrupoConf[];
  gruposCpf: GrupoConf[];
  ignorados: GrupoConf[];
  faltas: Record<FaltaTipo, FaltaConf>;
  resumo: {
    telefone: { grupos: number; fichas: number; comDivergencia: number; cpfsDiferentes: number; soFalta: number };
    cpf: { grupos: number; fichas: number; tambemNoTelefone: number };
    divergentes: { grupos: number; cpfsDiferentes: number };
    semTelefoneOuInvalido: number;
    clienteSemCpfOuInvalido: number;
    ignorados: number;
  };
};

function digitos(v: string | null | undefined): string {
  return String(v ?? "").replace(/\D/g, "");
}

function temTelefoneSecundario(raw: string | null): boolean {
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.some((t) => digitos(String(t)).length > 0);
  } catch { /* lista separada por vírgula */ }
  return raw.split(",").some((t) => digitos(t).length > 0);
}

// ─── Carga ───────────────────────────────────────────────────────────────────

export async function carregarBaseConferencia(db: any, escritorioId: number): Promise<BaseConferencia> {
  const fichas: FichaBase[] = await db
    .select({
      id: contatos.id, nome: contatos.nome, telefone: contatos.telefone,
      telefonesSecundarios: contatos.telefonesSecundarios, cpfCnpj: contatos.cpfCnpj,
      email: contatos.email, estagio: contatos.estagio, origem: contatos.origem,
      createdAt: contatos.createdAt, responsavelId: contatos.responsavelId,
    })
    .from(contatos)
    .where(eq(contatos.escritorioId, escritorioId));

  const contar = async (tabela: any, coluna: any, colEscritorio: any): Promise<Map<number, number>> => {
    const mapa = new Map<number, number>();
    try {
      const rows = await db
        .select({ contatoId: coluna, n: sql<number>`COUNT(*)` })
        .from(tabela)
        .where(eq(colEscritorio, escritorioId))
        .groupBy(coluna);
      for (const r of rows) if (r.contatoId != null) mapa.set(Number(r.contatoId), Number(r.n));
    } catch { /* tabela pode não existir — conta zero */ }
    return mapa;
  };
  const [nConversas, nCobrancas, nProcessos] = await Promise.all([
    contar(conversas, conversas.contatoId, conversas.escritorioId),
    contar(asaasCobrancas, asaasCobrancas.contatoId, asaasCobrancas.escritorioId),
    contar(clienteProcessos, clienteProcessos.contatoId, clienteProcessos.escritorioId),
  ]);

  const responsaveis = new Map<number, string>();
  try {
    const rows = await db
      .select({ id: colaboradores.id, nome: users.name })
      .from(colaboradores)
      .innerJoin(users, eq(users.id, colaboradores.userId))
      .where(eq(colaboradores.escritorioId, escritorioId));
    for (const r of rows) responsaveis.set(Number(r.id), r.nome ?? "");
  } catch { /* sem nomes — a tela mostra o id */ }

  let ignorados: Ignorado[] = [];
  try {
    const rows = await db
      .select({
        tipo: contatosNaoDuplicados.tipo, chave: contatosNaoDuplicados.chave,
        marcadoPor: contatosNaoDuplicados.marcadoPor, createdAt: contatosNaoDuplicados.createdAt,
      })
      .from(contatosNaoDuplicados)
      .where(eq(contatosNaoDuplicados.escritorioId, escritorioId));
    ignorados = rows.map((r: any) => ({ tipo: r.tipo, chave: String(r.chave), marcadoPor: r.marcadoPor ?? null, createdAt: r.createdAt ?? null }));
  } catch { /* migration pendente — nada ignorado */ }

  return { fichas, contagens: { conversas: nConversas, cobrancas: nCobrancas, processos: nProcessos }, responsaveis, ignorados };
}

// ─── Cálculo puro ────────────────────────────────────────────────────────────

/**
 * As seis categorias de falta, calculadas em cima das fichas. `temProcesso`
 * entra de fora porque "só o nome do perfil" usa a MESMA régua da unificação
 * automática (`ehFichaMagra`), que exige saber se a ficha tem processo.
 */
export function faltasDasFichas(
  fichas: FichaBase[],
  temProcesso: (id: number) => boolean,
): Record<FaltaTipo, FaltaConf> {
  const out = {} as Record<FaltaTipo, FaltaConf>;
  for (const tipo of FALTA_TIPOS) out[tipo] = { ids: [], clientes: 0, leads: 0, exemplo: null };
  const marca = (tipo: FaltaTipo, f: FichaBase) => {
    const fal = out[tipo];
    fal.ids.push(f.id);
    if (f.estagio === "cliente") fal.clientes++; else fal.leads++;
    if (!fal.exemplo) fal.exemplo = { id: f.id, nome: f.nome, origem: f.origem, createdAt: toIsoString(f.createdAt) ?? null };
  };
  for (const f of fichas) {
    const tel = digitos(f.telefone);
    if (!tel && !temTelefoneSecundario(f.telefonesSecundarios)) marca("sem_telefone", f);
    if (telefoneInvalido(f.telefone)) marca("telefone_invalido", f);
    const cpf = digitos(f.cpfCnpj);
    if (f.estagio === "cliente" && !cpf) marca("cliente_sem_cpf", f);
    if (cpf && !validarCpfCnpj(cpf).valido) marca("cpf_invalido", f);
    if ((f.email ?? "").trim() && !validarEmail(f.email!)) marca("email_invalido", f);
    if (f.origem === "whatsapp" && ehFichaMagra(f, temProcesso(f.id))) marca("so_nome_perfil", f);
  }
  return out;
}

export function montarConferencia(base: BaseConferencia): Conferencia {
  const { fichas, contagens, responsaveis } = base;
  const ignoradosPorChave = new Map(base.ignorados.map((i) => [`${i.tipo}:${i.chave}`, i]));
  const temProcesso = (id: number) => (contagens.processos.get(id) ?? 0) > 0;

  const projetar = (f: FichaBase): FichaConf => ({
    id: f.id,
    nome: f.nome,
    estagio: f.estagio,
    origem: f.origem,
    createdAt: toIsoString(f.createdAt) ?? null,
    telefone: f.telefone,
    cpfCnpj: f.cpfCnpj,
    email: f.email,
    responsavelId: f.responsavelId,
    responsavelNome: f.responsavelId != null ? responsaveis.get(f.responsavelId) ?? null : null,
    conversas: contagens.conversas.get(f.id) ?? 0,
    cobrancas: contagens.cobrancas.get(f.id) ?? 0,
    processos: contagens.processos.get(f.id) ?? 0,
  });

  const chaveTel = new Map<number, string | null>(fichas.map((f) => [f.id, chaveTelefoneBR(f.telefone)]));

  const montarGrupo = (tipo: TipoGrupo, chave: string, membros: FichaBase[]): GrupoConf => {
    const principal = membros.reduce((m, c) => escolherSobrevivente(m, c).principal);
    const ordenados = [principal, ...membros.filter((c) => c.id !== principal.id)];
    const divergencias = divergenciasDoGrupo(membros, tipo);
    const chavesTel = membros.map((m) => chaveTel.get(m.id)).filter((c): c is string => !!c);
    return {
      tipo,
      chave,
      rotulo: tipo === "telefone" ? mascararTelefoneBR(principal.telefone) : mascararCpfCnpj(chave),
      sobreviventeId: principal.id,
      fichas: ordenados.map(projetar),
      divergencias,
      classe: classeDoGrupo(divergencias),
      nomeIncompleto: !divergencias.includes("nome") && nomeIncompletoEntre(membros.map((m) => m.nome)),
      tambemNoTelefone: tipo === "cpf" && new Set(chavesTel).size < chavesTel.length,
      ignorado: ignoradosPorChave.get(`${tipo}:${chave}`) ?? null,
    };
  };

  const todosTelefone = agruparPorTelefone(fichas).map((g) => montarGrupo("telefone", g.chave, g.contatos));

  const porCpf = new Map<string, FichaBase[]>();
  for (const f of fichas) {
    const d = digitos(f.cpfCnpj);
    if (!d) continue;
    porCpf.set(d, [...(porCpf.get(d) ?? []), f]);
  }
  const todosCpf = [...porCpf.entries()]
    .filter(([, g]) => g.length > 1)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([chave, g]) => montarGrupo("cpf", chave, g));

  const gruposTelefone = todosTelefone.filter((g) => !g.ignorado);
  const gruposCpf = todosCpf.filter((g) => !g.ignorado);
  const ignorados = [...todosTelefone, ...todosCpf].filter((g) => g.ignorado);

  const faltas = faltasDasFichas(fichas, temProcesso);
  const clientes = fichas.filter((f) => f.estagio === "cliente").length;
  const contarClasse = (lista: GrupoConf[], classe: ClasseGrupo) => lista.filter((g) => g.classe === classe).length;

  return {
    fichas: { total: fichas.length, clientes, leads: fichas.length - clientes },
    todas: fichas.map(projetar),
    gruposTelefone,
    gruposCpf,
    ignorados,
    faltas,
    resumo: {
      telefone: {
        grupos: gruposTelefone.length,
        fichas: gruposTelefone.reduce((n, g) => n + g.fichas.length, 0),
        comDivergencia: gruposTelefone.filter((g) => g.classe !== "so_falta").length,
        cpfsDiferentes: contarClasse(gruposTelefone, "cpfs_diferentes"),
        soFalta: contarClasse(gruposTelefone, "so_falta"),
      },
      cpf: {
        grupos: gruposCpf.length,
        fichas: gruposCpf.reduce((n, g) => n + g.fichas.length, 0),
        tambemNoTelefone: gruposCpf.filter((g) => g.tambemNoTelefone).length,
      },
      divergentes: {
        grupos: [...gruposTelefone, ...gruposCpf].filter((g) => g.classe !== "so_falta").length,
        cpfsDiferentes: contarClasse(gruposTelefone, "cpfs_diferentes"),
      },
      semTelefoneOuInvalido: faltas.sem_telefone.ids.length + faltas.telefone_invalido.ids.length,
      clienteSemCpfOuInvalido: faltas.cliente_sem_cpf.ids.length + faltas.cpf_invalido.ids.length,
      ignorados: ignorados.length,
    },
  };
}

/** Ids de uma categoria de falta, pra lista de Clientes abrir filtrada ("Ver na lista"). */
export async function idsDaFaltaNoEscritorio(db: any, escritorioId: number, tipo: FaltaTipo): Promise<number[]> {
  const base = await carregarBaseConferencia(db, escritorioId);
  const temProcesso = (id: number) => (base.contagens.processos.get(id) ?? 0) > 0;
  return faltasDasFichas(base.fichas, temProcesso)[tipo].ids;
}

// ─── Projeções ───────────────────────────────────────────────────────────────

export type GrupoTela = Omit<GrupoConf, "fichas"> & { fichas: Array<Omit<FichaConf, "cpfCnpj"> & { cpfCnpj: string | null }> };

/**
 * O que vai pra tela: CPF só com o miolo escondido (a chave do grupo de CPF
 * É o CPF, então vira `cpf-<sobrevivente>` — a tela marca "não é duplicado"
 * pelo id da ficha, não pela chave); faltas sem a lista de ids.
 */
export function conferenciaParaTela(conf: Conferencia) {
  const mascarar = (g: GrupoConf): GrupoTela => ({
    ...g,
    chave: g.tipo === "cpf" ? `cpf-${g.sobreviventeId}` : g.chave,
    fichas: g.fichas.map((f) => ({ ...f, cpfCnpj: f.cpfCnpj ? mascararCpfCnpj(f.cpfCnpj) : null })),
  });
  const faltas = {} as Record<FaltaTipo, { total: number; clientes: number; leads: number; exemplo: FaltaConf["exemplo"] }>;
  for (const tipo of FALTA_TIPOS) {
    const f = conf.faltas[tipo];
    faltas[tipo] = { total: f.ids.length, clientes: f.clientes, leads: f.leads, exemplo: f.exemplo };
  }
  return {
    fichas: conf.fichas,
    resumo: conf.resumo,
    gruposTelefone: conf.gruposTelefone.map(mascarar),
    gruposCpf: conf.gruposCpf.map(mascarar),
    ignorados: conf.ignorados.map(mascarar),
    faltas,
  };
}

export function gruposFiltrados(conf: Conferencia, filtro: FiltroGrupo): { telefone: GrupoConf[]; cpf: GrupoConf[] } {
  return {
    telefone: conf.gruposTelefone.filter((g) => grupoPassaNoFiltro(g.classe, filtro)),
    cpf: conf.gruposCpf.filter((g) => grupoPassaNoFiltro(g.classe, filtro)),
  };
}

// ─── Planilha ────────────────────────────────────────────────────────────────

export const COLUNAS_CSV = [
  "grupo", "chave", "id", "nome", "estagio", "origem", "cadastrado_em", "telefone", "cpf_cnpj",
  "email", "responsavel", "conversas", "cobrancas", "processos", "sobrevive", "divergencias",
] as const;

/**
 * Com hora: quatro fichas iguais criadas no mesmo minuto contam uma história
 * (clique repetido) e criadas em dias diferentes contam outra.
 */
function dataBR(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).replace(",", "");
}

function celula(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Uma linha por ficha, coluna "grupo" (telefone · cpf · falta) e coluna
 * "divergencias" — dá pra ordenar e filtrar no Excel. Separador `;` porque é o
 * que o Excel em português abre direto em colunas; BOM pra acentuação.
 * Telefone e CPF vão como estão gravados (decisão 4: é o arquivo de trabalho
 * de quem tem permissão de excluir clientes).
 */
export function gerarConferenciaCsv(conf: Conferencia, filtro: FiltroGrupo): string {
  const linhas: string[][] = [[...COLUNAS_CSV]];
  const { telefone, cpf } = gruposFiltrados(conf, filtro);
  const linhaFicha = (grupo: string, chave: string, f: FichaConf, sobrevive: string, divergencias: string) => [
    grupo, chave, String(f.id), f.nome, f.estagio, f.origem, dataBR(f.createdAt), f.telefone ?? "", f.cpfCnpj ?? "",
    f.email ?? "", f.responsavelNome ?? (f.responsavelId != null ? String(f.responsavelId) : ""),
    String(f.conversas), String(f.cobrancas), String(f.processos), sobrevive, divergencias,
  ];
  for (const g of [...telefone, ...cpf]) {
    // Vírgula dentro da célula: o ";" é o separador de colunas e ia sair entre aspas.
    const divs = g.divergencias.join(",");
    for (const f of g.fichas) {
      linhas.push(linhaFicha(g.tipo, g.chave, f, f.id === g.sobreviventeId ? "sim" : "não", divs));
    }
  }
  const porId = new Map<number, FichaConf>(conf.todas.map((f) => [f.id, f]));
  for (const tipo of FALTA_TIPOS) {
    for (const id of conf.faltas[tipo].ids) {
      const f = porId.get(id);
      if (f) linhas.push(linhaFicha("falta", tipo, f, "", tipo));
    }
  }
  return "\ufeff" + linhas.map((l) => l.map(celula).join(";")).join("\r\n") + "\r\n";
}

// ─── "Não é duplicado" ───────────────────────────────────────────────────────

/**
 * A chave do grupo a partir de uma ficha dele — o CPF nunca viaja do client
 * pro servidor; a tela manda o id da ficha sobrevivente.
 */
export async function chaveDoNaoDuplicado(
  db: any,
  escritorioId: number,
  opts: { tipo: TipoGrupo; contatoId: number },
): Promise<string | null> {
  const [c] = await db
    .select({ telefone: contatos.telefone, cpfCnpj: contatos.cpfCnpj })
    .from(contatos)
    .where(and(eq(contatos.id, opts.contatoId), eq(contatos.escritorioId, escritorioId)))
    .limit(1);
  if (!c) return null;
  return opts.tipo === "telefone" ? chaveTelefoneBR(c.telefone) : digitos(c.cpfCnpj) || null;
}

export async function marcarNaoDuplicado(
  db: any,
  opts: { escritorioId: number; tipo: TipoGrupo; chave: string; marcadoPor: number | null },
): Promise<{ ok: true; jaEstava: boolean }> {
  const [existe] = await db
    .select({ id: contatosNaoDuplicados.id })
    .from(contatosNaoDuplicados)
    .where(and(
      eq(contatosNaoDuplicados.escritorioId, opts.escritorioId),
      eq(contatosNaoDuplicados.tipo, opts.tipo),
      eq(contatosNaoDuplicados.chave, opts.chave),
    ))
    .limit(1);
  if (existe) return { ok: true, jaEstava: true };
  await db.insert(contatosNaoDuplicados).values({
    escritorioId: opts.escritorioId,
    tipo: opts.tipo,
    chave: opts.chave,
    marcadoPor: opts.marcadoPor,
  });
  return { ok: true, jaEstava: false };
}

export async function desmarcarNaoDuplicado(
  db: any,
  opts: { escritorioId: number; tipo: TipoGrupo; chave: string },
): Promise<{ ok: true }> {
  await db.delete(contatosNaoDuplicados).where(and(
    eq(contatosNaoDuplicados.escritorioId, opts.escritorioId),
    eq(contatosNaoDuplicados.tipo, opts.tipo),
    eq(contatosNaoDuplicados.chave, opts.chave),
  ));
  return { ok: true };
}
