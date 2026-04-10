/**
 * Serviço de email via Resend API.
 *
 * Usa fetch direto — não precisa de SDK.
 * Configure RESEND_API_KEY no .env.
 *
 * Grátis até 100 emails/dia, 3000/mês.
 * Docs: https://resend.com/docs/api-reference
 */

import { createLogger } from "./logger";
const log = createLogger("email");

const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const APP_URL = process.env.APP_URL || process.env.VITE_APP_URL || "https://app.jurify.com.br";
const FROM_EMAIL = process.env.FROM_EMAIL || "Jurify <noreply@jurify.com.br>";

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export async function enviarEmail(options: EmailOptions): Promise<{ success: boolean; error?: string }> {
  if (!RESEND_API_KEY) {
    log.warn("RESEND_API_KEY não configurada — email não enviado");
    return { success: false, error: "Serviço de email não configurado. Configure RESEND_API_KEY." };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${RESEND_API_KEY}`,
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
      return { success: false, error: `Erro ao enviar email: ${res.status}` };
    }

    const data = await res.json();
    log.info({ to: options.to, id: data.id }, "Email enviado com sucesso");
    return { success: true };
  } catch (err: any) {
    log.error({ err: err.message }, "Falha ao enviar email");
    return { success: false, error: err.message };
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
  });
}
