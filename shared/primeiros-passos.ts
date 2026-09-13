/**
 * Primeiros passos do dono (Central de ajuda, fatia 2 — mockup
 * `mockup-central-de-ajuda.html`, aba 4, "pode fazer" de 12/09/2026).
 *
 * Cinco coisas, nesta ordem, que fazem o JuridFlow trabalhar pelo
 * escritório. O catálogo mora aqui, puro, porque as duas pontas leem o
 * mesmo desenho: o servidor decide o que está feito e o que o plano
 * contratou; a tela só desenha o que recebe. Cada passo abre o fluxo REAL
 * (deep-link `?novo=1`, o mesmo idioma do GuiaProcessual), não uma
 * explicação.
 */

import { contratoLibera } from "./modulos-contratacao";

export type PassoId = "whatsapp" | "cliente" | "cofre" | "processo" | "equipe";

export interface PassoCatalogo {
  id: PassoId;
  titulo: string;
  descricao: string;
  /** Rota do app que abre o fluxo — pathname + query, nunca URL externa. */
  rota: string;
  /** Texto do botão que abre a rota. */
  rotulo: string;
  /**
   * Módulos que liberam o passo (basta UM contratado). Vazio = core, vale em
   * qualquer plano. Espelha `MODULOS_POR_ROTA` da rota que o passo abre:
   * passo que o plano não contratou sai da lista e do total, como o item de
   * menu que some.
   */
  modulos: readonly string[];
  /** Passo que precisa existir antes — o cadeado do mockup. */
  dependeDe: PassoId | null;
}

export const PRIMEIROS_PASSOS: readonly PassoCatalogo[] = [
  {
    id: "whatsapp",
    titulo: "Conectar o WhatsApp",
    descricao: "O número do escritório recebendo no Atendimento.",
    rota: "/configuracoes?tab=canais&novo=1",
    rotulo: "Conectar o número",
    modulos: ["atendimento"],
    dependeDe: null,
  },
  {
    id: "cliente",
    titulo: "Cadastrar o 1º cliente",
    descricao: "Nome e WhatsApp bastam pra começar.",
    rota: "/clientes?novo=1",
    rotulo: "Cadastrar cliente",
    modulos: ["clientes", "processos"],
    dependeDe: null,
  },
  {
    id: "cofre",
    titulo: "Guardar o acesso ao tribunal",
    descricao: "Seu login do PJe no Cofre — o robô usa pra ler os processos.",
    rota: "/processos?tab=cofre&novo=1",
    rotulo: "Abrir o Cofre",
    modulos: ["processos"],
    dependeDe: null,
  },
  {
    id: "processo",
    titulo: "Vigiar um processo",
    descricao: "Cole o CNJ e o robô confere todo dia.",
    rota: "/processos?tab=novas-acoes&novo=1",
    rotulo: "Vigiar agora",
    modulos: ["processos"],
    dependeDe: "cofre",
  },
  {
    id: "equipe",
    titulo: "Convidar a equipe",
    descricao: "Cada pessoa com o seu acesso e as suas permissões.",
    rota: "/configuracoes?tab=equipe&novo=1",
    rotulo: "Convidar",
    modulos: [],
    dependeDe: null,
  },
];

export interface PassoPrimeirosPassos {
  id: PassoId;
  titulo: string;
  descricao: string;
  feito: boolean;
  /** ISO do registro mais antigo que satisfaz o passo; null quando não feito. */
  feitoEm: string | null;
  rota: string;
  rotulo: string;
  travadoPor: PassoId | null;
  /** Módulo principal que libera o passo (só informação); null = core. */
  modulo: string | null;
}

export interface PrimeirosPassosPayload {
  souDono: boolean;
  passos: PassoPrimeirosPassos[];
  feitos: number;
  total: number;
}

/** O que a detecção achou por passo: a data do registro mais antigo, ou null. */
export type DeteccaoPassos = Partial<Record<PassoId, Date | string | null>>;

export const PAYLOAD_VAZIO: PrimeirosPassosPayload = { souDono: false, passos: [], feitos: 0, total: 0 };

/** Passos que o contrato libera, na ordem do catálogo. */
export function passosDoContrato(modulosContratados: readonly string[] | null): PassoCatalogo[] {
  return PRIMEIROS_PASSOS.filter((p) => contratoLibera(modulosContratados, p.modulos));
}

function isoDe(v: Date | string | null | undefined): string | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Monta o payload a partir do que foi detectado e do contrato. Puro: quem
 * chama já decidiu que é o dono (quem não é recebe `PAYLOAD_VAZIO`, nunca
 * dados). O cadeado olha a detecção do passo-pai mesmo quando o pai não
 * está na lista — hoje os dois (Cofre → Vigiar) vivem no mesmo módulo, mas
 * a regra não depende disso.
 */
export function montarPrimeirosPassos(
  detectado: DeteccaoPassos,
  modulosContratados: readonly string[] | null,
): PrimeirosPassosPayload {
  const passos = passosDoContrato(modulosContratados).map<PassoPrimeirosPassos>((p) => {
    const feitoEm = isoDe(detectado[p.id]);
    const feito = feitoEm != null;
    const paiFeito = p.dependeDe ? isoDe(detectado[p.dependeDe]) != null : true;
    return {
      id: p.id,
      titulo: p.titulo,
      descricao: p.descricao,
      feito,
      feitoEm,
      rota: p.rota,
      rotulo: p.rotulo,
      travadoPor: !feito && p.dependeDe && !paiFeito ? p.dependeDe : null,
      modulo: p.modulos[0] ?? null,
    };
  });
  const feitos = passos.filter((p) => p.feito).length;
  return { souDono: true, passos, feitos, total: passos.length };
}

/** O passo em destaque: o primeiro que falta e não está travado. */
export function passoAtual(passos: readonly PassoPrimeirosPassos[]): PassoId | null {
  return passos.find((p) => !p.feito && !p.travadoPor)?.id ?? null;
}

/** Número do passo (1..N) dentro da lista devolvida — é o que o cadeado cita. */
export function numeroDoPasso(passos: readonly PassoPrimeirosPassos[], id: PassoId | null): number | null {
  if (!id) return null;
  const i = passos.findIndex((p) => p.id === id);
  return i < 0 ? null : i + 1;
}
