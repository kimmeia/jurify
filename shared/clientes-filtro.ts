/**
 * Filtro/ordenação da lista de Clientes do Financeiro. Fonte única usada pelo
 * client (tela) e pelo server (geração do PDF) — garante que o relatório
 * reflete exatamente o recorte exibido.
 *
 * A busca textual (nome/CPF) é aplicada no SQL (procedure listarClientesVinculados),
 * por isso não entra aqui — este módulo cobre chip + dias de atraso + ordenação.
 */

export type ClientesChip =
  | "todos"
  | "inadimplentes"
  | "pendente"
  | "bons"
  | "sem_cobranca";

export type ClientesSortCol =
  | "nome"
  | "cobrancas"
  | "pendente"
  | "vencido"
  | "pago"
  | "atraso";

export type ClientesSortDir = "asc" | "desc";

export type ClientesSort = { col: ClientesSortCol; dir: ClientesSortDir };

/** Campos mínimos que o filtro/ordenação consulta. */
export type ClienteParaFiltro = {
  contatoNome: string;
  totalCobrancas: number;
  pendente: number;
  vencido: number;
  pago: number;
  diasAtrasoMax: number | null;
};

export function defaultSortPorChip(chip: ClientesChip): ClientesSort {
  if (chip === "inadimplentes") return { col: "atraso", dir: "desc" };
  if (chip === "pendente") return { col: "pendente", dir: "desc" };
  if (chip === "bons") return { col: "pago", dir: "desc" };
  return { col: "nome", dir: "asc" };
}

export function valorOrdenacao(
  c: ClienteParaFiltro,
  col: ClientesSortCol,
): number | string {
  switch (col) {
    case "nome": return (c.contatoNome || "").toLowerCase();
    case "cobrancas": return c.totalCobrancas || 0;
    case "pendente": return c.pendente || 0;
    case "vencido": return c.vencido || 0;
    case "pago": return c.pago || 0;
    case "atraso": return c.diasAtrasoMax ?? -1;
  }
}

export function filtrarClientes<T extends ClienteParaFiltro>(
  lista: T[],
  opts: { chip: ClientesChip; diasAtrasoMin?: number | null },
): T[] {
  let r = lista;
  if (opts.chip === "inadimplentes") r = r.filter((c) => c.vencido > 0);
  else if (opts.chip === "pendente") r = r.filter((c) => c.pendente > 0);
  else if (opts.chip === "bons") r = r.filter((c) => c.pago > 0 && c.vencido === 0);
  else if (opts.chip === "sem_cobranca") r = r.filter((c) => c.totalCobrancas === 0);

  const min = opts.diasAtrasoMin;
  if (min != null && !isNaN(min) && min > 0) {
    r = r.filter((c) => c.diasAtrasoMax != null && c.diasAtrasoMax >= min);
  }
  return r;
}

export function ordenarClientes<T extends ClienteParaFiltro>(
  lista: T[],
  sort: ClientesSort | null,
  chip: ClientesChip,
): T[] {
  const efetivo = sort ?? defaultSortPorChip(chip);
  return [...lista].sort((a, b) => {
    const vA = valorOrdenacao(a, efetivo.col);
    const vB = valorOrdenacao(b, efetivo.col);
    if (vA < vB) return efetivo.dir === "asc" ? -1 : 1;
    if (vA > vB) return efetivo.dir === "asc" ? 1 : -1;
    return 0;
  });
}

export function aplicarFiltrosClientes<T extends ClienteParaFiltro>(
  lista: T[],
  opts: { chip: ClientesChip; diasAtrasoMin?: number | null; sort?: ClientesSort | null },
): T[] {
  return ordenarClientes(
    filtrarClientes(lista, opts),
    opts.sort ?? null,
    opts.chip,
  );
}
