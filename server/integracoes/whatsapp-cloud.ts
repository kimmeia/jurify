/**
 * WhatsApp Cloud API Client — CoEx (Coexistence)
 *
 * Envia mensagens via Cloud API oficial da Meta.
 * Recebe config do canal (accessToken, phoneNumberId, wabaId).
 *
 * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api
 */

import axios, { AxiosInstance } from "axios";
import type {
  WACloudTemplate,
  WACriarTemplateInput,
  WAComponenteTemplate,
  WABusinessProfile,
  WABotaoResposta,
  WASecaoLista,
} from "../../shared/whatsapp-cloud-types";

const GRAPH_API = "https://graph.facebook.com/v21.0";

// A Calling API (endpoints /calls, /settings de calling e o interactive
// call_permission_request) só existe a partir da v23.0. Mantida separada da
// mensageria (v21.0) de propósito: bumpar a versão global mudaria o
// comportamento de todo o envio de mensagem, que está estável na v21.0.
const GRAPH_API_CALLS = "https://graph.facebook.com/v23.0";

export interface WACloudConfig {
  accessToken: string;
  phoneNumberId: string;
  wabaId?: string;
}

/**
 * Monta o array `components` do payload de CRIAÇÃO de template a partir do
 * input estruturado da UI. Pure function (sem rede) — testável isolado.
 *
 * Regras da Meta cobertas:
 *   - BODY é obrigatório; HEADER/FOOTER/BUTTONS opcionais
 *   - Quando o corpo tem variáveis ({{1}}...), a Meta exige `example.body_text`
 *     com um array de exemplos (um valor por variável)
 */
export function montarComponentesCriacao(input: WACriarTemplateInput): WAComponenteTemplate[] {
  const components: WAComponenteTemplate[] = [];

  if (input.cabecalhoTexto && input.cabecalhoTexto.trim()) {
    components.push({ type: "HEADER", format: "TEXT", text: input.cabecalhoTexto.trim() });
  }

  const body: WAComponenteTemplate = { type: "BODY", text: input.corpo };
  const exemplos = (input.exemplosCorpo || []).filter((e) => e && e.trim());
  if (exemplos.length > 0) {
    body.example = { body_text: [exemplos] };
  }
  components.push(body);

  if (input.rodapeTexto && input.rodapeTexto.trim()) {
    components.push({ type: "FOOTER", text: input.rodapeTexto.trim() });
  }

  if (input.botoes && input.botoes.length > 0) {
    components.push({ type: "BUTTONS", buttons: input.botoes });
  }

  return components;
}

/**
 * Monta o `template.components` do payload de ENVIO a partir dos parâmetros
 * posicionais do corpo + media opcional no cabeçalho. Pure function.
 *
 * `bodyParams` vira `{ type: "body", parameters: [{ type: "text", text }] }`.
 * `headerImageUrl`/`headerImageId` viram o componente de header de imagem.
 */
export function montarComponentesEnvio(opts: {
  bodyParams?: string[];
  headerImageUrl?: string;
  headerImageId?: string;
}): WAComponenteTemplate[] | undefined {
  const components: any[] = [];

  if (opts.headerImageUrl || opts.headerImageId) {
    const image = opts.headerImageId
      ? { id: opts.headerImageId }
      : { link: opts.headerImageUrl };
    components.push({
      type: "header",
      parameters: [{ type: "image", image }],
    });
  }

  const params = (opts.bodyParams || []).filter((p) => p !== undefined && p !== null);
  if (params.length > 0) {
    components.push({
      type: "body",
      parameters: params.map((text) => ({ type: "text", text: String(text) })),
    });
  }

  return components.length > 0 ? (components as WAComponenteTemplate[]) : undefined;
}

export class WhatsAppCloudClient {
  private api: AxiosInstance;
  private apiCalls: AxiosInstance;
  private phoneNumberId: string;
  private accessToken: string;

