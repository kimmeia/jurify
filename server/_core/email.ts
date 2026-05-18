/**
 * Serviço de email via Resend API.
 *
 * Usa fetch direto — não precisa de SDK.
 *
 * A API key pode ser configurada de duas formas, na ordem de prioridade:
 *   1. Admin → Integrações → Resend (recomendado — trocável sem redeploy)
 *   2. Variável de ambiente RESEND_API_KEY (fallback/bootstrap)
 *
 * Grátis até 100 emails/dia, 3000/mês.
 * Docs: https://resend.com/docs/api-reference
 */

import { createLogger } from "./logger";
const log = createLogger("email");

const APP_URL = process.env.APP_URL || process.env.VITE_APP_URL || "https://app.jurify.com.br";
const FROM_EMAIL = process.env.FROM_EMAIL || "Jurify <noreply@jurify.com.br>";

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  /**
   * Tipo do email para rastreio no log (bug #6). Padroniza por:
   * boas_vindas, redefinir_senha, convite_colaborador, outro.
   * Quando omitido, fica como "outro".
   */
  tipo?: string;
  escritorioId?: number;
  userId?: number;
}

/**
 * Persiste resultado do envio no `email_log` (bug #6). Antes os erros
 * viviam só no logger e somiam — admin não tinha como auditar nem reenviar.
 *
 * Best-effort: se o INSERT falhar (DB indisponível, schema fora de sync),
 * apenas loga e continua — falha de log NÃO deve impedir o caller original
 * de receber a resposta da chamada de email.
 */
async function registrarEmailLog(params: {
  tipo: string;
  destinatario: string;
  assunto: string;
  status: "sucesso" | "falha";
  erro?: string;
  escritorioId?: number;
  userId?: number;
  contexto?: { html: string; text?: string };
}): Promise<number | null> {
  try {
    const { getDb } = await import("../db");
    const { emailLog } = await import("../../drizzle/schema");
    const db = await getDb();
    if (!db) return null;

    const contextoJson = params.contexto
      ? JSON.stringify({ html: params.contexto.html, text: params.contexto.text })
      : null;

    const res: any = await db.insert(emailLog).values({
      tipo: params.tipo,
      destinatario: params.destinatario,
      assunto: params.assunto,
      status: params.status,
      erro: params.erro?.slice(0, 1024) ?? null,
      escritorioId: params.escritorioId ?? null,
      userId: params.userId ?? null,
      contextoJson,
    });
    return res?.[0]?.insertId ?? null;
  } catch (err: any) {
    log.warn({ err: err.message }, "Falha ao registrar email_log (best-effort, ignorado)");
    return null;
  }
}

type ResendKeyResult = {
  apiKey: string;
  fonte: "db" | "env" | "vazio";
  diagnostico?: string;
};

/**
 * Busca a API key do Resend. Tenta primeiro no banco (admin_integracoes) e
 * cai no ENV como fallback. Retorna também a "fonte" e diagnóstico para
 * troubleshooting (logs + mensagem de erro mais específica pro usuário).
 */
