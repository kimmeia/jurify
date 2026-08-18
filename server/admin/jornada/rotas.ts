/**
 * As telas que o robô percorre.
 *
 * Só rotas sem parâmetro. As com `:id` exigem um registro específico e por
 * isso são território das conferências (`conferencias.ts`), que criam o dado
 * antes de navegar — foi justamente a ausência disso que deixou metade do app
 * fora do alcance do robô por tanto tempo.
 */

export const ROTAS_JORNADA: readonly string[] = [
  "/dashboard",
  "/clientes",
  "/processos",
  "/movimentacoes",
  "/atendimento",
  "/agenda",
  "/tarefas",
  "/kanban",
  "/financeiro",
  "/relatorios",
  "/acordos",
  "/modelos-contrato",
  "/automacoes",
  "/smartflow",
  "/agentes-ia",
  "/jurisia",
  "/ponto",
  "/calculos",
  "/configuracoes",
];

/** Além disto, a tela travou. */
export const TIMEOUT_ROTA_MS = 20_000;

/**
 * Quanto se espera o esqueleto sumir. `networkidle` seria mais rigoroso, mas o
 * app tem polling permanente (a caixa de entrada a cada 5 s) e nunca fica
 * ocioso — esperar por ele daria timeout em tudo.
 */
export const TIMEOUT_SPINNER_MS = 15_000;

/** Teto da execução inteira. Passou disso, algo travou e a sessão morre. */
export const TIMEOUT_EXECUCAO_MS = 12 * 60_000;
