/**
 * Tipos do robô auditor.
 *
 * O robô roda uma lista de invariantes contra o banco. Invariante aqui é
 * uma afirmação que precisa valer sempre — "o saldo é igual à cabeça do
 * extrato", "processo e cliente pertencem ao mesmo escritório". A regra
 * devolve as linhas que violam a afirmação; zero linha é o estado saudável.
 *
 * Fase 1 (esta): TODA regra é read-only e nasce em shadow mode. Nenhum
 * caminho de escrita existe neste módulo — nem para as regras nível A. A
 * correção assistida e a auto-correção entram depois, quando as regras
 * tiverem histórico provando que não geram falso positivo.
 */

import type { getDb } from "../../db";

/** Instância do Drizzle já resolvida (getDb devolve null sem DATABASE_URL). */
export type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export type Severidade = "critico" | "alto" | "medio" | "baixo";

export const ORDEM_SEVERIDADE: Record<Severidade, number> = {
  critico: 0,
  alto: 1,
  medio: 2,
  baixo: 3,
};

/**
 * Quanto o robô tem permissão de fazer sozinho quando a correção existir:
 *
 *   A — o valor é derivado e pode ser recalculado da fonte da verdade no
 *       próprio banco. Corrigir é recalcular; nenhuma decisão envolvida.
 *   B — a correção existe mas exige escolher entre duas verdades. Vira
 *       proposta pra um humano aplicar.
 *   C — dinheiro, permissão ou exclusão. O robô relata e para.
 *
 * A régua: se a correção é um recálculo, nível A; se é uma decisão, não é.
 */
export type NivelCorrecao = "A" | "B" | "C";

export type Dominio =
  | "financeiro"
  | "comissoes"
  | "multi_tenant"
  | "motor"
  | "smartflow"
  | "kanban"
  | "permissoes"
  | "observabilidade";

/** Uma linha que viola a invariante. */
export interface LinhaAchado {
  /** Escritório dono da linha — null quando a regra é global. */
  escritorioId: number | null;
  /** PK da linha violada, pra investigação manual. */
  alvoId: number;
  /** Resumo legível da linha (aparece na tabela do painel). */
  descricao: string;
  /**
   * Pares campo→valor que sustentam o achado. É o que o painel mostra
   * como "o que está gravado" vs "o que a fonte da verdade diz".
   *
   * Nunca colocar aqui conteúdo sensível (senha, token, CPF) — o painel é
   * admin, mas o achado também vai pra log.
   */
  valores: Record<string, string | number | null>;
}

export interface Regra {
  /** Estável e curto — vira chave de log e de histórico. Ex: "CRED-01". */
  id: string;
  titulo: string;
  severidade: Severidade;
  dominio: Dominio;
  nivel: NivelCorrecao;
  /** Tabela principal varrida, pra filtro e exibição. */
  tabela: string;
  /** A afirmação, em português, que a regra defende. */
  invariante: string;
  /** O que uma correção faria — documentação, não código executável. */
  correcaoPrevista: string;
  /**
   * true = ainda não autorizada a corrigir nada. Todas nascem assim e só
   * saem depois de rodar limpo por tempo suficiente. Na fase 1 não existe
   * caminho de escrita, então o campo é uma declaração de intenção — o que
   * ele guarda é a decisão de que promover uma regra é ato deliberado.
   */
  shadow: boolean;
  /** Executa a checagem. Somente leitura. */
  detectar(db: Db, limite: number): Promise<LinhaAchado[]>;
}

/** Metadados da regra sem a função — é o que trafega pro client. */
export type RegraMeta = Omit<Regra, "detectar">;

export interface AchadoRegra {
  regra: RegraMeta;
  /** true = invariante respeitada (nenhuma linha violando). */
  ok: boolean;
  linhas: LinhaAchado[];
  /** Quantas linhas vieram. Igual a `linhas.length` — truncado avisa se há mais. */
  total: number;
  /** A consulta bateu no limite: existem mais linhas do que as mostradas. */
  truncado: boolean;
  /** Mensagem quando a própria regra falhou (SQL inválido, coluna ausente). */
  erro?: string;
  latenciaMs: number;
}

export interface ResumoVarredura {
  regrasExecutadas: number;
  regrasComErro: number;
  /** Regras que encontraram pelo menos uma violação. */
  achados: number;
  /** Soma das linhas violando, considerando todas as regras. */
  linhasAfetadas: number;
  porSeveridade: Record<Severidade, number>;
  /** Achados cujas regras ainda estão em shadow mode. */
  emShadow: number;
}

export interface ResultadoVarredura {
  runId: string;
  iniciadoEm: string;
  latenciaMs: number;
  resumo: ResumoVarredura;
  achados: AchadoRegra[];
}