async function getResendApiKey(): Promise<ResendKeyResult> {
  let dbDiag = "";
  try {
    const { getDb } = await import("../db");
    const { adminIntegracoes } = await import("../../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const { decrypt } = await import("../escritorio/crypto-utils");
    const db = await getDb();
    if (!db) {
      dbDiag = "DB indisponível";
    } else {
      const [reg] = await db
        .select()
        .from(adminIntegracoes)
        .where(eq(adminIntegracoes.provedor, "resend"))
        .limit(1);

      if (!reg) {
        dbDiag = "nenhum registro 'resend' em admin_integracoes";
      } else if (reg.status !== "conectado") {
        dbDiag = `registro existe mas status='${reg.status}' (esperado 'conectado')`;
      } else if (!reg.apiKeyEncrypted || !reg.apiKeyIv || !reg.apiKeyTag) {
        dbDiag = "registro existe mas sem apiKeyEncrypted/iv/tag";
      } else {
        try {
          const apiKey = decrypt(reg.apiKeyEncrypted, reg.apiKeyIv, reg.apiKeyTag);
          if (apiKey) {
            log.info({ fonte: "db", preview: apiKey.slice(0, 6) + "…" }, "Resend key resolvida do DB");
            return { apiKey, fonte: "db" };
          }
          dbDiag = "decrypt retornou string vazia";
        } catch (err: any) {
          dbDiag = `decrypt falhou: ${err.message} — ENCRYPTION_KEY pode ter mudado`;
        }
      }
    }
  } catch (err: any) {
    dbDiag = `erro inesperado: ${err.message}`;
  }

  const envKey = process.env.RESEND_API_KEY || "";
  if (envKey) {
    log.info({ fonte: "env", dbDiag }, "Resend key resolvida do ENV (fallback)");
    return { apiKey: envKey, fonte: "env", diagnostico: dbDiag };
  }
  log.warn({ dbDiag }, "Nenhuma RESEND key disponível (DB nem ENV)");
  return { apiKey: "", fonte: "vazio", diagnostico: dbDiag };
}

export async function enviarEmail(options: EmailOptions): Promise<{ success: boolean; error?: string; logId?: number | null }> {
  const tipo = options.tipo ?? "outro";
  const { apiKey, fonte, diagnostico } = await getResendApiKey();

  if (!apiKey) {
    const erroMsg = diagnostico
      ? `Serviço de email não configurado. ${diagnostico}. Admin → Integrações → Resend.`
      : "Serviço de email não configurado. Admin deve conectar Resend em Admin → Integrações.";
    log.warn({ diagnostico }, "Resend API key não configurada — email não enviado");

    const logId = await registrarEmailLog({
      tipo,
      destinatario: options.to,
      assunto: options.subject,
      status: "falha",
      erro: erroMsg,
      escritorioId: options.escritorioId,
      userId: options.userId,
      contexto: { html: options.html, text: options.text },
    });

    return { success: false, error: erroMsg, logId };
  }
  log.debug({ fonte, to: options.to }, "Enviando email via Resend");

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [options.to],
        subject: options.subject,
        html: options.html,
        text: options.text,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      log.error({ status: res.status, err }, "Resend retornou erro");
      const erroMsg = `Erro ao enviar email: ${res.status} ${err.slice(0, 256)}`;
      const logId = await registrarEmailLog({
        tipo,
        destinatario: options.to,
        assunto: options.subject,
        status: "falha",
        erro: erroMsg,
        escritorioId: options.escritorioId,
        userId: options.userId,
        contexto: { html: options.html, text: options.text },
      });
      return { success: false, error: erroMsg, logId };
    }

    const data = await res.json();
    log.info({ to: options.to, id: data.id }, "Email enviado com sucesso");
    const logId = await registrarEmailLog({
      tipo,
      destinatario: options.to,
      assunto: options.subject,
      status: "sucesso",
      escritorioId: options.escritorioId,
      userId: options.userId,
      contexto: { html: options.html, text: options.text },
    });
    return { success: true, logId };
  } catch (err: any) {
    log.error({ err: err.message }, "Falha ao enviar email");
    const logId = await registrarEmailLog({
      tipo,
      destinatario: options.to,
      assunto: options.subject,
      status: "falha",
      erro: err.message,
      escritorioId: options.escritorioId,
      userId: options.userId,
      contexto: { html: options.html, text: options.text },
    });
    return { success: false, error: err.message, logId };
  }
}

export function getAppUrl(): string {
  return APP_URL;
}

/**
 * Email de convite para colaborador.
 */
