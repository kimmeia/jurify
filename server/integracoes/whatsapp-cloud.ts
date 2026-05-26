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
  private phoneNumberId: string;

  constructor(config: WACloudConfig) {
    this.phoneNumberId = config.phoneNumberId;
    this.api = axios.create({
      baseURL: GRAPH_API,
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

  /** Marcar mensagem como lida */
  async marcarLida(messageId: string): Promise<void> {
    await this.api.post(`/${this.phoneNumberId}/messages`, {
      messaging_product: "whatsapp",
      status: "read",
      message_id: messageId,
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
