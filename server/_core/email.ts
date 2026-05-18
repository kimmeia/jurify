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

const APP_URL = process.env.APP_URL || process.env.VITE_APP_URL || "https://app.juridflow.com.br";
const FROM_EMAIL = process.env.FROM_EMAIL || "Jurify <noreply@juridflow.com.br>";

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
  // Validações defensivas — sem isso já tivemos casos em que o Resend
  // retornou 422 "Missing 'to' field" porque options.to chegou vazio,
  // gastando rate-limit à toa. Falhar cedo dá erro acionável pro caller.
  if (!options || typeof options !== "object") {
    log.error({}, "enviarEmail chamado sem options");
    return { success: false, error: "Email options ausente." };
  }
  const tipo = options.tipo ?? "outro";
  if (!options.to || typeof options.to !== "string" || !options.to.trim()) {
    log.error({ options }, "enviarEmail chamado sem 'to' válido");
    const erroMsg = "Destinatário (to) ausente.";
    const logId = await registrarEmailLog({
      tipo,
      destinatario: typeof options.to === "string" ? options.to : "(vazio)",
      assunto: options.subject ?? "(vazio)",
      status: "falha",
      erro: erroMsg,
      escritorioId: options.escritorioId,
      userId: options.userId,
      contexto: { html: options.html ?? "", text: options.text },
    });
    return { success: false, error: erroMsg, logId };
  }
  if (!options.subject?.trim() || !options.html?.trim()) {
    log.error({ subject: options.subject, hasHtml: !!options.html }, "enviarEmail sem subject/html");
    const erroMsg = "Email sem assunto ou corpo.";
    const logId = await registrarEmailLog({
      tipo,
      destinatario: options.to,
      assunto: options.subject ?? "(vazio)",
      status: "falha",
      erro: erroMsg,
      escritorioId: options.escritorioId,
      userId: options.userId,
      contexto: { html: options.html ?? "", text: options.text },
    });
    return { success: false, error: erroMsg, logId };
  }

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
      log.error(
        { status: res.status, err, from: FROM_EMAIL, to: options.to, subject: options.subject },
        "Resend retornou erro",
      );
      // Mensagem mais útil pro usuário final detectar problemas comuns.
      let userMsg = `Erro ao enviar email (${res.status}): ${err.slice(0, 256)}`;
      const errLower = err.toLowerCase();
      const dominioMatch = FROM_EMAIL.match(/@([^>\s]+)/);
      const dominio = dominioMatch ? dominioMatch[1] : FROM_EMAIL;
      if (errLower.includes("domain") && (errLower.includes("not verified") || errLower.includes("verify") || errLower.includes("valid"))) {
        userMsg = `Domínio "${dominio}" não está verificado no Resend. Em Resend → Domains: (1) adicione o domínio, (2) copie os registros DNS (MX/SPF/DKIM/DMARC) e cole no seu provedor de DNS, (3) volte no Resend e clique em "Verify DNS Records". A verificação só conclui quando todos os registros estiverem propagados (pode levar até 1h).`;
      } else if (errLower.includes("missing") && errLower.includes("to")) {
        userMsg = "Endereço de destino ausente. Verifique se o cadastro tem email válido.";
      } else if (res.status === 401) {
        userMsg = "API key do Resend inválida. Admin → Integrações → Resend.";
      } else if (res.status === 403 && !errLower.includes("domain")) {
        userMsg = "API key do Resend sem permissão. Admin → Integrações → Resend.";
      }
      // Log preserva a resposta crua do Resend (status + body) pra auditoria.
      // O usuário recebe userMsg traduzida; o admin no AdminEmailLog vê o motivo real.
      const erroLog = `${res.status} ${err.slice(0, 512)}`;
      const logId = await registrarEmailLog({
        tipo,
        destinatario: options.to,
        assunto: options.subject,
        status: "falha",
        erro: erroLog,
        escritorioId: options.escritorioId,
        userId: options.userId,
        contexto: { html: options.html, text: options.text },
      });
      return { success: false, error: userMsg, logId };
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