  constructor(config: WACloudConfig) {
    this.phoneNumberId = config.phoneNumberId;
    this.accessToken = config.accessToken;
    this.api = axios.create({
      baseURL: GRAPH_API,
      headers: {
        "Authorization": `Bearer ${config.accessToken}`,
        "Content-Type": "application/json",
      },
      timeout: 15000,
    });
    // Instância dedicada à Calling API (v23.0) — ver GRAPH_API_CALLS.
    this.apiCalls = axios.create({
      baseURL: GRAPH_API_CALLS,
      headers: {
        "Authorization": `Bearer ${config.accessToken}`,
        "Content-Type": "application/json",
      },
      timeout: 15000,
    });
  }

  /** Enviar mensagem de texto */
  async enviarTexto(telefone: string, texto: string): Promise<string> {
    const res = await this.api.post(`/${this.phoneNumberId}/messages`, {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: telefone.replace(/\D/g, ""),
      type: "text",
      text: { body: texto },
    });
    return res.data?.messages?.[0]?.id || "";
  }

  /** Enviar mensagem de template */
  async enviarTemplate(telefone: string, templateName: string, languageCode = "pt_BR", components?: any[]): Promise<string> {
    const payload: any = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: telefone.replace(/\D/g, ""),
      type: "template",
      template: {
        name: templateName,
        language: { code: languageCode },
      },
    };
    if (components) payload.template.components = components;

