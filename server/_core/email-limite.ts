/**
 * Monitor do limite diário de e-mails (Resend).
 *
 * O plano grátis corta em 100 e-mails/dia — e o corte pega justamente o
 * e-mail de confirmação de cadastro, que trava a conta nova. O dono decidiu
 * fazer upgrade só quando precisar, então este monitor garante que ele
 * FIQUE SABENDO: aviso amarelo aos 80% (e-mail sai na hora, ainda tem
 * cota), aviso vermelho no estouro (o e-mail fica retido no log como falha
 * e sai sozinho quando a cota renova), e reenvio automático de tudo que
 * falhou por limite — confirmações primeiro.
 *
 * Tudo deriva do próprio email_log; nenhum estado novo no banco. O "dia"
 * é UTC porque é o relógio que o Resend usa pra zerar a cota.
 */

import { and, asc, eq, gte, sql } from "drizzle-orm";
import { getDb } from "../db";
import { configSistema, emailLog, users } from "../../drizzle/schema";
import { enviarEmail } from "./email";
import { createLogger } from "./logger";
import { ehEmailDeTeste } from "../../shared/escritorio-de-teste";

const log = createLogger("email-limite");

export const LIMITE_DIARIO_PADRAO = 100;
/** Fração do limite que acende o aviso amarelo (80%). */
export const FRACAO_AVISO = 0.8;
export const TIPO_ALERTA = "alerta_limite_email";
/** Máximo de reenvios automáticos por tick — se a cota re-estourar, o
 *  primeiro 429 já interrompe o lote; isto é o cinto de segurança. */
const MAX_REENVIOS_POR_TICK = 50;

/**
 * O erro gravado no email_log tem o formato `${status} ${body}` — 429 é o
 * código do Resend pra limite/rate. As palavras cobrem variações do body.
 */
export function ehErroDeLimite(erro: string | null | undefined): boolean {
  if (!erro) return false;
  const e = erro.toLowerCase();
  return (
    e.startsWith("429") ||
    e.includes("rate limit") ||
    e.includes("rate_limit") ||
    e.includes("too many requests") ||
    e.includes("quota")
  );
}

export type NivelLimite = "ok" | "aviso" | "estouro";

/**
 * Vermelho SÓ quando o Resend recusou de verdade (falha por limite) — no
 * plano pago nunca há 429, então usados>limite configurado não vira falso
 * alarme. Amarelo pela contagem própria; limite 0 = amarelo desligado
 * (é como marcar "fiz o upgrade" sem UI nova).
 */
export function decidirNivel(args: {
  usadosHoje: number;
  limite: number;
  falhasLimite24h: number;
}): NivelLimite {
  if (args.falhasLimite24h > 0) return "estouro";
  if (args.limite > 0 && args.usadosHoje >= Math.ceil(args.limite * FRACAO_AVISO)) return "aviso";
  return "ok";
}

/** Meia-noite UTC de hoje — o momento em que o Resend zera a cota. */
function inicioDoDiaUtc(agora = new Date()): Date {
  return new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate()));
}

async function lerLimiteConfigurado(db: any): Promise<number> {
  try {
    const [row] = await db
      .select({ valor: configSistema.valor })
      .from(configSistema)
      .where(eq(configSistema.chave, "resend_limite_diario"))
      .limit(1);
    if (!row?.valor) return LIMITE_DIARIO_PADRAO;
    const n = Number(row.valor);
    return Number.isFinite(n) && n >= 0 ? n : LIMITE_DIARIO_PADRAO;
  } catch {
    return LIMITE_DIARIO_PADRAO;
  }
}

export interface StatusLimite {
  usadosHoje: number;
  limite: number;
  nivel: NivelLimite;
  falhasLimite24h: number;
  confirmacoesFalhas24h: number;
  avisadoHoje: boolean;
}

