/**
 * Quem tem direito ao JurisIA.
 *
 * O módulo é vendido à parte, então a liberação vem de duas origens que
 * coexistem: o **plano** (quando a faixa contratada já inclui o módulo) e o
 * **add-on por escritório** (contrato avulso, cortesia, piloto).
 *
 * Esta função é o único lugar que decide. Espalhar a regra entre o gate da
 * procedure, o menu e a tela de cobrança é como um escritório acaba vendo o
 * item no menu, clicando, e recebendo "não está no seu plano" — que foi
 * exatamente o estado em que o módulo nasceu.
 *
 * Quando as duas origens liberam, vale o MAIOR limite: o add-on existe pra
 * somar, e quem comprou avulso não pode acabar com menos do que o plano já
 * dava.
 */

export type StatusAddon = "ativo" | "suspenso" | "cancelado";

export type OrigemAcesso = "plano" | "addon" | "ambos";

export type MotivoBloqueio =
  /** Nunca contratou — a tela oferece contratar. */
  | "nao_contratado"
  /** Contratou e o prazo venceu — a tela oferece renovar, que é outra conversa. */
  | "expirado"
  /** Contrato existe mas está suspenso (inadimplência, pedido do cliente). */
  | "suspenso";

export interface PlanoParaAcesso {
  /** `modulosLiberados` do plano. */
  modulos: readonly string[];
  jurisiaMensagensMes: number;
}

export interface AddonParaAcesso {
  status: StatusAddon;
  limiteMensal: number;
  /** ISO ou null (vale desde sempre). */
  inicioEm: string | null;
  /** ISO ou null (não vence). */
  expiraEm: string | null;
}

export interface AcessoJurisIA {
  liberado: boolean;
  /** Mensagens/mês. 0 quando bloqueado. */
  limite: number;
  origem: OrigemAcesso | null;
  /** ISO do vencimento do add-on, quando é ele que libera. */
  expiraEm: string | null;
  /** Só quando `liberado` é false. */
  motivo: MotivoBloqueio | null;
}

/** O id do módulo no registro de `shared/modulos-app.ts`. */
export const MODULO_JURISIA = "jurisia";

const inteiroPositivo = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
};

/**
 * Add-on vigente agora.
 *
 * `inicioEm` no futuro é contrato agendado, não contrato ativo — liberar antes
 * da data entregaria o módulo de graça no intervalo.
 */
export function addonVigente(addon: AddonParaAcesso | null, agora: Date): boolean {
  if (!addon || addon.status !== "ativo") return false;
  const t = agora.getTime();
  if (addon.inicioEm) {
    const inicio = new Date(addon.inicioEm).getTime();
    if (Number.isFinite(inicio) && inicio > t) return false;
  }
  if (addon.expiraEm) {
    const fim = new Date(addon.expiraEm).getTime();
    // Data inválida vinda do banco não pode virar "vale pra sempre".
    if (!Number.isFinite(fim) || fim <= t) return false;
  }
  return true;
}

function planoLibera(plano: PlanoParaAcesso | null): boolean {
  if (!plano) return false;
  return plano.modulos.includes(MODULO_JURISIA) && inteiroPositivo(plano.jurisiaMensagensMes) > 0;
}

export function resolverAcessoJurisIA(args: {
  plano: PlanoParaAcesso | null;
  addon: AddonParaAcesso | null;
  agora: Date;
}): AcessoJurisIA {
  const doPlano = planoLibera(args.plano);
  const doAddon = addonVigente(args.addon, args.agora);

  if (!doPlano && !doAddon) {
    return {
      liberado: false,
      limite: 0,
      origem: null,
      expiraEm: null,
      motivo: motivoDoBloqueio(args.addon, args.agora),
    };
  }

  const limitePlano = doPlano ? inteiroPositivo(args.plano?.jurisiaMensagensMes) : 0;
  const limiteAddon = doAddon ? inteiroPositivo(args.addon?.limiteMensal) : 0;

  return {
    liberado: true,
    limite: Math.max(limitePlano, limiteAddon),
    origem: doPlano && doAddon ? "ambos" : doPlano ? "plano" : "addon",
    expiraEm: doAddon ? (args.addon?.expiraEm ?? null) : null,
    motivo: null,
  };
}

/**
 * Por que está bloqueado — a tela fala diferente em cada caso, e "renove" pra
 * quem nunca comprou soa como cobrança de dívida que não existe.
 */
function motivoDoBloqueio(addon: AddonParaAcesso | null, agora: Date): MotivoBloqueio {
  if (!addon) return "nao_contratado";
  if (addon.status === "suspenso") return "suspenso";
  if (addon.status === "cancelado") return "expirado";
  if (addon.expiraEm) {
    const fim = new Date(addon.expiraEm).getTime();
    if (Number.isFinite(fim) && fim <= agora.getTime()) return "expirado";
  }
  // Ativo mas ainda não começou: pro escritório é indistinguível de não ter.
  return "nao_contratado";
}

/** Quantos dias faltam pro add-on vencer. null quando não vence ou já venceu. */
export function diasParaVencer(expiraEm: string | null, agora: Date): number | null {
  if (!expiraEm) return null;
  const fim = new Date(expiraEm).getTime();
  if (!Number.isFinite(fim)) return null;
  const dias = Math.ceil((fim - agora.getTime()) / 86_400_000);
  return dias > 0 ? dias : null;
}
