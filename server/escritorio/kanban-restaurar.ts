/**
 * Descobre o que sumiu do quadro e monta o plano de recriar.
 *
 * A comparação é contra o BANCO, não contra um segundo relatório: o banco é o
 * que existe agora, e ele tem o nome inteiro do card. O PDF é que corta com
 * reticências quando o nome não cabe na coluna — e corta em pontos diferentes
 * conforme a versão do gerador. Por isso o nome do relatório entra como
 * prefixo do nome do banco, nunca como igualdade.
 *
 * A data de cadastro é o segundo âncora, e o mais confiável: ela não muda
 * quando o card anda de coluna. Duas linhas do mesmo cliente no mesmo dia são
 * dois cards de verdade, então cada card do banco só pode casar uma vez.
 */

import type { LinhaRelatorio } from "./kanban-relatorio-parser";

export type SituacaoItem = "recriar" | "esta_no_quadro" | "refeito" | "sem_coluna";

export interface CardExistente {
  id: number;
  titulo: string;
  colunaId: number;
  criadoEm: Date;
}

export interface ColunaDoFunil {
  id: number;
  nome: string;
}

export interface PessoaConhecida {
  id: number;
  nome: string;
}

export interface ItemDoPlano {
  /** Índice na leitura do PDF — o cliente devolve isto pra confirmar. */
  indice: number;
  titulo: string;
  cliente: string;
  etapa: string;
  responsavel: string;
  cadastrado: string;
  prazo: string;
  situacao: SituacaoItem;
  /** Só quando `refeito`: a data do card que existe hoje com esse nome. */
  refeitoEm: string | null;
  colunaId: number | null;
  colunaNome: string | null;
  responsavelId: number | null;
  clienteId: number | null;
}

export interface PlanoDeRestauracao {
  itens: ItemDoPlano[];
  totalLido: number;
  ausentes: number;
  aRecriar: number;
  refeitos: number;
  semColuna: number;
  /** Nomes do relatório que não bateram com ninguém do time. */
  responsaveisNaoEncontrados: string[];
}