/** Fotografia do consumo — alimenta o painel e o cron. */
export async function statusLimiteEmails(): Promise<StatusLimite | null> {
  const db = await getDb();
  if (!db) return null;

  const limite = await lerLimiteConfigurado(db);
  const hojeUtc = inicioDoDiaUtc();
  const ha24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [usados] = await db
    .select({ c: sql<number>`COUNT(*)` })
    .from(emailLog)
    .where(and(eq(emailLog.status, "sucesso"), gte(emailLog.createdAt, hojeUtc)));

  // Falhas recentes vêm inteiras e o filtro de "foi por limite?" roda em JS —
  // o padrão do erro (429/quota/rate) não cabe num LIKE só.
  const falhasRecentes = await db
    .select({ id: emailLog.id, erro: emailLog.erro, tipo: emailLog.tipo })
    .from(emailLog)
    .where(and(eq(emailLog.status, "falha"), gte(emailLog.createdAt, ha24h)))
    .limit(500);
  const porLimite = falhasRecentes.filter((f: any) => ehErroDeLimite(f.erro));

  const [avisos] = await db
    .select({ c: sql<number>`COUNT(*)` })
    .from(emailLog)
    .where(
      and(
        eq(emailLog.status, "sucesso"),
        eq(emailLog.tipo, TIPO_ALERTA),
        gte(emailLog.createdAt, hojeUtc),
      ),
    );

  const usadosHoje = Number(usados?.c ?? 0);
  const falhasLimite24h = porLimite.length;

  return {
    usadosHoje,
    limite,
    nivel: decidirNivel({ usadosHoje, limite, falhasLimite24h }),
    falhasLimite24h,
    confirmacoesFalhas24h: porLimite.filter((f: any) => f.tipo === "confirmacao_email").length,
    avisadoHoje: Number(avisos?.c ?? 0) > 0,
  };
}

function barraHtml(pct: number, cor: string): string {
  const largura = Math.max(2, Math.min(100, Math.round(pct)));
  return `<div style="height:8px;border-radius:99px;background:#f1f5f9;overflow:hidden;margin:8px 0 4px">
    <div style="height:8px;border-radius:99px;width:${largura}%;background:${cor}"></div>
  </div>`;
}