export async function enviarEmailConvite(params: {
  email: string;
  nomeEscritorio: string;
  cargo: string;
  token: string;
  convidadoPor: string;
}): Promise<{ success: boolean; error?: string }> {
  const link = `${APP_URL}/convite/${params.token}`;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f9fafb;">
  <div style="background: white; border-radius: 12px; padding: 32px; border: 1px solid #e5e7eb;">
    <div style="text-align: center; margin-bottom: 24px;">
      <h1 style="font-size: 24px; color: #7c3aed; margin: 0;">Jurify</h1>
      <p style="color: #6b7280; font-size: 14px; margin-top: 4px;">Plataforma Jurídica</p>
    </div>

    <h2 style="font-size: 20px; color: #111827; margin-bottom: 8px;">Você foi convidado!</h2>

    <p style="color: #4b5563; font-size: 15px; line-height: 1.6;">
      <strong>${params.convidadoPor}</strong> convidou você para fazer parte do escritório
      <strong>${params.nomeEscritorio}</strong> como <strong>${params.cargo}</strong>.
    </p>

    <div style="text-align: center; margin: 32px 0;">
      <a href="${link}" style="display: inline-block; background: #7c3aed; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 15px;">
        Aceitar convite
      </a>
    </div>

    <p style="color: #9ca3af; font-size: 12px; text-align: center;">
      Este convite expira em 7 dias.<br>
      Se não reconhece quem enviou, ignore este email.
    </p>

    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">

    <p style="color: #9ca3af; font-size: 11px; text-align: center;">
      Se o botão não funcionar, copie e cole este link no navegador:<br>
      <a href="${link}" style="color: #7c3aed; word-break: break-all;">${link}</a>
    </p>
  </div>
</body>
</html>`;

  const text = `Você foi convidado para o escritório ${params.nomeEscritorio} como ${params.cargo}.\n\nAceite o convite: ${link}\n\nConvidado por: ${params.convidadoPor}\nExpira em 7 dias.`;

  return enviarEmail({
    to: params.email,
    subject: `Convite para ${params.nomeEscritorio} — Jurify`,
    html,
    text,
    tipo: "convite_colaborador",
  });
}

/**
 * Email de redefinição de senha. Link expira em 1h.
 */
export async function enviarEmailRedefinirSenha(params: {
  email: string;
  nome: string;
  token: string;
}): Promise<{ success: boolean; error?: string }> {
  const link = `${APP_URL}/redefinir-senha?token=${encodeURIComponent(params.token)}`;
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f9fafb;">
  <div style="background: white; border-radius: 12px; padding: 32px; border: 1px solid #e5e7eb;">
    <div style="text-align: center; margin-bottom: 24px;">
      <h1 style="font-size: 24px; color: #7c3aed; margin: 0;">Jurify</h1>
    </div>
    <h2 style="font-size: 20px; color: #111827; margin-bottom: 8px;">Redefinir sua senha</h2>
    <p style="color: #4b5563; font-size: 15px; line-height: 1.6;">Olá ${params.nome || "Usuário"},</p>
    <p style="color: #4b5563; font-size: 15px; line-height: 1.6;">
      Recebemos uma solicitação para redefinir sua senha do Jurify. Clique no botão abaixo pra escolher uma nova senha:
    </p>
    <div style="text-align: center; margin: 32px 0;">
      <a href="${link}" style="display: inline-block; background: #7c3aed; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 15px;">
        Redefinir senha
      </a>
    </div>
    <p style="color: #6b7280; font-size: 13px; line-height: 1.5;">
      Se o botão não funcionar, copie e cole no navegador:<br>
      <a href="${link}" style="color: #7c3aed; word-break: break-all;">${link}</a>
    </p>
    <p style="color: #9ca3af; font-size: 12px; margin-top: 24px; text-align: center;">
      Este link expira em <strong>1 hora</strong>.<br>
      Se você não solicitou, ignore este email — sua senha continua a mesma.
    </p>
    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
    <p style="color: #9ca3af; font-size: 11px; text-align: center;">Jurify — Plataforma Jurídica</p>
  </div>
</body>
</html>`;
  const text = `Olá ${params.nome || "Usuário"},\n\nRecebemos uma solicitação para redefinir sua senha do Jurify.\n\nAcesse o link abaixo (expira em 1h):\n${link}\n\nSe você não solicitou, ignore este email.`;
  return enviarEmail({ to: params.email, subject: "Redefinir sua senha — Jurify", html, text, tipo: "redefinir_senha" });
}

/**
 * Email de confirmação de cadastro (Fase 2 do roadmap de Planos).
 *
 * Disparado no signup. Cliente clica no link → `/confirmar-email/:token`
 * que valida e ativa a conta. Sem confirmar, login fica bloqueado.
 */
