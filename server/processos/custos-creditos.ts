/**
 * Custos em créditos das operações do motor de processos.
 *
 * Vive em módulo próprio porque tanto o router (`routers/processos.ts`)
 * quanto o billing (`billing/escritorio-creditos.ts`, que deriva a cota
 * mensal dos planos a partir destes custos) precisam dele — e o billing
 * não pode importar o router sem criar ciclo.
 */
export const CUSTOS = {
  consulta_cnj: 1,
  monitorar_processo_mes: 2,    // ANTES: Judit cobrava 5
  monitorar_pessoa_mes: 15,     // ANTES: Judit cobrava 35
  /**
   * Busca por CPF/CNPJ sob demanda — retorna lista de CNJs encontrados
   * sem detalhes (capa/movs). Cobra flat 3 cred independente do número
   * de resultados (motor próprio TJCE custa só servidor, sem cobrança
   * externa por resultado como na Judit). User pode clicar nos CNJs
   * pra detalhar (1 cred cada via `consultarCNJ`).
   */
  consulta_documento: 3,
} as const;