function htmlAviso(s: StatusLimite): { assunto: string; html: string } {
  const upgrade = `<a href="https://resend.com/settings/billing" style="display:inline-block;background:#7c3aed;color:#fff;border-radius:10px;padding:10px 18px;font-weight:700;text-decoration:none">Fazer upgrade no Resend</a>
  <p style="font-size:12px;color:#94a3b8;margin-top:6px">Leva 2 minutos: resend.com &rarr; Settings &rarr; Billing &rarr; plano Pro.</p>`;
  const rodape = `<p style="font-size:11px;color:#94a3b8;border-top:1px solid #f1f5f9;padding-top:10px;margin-top:18px">Você recebe no máximo 1 aviso desses por dia. Enviado pelo monitor de limite do JuridFlow.</p>`;

  if (s.nivel === "estouro") {
    return {
      assunto: `🚨 O limite diário de e-mails estourou — ${s.falhasLimite24h} não ${s.falhasLimite24h === 1 ? "saiu" : "saíram"}`,
      html: `<div style="font-family:Arial,sans-serif;max-width:560px;color:#334155;line-height:1.6">
        <h2 style="color:#0f172a">O plano grátis do Resend cortou os envios</h2>
        <p><b>${s.falhasLimite24h}</b> e-mail(s) foram recusados por limite nas últimas 24h${s.confirmacoesFalhas24h > 0 ? ` — <b>${s.confirmacoesFalhas24h} eram confirmação de cadastro</b> (contas novas travadas até o e-mail chegar)` : ""}.</p>
        ${barraHtml(100, "#e11d48")}
        <p style="font-size:12px;color:#64748b">${s.usadosHoje} de ${s.limite} e-mails do dia usados</p>
        <p><b>A boa notícia:</b> o JuridFlow reenvia sozinho tudo que falhou assim que a cota renova (é provavelmente por isso que este aviso chegou agora). Mas o upgrade evita o buraco de horas sem e-mail.</p>
        ${upgrade}${rodape}
      </div>`,
    };
  }
  const pct = s.limite > 0 ? Math.round((s.usadosHoje / s.limite) * 100) : 0;
  return {
    assunto: `⚠️ Seus e-mails chegaram a ${pct}% do limite diário`,
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;color:#334155;line-height:1.6">
      <h2 style="color:#0f172a">Tá chegando no teto do plano grátis do Resend</h2>
      <p>O JuridFlow já enviou <b>${s.usadosHoje} dos ${s.limite} e-mails</b> que o plano grátis permite por dia.</p>
      ${barraHtml(pct, "#f59e0b")}
      <p style="font-size:12px;color:#64748b">${s.usadosHoje} de ${s.limite} e-mails do dia</p>
      <p><b>Se estourar:</b> quem se cadastrar não recebe o e-mail de confirmação e não consegue entrar — e avisos de trial e resumos param até meia-noite. (Se estourar, o sistema reenvia tudo sozinho quando a cota zerar.)</p>
      ${upgrade}${rodape}
    </div>`,
  };
}

/** E-mails dos admins da plataforma — os destinatários do aviso. */
async function emailsDosAdmins(db: any): Promise<string[]> {
  const rows = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.role, "admin"))
    .limit(10);
  return rows
    .map((r: any) => r.email as string | null)
    .filter((e: string | null): e is string => !!e && e.includes("@") && !ehEmailDeTeste(e));
}

/**
 * Reenvia um e-mail falhado a partir do contextoJson — mesma mecânica do
 * reenviar manual do AdminEmailLog: enviarEmail grava um row novo e o row
 * original vira "sucesso" quando resolve (é a auto-cura que tira o card
 * vermelho do painel).
 */
async function reenviarDoLog(db: any, original: any): Promise<{ ok: boolean; porLimite: boolean }> {
  let payload: { html: string; text?: string };
  try {
    payload = JSON.parse(original.contextoJson);
  } catch {
    return { ok: false, porLimite: false };
  }
  const resultado = await enviarEmail({
    to: original.destinatario,
    subject: original.assunto,
    html: payload.html,
    text: payload.text,
    tipo: original.tipo,
    escritorioId: original.escritorioId ?? undefined,
    userId: original.userId ?? undefined,
  });
  await db
    .update(emailLog)
    .set({
      tentativas: (original.tentativas ?? 1) + 1,
      ultimaTentativaEm: new Date(),
      status: resultado.success ? "sucesso" : "falha",
      erro: resultado.success ? null : (resultado.error?.slice(0, 1024) ?? original.erro),
    })
    .where(eq(emailLog.id, original.id));
  return { ok: resultado.success, porLimite: !resultado.success && ehErroDeLimite(resultado.error) };
}

/**
 * Tick do cron (horário). Nunca lança — falha aqui não pode derrubar os
 * outros jobs do processo.
 */
export async function verificarLimiteEmails(): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;

    const s = await statusLimiteEmails();
    if (!s) return;

    // 1) Aviso por e-mail — no máximo 1 com sucesso por dia. No estouro o
    // próprio aviso falha por 429 e fica no log; os ticks seguintes tentam
    // de novo até a cota renovar (o dedup olha só SUCESSOS de hoje).
    if (s.nivel !== "ok" && !s.avisadoHoje) {
      const destinos = await emailsDosAdmins(db);
      const { assunto, html } = htmlAviso(s);
      for (const to of destinos) {
        await enviarEmail({ to, subject: assunto, html, tipo: TIPO_ALERTA });
      }
      log.info({ nivel: s.nivel, destinos: destinos.length }, "Aviso de limite de e-mails disparado");
    }

    // 2) Reenvio automático do que falhou por limite (últimas 48h),
    // confirmações de cadastro primeiro — são as que travam conta nova.
    // O primeiro 429 interrompe o lote: a cota ainda não renovou.
    const ha48h = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const candidatas = await db
      .select()
      .from(emailLog)
      .where(and(eq(emailLog.status, "falha"), gte(emailLog.createdAt, ha48h)))
      .orderBy(asc(emailLog.createdAt))
      .limit(200);
    const porLimite = candidatas
      .filter((f: any) => ehErroDeLimite(f.erro) && f.contextoJson)
      .sort((a: any, b: any) =>
        (a.tipo === "confirmacao_email" ? 0 : 1) - (b.tipo === "confirmacao_email" ? 0 : 1),
      )
      .slice(0, MAX_REENVIOS_POR_TICK);

    let reenviados = 0;
    for (const row of porLimite) {
      const r = await reenviarDoLog(db, row);
      if (r.porLimite) break;
      if (r.ok) reenviados++;
    }
    if (reenviados > 0) {
      log.info({ reenviados }, "E-mails falhados por limite reenviados automaticamente");
    }
  } catch (err: any) {
    log.error({ err: err?.message }, "verificarLimiteEmails falhou (ignorado)");
  }
}
