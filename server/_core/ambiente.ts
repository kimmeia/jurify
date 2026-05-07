/**
 * Resolução de ambiente — centraliza a lógica usada por vários lugares
 * (boot do server, gate do motor próprio, frontend via /api/health/live).
 *
 * Ordem de precedência (primeiro encontrado vence):
 *
 *   1. `JURIFY_AMBIENTE` — override manual setado pelo dev/admin no Railway.
 *      Útil pra forçar comportamento em casos especiais (ex: testar
 *      "production mode" localmente sem deploy real).
 *
 *   2. `RAILWAY_ENVIRONMENT_NAME` — env var setada AUTOMATICAMENTE pelo
 *      Railway em todo container, com valor "production" / "staging" /
 *      etc. conforme o environment do projeto. É a fonte mais confiável
 *      em deploy Railway porque NÃO depende de configuração manual.
 *      Doc: https://docs.railway.app/reference/variables#railway-provided-variables
 *
 *   3. `NODE_ENV` — fallback genérico. Quase sempre "production" em
 *      runtime (Node default), então só identifica "production" vs
 *      "development" — não sabe distinguir staging.
 *
 *   4. Default "development" — usado em scripts isolados, vitest, etc.
 *
 * Resultado garantido: sempre retorna um dos 3 valores tipados.
 */

export type Ambiente = "production" | "staging" | "development";

export function resolverAmbiente(): Ambiente {
  const override = process.env.JURIFY_AMBIENTE;
  if (override === "production" || override === "staging" || override === "development") {
    return override;
  }

  const railway = process.env.RAILWAY_ENVIRONMENT_NAME;
  if (railway === "production" || railway === "staging") {
    return railway;
  }
  // Railway pode usar nomes customizados ("dev", "preview", "test", etc) —
  // tratamos qualquer não-production como staging por segurança.
  if (railway && railway !== "production") {
    return "staging";
  }

  if (process.env.NODE_ENV === "production") return "production";
  if (process.env.NODE_ENV === "staging") return "staging";
  return "development";
}

/**
 * Conveniência: indica se o ambiente é "seguro pra teste" (staging ou dev).
 * Usado pra gatear features experimentais como o motor próprio durante o Spike.
 */
export function ambienteSuportaTeste(): boolean {
  const a = resolverAmbiente();
  return a === "staging" || a === "development";
}
