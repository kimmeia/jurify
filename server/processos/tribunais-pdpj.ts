/**
 * Registro central de tribunais PJe-PDPJ com motor próprio.
 *
 * Fonte única da verdade pra: (a) quais tribunais aceitam monitoramento
 * (`cnj-parser`), (b) qual config de consulta usar (cron + routers). Adicionar
 * um estado PJe = UMA linha no REGISTRO — desde que ele siga o padrão PDPJ do
 * TJCE (login Keycloak + app autenticador, consulta JSF/Seam em
 * `pje.tjXX.jus.br/pjeNgrau/.../listView.seam`).
 *
 * IMPORTANTE: cada estado novo precisa de validação real (1 login + 1 consulta)
 * ao ser ligado — a URL é derivada do padrão e confirmada no uso. Ver #529.
 */
import type { TribunalPdpjConfig } from "./adapters/pje-tjce";

/**
 * Gera a config PDPJ de um TJ a partir da UF, no padrão do TJCE. Se algum
 * tribunal fugir do padrão de URL, passe `override` (urlEntrada/urlBusca).
 */
export function pdpjTjConfig(
  uf: string,
  grau: 1 | 2 = 1,
  override?: Partial<TribunalPdpjConfig>,
): TribunalPdpjConfig {
  const tribunal = `tj${uf.toLowerCase()}`;
  const base = `https://pje.${tribunal}.jus.br`;
  return {
    tribunal,
    grau,
    nome: `Tribunal de Justiça (${uf.toUpperCase()}) — PJe ${grau}º grau (PDPJ-cloud)`,
    urlEntrada: grau === 2 ? `${base}/pje2grau/` : `${base}/`,
    urlBusca: `${base}/pje${grau}grau/Processo/ConsultaProcesso/listView.seam`,
    ...override,
  };
}

// Tribunais PJe habilitados (motor próprio). Adicionar um estado = uma linha.
// Ex.: tjmg: pdpjTjConfig("mg")  — depois de validar login + consulta reais.
const REGISTRO: Record<string, TribunalPdpjConfig> = {
  tjce: pdpjTjConfig("ce"),
};

/** Config de consulta de um tribunal (grau 1 por padrão). null = sem motor próprio. */
export function getConfigTribunal(
  tribunal: string,
  grau: 1 | 2 = 1,
): TribunalPdpjConfig | null {
  if (!(tribunal in REGISTRO)) return null;
  if (grau === 2) return pdpjTjConfig(tribunal.replace(/^tj/, ""), 2);
  return REGISTRO[tribunal];
}

/** Usado pelo cnj-parser pra marcar `temMotorProprio` no parse do CNJ. */
export function tribunalTemMotorProprio(tribunal: string): boolean {
  return tribunal in REGISTRO;
}

/**
 * Mapeia o `sistema` de uma credencial do cofre (ex: "pje_tjmg") pra a config
 * do tribunal — pro LOGIN usar o portal do estado certo. Só PJe-TJ PDPJ
 * ("pje_tjXX"); outros (esaj_*, eproc_*, pje_restrito_trt*, pje_*) → null.
 */
export function configPorSistema(sistema: string): TribunalPdpjConfig | null {
  const m = /^pje_(tj[a-z]+)$/.exec(sistema);
  if (!m) return null;
  return getConfigTribunal(m[1]);
}

export const TRIBUNAIS_MOTOR_PROPRIO = Object.keys(REGISTRO);