export async function enviarEmailConfirmacao(params: {
  email: string;
  nome: string;
  token: string;
}): Promise<{ success: boolean; error?: string }> {
  const link = `${APP_URL}/confirmar-email/${encodeURIComponent(params.token)}`;
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f9fafb;">
  <div style="background: white; border-radius: 12px; padding: 32px; border: 1px solid #e5e7eb;">
    <div style="text-align: center; margin-bottom: 24px;">
      <h1 style="font-size: 24px; color: #7c3aed; margin: 0;">Jurify</h1>
    </div>
    <h2 style="font-size: 20px; color: #111827; margin-bottom: 8px;">Confirme seu email</h2>
    <p style="color: #4b5563; font-size: 15px; line-height: 1.6;">Olá ${params.nome || "Usuário"},</p>
    <p style="color: #4b5563; font-size: 15px; line-height: 1.6;">
      Bem-vindo ao Jurify! Pra ativar sua conta e começar a usar a plataforma, clique no botão abaixo:
    </p>
    <div style="text-align: center; margin: 32px 0;">
      <a href="${link}" style="display: inline-block; background: #7c3aed; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 15px;">
        Confirmar email e entrar
      </a>
    </div>
    <p style="color: #6b7280; font-size: 13px; line-height: 1.5;">
      Se o botão não funcionar, copie e cole no navegador:<br>
      <a href="${link}" style="color: #7c3aed; word-break: break-all;">${link}</a>
    </p>
    <p style="color: #9ca3af; font-size: 12px; margin-top: 24px; text-align: center;">
      Este link expira em <strong>24 horas</strong>.<br>
      Se você não criou esta conta, ignore este email.
    </p>
    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
    <p style="color: #9ca3af; font-size: 11px; text-align: center;">Jurify — Plataforma Jurídica</p>
  </div>
</body>
</html>`;
  const text = `Olá ${params.nome || "Usuário"},\n\nBem-vindo ao Jurify!\n\nConfirme seu email pra ativar sua conta (link válido por 24h):\n${link}\n\nSe você não criou esta conta, ignore este email.`;
  return enviarEmail({
    to: params.email,
    subject: "Confirme seu email — Jurify",
    html,
    text,
    tipo: "confirmacao_email",
  });
}

/**
 * Emails do fluxo de trial (Fase 3 do roadmap de Planos). Disparados pelo
 * cron diário. Cada email tem flag idempotente em subscriptions pra evitar
 * reenvio.
 */
function templateTrialBase(opts: {
  titulo: string;
  saudacao: string;
  corpo: string;
  ctaLabel: string;
  ctaUrl: string;
  rodape?: string;
}): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f9fafb;">
  <div style="background: white; border-radius: 12px; padding: 32px; border: 1px solid #e5e7eb;">
    <div style="text-align: center; margin-bottom: 24px;">
      <h1 style="font-size: 24px; color: #7c3aed; margin: 0;">Jurify</h1>
    </div>
    <h2 style="font-size: 20px; color: #111827; margin-bottom: 8px;">${opts.titulo}</h2>
    <p style="color: #4b5563; font-size: 15px; line-height: 1.6;">${opts.saudacao}</p>
    <p style="color: #4b5563; font-size: 15px; line-height: 1.6;">${opts.corpo}</p>
    <div style="text-align: center; margin: 32px 0;">
      <a href="${opts.ctaUrl}" style="display: inline-block; background: #7c3aed; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 15px;">
        ${opts.ctaLabel}
      </a>
    </div>
    ${opts.rodape ? `<p style="color: #6b7280; font-size: 13px; line-height: 1.5;">${opts.rodape}</p>` : ""}
    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
    <p style="color: #9ca3af; font-size: 11px; text-align: center;">Jurify — Plataforma Jurídica</p>
  </div>
</body></html>`;
}

export async function enviarEmailTrialFaltam3Dias(params: {
  email: string;
  nome: string;
  planoNome: string;
}): Promise<{ success: boolean; error?: string }> {
  const link = `${APP_URL}/configuracoes?tab=meu-plano`;
  const html = templateTrialBase({
    titulo: "Seu trial termina em 3 dias",
    saudacao: `Olá ${params.nome || "Usuário"},`,
    corpo: `Seu trial do plano <strong>${params.planoNome}</strong> termina em 3 dias. Adicione uma forma de pagamento agora pra continuar usando o Jurify sem interrupção.`,
    ctaLabel: "Adicionar pagamento",
    ctaUrl: link,
    rodape: "Se preferir não continuar, é só ignorar este email — sua conta será automaticamente desativada no fim do período.",
  });
  const text = `Olá ${params.nome || "Usuário"},\n\nSeu trial do plano ${params.planoNome} termina em 3 dias.\n\nAdicione forma de pagamento: ${link}`;
  return enviarEmail({
    to: params.email,
    subject: "Seu trial Jurify termina em 3 dias",
    html,
    text,
    tipo: "trial_3dias",
  });
}

