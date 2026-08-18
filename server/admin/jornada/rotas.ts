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
 * Quanto se espera o React montar dentro de `#root`.
 *
 * Este é o timeout que dá sentido a todos os outros. `domcontentloaded` numa
 * SPA volta com `<div id="root"></div>` e mais nada — o shell é idêntico em
 * todas as rotas. Qualquer conferência feita nesse instante olha para uma
 * página vazia e passa: sem app, não há spinner para esperar, não há erro para
 * capturar e nenhuma chamada de API para dar 5xx.
 *
 * Foi exatamente o que aconteceu na primeira execução real — 19 telas em 6 s,
 * zero achados, porque o robô nunca esperou o app existir.
 */
export const TIMEOUT_MONTAGEM_MS = 20_000;

/**
 * Quanto se espera o esqueleto sumir, já com o app montado. `networkidle`
 * seria mais rigoroso, mas o app tem polling permanente (a caixa de entrada a
 * cada 5 s) e nunca fica ocioso — esperar por ele daria timeout em tudo.
 *
 * Com a montagem garantida antes, esperar o spinner sumir passa a significar
 * "as consultas da primeira pintura responderam", que é o sinal que se quer.
 */
export const TIMEOUT_SPINNER_MS = 15_000;

/**
 * Respiro depois da tela pronta.
 *
 * Erro de render não é síncrono com a montagem: o React monta, um efeito
 * dispara, e só então a tela cai. Sem esta pausa o erro chegaria depois do
 * `goto` seguinte e seria contado na rota errada — ou perdido, se fosse a
 * última.
 */
export const PAUSA_POS_RENDER_MS = 1_200;

/** O ErrorBoundary do app pinta isto quando engole uma exceção de render. */
export const MARCA_ERROR_BOUNDARY = "An unexpected error occurred.";

/** Teto da execução inteira. Passou disso, algo travou e a sessão morre. */
export const TIMEOUT_EXECUCAO_MS = 12 * 60_000;
