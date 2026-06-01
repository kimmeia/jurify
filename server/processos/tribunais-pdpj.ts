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
//
// TJDF é exceção: o código do CNJ é "tjdf" mas o portal vive em
// pje.tjdft.jus.br (com T do "Distrito Federal e Territórios"). Override
// usado pra alinhar a URL sem mudar o id interno.
const REGISTRO: Record<string, TribunalPdpjConfig> = {
  tjce: pdpjTjConfig("ce"),
  tjrj: pdpjTjConfig("rj"),
  tjmg: pdpjTjConfig("mg"),
  tjrn: pdpjTjConfig("rn"),
  tjma: pdpjTjConfig("ma"),
  tjpa: pdpjTjConfig("pa"),
  tjro: pdpjTjConfig("ro"),
  tjpe: pdpjTjConfig("pe"),
  tjpb: pdpjTjConfig("pb"),
  tjmt: pdpjTjConfig("mt"),
  tjrr: pdpjTjConfig("rr"),
  tjdf: pdpjTjConfig("dft", 1, { tribunal: "tjdf" }),
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

/**
 * Tribunais que rodam por CONSULTA PÚBLICA (sem credencial OAB no Cofre).
 * Padrão PJe JSF/RichFaces aberto — adapter herda do TRT2Scraper genérico
 * com override de URL. Não usam REGISTRO porque a config TribunalPdpjConfig
 * é específica do fluxo PDPJ-cloud (login Keycloak); estes não.
 *
 * Cron decide o caminho via `tribunalRequerCredencial` abaixo.
 */
export const TRIBUNAIS_CONSULTA_PUBLICA = new Set<string>([
  "trf5",
]);

/** Usado pelo cnj-parser pra marcar `temMotorProprio` no parse do CNJ.
 *  União dos dois registros (PDPJ-cloud com credencial + consulta pública). */
export function tribunalTemMotorProprio(tribunal: string): boolean {
  return tribunal in REGISTRO || TRIBUNAIS_CONSULTA_PUBLICA.has(tribunal);
}

/** Indica se o tribunal precisa de credencial OAB no Cofre. False pra
 *  consulta pública (trf5 etc), true pra PDPJ-cloud (TJs). */
export function tribunalRequerCredencial(tribunal: string): boolean {
  return tribunal in REGISTRO;
}

/**
 * Mapeia o `sistema` de uma credencial do cofre (ex: "pje_tjmg") pra a config
 * do tribunal — pro LOGIN usar o portal do estado certo. Só PJe-TJ PDPJ
 * ("pje_tjXX"); outros (esaj_*, eproc_*, pje_restrito_trt*, pje_*) → null.
 *
 * Casos especiais: alguns sistemas no cofre usam sigla histórica diferente
 * do código do CNJ. TJDFT no cofre vs tjdf no CNJ (estado DF).
 */
const ALIAS_SISTEMA_PARA_TRIBUNAL: Record<string, string> = {
  tjdft: "tjdf",
};

export function configPorSistema(sistema: string): TribunalPdpjConfig | null {
  const m = /^pje_(tj[a-z]+)$/.exec(sistema);
  if (!m) return null;
  const trib = ALIAS_SISTEMA_PARA_TRIBUNAL[m[1]] ?? m[1];
  return getConfigTribunal(trib);
}

export const TRIBUNAIS_MOTOR_PROPRIO = [
  ...Object.keys(REGISTRO),
  ...TRIBUNAIS_CONSULTA_PUBLICA,
];