export function normalizar(s: string): string {
  return s
    .replace(/…|\.\.\./g, "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

/** Um nome truncado casa com o inteiro se for começo dele. */
function compativel(a: string, b: string): boolean {
  if (!a || !b) return false;
  return a.startsWith(b) || b.startsWith(a);
}

function dataBR(d: Date): string {
  return [
    String(d.getDate()).padStart(2, "0"),
    String(d.getMonth() + 1).padStart(2, "0"),
    d.getFullYear(),
  ].join("/");
}

/** "05/08/2026" → Date local, ou null. */
export function lerDataBR(s: string): Date | null {
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), 12, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * "11/08" (dia/mês, como o relatório imprime prazo) resolvido contra o ano do
 * cadastro. Prazo impresso sem ano é ambíguo na virada; ancorar no cadastro é
 * o que mais acerta, porque prazo nasce perto do cadastro.
 */
export function lerPrazoBR(prazo: string, cadastro: Date | null): Date | null {
  const m = prazo.match(/^(\d{2})\/(\d{2})$/);
  if (!m || !cadastro) return null;
  const ano = cadastro.getFullYear();
  const d = new Date(ano, Number(m[2]) - 1, Number(m[1]), 12, 0, 0);
  // Prazo que caiu mais de 6 meses antes do cadastro é virada de ano.
  if (d.getTime() < cadastro.getTime() - 182 * 24 * 3600_000) d.setFullYear(ano + 1);
  return d;
}

function acharPessoa(nome: string, pessoas: PessoaConhecida[]): number | null {
  const alvo = normalizar(nome);
  if (!alvo || alvo === "—" || alvo === "-") return null;
  const exato = pessoas.find((p) => normalizar(p.nome) === alvo);
  if (exato) return exato.id;
  // O relatório trunca nome longo; prefixo resolve, mas só se for de um só.
  const prefixo = pessoas.filter((p) => compativel(alvo, normalizar(p.nome)));
  return prefixo.length === 1 ? prefixo[0].id : null;
}

export function montarPlano(args: {
  linhas: LinhaRelatorio[];
  cards: CardExistente[];
  colunas: ColunaDoFunil[];
  colaboradores: PessoaConhecida[];
  clientes: PessoaConhecida[];
  /** Coluna pra onde vai card cuja etapa não existe mais. */
  colunaPadraoId?: number | null;
}): PlanoDeRestauracao {
  const { linhas, cards, colunas, colaboradores, clientes } = args;

  const usados = new Set<number>();
  const itens: ItemDoPlano[] = [];
  const naoEncontrados = new Set<string>();

  for (const [indice, l] of linhas.entries()) {
    const nome = normalizar(l.card);
    const cadastro = lerDataBR(l.cadastrado);

    // 1) O mesmo card, no mesmo dia, ainda no quadro? Então não sumiu — pouco
    //    importa em que coluna ele esteja hoje.
    const mesmoDia = cards.find(
      (c) =>
        !usados.has(c.id) &&
        compativel(nome, normalizar(c.titulo)) &&
        cadastro !== null &&
        dataBR(c.criadoEm) === l.cadastrado,
    );
    if (mesmoDia) {
      usados.add(mesmoDia.id);
      itens.push(base(indice, l, "esta_no_quadro", null, null, null, null, null));
      continue;
    }

    // 2) Existe card com esse nome, mas cadastrado depois? Alguém já refez na
    //    mão. Recriar de novo geraria duplicata.
    const refeito = cards.find(
      (c) =>
        !usados.has(c.id) &&
        compativel(nome, normalizar(c.titulo)) &&
        cadastro !== null &&
        c.criadoEm.getTime() > cadastro.getTime(),
    );
    if (refeito) {
      itens.push(base(indice, l, "refeito", dataBR(refeito.criadoEm), null, null, null, null));
      continue;
    }

    // 3) Sumiu. Resolve pra onde volta e com quem.
    const alvoEtapa = normalizar(l.etapa);
    const coluna =
      colunas.find((c) => normalizar(c.nome) === alvoEtapa) ??
      colunas.find((c) => compativel(alvoEtapa, normalizar(c.nome))) ??
      null;

    const responsavelId = acharPessoa(l.responsavel, colaboradores);
    if (l.responsavel && l.responsavel !== "—" && responsavelId === null) {
      naoEncontrados.add(l.responsavel);
    }
    const clienteId = l.cliente.includes("sem cliente") ? null : acharPessoa(l.cliente, clientes);

    itens.push(
      base(
        indice,
        l,
        coluna ? "recriar" : "sem_coluna",
        null,
        coluna?.id ?? args.colunaPadraoId ?? null,
        coluna?.nome ?? null,
        responsavelId,
        clienteId,
      ),
    );
  }

  return {
    itens,
    totalLido: linhas.length,
    ausentes: itens.filter((i) => i.situacao !== "esta_no_quadro").length,
    aRecriar: itens.filter((i) => i.situacao === "recriar").length,
    refeitos: itens.filter((i) => i.situacao === "refeito").length,
    semColuna: itens.filter((i) => i.situacao === "sem_coluna").length,
    responsaveisNaoEncontrados: [...naoEncontrados],
  };
}

function base(
  indice: number,
  l: LinhaRelatorio,
  situacao: SituacaoItem,
  refeitoEm: string | null,
  colunaId: number | null,
  colunaNome: string | null,
  responsavelId: number | null,
  clienteId: number | null,
): ItemDoPlano {
  return {
    indice,
    titulo: l.card,
    cliente: l.cliente,
    etapa: l.etapa,
    responsavel: l.responsavel,
    cadastrado: l.cadastrado,
    prazo: l.prazo,
    situacao,
    refeitoEm,
    colunaId,
    colunaNome,
    responsavelId,
    clienteId,
  };
}
