/**
 * Testes — serviços da WhatsApp Cloud API (templates, perfil, interativas).
 *
 * Cobre os builders puros (montagem de `components`) e os métodos do client
 * com axios mockado, garantindo que o payload enviado ao Graph API segue o
 * formato exigido pela Meta.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  contarVariaveisTemplate,
  validarNomeTemplate,
} from "../../shared/whatsapp-cloud-types";

// ─── Helpers puros de shared ─────────────────────────────────────────────────

describe("contarVariaveisTemplate", () => {
  it("conta o maior índice posicional", () => {
    expect(contarVariaveisTemplate("Olá {{1}}, seu processo {{2}} foi atualizado.")).toBe(2);
  });

  it("ignora repetições e retorna o maior índice", () => {
    expect(contarVariaveisTemplate("{{1}} e {{1}} de novo, depois {{3}}")).toBe(3);
  });

  it("lida com espaços dentro das chaves", () => {
    expect(contarVariaveisTemplate("valor: {{ 2 }}")).toBe(2);
  });

  it("retorna 0 sem variáveis", () => {
    expect(contarVariaveisTemplate("Mensagem fixa sem variáveis")).toBe(0);
    expect(contarVariaveisTemplate("")).toBe(0);
  });
});

describe("validarNomeTemplate", () => {
  it("aceita nome válido (minúsculas, números, underscore)", () => {
    expect(validarNomeTemplate("lembrete_audiencia_2")).toBeNull();
  });

  it("rejeita maiúsculas e espaços", () => {
    expect(validarNomeTemplate("Lembrete Audiencia")).toContain("minúsculas");
  });

  it("rejeita acentos", () => {
    expect(validarNomeTemplate("audiência")).toContain("minúsculas");
  });

  it("rejeita vazio", () => {
    expect(validarNomeTemplate("")).toContain("Informe");
  });
});

// ─── Builders de components (puros) ──────────────────────────────────────────

import { montarComponentesCriacao, montarComponentesEnvio } from "../integracoes/whatsapp-cloud";

describe("montarComponentesCriacao", () => {
  it("monta apenas BODY quando só há corpo", () => {
    const comps = montarComponentesCriacao({
      nome: "x",
      idioma: "pt_BR",
      categoria: "UTILITY",
      corpo: "Mensagem fixa",
    });
    expect(comps).toEqual([{ type: "BODY", text: "Mensagem fixa" }]);
  });

  it("inclui example.body_text quando há exemplos", () => {
    const comps = montarComponentesCriacao({
      nome: "x",
      idioma: "pt_BR",
      categoria: "UTILITY",
      corpo: "Olá {{1}}, prazo {{2}}",
      exemplosCorpo: ["Maria", "30/05"],
    });
    const body = comps.find((c) => c.type === "BODY");
    expect(body?.example).toEqual({ body_text: [["Maria", "30/05"]] });
  });

  it("ignora exemplos vazios", () => {
    const comps = montarComponentesCriacao({
      nome: "x",
      idioma: "pt_BR",
      categoria: "UTILITY",
      corpo: "Olá {{1}}",
      exemplosCorpo: ["", "  "],
    });
    expect(comps.find((c) => c.type === "BODY")?.example).toBeUndefined();
  });

  it("inclui HEADER, FOOTER e BUTTONS na ordem correta", () => {
    const comps = montarComponentesCriacao({
      nome: "x",
      idioma: "pt_BR",
      categoria: "MARKETING",
      corpo: "corpo",
      cabecalhoTexto: "Título",
      rodapeTexto: "Rodapé",
      botoes: [{ type: "QUICK_REPLY", text: "Sim" }],
    });
    expect(comps.map((c) => c.type)).toEqual(["HEADER", "BODY", "FOOTER", "BUTTONS"]);
    expect(comps[0]).toEqual({ type: "HEADER", format: "TEXT", text: "Título" });
    expect(comps[3].buttons).toEqual([{ type: "QUICK_REPLY", text: "Sim" }]);
  });
});

describe("montarComponentesEnvio", () => {
  it("retorna undefined sem parâmetros nem header", () => {
    expect(montarComponentesEnvio({})).toBeUndefined();
    expect(montarComponentesEnvio({ bodyParams: [] })).toBeUndefined();
  });

  it("monta body com parâmetros de texto", () => {
    const comps = montarComponentesEnvio({ bodyParams: ["Maria", "30/05"] });
    expect(comps).toEqual([
      {
        type: "body",
        parameters: [
          { type: "text", text: "Maria" },
          { type: "text", text: "30/05" },
        ],
      },
    ]);
  });

  it("monta header de imagem por link antes do body", () => {
    const comps = montarComponentesEnvio({
      bodyParams: ["Maria"],
      headerImageUrl: "https://ex.com/a.jpg",
    });
    expect(comps?.[0]).toEqual({
      type: "header",
      parameters: [{ type: "image", image: { link: "https://ex.com/a.jpg" } }],
    });
    expect(comps?.[1].type).toBe("body");
  });

  it("prefere headerImageId sobre link quando ambos presentes", () => {
    const comps = montarComponentesEnvio({ headerImageId: "MEDIA_123" });
    expect(comps?.[0]).toEqual({
      type: "header",
      parameters: [{ type: "image", image: { id: "MEDIA_123" } }],
    });
  });
});

// ─── Métodos do client (axios mockado) ───────────────────────────────────────

const mockGet = vi.fn();
const mockPost = vi.fn();
const mockDelete = vi.fn();

vi.mock("axios", () => ({
  default: {
    create: () => ({ get: mockGet, post: mockPost, delete: mockDelete }),
  },
}));

import { WhatsAppCloudClient } from "../integracoes/whatsapp-cloud";

function novoClient() {
  return new WhatsAppCloudClient({ accessToken: "tok", phoneNumberId: "PN1", wabaId: "WABA1" });
}

describe("WhatsAppCloudClient — templates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("listarTemplates extrai o array data", async () => {
    mockGet.mockResolvedValueOnce({
      data: { data: [{ id: "1", name: "t", status: "APPROVED", category: "UTILITY", language: "pt_BR", components: [] }] },
    });
    const out = await novoClient().listarTemplates("WABA1");
    expect(mockGet).toHaveBeenCalledWith("/WABA1/message_templates", expect.any(Object));
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("t");
  });

  it("listarTemplates devolve [] quando não há data", async () => {
    mockGet.mockResolvedValueOnce({ data: {} });
    expect(await novoClient().listarTemplates("WABA1")).toEqual([]);
  });

  it("criarTemplate posta name/language/category/components", async () => {
    mockPost.mockResolvedValueOnce({ data: { id: "999", status: "PENDING" } });
    const out = await novoClient().criarTemplate("WABA1", {
      nome: "lembrete",
      idioma: "pt_BR",
      categoria: "UTILITY",
      corpo: "Olá {{1}}",
      exemplosCorpo: ["Maria"],
    });
    const [url, payload] = mockPost.mock.calls[0];
    expect(url).toBe("/WABA1/message_templates");
    expect(payload.name).toBe("lembrete");
    expect(payload.language).toBe("pt_BR");
    expect(payload.category).toBe("UTILITY");
    expect(payload.components.find((c: any) => c.type === "BODY").example).toEqual({
      body_text: [["Maria"]],
    });
    expect(out).toEqual({ id: "999", status: "PENDING", category: "UTILITY" });
  });

  it("excluirTemplate passa name nos params", async () => {
    mockDelete.mockResolvedValueOnce({ data: {} });
    await novoClient().excluirTemplate("WABA1", "lembrete");
    expect(mockDelete).toHaveBeenCalledWith("/WABA1/message_templates", {
      params: { name: "lembrete" },
    });
  });
});

describe("WhatsAppCloudClient — business profile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getBusinessProfile extrai o primeiro item de data", async () => {
    mockGet.mockResolvedValueOnce({ data: { data: [{ about: "Escritório X", email: "a@b.com" }] } });
    const out = await novoClient().getBusinessProfile();
    expect(mockGet).toHaveBeenCalledWith("/PN1/whatsapp_business_profile", expect.any(Object));
    expect(out.about).toBe("Escritório X");
  });

  it("atualizarBusinessProfile inclui messaging_product", async () => {
    mockPost.mockResolvedValueOnce({ data: {} });
    await novoClient().atualizarBusinessProfile({ about: "novo" });
    const [url, payload] = mockPost.mock.calls[0];
    expect(url).toBe("/PN1/whatsapp_business_profile");
    expect(payload.messaging_product).toBe("whatsapp");
    expect(payload.about).toBe("novo");
  });
});

describe("WhatsAppCloudClient — interativas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPost.mockResolvedValue({ data: { messages: [{ id: "wamid.X" }] } });
  });

  it("enviarBotoes monta interactive type button (máx 3)", async () => {
    const id = await novoClient().enviarBotoes("5585999999999", "Confirma?", [
      { id: "sim", titulo: "Sim" },
      { id: "nao", titulo: "Não" },
      { id: "talvez", titulo: "Talvez" },
      { id: "extra", titulo: "Ignorado" },
    ]);
    const payload = mockPost.mock.calls[0][1];
    expect(payload.type).toBe("interactive");
    expect(payload.interactive.type).toBe("button");
    expect(payload.interactive.action.buttons).toHaveLength(3);
    expect(payload.interactive.action.buttons[0]).toEqual({
      type: "reply",
      reply: { id: "sim", title: "Sim" },
    });
    expect(id).toBe("wamid.X");
  });

  it("enviarLista monta sections com rows", async () => {
    await novoClient().enviarLista("5585999999999", "Escolha", "Ver opções", [
      { titulo: "Serviços", itens: [{ id: "a", titulo: "Trabalhista", descricao: "desc" }] },
    ]);
    const payload = mockPost.mock.calls[0][1];
    expect(payload.interactive.type).toBe("list");
    expect(payload.interactive.action.button).toBe("Ver opções");
    expect(payload.interactive.action.sections[0].rows[0]).toEqual({
      id: "a",
      title: "Trabalhista",
      description: "desc",
    });
  });

  it("enviarReacao monta type reaction", async () => {
    await novoClient().enviarReacao("5585999999999", "wamid.ABC", "👍");
    const payload = mockPost.mock.calls[0][1];
    expect(payload.type).toBe("reaction");
    expect(payload.reaction).toEqual({ message_id: "wamid.ABC", emoji: "👍" });
  });

  it("limpa caracteres não-numéricos do telefone", async () => {
    await novoClient().enviarReacao("+55 (85) 99999-9999", "wamid.ABC", "👍");
    expect(mockPost.mock.calls[0][1].to).toBe("5585999999999");
  });
});
