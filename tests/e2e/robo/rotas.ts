/**
 * As rotas do app logado, sem parâmetro.
 *
 * Fonte única pros dois robôs que navegam: o de jornada (a rota abre?) e
 * o de ação (o que dá pra clicar dentro dela?). Estavam duplicadas, e
 * lista duplicada só se percebe quando uma tela nova entra numa e não na
 * outra — aí um robô cobre e o outro não, sem ninguém notar.
 *
 * As rotas com `:id` ficam de fora enquanto os robôs não souberem criar
 * o registro antes de navegar.
 */
export const ROTAS_APP = [
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
] as const;