export async function enviarEmailTrialFaltam1Dia(params: {
  email: string;
  nome: string;
  planoNome: string;
}): Promise<{ success: boolean; error?: string }> {
  const link = `${APP_URL}/configuracoes?tab=meu-plano`;
  const html = templateTrialBase({
    titulo: "Seu trial termina amanhã",
    saudacao: `Olá ${params.nome || "Usuário"},`,
    corpo: `Última chamada: seu trial do plano <strong>${params.planoNome}</strong> termina amanhã. Adicione forma de pagamento agora pra não perder acesso.`,
    ctaLabel: "Continuar com o plano",
    ctaUrl: link,
  });
  const text = `Olá ${params.nome || "Usuário"},\n\nSeu trial do plano ${params.planoNome} termina amanhã.\n\nContinuar: ${link}`;
  return enviarEmail({
    to: params.email,
    subject: "Seu trial Jurify termina amanhã",
    html,
    text,
    tipo: "trial_1dia",
  });
}

export async function enviarEmailTrialExpirou(params: {
  email: string;
  nome: string;
  planoNome: string;
}): Promise<{ success: boolean; error?: string }> {
  const link = `${APP_URL}/configuracoes?tab=meu-plano`;
  const html = templateTrialBase({
    titulo: "Seu trial expirou",
    saudacao: `Olá ${params.nome || "Usuário"},`,
    corpo: `Seu trial do plano <strong>${params.planoNome}</strong> expirou. Pra continuar usando o Jurify, assine um plano agora.`,
    ctaLabel: "Assinar plano",
    ctaUrl: link,
    rodape: "Seus dados continuam guardados — você pode voltar a qualquer momento.",
  });
  const text = `Olá ${params.nome || "Usuário"},\n\nSeu trial do plano ${params.planoNome} expirou.\n\nAssinar: ${link}`;
  return enviarEmail({
    to: params.email,
    subject: "Seu trial Jurify expirou",
    html,
    text,
    tipo: "trial_expirou",
  });
}

/**
 * Email de boas-vindas pós-signup com CTA pra dashboard.
 */
export async function enviarEmailBoasVindas(params: {
  email: string;
  nome: string;
}): Promise<{ success: boolean; error?: string }> {
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f9fafb;">
  <div style="background: white; border-radius: 12px; padding: 32px; border: 1px solid #e5e7eb;">
    <div style="text-align: center; margin-bottom: 24px;">
      <h1 style="font-size: 28px; color: #7c3aed; margin: 0;">Bem-vindo ao Jurify!</h1>
    </div>
    <p style="color: #4b5563; font-size: 16px; line-height: 1.6;">Olá <strong>${params.nome}</strong>,</p>
    <p style="color: #4b5563; font-size: 15px; line-height: 1.6;">Sua conta foi criada com sucesso. Estamos felizes em ter você.</p>
    <p style="color: #4b5563; font-size: 15px; line-height: 1.6;">Pra começar, você pode:</p>
    <ul style="color: #4b5563; font-size: 15px; line-height: 1.8; padding-left: 20px;">
      <li>Cadastrar seus primeiros <strong>clientes</strong></li>
      <li>Organizar tarefas no <strong>Kanban</strong></li>
      <li>Acompanhar receitas e despesas no <strong>Financeiro</strong></li>
    </ul>
    <div style="text-align: center; margin: 32px 0;">
      <a href="${APP_URL}/dashboard" style="display: inline-block; background: #7c3aed; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 15px;">
        Acessar o Jurify
      </a>
    </div>
    <p style="color: #9ca3af; font-size: 13px; text-align: center; margin-top: 24px;">
      Estamos em <strong>versão Beta</strong> — sua opinião conta muito.<br>
      Use o menu <strong>Roadmap</strong> dentro do app pra sugerir melhorias.
    </p>
    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
    <p style="color: #9ca3af; font-size: 11px; text-align: center;">Jurify — Plataforma Jurídica</p>
  </div>
</body>
</html>`;
  const text = `Olá ${params.nome},\n\nSua conta no Jurify foi criada com sucesso. Estamos felizes em ter você.\n\nAcesse: ${APP_URL}/dashboard\n\nEstamos em versão Beta — use o menu Roadmap dentro do app pra sugerir melhorias.`;
  return enviarEmail({ to: params.email, subject: "Bem-vindo ao Jurify", html, text, tipo: "boas_vindas" });
}
