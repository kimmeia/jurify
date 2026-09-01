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
  // TJRJ foge do padrão: o portal é tribunal-como-subdomínio do pje.jus.br
  // (tjrj.pje.jus.br) com grau no path curto (/1g). O derivado
  // pje.tjrj.jus.br nem resolve DNS — foi o ERR_NAME_NOT_RESOLVED visto na
  // validação do Cofre em 20/08.
  tjrj: pdpjTjConfig("rj", 1, {
    urlEntrada: "https://tjrj.pje.jus.br/1g/login.seam",
    urlBusca: "https://tjrj.pje.jus.br/1g/Processo/ConsultaProcesso/listView.seam",
  }),
  tjmg: pdpjTjConfig("mg"),
  // Endereços reais confirmados na validação do Cofre de 20/08 — o derivado
  // caía em portal institucional (PA/PE/RO) ou não respondia (RN):
  tjrn: pdpjTjConfig("rn", 1, {
    urlEntrada: "https://pje1g.tjrn.jus.br/pje/login.seam",
    urlBusca: "https://pje1g.tjrn.jus.br/pje/Processo/ConsultaProcesso/listView.seam",
  }),
  tjma: pdpjTjConfig("ma"),
  tjpa: pdpjTjConfig("pa", 1, {
    urlEntrada: "https://pje.tjpa.jus.br/pje/login.seam",
    urlBusca: "https://pje.tjpa.jus.br/pje/Processo/ConsultaProcesso/listView.seam",
  }),
  tjro: pdpjTjConfig("ro", 1, {
    urlEntrada: "https://pjepg.tjro.jus.br/pje/login.seam",
    urlBusca: "https://pjepg.tjro.jus.br/pje/Processo/ConsultaProcesso/listView.seam",
  }),
  // TJPE migrou o 1º grau pra pje.cloud.tjpe.jus.br (o endereço antigo vive
  // redirecionando pro portal Liferay institucional).
  tjpe: pdpjTjConfig("pe", 1, {
    urlEntrada: "https://pje.cloud.tjpe.jus.br/1g/login.seam",
    urlBusca: "https://pje.cloud.tjpe.jus.br/1g/Processo/ConsultaProcesso/listView.seam",
  }),
  tjpb: pdpjTjConfig("pb"),
  tjmt: pdpjTjConfig("mt"),
  tjrr: pdpjTjConfig("rr"),
  tjdf: pdpjTjConfig("dft", 1, { tribunal: "tjdf" }),
};

/**
 * 2º grau dos estados cujo 1º grau NÃO segue o padrão derivado.
 *
 * Sem este registro, pedir o 2º grau de um estado com endereço próprio caía no
 * padrão genérico `pje.tjXX.jus.br/pje2grau/` — o mesmo host que já não
 * resolvia no 1º grau e por isso ganhou override. O cron consulta o 2º grau
 * quando detecta que o processo subiu (`cron-monitoramento`), engole a falha e
 * segue só com o 1º: a movimentação do recurso sumia sem ninguém ver.
 *
 * Os endereços aqui vêm da MESMA transformação textual do host já validado no
 * 1º grau (`/1g` → `/2g`, `pje1g.` → `pje2g.`) — continuam sendo candidatos até
 * um login real passar, e é o registro por grau no Cofre que diz quando passou.
 *
 * `null` = não dá pra derivar com honestidade (o endereço do 1º grau não tem
 * marca de grau nenhuma). Melhor devolver "não sei" do que mandar o robô num
 * host inventado.
 */
const REGISTRO_G2: Record<string, TribunalPdpjConfig | null> = {
  tjrj: pdpjTjConfig("rj", 2, {
    urlEntrada: "https://tjrj.pje.jus.br/2g/login.seam",
    urlBusca: "https://tjrj.pje.jus.br/2g/Processo/ConsultaProcesso/listView.seam",
  }),
  tjrn: pdpjTjConfig("rn", 2, {
    urlEntrada: "https://pje2g.tjrn.jus.br/pje/login.seam",
    urlBusca: "https://pje2g.tjrn.jus.br/pje/Processo/ConsultaProcesso/listView.seam",
  }),
  tjpe: pdpjTjConfig("pe", 2, {
    urlEntrada: "https://pje.cloud.tjpe.jus.br/2g/login.seam",
    urlBusca: "https://pje.cloud.tjpe.jus.br/2g/Processo/ConsultaProcesso/listView.seam",
  }),
  // `pje.tjpa.jus.br/pje/` e `pjepg.tjro.jus.br/pje/` não carregam grau no
  // endereço, então não há transformação a fazer — fica mapeado como desconhecido.
  tjpa: null,
  tjro: null,
  // O portal do DF vive em tjdft (com T), enquanto o código do CNJ é tjdf. Sem
  // esta linha o 2º grau derivava `pje.tjdf.jus.br`, que não é o portal dele.
  tjdf: pdpjTjConfig("dft", 2, { tribunal: "tjdf" }),
};

/** Estados cujo 2º grau ainda não tem endereço mapeado. */
export function segundoGrauMapeado(tribunal: string): boolean {
  if (!(tribunal in REGISTRO)) return false;
  if (tribunal in REGISTRO_G2) return REGISTRO_G2[tribunal] != null;
  return true;
}

/** Config de consulta de um tribunal (grau 1 por padrão). null = sem motor próprio. */
export function getConfigTribunal(
  tribunal: string,
  grau: 1 | 2 = 1,
): TribunalPdpjConfig | null {
  if (!(tribunal in REGISTRO)) return null;
  if (grau === 2) {
    if (tribunal in REGISTRO_G2) return REGISTRO_G2[tribunal];
    return pdpjTjConfig(tribunal.replace(/^tj/, ""), 2);
  }
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

/**
 * Sistema que vale em QUALQUER PJe.
 *
 * O login do PDPJ é nacional — o mesmo CPF/OAB entra em todos os estados. Sem
 * este valor, monitorar processo de outro estado exigia cadastrar a mesma
 * pessoa de novo, e a mesma senha acabava guardada uma vez por tribunal.
 */
export const SISTEMA_PJE_NACIONAL = "pje_*";

/** Um sistema do cofre atende este tribunal? */
export function sistemaAtendeTribunal(sistema: string, tribunal: string): boolean {
  if (sistema === SISTEMA_PJE_NACIONAL) return tribunal in REGISTRO;
  return configPorSistema(sistema)?.tribunal === tribunal;
}

/**
 * Tribunal que um sistema nomeia. `null` pro alcance nacional, que não nomeia
 * nenhum — quem chama precisa dizer qual estado quer.
 */
export function tribunalDoSistema(sistema: string): string | null {
  if (sistema === SISTEMA_PJE_NACIONAL) return null;
  return configPorSistema(sistema)?.tribunal ?? null;
}

/** Estados que o motor atende, na ordem do registro. */
export function tribunaisPjeDisponiveis(): string[] {
  return Object.keys(REGISTRO);
}

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

/**
 * Siglas suportadas, pra mensagem de erro. "Ainda em desenvolvimento" sem
 * dizer o que funciona deixa quem cadastrou sem saber se o problema é o
 * tribunal dele ou o número que digitou.
 */
export function siglasSuportadas(): string {
  return TRIBUNAIS_MOTOR_PROPRIO.map((t) => t.toUpperCase()).sort().join(", ");
}
