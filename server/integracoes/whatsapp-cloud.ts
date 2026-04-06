/**
 * WhatsApp Cloud API Client — CoEx (Coexistence)
 *
 * Envia mensagens via Cloud API oficial da Meta.
 * Recebe config do canal (accessToken, phoneNumberId, wabaId).
 *
 * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api
 */

import axios, { AxiosInstance } from "axios";

const GRAPH_API = "https://graph.facebook.com/v21.0";

export interface WACloudConfig {
  accessToken: string;
  phoneNumberId: string;
  wabaId?: string;
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