    const res = await this.api.post(`/${this.phoneNumberId}/messages`, payload);
    return res.data?.messages?.[0]?.id || "";
  }

  /** Enviar imagem */
  async enviarImagem(telefone: string, imageUrl: string, caption?: string): Promise<string> {
    const res = await this.api.post(`/${this.phoneNumberId}/messages`, {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: telefone.replace(/\D/g, ""),
      type: "image",
      image: { link: imageUrl, caption },
    });
    return res.data?.messages?.[0]?.id || "";
  }

  /** Enviar documento */
  async enviarDocumento(telefone: string, docUrl: string, filename: string, caption?: string): Promise<string> {
    const res = await this.api.post(`/${this.phoneNumberId}/messages`, {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: telefone.replace(/\D/g, ""),
      type: "document",
      document: { link: docUrl, filename, caption },
    });
    return res.data?.messages?.[0]?.id || "";
  }

  /** Enviar vídeo (MP4 — único formato aceito pela Cloud API; máx 16 MB) */
  async enviarVideo(telefone: string, videoUrl: string, caption?: string): Promise<string> {
    const res = await this.api.post(`/${this.phoneNumberId}/messages`, {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: telefone.replace(/\D/g, ""),
      type: "video",
      video: { link: videoUrl, caption },
    });
    return res.data?.messages?.[0]?.id || "";
  }

  /** Enviar audio */
  async enviarAudio(telefone: string, audioUrl: string): Promise<string> {
    const res = await this.api.post(`/${this.phoneNumberId}/messages`, {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: telefone.replace(/\D/g, ""),
      type: "audio",
      audio: { link: audioUrl },
    });
    return res.data?.messages?.[0]?.id || "";
  }

  /**
   * Sobe mídia pro endpoint /media e devolve o media_id. Enviar por id (em vez
   * de `link`) evita depender de uma URL pública — o servidor manda os bytes
   * direto pra Meta. Usa um POST próprio porque o multipart precisa do boundary
   * que o axios calcula do FormData; a instância padrão força JSON.
   */
  async uploadMedia(buffer: Buffer, mime: string, filename: string): Promise<string> {
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("file", new Blob([new Uint8Array(buffer)], { type: mime }), filename);
    const res = await axios.post(`${GRAPH_API}/${this.phoneNumberId}/media`, form, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
      timeout: 30_000,
      maxBodyLength: Infinity,
    });
    return res.data?.id || "";
  }

  private async enviarMidiaPorId(telefone: string, payload: Record<string, unknown>): Promise<string> {
    const res = await this.api.post(`/${this.phoneNumberId}/messages`, {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: telefone.replace(/\D/g, ""),
      ...payload,
    });
    return res.data?.messages?.[0]?.id || "";
  }

  /** Enviar áudio (nota de voz) por media_id já carregado via uploadMedia. */
  async enviarAudioPorId(telefone: string, mediaId: string): Promise<string> {
    return this.enviarMidiaPorId(telefone, { type: "audio", audio: { id: mediaId } });
  }

  /** Enviar imagem por media_id. */
  async enviarImagemPorId(telefone: string, mediaId: string, caption?: string): Promise<string> {
    return this.enviarMidiaPorId(telefone, { type: "image", image: { id: mediaId, caption } });
  }

  /** Enviar documento por media_id. */
  async enviarDocumentoPorId(telefone: string, mediaId: string, filename: string, caption?: string): Promise<string> {
    return this.enviarMidiaPorId(telefone, { type: "document", document: { id: mediaId, filename, caption } });
  }

  async enviarVideoPorId(telefone: string, mediaId: string, caption?: string): Promise<string> {
    return this.enviarMidiaPorId(telefone, { type: "video", video: { id: mediaId, caption } });
  }

  /** Marcar mensagem como lida */
  async marcarLida(messageId: string): Promise<void> {
    await this.api.post(`/${this.phoneNumberId}/messages`, {
      messaging_product: "whatsapp",
      status: "read",
      message_id: messageId,
    });
  }

  /**
   * Mostra "digitando…" pro cliente. A Cloud API atrela o indicador à
   * última mensagem RECEBIDA (marca como lida junto); ele some sozinho
   * em ~25s ou quando a próxima mensagem é enviada. Best-effort — quem
   * chama trata falha como não-fatal.
   */
  async enviarTypingIndicator(messageIdRecebido: string): Promise<void> {
    await this.api.post(`/${this.phoneNumberId}/messages`, {
      messaging_product: "whatsapp",
      status: "read",
      message_id: messageIdRecebido,
      typing_indicator: { type: "text" },
    });
  }

  /** Baixar media (retorna URL temporaria) */
  async getMediaUrl(mediaId: string): Promise<string> {
    const res = await this.api.get(`/${mediaId}`);
    return res.data?.url || "";
  }

  // ─── Message Templates (Management API da WABA) ─────────────────────────────

  /** Lista os templates de mensagem da WABA. */
  async listarTemplates(wabaId: string): Promise<WACloudTemplate[]> {
    const res = await this.api.get(`/${wabaId}/message_templates`, {
      params: { limit: 200, fields: "name,status,category,language,components,id" },
    });
    return (res.data?.data || []) as WACloudTemplate[];
  }

  /** Cria um template de mensagem na WABA. Retorna id + status de aprovação. */
  async criarTemplate(
    wabaId: string,
    input: WACriarTemplateInput,
  ): Promise<{ id: string; status: string; category: string }> {
    const res = await this.api.post(`/${wabaId}/message_templates`, {
      name: input.nome,
      language: input.idioma,
      category: input.categoria,
      components: montarComponentesCriacao(input),
    });
    return {
      id: res.data?.id || "",
      status: res.data?.status || "",
      category: res.data?.category || input.categoria,
    };
  }

  /** Exclui um template (por nome) da WABA. */
  async excluirTemplate(wabaId: string, nome: string, hsmId?: string): Promise<void> {
    await this.api.delete(`/${wabaId}/message_templates`, {
      params: hsmId ? { name: nome, hsm_id: hsmId } : { name: nome },
    });
  }

  // ─── Business Profile (perfil do número) ────────────────────────────────────

  /** Lê o perfil de negócio do número. */
  async getBusinessProfile(): Promise<WABusinessProfile> {
    const res = await this.api.get(`/${this.phoneNumberId}/whatsapp_business_profile`, {
      params: {
        fields: "about,address,description,email,vertical,websites,profile_picture_url",
      },
    });
    return (res.data?.data?.[0] || {}) as WABusinessProfile;
  }

  /** Atualiza o perfil de negócio do número (campos parciais). */
  async atualizarBusinessProfile(fields: WABusinessProfile): Promise<void> {
    await this.api.post(`/${this.phoneNumberId}/whatsapp_business_profile`, {
      messaging_product: "whatsapp",
      ...fields,
    });
  }

  // ─── Mensagens interativas + reações ────────────────────────────────────────

  /** Envia mensagem com botões de resposta rápida (até 3). */
  async enviarBotoes(
    telefone: string,
    corpo: string,
    botoes: WABotaoResposta[],
    opts?: { cabecalho?: string; rodape?: string },
  ): Promise<string> {
    const interactive: any = {
      type: "button",
      body: { text: corpo },
      action: {
        buttons: botoes.slice(0, 3).map((b) => ({
          type: "reply",
          reply: { id: b.id, title: b.titulo },
        })),
      },
    };
    if (opts?.cabecalho) interactive.header = { type: "text", text: opts.cabecalho };
    if (opts?.rodape) interactive.footer = { text: opts.rodape };

    const res = await this.api.post(`/${this.phoneNumberId}/messages`, {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: telefone.replace(/\D/g, ""),
      type: "interactive",
      interactive,
    });
    return res.data?.messages?.[0]?.id || "";
  }

  /** Envia mensagem com lista de opções (menu). */
  async enviarLista(
    telefone: string,
    corpo: string,
    botaoTexto: string,
    secoes: WASecaoLista[],
    opts?: { cabecalho?: string; rodape?: string },
  ): Promise<string> {
    const interactive: any = {
      type: "list",
      body: { text: corpo },
      action: {
        button: botaoTexto,
        sections: secoes.map((s) => ({
          title: s.titulo,
          rows: s.itens.map((i) => ({
            id: i.id,
            title: i.titulo,
            description: i.descricao || undefined,
          })),
        })),
      },
    };
    if (opts?.cabecalho) interactive.header = { type: "text", text: opts.cabecalho };
    if (opts?.rodape) interactive.footer = { text: opts.rodape };

    const res = await this.api.post(`/${this.phoneNumberId}/messages`, {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: telefone.replace(/\D/g, ""),
      type: "interactive",
      interactive,
    });
    return res.data?.messages?.[0]?.id || "";
  }

  /** Reage a uma mensagem com um emoji (string vazia remove a reação). */
  async enviarReacao(telefone: string, messageId: string, emoji: string): Promise<string> {
    const res = await this.api.post(`/${this.phoneNumberId}/messages`, {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: telefone.replace(/\D/g, ""),
      type: "reaction",
      reaction: { message_id: messageId, emoji },
    });
    return res.data?.messages?.[0]?.id || "";
  }

  // ─── Calling API (ligação de voz no mesmo número) ───────────────────────────
  // Endpoints na v23.0 (this.apiCalls). Fluxo de entrada: webhook envia o
  // evento `connect` com o SDP offer → preAceitar (mídia) → aceitar (SDP
  // answer). Saída: pedir permissão → iniciarChamada (SDP offer) → encerrar.

  /** Lê as configurações de calling do número (status habilitado, ícone, etc). */
  async getCallingSettings(): Promise<Record<string, unknown>> {
    const res = await this.apiCalls.get(`/${this.phoneNumberId}/settings`, {
      params: { fields: "calling" },
    });
    const calling = res.data?.calling;
    return (calling && typeof calling === "object" ? calling : {}) as Record<string, unknown>;
  }

  /**
   * Habilita ou desabilita calling no número. `extra` aceita campos opcionais
   * do objeto `calling` da Meta (call_icon_visibility, call_hours, sip...) sem
   * precisar de um método novo por config.
   */
  async definirStatusCalling(
    status: "ENABLED" | "DISABLED",
    extra?: Record<string, unknown>,
  ): Promise<void> {
    await this.apiCalls.post(`/${this.phoneNumberId}/settings`, {
      calling: { status, ...(extra || {}) },
    });
  }

  /** POST genérico em /calls. `connect` (saída) não tem call_id ainda. */
  private async acaoChamada(
    callId: string,
    action: "connect" | "pre_accept" | "accept" | "reject" | "terminate",
    session?: { sdp_type: "offer" | "answer"; sdp: string },
    extra?: Record<string, unknown>,
  ): Promise<any> {
    const payload: Record<string, unknown> = {
      messaging_product: "whatsapp",
      action,
      ...(extra || {}),
    };
    if (callId) payload.call_id = callId;
    if (session) payload.session = session;
    const res = await this.apiCalls.post(`/${this.phoneNumberId}/calls`, payload);
    return res.data;
  }

  /**
   * Pre-aceita uma chamada recebida com o SDP answer. Estabelece a conexão de
   * mídia ANTES do accept — a Meta recomenda pra conectar mais rápido e evitar
   * cortar o começo do áudio. `accept` antes de `pre_accept` é rejeitado.
   */
  async preAceitarChamada(callId: string, sdpAnswer: string): Promise<void> {
    await this.acaoChamada(callId, "pre_accept", { sdp_type: "answer", sdp: sdpAnswer });
  }

  /** Aceita (atende) uma chamada recebida com o SDP answer. */
  async aceitarChamada(callId: string, sdpAnswer: string): Promise<void> {
    await this.acaoChamada(callId, "accept", { sdp_type: "answer", sdp: sdpAnswer });
  }

  /** Recusa uma chamada recebida. */
  async rejeitarChamada(callId: string): Promise<void> {
    await this.acaoChamada(callId, "reject");
  }

  /** Encerra uma chamada em andamento (de qualquer direção). */
  async encerrarChamada(callId: string): Promise<void> {
    await this.acaoChamada(callId, "terminate");
  }

  /**
   * Inicia uma chamada da empresa pro cliente (business-initiated) com o SDP
   * offer gerado no navegador do atendente. Exige permissão de ligação já
   * concedida pelo cliente. Retorna o call_id criado pela Meta.
   */
  async iniciarChamada(
    telefone: string,
    sdpOffer: string,
    bizOpaqueCallbackData?: string,
  ): Promise<string> {
    const data = await this.acaoChamada("", "connect", { sdp_type: "offer", sdp: sdpOffer }, {
      to: telefone.replace(/\D/g, ""),
      ...(bizOpaqueCallbackData ? { biz_opaque_callback_data: bizOpaqueCallbackData } : {}),
    });
    return data?.calls?.[0]?.id || "";
  }

  /**
   * Envia o pedido de permissão de ligação (interactive call_permission_request).
   * O cliente precisa aprovar antes da empresa poder ligar (validade de 7 dias).
   * Retorna o message_id.
   */
  async pedirPermissaoLigacao(telefone: string, texto: string): Promise<string> {
    const res = await this.apiCalls.post(`/${this.phoneNumberId}/messages`, {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: telefone.replace(/\D/g, ""),
      type: "interactive",
      interactive: {
        type: "call_permission_request",
        action: { name: "call_permission_request" },
        body: { text: texto },
      },
    });
    return res.data?.messages?.[0]?.id || "";
  }

  /** Testar conexao (verifica se o token e phoneNumberId sao validos) */
  async testarConexao(): Promise<{ ok: boolean; nome?: string; telefone?: string; erro?: string }> {
    try {
      const res = await this.api.get(`/${this.phoneNumberId}`, {
        params: { fields: "display_phone_number,verified_name,quality_rating" },
      });
      return {
        ok: true,
        nome: res.data?.verified_name || "",
        telefone: res.data?.display_phone_number || "",
      };
    } catch (err: any) {
      const msg = err.response?.data?.error?.message || err.message;
      return { ok: false, erro: msg };
    }
  }
}
