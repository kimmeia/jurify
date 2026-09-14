/**
 * Decide se ESTE aviso, pra ESTA pessoa, toca o celular agora.
 *
 * Três coisas, nesta ordem, e a ordem é o desenho:
 *
 * 1. **Aviso desconhecido passa.** `avisoDoTipo` devolve null pro que o
 *    catálogo não declara, e null é "manda". Nenhum aviso que funciona hoje
 *    para de funcionar porque eu esqueci de mapear.
 * 2. **A escolha da pessoa manda.** Só o que diverge do padrão está no banco;
 *    linha ausente é o padrão de fábrica.
 * 3. **O silêncio é o último filtro**, e só segura o PUSH. A notificação
 *    continua sendo criada, continua no sino e continua chegando pelo SSE —
 *    silêncio é "não toque o meu celular de madrugada", não "esconda de mim".
 *
 * A leitura é cacheada por usuário por pouco tempo: o cron de movimentações
 * dispara em rajada e não pode virar uma consulta por notificação. O cache
 * guarda o mapa inteiro do usuário e é invalidado quando ele salva.
 */

import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { notificacaoPreferencias, colaboradores, escritorios } from "../../drizzle/schema";
import {
  avisoDoTipo,
  dentroDoSilencio,
  padraoDaChave,
  AJUSTE_ALCANCE,
  AJUSTE_SILENCIO,
} from "@shared/notificacoes-avisos";
import { FUSO_HORARIO_PADRAO } from "@shared/escritorio-types";
import { createLogger } from "./logger";

const log = createLogger("preferencias-notificacao");

const VALIDADE_MS = 60_000;

interface Cacheado {
  mapa: Map<string, boolean>;
  fuso: string;
  em: number;
}

const cache = new Map<number, Cacheado>();

/** Chamado quando a pessoa salva — senão a escolha demoraria até um minuto. */
export function esquecerPreferencias(userId: number): void {
  cache.delete(userId);
}

/** Só pra teste: zera tudo entre casos. */
export function limparCachePreferencias(): void {
  cache.clear();
}

async function carregar(userId: number): Promise<Cacheado | null> {
  const agora = Date.now();
  const guardado = cache.get(userId);
  if (guardado && agora - guardado.em < VALIDADE_MS) return guardado;

  const db = await getDb();
  if (!db) return null;

  const linhas = await db
    .select({ chave: notificacaoPreferencias.chave, ligado: notificacaoPreferencias.ligado })
    .from(notificacaoPreferencias)
    .where(eq(notificacaoPreferencias.userId, userId));

  // O fuso vem do escritório da pessoa: silêncio "das 21h" é 21h onde ela
  // está, não onde o servidor está.
  let fuso = FUSO_HORARIO_PADRAO;
  try {
    const [row] = await db
      .select({ fuso: escritorios.fusoHorario })
      .from(colaboradores)
      .innerJoin(escritorios, eq(colaboradores.escritorioId, escritorios.id))
      .where(eq(colaboradores.userId, userId))
      .limit(1);
    if (row?.fuso) fuso = row.fuso;
  } catch {
    /* fuso é conforto, não correção: o padrão serve */
  }

  const novo: Cacheado = {
    mapa: new Map(linhas.map((l) => [l.chave, Boolean(l.ligado)])),
    fuso,
    em: agora,
  };
  cache.set(userId, novo);
  return novo;
}

/** A hora local (0–23) naquele fuso, sem depender do fuso do servidor. */
export function horaLocalEm(fuso: string, quando: Date): number {
  try {
    const txt = new Intl.DateTimeFormat("pt-BR", {
      timeZone: fuso,
      hour: "2-digit",
      hour12: false,
    }).format(quando);
    const n = Number(txt.replace(/\D/g, ""));
    return Number.isFinite(n) ? n % 24 : quando.getUTCHours();
  } catch {
    return quando.getUTCHours();
  }
}

export interface DecisaoPush {
  enviar: boolean;
  /** Por que não. Só pra log — a tela nunca vê isto. */
  motivo?: "desligado" | "silencio";
}

/**
 * O push sai?
 *
 * Nunca lança e nunca bloqueia por dúvida: banco fora, usuário sem linha,
 * tipo desconhecido — tudo isso passa. O único "não" é o explícito.
 */
/**
 * A decisão, sem banco e sem relógio: dá pra testar de verdade.
 *
 * A ordem importa e é o desenho: desligado vence silêncio. Quem desligou o
 * aviso não precisa que a hora seja consultada, e trocar a ordem faria o
 * motivo do log mentir sobre por que o celular não tocou.
 */
export function decidirPush(opts: {
  aviso: string | null;
  mapa: Map<string, boolean>;
  horaLocal: number;
}): DecisaoPush {
  if (!opts.aviso) return { enviar: true };

  const ligado = opts.mapa.get(opts.aviso) ?? padraoDaChave(opts.aviso);
  if (!ligado) return { enviar: false, motivo: "desligado" };

  const silencio = opts.mapa.get(AJUSTE_SILENCIO) ?? padraoDaChave(AJUSTE_SILENCIO);
  if (silencio && dentroDoSilencio(opts.horaLocal)) {
    return { enviar: false, motivo: "silencio" };
  }
  return { enviar: true };
}

export async function pushPermitido(
  userId: number,
  tipo: string,
  dados?: Record<string, unknown> | null,
  agora: Date = new Date(),
): Promise<DecisaoPush> {
  const aviso = avisoDoTipo(tipo, dados);
  if (!aviso) return { enviar: true };

  try {
    const pref = await carregar(userId);
    if (!pref) return { enviar: true };
    return decidirPush({ aviso, mapa: pref.mapa, horaLocal: horaLocalEm(pref.fuso, agora) });
  } catch (err) {
    log.warn({ userId, tipo, err: (err as Error).message }, "[push] preferência indisponível — enviando");
    return { enviar: true };
  }
}

/** Uma chave qualquer está ligada pra este usuário? Usado pelos ajustes. */
export async function ajusteLigado(userId: number, chave: string): Promise<boolean> {
  try {
    const pref = await carregar(userId);
    if (!pref) return padraoDaChave(chave);
    return pref.mapa.get(chave) ?? padraoDaChave(chave);
  } catch {
    return padraoDaChave(chave);
  }
}

/**
 * O dono quer receber o que é dos colaboradores?
 *
 * Existe porque o aviso de movimentação sempre foi para quem CADASTROU o
 * processo no vigia — se um colaborador cadastrou, o dono nunca soube. A chave
 * nasce desligada: ligar é decisão dele, não padrão nosso.
 *
 * Devolve o userId do dono, ou null quando ele já é quem seria avisado, quando
 * não quer, ou quando não dá pra saber.
 */
export async function donoQueQuerTudo(
  escritorioId: number,
  jaAvisadoUserId: number | null | undefined,
): Promise<number | null> {
  try {
    const db = await getDb();
    if (!db) return null;
    const [dono] = await db
      .select({ userId: colaboradores.userId })
      .from(colaboradores)
      .where(
        and(
          eq(colaboradores.escritorioId, escritorioId),
          eq(colaboradores.cargo, "dono"),
          eq(colaboradores.ativo, true),
        ),
      )
      .limit(1);
    if (!dono?.userId || dono.userId === jaAvisadoUserId) return null;
    return (await ajusteLigado(dono.userId, AJUSTE_ALCANCE)) ? dono.userId : null;
  } catch {
    return null;
  }
}
