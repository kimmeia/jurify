/**
 * Router tRPC — Integrações Externas do Admin
 *
 * Gerencia integrações como Judit.IO, Escavador, etc.
 * Todas as rotas são protegidas por adminProcedure (apenas o dono do sistema).
 *
 * Fluxo:
 * 1. Admin cola a API key no frontend
 * 2. Backend testa a conexão na API do provedor
 * 3. Se OK, criptografa e salva no banco
 * 4. Status fica "conectado" até ação manual de desconectar
 */

import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { adminIntegracoes } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { encrypt, decrypt, maskToken, generateWebhookSecret } from "../escritorio/crypto-utils";
import { JuditClient } from "./judit-client";
import { AsaasClient } from "./asaas-client";
import { createLogger } from "../_core/logger";
const log = createLogger("integracoes-router-admin-integracoes");

// ═══════════════════════════════════════════════════════════════════════════════
// METADATA DOS PROVEDORES SUPORTADOS
// ═══════════════════════════════════════════════════════════════════════════════

interface ProvedorMeta {
  id: string;
  nome: string;
  descricao: string;
  docUrl: string;
  services: string[];
}

const PROVEDORES: ProvedorMeta[] = [
  {
    id: "asaas",
    nome: "Asaas",
    descricao: "Gateway de pagamento para mensalidades dos escritórios (substitui Stripe).",
    docUrl: "https://docs.asaas.com/reference",
    services: ["Assinaturas", "PIX", "Boleto", "Cartão"],
  },
  {
    id: "judit",
    nome: "Judit.IO",
    descricao: "Monitoramento processual em 90+ tribunais por CNJ/CPF/CNPJ/OAB.",
    docUrl: "https://docs.judit.io",
    services: ["Processos", "Monitoramento", "Webhooks"],
  },
  {
    id: "whatsapp_cloud",
    nome: "WhatsApp Cloud",
    descricao: "Configuração global do WhatsApp CoEx. Escritórios conectam em Canais.",
    docUrl: "https://developers.facebook.com/docs/whatsapp/cloud-api",
    services: ["Cloud API", "CoEx", "Mensagens"],
  },
  {
    id: "openai",
    nome: "OpenAI (ChatGPT)",
    descricao: "API key do OpenAI usada pelos Agentes IA do admin e resumos automáticos.",
    docUrl: "https://platform.openai.com/api-keys",
    services: ["GPT-4", "GPT-3.5", "Assistants", "Embeddings"],
  },
  {
    id: "resend",
    nome: "Resend (E-mail)",
    descricao:
      "Servidor de email transacional usado por TODOS os escritórios para enviar convites de equipe e notificações. Configuração global (1 key, todos clientes).",
    docUrl: "https://resend.com/api-keys",
    services: ["Convites de equipe", "Notificações", "100/dia grátis"],
  },
];

function getProvedorMeta(provedor: string): ProvedorMeta | undefined {
  return PROVEDORES.find((p) => p.id === provedor);
}

// ═══════════════════════════════════════════════════════════════════════════════
// FUNÇÕES DE TESTE POR PROVEDOR
// ═══════════════════════════════════════════════════════════════════════════════

