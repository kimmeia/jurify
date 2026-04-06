/**
 * Twilio VoIP Client — Faz chamadas telefônicas via Twilio REST API
 * 
 * Usa fetch nativo (sem SDK do Twilio) para manter leve.
 * Twilio REST API: https://api.twilio.com/2010-04-01/Accounts/{SID}/Calls.json
 * 
 * Auth: Basic (AccountSID:AuthToken)
 */

export interface TwilioConfig {
  twilioSid: string;
  twilioAuthToken: string;
  twilioPhoneNumber: string; // número Twilio (remetente)
}

export interface TwilioCallResult {
  success: boolean;
  callSid?: string;
  status?: string;
  erro?: string;
}

/**
 * Inicia uma chamada telefônica via Twilio.
 * 
 * O `twimlUrl` define o que acontece quando a chamada é atendida.
 * Para uma chamada simples de ponte (conectar 2 pessoas), usamos
 * o TwiML inline via `Twiml` param que faz um <Dial> para o atendente.
 * 
 * Fluxo simplificado:
 * - Twilio liga para o `destino` (cliente)
 * - Quando atende, reproduz o TwiML que conecta ao `atendente` (número do escritório)
 */
export async function iniciarChamada(
  config: TwilioConfig,
  destino: string,        // número do cliente (quem vai receber a chamada)
  atendente?: string,     // número do atendente (se quiser ponte) - opcional
): Promise<TwilioCallResult> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${config.twilioSid}/Calls.json`;

  // Basic auth
  const auth = Buffer.from(`${config.twilioSid}:${config.twilioAuthToken}`).toString("base64");

  // Formatar números
  const from = formatPhone(config.twilioPhoneNumber);
  const to = formatPhone(destino);

  // TwiML: se tem atendente, faz ponte; senão, apenas toca e desliga
  let twiml: string;
  if (atendente) {
    const atendenteFormatado = formatPhone(atendente);
    twiml = `<Response><Say language="pt-BR">Conectando sua chamada.</Say><Dial callerId="${from}" timeout="30"><Number>${atendenteFormatado}</Number></Dial></Response>`;
  } else {
    // Chamada simples — liga e reproduz mensagem
    twiml = `<Response><Say language="pt-BR">Olá! Esta é uma chamada de teste do sistema. Obrigado.</Say><Hangup/></Response>`;
  }

  const body = new URLSearchParams({
    To: to,
    From: from,
    Twiml: twiml,
  });

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[Twilio] Erro ${response.status}:`, errText);

      // Tentar extrair mensagem de erro do Twilio
      let erroMsg = `Twilio erro: ${response.status}`;
      try {
        const errJson = JSON.parse(errText);
        erroMsg = errJson.message || errJson.more_info || erroMsg;
      } catch { /* ignore */ }

      return { success: false, erro: erroMsg };
    }

    const data = await response.json();
    console.log(`[Twilio] Chamada iniciada: SID=${data.sid}, status=${data.status}`);

    return {
      success: true,
      callSid: data.sid,
      status: data.status, // "queued" ou "initiated"
    };
  } catch (err: any) {
    console.error(`[Twilio] Erro ao iniciar chamada:`, err.message);
    return { success: false, erro: err.message };
  }
}

/**
 * Consulta o status de uma chamada existente.
 */
export async function statusChamada(
  config: TwilioConfig,
  callSid: string,
): Promise<{ status: string; duration?: number; erro?: string }> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${config.twilioSid}/Calls/${callSid}.json`;
  const auth = Buffer.from(`${config.twilioSid}:${config.twilioAuthToken}`).toString("base64");

  try {
    const response = await fetch(url, {
      headers: { "Authorization": `Basic ${auth}` },
    });

    if (!response.ok) {
      return { status: "erro", erro: `HTTP ${response.status}` };
    }

    const data = await response.json();
    return {
      status: data.status, // queued, ringing, in-progress, completed, failed, busy, no-answer, canceled
      duration: data.duration ? parseInt(data.duration) : undefined,
    };
  } catch (err: any) {
    return { status: "erro", erro: err.message };
  }
}

/**
 * Encerra uma chamada ativa via Twilio API.
 */
export async function encerrarChamada(
  config: TwilioConfig,
  callSid: string,
): Promise<{ success: boolean; erro?: string }> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${config.twilioSid}/Calls/${callSid}.json`;
  const auth = Buffer.from(`${config.twilioSid}:${config.twilioAuthToken}`).toString("base64");

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ Status: "completed" }).toString(),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[Twilio] Erro ao encerrar chamada:`, errText);
      return { success: false, erro: `HTTP ${response.status}` };
    }

    console.log(`[Twilio] Chamada ${callSid} encerrada`);
    return { success: true };
  } catch (err: any) {
    return { success: false, erro: err.message };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatPhone(phone: string): string {
  // Se já tem +, preservar mas normalizar Brasil
  const raw = phone.startsWith("+") ? phone.substring(1) : phone.replace(/\D/g, "");
  const clean = raw.replace(/\D/g, "");

  // Número começando com 1 = EUA/Canadá (Twilio numbers)
  if (clean.startsWith("1") && clean.length >= 10 && clean.length <= 11) {
    return `+${clean}`;
  }

  // Número brasileiro com DDI 55
  if (clean.startsWith("55")) {
    return `+${normalizarBrasil(clean)}`;
  }

  // Número brasileiro sem DDI (10-11 dígitos)
  if (clean.length === 10 || clean.length === 11) {
    return `+${normalizarBrasil("55" + clean)}`;
  }

  // Qualquer outro: assumir que já tem DDI
  return `+${clean}`;
}

/**
 * Normaliza número brasileiro para garantir o 9º dígito em celulares.
 * Formato esperado: 55 + DDD(2) + número(8 ou 9)
 * 
 * Celulares brasileiros (pós 2012) têm 9 dígitos: 55 + XX + 9XXXX-XXXX
 * Se receber 55 + XX + XXXX-XXXX (8 dígitos começando com 6-9), adiciona o 9.
 */
function normalizarBrasil(numero: string): string {
  // 55 + DDD(2) + 8 dígitos = falta o 9
  // Total: 12 dígitos
  if (numero.length === 12) {
    const ddd = numero.substring(2, 4);
    const local = numero.substring(4); // 8 dígitos
    const primeiro = local.charAt(0);

    // Se começa com 6, 7, 8 ou 9 → é celular, adicionar 9 na frente
    if (["6", "7", "8", "9"].includes(primeiro)) {
      return `55${ddd}9${local}`;
    }
  }

  // Já tem 13 dígitos (55 + DDD + 9 + 8 dígitos) → ok
  return numero;
}
