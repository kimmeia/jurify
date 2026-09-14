/**
 * Módulo que ainda não está pronto pra produção.
 *
 * Decisão do dono (13/09): o Ponto sai de produção por enquanto e fica em
 * staging com a etiqueta "beta". Não é remoção de código — é o módulo deixar de
 * ser oferecido onde há cliente pagando, e continuar existindo onde se testa.
 *
 * Uma lista só, lida pelas três portas que decidem se um módulo existe: o menu,
 * a rota (`ModuloGuard`) e o porteiro das procedures. Três listas divergindo
 * dariam o pior resultado possível — item escondido no menu com a API aberta,
 * ou o contrário.
 *
 * Pra tirar o Ponto do beta, basta apagá-lo daqui; pra segurar outro módulo,
 * basta acrescentar. Nada mais muda.
 */

export type AmbienteApp = "production" | "staging" | "development";

/** Módulos que só existem fora de produção, com etiqueta de beta. */
export const MODULOS_BETA: readonly string[] = ["ponto"];

export function ehModuloBeta(modulo: string): boolean {
  return MODULOS_BETA.includes(modulo);
}

/**
 * O módulo está FORA neste ambiente?
 *
 * Em produção, módulo em beta não é oferecido — nem no menu, nem pela rota, nem
 * pela API. Ambiente desconhecido é tratado como produção de propósito: na
 * dúvida sobre onde estamos, o certo é não mostrar.
 */
export function moduloRemovidoNoAmbiente(
  modulo: string,
  ambiente: AmbienteApp | null | undefined,
): boolean {
  if (!ehModuloBeta(modulo)) return false;
  return ambiente !== "staging" && ambiente !== "development";
}

/** O módulo aparece, mas marcado como beta? (staging e dev) */
export function moduloMostraSeloBeta(
  modulo: string,
  ambiente: AmbienteApp | null | undefined,
): boolean {
  return ehModuloBeta(modulo) && !moduloRemovidoNoAmbiente(modulo, ambiente);
}

/**
 * Tira do contrato os módulos que não existem aqui.
 *
 * `null` é o "indeterminado = tudo liberado" do porteiro e continua null: quem
 * decide o bloqueio nesse caso é a porta, não a cesta — mexer aqui trocaria o
 * fail-open do gate inteiro por um efeito colateral desta lista.
 */
export function filtrarModulosDoAmbiente(
  modulos: string[] | null,
  ambiente: AmbienteApp | null | undefined,
): string[] | null {
  if (modulos == null) return null;
  return modulos.filter((m) => !moduloRemovidoNoAmbiente(m, ambiente));
}