async function testarConexaoProvedor(provedor: string, apiKey: string) {
  switch (provedor) {
    case "judit": {
      const client = new JuditClient(apiKey);
      return client.testarConexao();
    }
    case "whatsapp_cloud": {
      // apiKey is JSON: {"appId":"...", "appSecret":"...", "webhookVerifyToken":"..."}
      try {
        const config = JSON.parse(apiKey);
        if (!config.appId || !config.appSecret || !config.webhookVerifyToken) {
          return { ok: false, mensagem: "Preencha App ID, App Secret e Verify Token" };
        }
        return { ok: true, mensagem: `App ID ${config.appId} configurado. Webhook Verify Token definido.` };
      } catch {
        return { ok: false, mensagem: "Formato invalido. Esperado JSON com appId, appSecret, webhookVerifyToken" };
      }
    }
    case "asaas": {
      // Mesma classe AsaasClient que escritórios usam — só que aqui é a key
      // do ADMIN, usada pra cobrar a mensalidade dos próprios escritórios.
      const client = new AsaasClient(apiKey);
      const r = await client.testarConexao();
      if (!r.ok) return r;
      return {
        ok: true,
        mensagem: `Asaas (${r.modo}) conectado. Saldo: R$ ${(r.saldo ?? 0).toFixed(2)}`,
        modo: r.modo,
        saldo: r.saldo,
      };
    }
    case "openai": {
      // Testa a key do OpenAI fazendo um GET em /v1/models.
      // É o endpoint mais barato e rápido — retorna a lista de modelos
      // disponíveis pra essa key. Não consome tokens.
      try {
        const res = await fetch("https://api.openai.com/v1/models", {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(10000),
        });
        if (res.status === 401) {
          return { ok: false, mensagem: "API key inválida ou revogada" };
        }
        if (!res.ok) {
          return {
            ok: false,
            mensagem: `Erro HTTP ${res.status}`,
            detalhes: (await res.text()).slice(0, 200),
          };
        }
        const data = (await res.json()) as { data?: Array<{ id: string }> };
        const models = data.data || [];
        const hasGpt4 = models.some((m) => m.id.includes("gpt-4"));
        return {
          ok: true,
          mensagem: `OpenAI conectado. ${models.length} modelos disponíveis${hasGpt4 ? " (incluindo GPT-4)" : ""}.`,
        };
      } catch (err: any) {
        if (err.name === "AbortError" || err.name === "TimeoutError") {
          return { ok: false, mensagem: "Timeout — OpenAI não respondeu em 10s" };
        }
        return { ok: false, mensagem: "Erro de conexão", detalhes: err.message };
      }
    }
    case "resend": {
      // Testa GET /domains — endpoint autenticado mais leve da Resend.
      // Retorna 401 se key inválida, 200 com lista (pode ser vazia) se OK.
      try {
        const res = await fetch("https://api.resend.com/domains", {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(10000),
        });
        if (res.status === 401 || res.status === 403) {
          return { ok: false, mensagem: "API key Resend inválida ou revogada" };
        }
        if (!res.ok) {
          return {
            ok: false,
            mensagem: `Erro HTTP ${res.status}`,
            detalhes: (await res.text()).slice(0, 200),
          };
        }
        const data = (await res.json()) as { data?: Array<{ name: string; status: string }> };
        const domains = data.data || [];
        const verificados = domains.filter((d) => d.status === "verified");
        if (domains.length === 0) {
          return {
            ok: true,
            mensagem:
              "Resend conectado — nenhum domínio cadastrado ainda (emails serão enviados via onboarding.resend.dev, limite 100/dia).",
          };
        }
        return {
          ok: true,
          mensagem: `Resend conectado. ${domains.length} domínio(s), ${verificados.length} verificado(s).`,
        };
      } catch (err: any) {
        if (err.name === "AbortError" || err.name === "TimeoutError") {
          return { ok: false, mensagem: "Timeout — Resend não respondeu em 10s" };
        }
        return { ok: false, mensagem: "Erro de conexão", detalhes: err.message };
      }
    }
    default:
      return { ok: false, mensagem: `Provedor "${provedor}" não suportado` };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTER
// ═══════════════════════════════════════════════════════════════════════════════

export const adminIntegracoesRouter = router({
  /**
   * Lista todos os provedores suportados com seus status de conexão.
   * Retorna provedores registrados no banco + os não registrados como "desconectado".
   */
  listar: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return PROVEDORES.map((p) => ({ ...p, status: "desconectado" as const, ultimoTeste: null, mensagemErro: null, apiKeyPreview: null }));

    let registros: any[] = [];
    try {
      registros = await db.select().from(adminIntegracoes);
    } catch {
      // Tabela pode não existir ainda (migration pendente) — retorna tudo desconectado
      log.warn("[Integrações] Tabela admin_integracoes não encontrada. Execute a migration 0015.");
    }

    return PROVEDORES.map((provedor) => {
      const reg = registros.find((r) => r.provedor === provedor.id);

      if (!reg) {
        return {
          ...provedor,
          status: "desconectado" as const,
          ultimoTeste: null,
          mensagemErro: null,
          apiKeyPreview: null,
        };
      }

      // Decriptografa a key apenas para gerar o preview mascarado
      let apiKeyPreview: string | null = null;
      if (reg.apiKeyEncrypted && reg.apiKeyIv && reg.apiKeyTag) {
        try {
          const raw = decrypt(reg.apiKeyEncrypted, reg.apiKeyIv, reg.apiKeyTag);
          apiKeyPreview = maskToken(raw, 6);
        } catch {
          apiKeyPreview = "***erro ao ler***";
        }
      }

      return {
        ...provedor,
        status: reg.status,
        ultimoTeste: reg.ultimoTeste,
        mensagemErro: reg.mensagemErro,
        apiKeyPreview,
      };
    });
  }),

  /**
   * Testa uma API key sem salvar — útil para o admin validar antes de confirmar.
   */
  testarConexao: adminProcedure
    .input(z.object({
      provedor: z.string().min(1),
      apiKey: z.string().min(1),
    }))
    .mutation(async ({ input }) => {
      return testarConexaoProvedor(input.provedor, input.apiKey);
    }),

  /**
   * Salva/atualiza a integração:
   * 1. Testa a conexão
   * 2. Criptografa a API key
   * 3. Salva no banco com status "conectado"
   *
   * Se já existe registro para o provedor, faz UPDATE.
   * Se não existe, faz INSERT.
   */
  salvar: adminProcedure
    .input(z.object({
      provedor: z.string().min(1),
      apiKey: z.string().min(1),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database não disponível");

      const meta = getProvedorMeta(input.provedor);
      if (!meta) throw new Error(`Provedor "${input.provedor}" não suportado`);

      // 1. Testar conexão
      const teste = await testarConexaoProvedor(input.provedor, input.apiKey);
      if (!teste.ok) {
        throw new Error(teste.mensagem + (teste.detalhes ? ` (${teste.detalhes})` : ""));
      }

      // 2. Criptografar a API key
      const { encrypted, iv, tag } = encrypt(input.apiKey);

      // 3. Verificar se já existe registro
      const existente = await db
        .select()
        .from(adminIntegracoes)
        .where(eq(adminIntegracoes.provedor, input.provedor))
        .limit(1);

      if (existente.length > 0) {
        // UPDATE
        await db
          .update(adminIntegracoes)
          .set({
            apiKeyEncrypted: encrypted,
            apiKeyIv: iv,
            apiKeyTag: tag,
            status: "conectado",
            ultimoTeste: new Date(),
            mensagemErro: null,
            nomeExibicao: meta.nome,
          })
          .where(eq(adminIntegracoes.provedor, input.provedor));
      } else {
        // INSERT
        await db.insert(adminIntegracoes).values({
          provedor: input.provedor,
          nomeExibicao: meta.nome,
          apiKeyEncrypted: encrypted,
          apiKeyIv: iv,
          apiKeyTag: tag,
          status: "conectado",
          ultimoTeste: new Date(),
          mensagemErro: null,
          webhookSecret: generateWebhookSecret(),
        });
      }

      return { success: true, mensagem: "Integração conectada com sucesso" };
    }),

  /**
   * Desconecta a integração — limpa a API key e muda status para "desconectado".
   * A key é removida do banco por segurança.
   */
  desconectar: adminProcedure
    .input(z.object({
      provedor: z.string().min(1),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database não disponível");

      const existente = await db
        .select()
        .from(adminIntegracoes)
        .where(eq(adminIntegracoes.provedor, input.provedor))
        .limit(1);

      if (existente.length === 0) {
        throw new Error("Integração não encontrada");
      }

      await db
        .update(adminIntegracoes)
        .set({
          apiKeyEncrypted: null,
          apiKeyIv: null,
          apiKeyTag: null,
          status: "desconectado",
          mensagemErro: null,
        })
        .where(eq(adminIntegracoes.provedor, input.provedor));

      return { success: true, mensagem: "Integração desconectada" };
    }),

  /**
   * Retesta a conexão de uma integração já salva (usando a key armazenada).
   * Atualiza o timestamp e status.
   */
  retestar: adminProcedure
    .input(z.object({
      provedor: z.string().min(1),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database não disponível");

      const reg = await db
        .select()
        .from(adminIntegracoes)
        .where(eq(adminIntegracoes.provedor, input.provedor))
        .limit(1);

      if (reg.length === 0 || !reg[0].apiKeyEncrypted || !reg[0].apiKeyIv || !reg[0].apiKeyTag) {
        throw new Error("Integração não encontrada ou sem API key");
      }

      // Decriptografar a key armazenada
      const apiKey = decrypt(reg[0].apiKeyEncrypted, reg[0].apiKeyIv, reg[0].apiKeyTag);

      // Testar
      const teste = await testarConexaoProvedor(input.provedor, apiKey);

      await db
        .update(adminIntegracoes)
        .set({
          status: teste.ok ? "conectado" : "erro",
          ultimoTeste: new Date(),
          mensagemErro: teste.ok ? null : teste.mensagem,
        })
        .where(eq(adminIntegracoes.provedor, input.provedor));

      return teste;
    }),

  /**
   * Configura o webhook do Asaas automaticamente.
   *
   * Em vez do admin ter que abrir o painel do Asaas, ir em
   * Configurações → Webhooks e colar a URL e o token, este endpoint
   * faz a chamada via API do Asaas, registrando o webhook do Jurify
   * com o webhookSecret armazenado.
   *
   * Idempotente: chamar de novo apenas atualiza a configuração.
   */
  configurarWebhookAsaas: adminProcedure
    .input(z.object({
      baseUrl: z.string().url(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database não disponível");

      const [reg] = await db
        .select()
        .from(adminIntegracoes)
        .where(eq(adminIntegracoes.provedor, "asaas"))
        .limit(1);

      if (!reg || !reg.apiKeyEncrypted || !reg.apiKeyIv || !reg.apiKeyTag) {
        throw new Error("Asaas não está conectado. Conecte primeiro com a API key.");
      }
      if (!reg.webhookSecret) {
        throw new Error("webhookSecret ausente — desconecte e reconecte o Asaas.");
      }

      const apiKey = decrypt(reg.apiKeyEncrypted, reg.apiKeyIv, reg.apiKeyTag);
      const client = new AsaasClient(apiKey);

      // Monta a URL completa do webhook do Jurify
      const webhookUrl = `${input.baseUrl.replace(/\/$/, "")}/api/webhooks/asaas-billing`;

      try {
        await client.configurarWebhook(webhookUrl, reg.webhookSecret);
        log.info({ webhookUrl }, "Webhook Asaas configurado automaticamente");

        // Atualizar registro com a URL configurada
        await db
          .update(adminIntegracoes)
          .set({ webhookUrl, ultimoTeste: new Date(), mensagemErro: null })
          .where(eq(adminIntegracoes.provedor, "asaas"));

        return {
          ok: true,
          mensagem: `Webhook configurado em ${webhookUrl}`,
          webhookUrl,
        };
      } catch (err: any) {
        const detalhe = err.response?.data
          ? JSON.stringify(err.response.data).slice(0, 300)
          : err.message;
        log.error({ err: detalhe }, "Falha ao configurar webhook Asaas");
        throw new Error(`Falha ao configurar webhook: ${detalhe}`);
      }
    }),

  /**
   * Retorna os provedores suportados (metadata estática).
   */
  provedoresDisponiveis: adminProcedure.query(() => {
    return PROVEDORES;
  }),
});
