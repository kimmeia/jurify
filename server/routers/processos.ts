/**
 * Router — Processos via Motor Próprio
 *
 * Substituiu `judit-processos.ts` (08/05/2026) após decisão de remover
 * Judit completamente. Toda consulta passa pelo adapter motor próprio.
 *
 * Tribunais cobertos hoje:
 *   - TJCE 1º grau ✅ (PJe via PDPJ-cloud, login + 2FA via cofre)
 *
 * Tribunais sem adapter retornam TRPCError NOT_IMPLEMENTED com
 * mensagem instrutiva.
 *
 * Cobrança: 1 cred por consulta (cobrado via `motorCreditos`/
 * `motorTransacoes`). Consulta motor próprio não tem custo
 * operacional externo (só servidor + tribunal de origem).
 */

import { z } from "zod";
import { eq, desc, and, or, ne, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  motorCreditos,
  motorTransacoes,
  cofreCredenciais,
  motorMonitoramentos,
  eventosProcesso,
  adminIntegracoes,
} from "../../drizzle/schema";
import { decrypt as adminDecrypt } from "../escritorio/crypto-utils";
import { getEscritorioPorUsuario } from "../escritorio/db-escritorio";
import { createLogger } from "../_core/logger";
import { parseCnjTribunal, sistemaCofrePorTribunal } from "../processos/cnj-parser";
import { normalizarCnj, mascararCnj, validarCnj } from "../../scripts/spike-motor-proprio/lib/parser-utils";
import {
  ehRequestMotorProprio,
  iniciarConsultaMotorProprio,
  iniciarConsultaDocumentoMotorProprio,
  obterStatusMotorProprio,
  obterResultadoMotorProprio,
} from "../processos/motor-proprio-runner";
import { consultarTjce } from "../processos/adapters/pje-tjce";
import { getConfigTribunal } from "../processos/tribunais-pdpj";
import { resolverDedupMovimentacao } from "../processos/cron-monitoramento";
import { recuperarSessao } from "../escritorio/cofre-helpers";

const log = createLogger("processos-motor");

const PACOTES_CREDITOS = [
  { id: "pack_50", nome: "50 creditos", creditos: 50, preco: 49.9, popular: false },
  { id: "pack_200", nome: "200 creditos", creditos: 200, preco: 149.9, popular: true },
  { id: "pack_500", nome: "500 creditos", creditos: 500, preco: 299.9, popular: false },
  { id: "pack_1000", nome: "1000 creditos", creditos: 1000, preco: 499.9, popular: false },
] as const;

export const CUSTOS = {
  consulta_cnj: 1,
  monitorar_processo_mes: 2,    // ANTES: Judit cobrava 5
  monitorar_pessoa_mes: 15,     // ANTES: Judit cobrava 35
  /**
   * Busca por CPF/CNPJ sob demanda — retorna lista de CNJs encontrados
   * sem detalhes (capa/movs). Cobra flat 3 cred independente do número
   * de resultados (motor próprio TJCE custa só servidor, sem cobrança
   * externa por resultado como na Judit). User pode clicar nos CNJs
   * pra detalhar (1 cred cada via `consultarCNJ`).
   */
  consulta_documento: 3,
} as const;

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * Adiciona `capa` e `partes` parseados ao monitoramento.
 *
 * O cron de monitoramento já popula `capaJson` (classe, assuntos[],
 * orgaoJulgador, valorCausaCentavos, dataDistribuicao) e `partesJson`
 * (array de {nome, polo, advogados}) — antes voltavam só como string TEXT
 * crua, o que forçava o frontend a parsear cada vez. Agora o backend
 * deserializa uma vez e devolve um objeto pronto pra MonitoramentoCard
 * mostrar título do processo + partes sem custo extra de crédito.
 *
 * Mantém os campos originais (capaJson/partesJson string) pra retrocompat
 * com callers antigos que ainda esperam o shape bruto.
 */
function enriquecerMonitorComCapa<T extends { capaJson?: string | null; partesJson?: string | null }>(
  mon: T,
): T & { capa: any | null; partes: any[] | null } {
  const capa = mon.capaJson ? safeParse(mon.capaJson) : null;
  const partesParsed = mon.partesJson ? safeParse(mon.partesJson) : null;
  return {
    ...mon,
    capa: capa ?? null,
    partes: Array.isArray(partesParsed) ? partesParsed : null,
  };
}

/**
 * Converte ResultadoScraper (motor próprio) para o shape "lawsuit"
 * que o frontend MonitoramentoCard espera (legado Judit). Mantém
 * compat até refator profundo do componente.
 *
 * - amount em REAIS (não cents) — frontend formata com formatBRL direto
 * - parties[].side: "Active"/"Passive" (frontend filtra por isso)
 * - steps[].step_date / content: shape Judit
 */
function adaptarParaJuditShape(r: any, cnj: string) {
  const capa = r?.capa ?? {};
  const partes: Array<{ nome?: string; polo?: string; documento?: string | null; advogados?: any[] }> = capa.partes ?? [];
  const movs: Array<{ data?: string; texto?: string }> = r?.movimentacoes ?? [];
  return {
    code: cnj,
    name: capa.classe ?? null,
    classifications: capa.classe ? [{ name: capa.classe }] : [],
    amount:
      typeof capa.valorCausaCentavos === "number"
        ? capa.valorCausaCentavos / 100
        : null,
    distribution_date: capa.dataDistribuicao ?? null,
    // Frontend (MonitoramentoCard) lê esses 2 campos em badges:
    // tribunal_acronym (ex: "TJCE") + instance (ex: 1) — sem eles o
    // card renderiza sem cabeçalho. tribunal vem de r.tribunal (top
    // do ResultadoScraper, pe TJCE/TJSP) ou capa.tribunal.
    tribunal_acronym:
      typeof r?.tribunal === "string"
        ? r.tribunal.toUpperCase()
        : typeof capa.tribunal === "string"
          ? capa.tribunal.toUpperCase()
          : null,
    instance: capa.grauTribunal ?? capa.instancia ?? 1,
    parties: partes.map((p) => ({
      name: p.nome ?? "",
      side: (p.polo ?? "").toLowerCase().startsWith("ativ") ? "Active" : "Passive",
      main_document: p.documento ?? null,
      lawyers: p.advogados ?? [],
    })),
    steps: movs.map((m) => ({
      step_date: m.data ?? null,
      content: m.texto ?? "",
    })),
  };
}

async function consumirCreditos(
  escritorioId: number,
  userId: number,
  custo: number,
  operacao: string,
  detalhes?: string,
): Promise<void> {
  // Saldo unificado por escritório (migration 0073).
  // Helper trata: garante registro existe (cria com cota do plano se não),
  // valida saldo, debita, registra transação. Lança TRPCError se sem saldo.
  const { consumirCreditosEscritorio } = await import("../billing/escritorio-creditos");
  await consumirCreditosEscritorio(escritorioId, userId, custo, operacao, detalhes);
}

export const processosRouter = router({
  saldo: protectedProcedure.query(async ({ ctx }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id);
    if (!esc) return { saldo: 0, totalConsumido: 0, totalComprado: 0, cotaMensal: 0, ultimoReset: null };

    // Helper garante registro existe (cria com cota do plano se primeiro
    // acesso). Sem race conditions porque getSaldoEscritorio é idempotente.
    try {
      const { getSaldoEscritorio } = await import("../billing/escritorio-creditos");
      const s = await getSaldoEscritorio(esc.escritorio.id);
      return {
        saldo: s.saldo,
        totalConsumido: s.totalConsumido,
        totalComprado: s.totalComprado,
        cotaMensal: s.cotaMensal,
        ultimoReset: s.ultimoReset,
      };
    } catch {
      return { saldo: 0, totalConsumido: 0, totalComprado: 0, cotaMensal: 0, ultimoReset: null };
    }
  }),

  pacotes: protectedProcedure.query(() => ({ pacotes: PACOTES_CREDITOS, custos: CUSTOS })),

  /**
   * Inicia consulta de processo por CNJ via motor próprio.
   *
   * Detecta tribunal pelo CNJ. Se motor próprio cobre + escritório
   * tem credencial OAB ativa no cofre + sessão válida → executa
   * background, retorna requestId pra polling.
   *
   * Senão: TRPCError instrutivo (cadastrar credencial / aguardar
   * adapter / etc).
   */
  consultarCNJ: protectedProcedure
    .input(z.object({
      cnj: z.string().min(15).max(30),
      /**
       * Opcional: id de uma credencial específica do cofre. Quando
       * informada, usa essa credencial em vez de pegar a primeira ativa
       * — usuário pode ter múltiplas OABs (ex: 2 advogados, 1 banca)
       * e escolhe qual usar (necessário pra processos em segredo de
       * justiça onde só a OAB de quem peticionou consegue ver).
       */
      credencialId: z.number().int().positive().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "NOT_FOUND", message: "Escritório não encontrado" });

      const tribunal = parseCnjTribunal(input.cnj);
      if (!tribunal) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "CNJ inválido — verifique o formato (ex: 0000000-00.0000.0.00.0000)",
        });
      }

      if (!tribunal.temMotorProprio) {
        throw new TRPCError({
          code: "NOT_IMPLEMENTED",
          message:
            `Consulta para ${tribunal.siglaTribunal} ainda está em desenvolvimento. ` +
            `Tribunais cobertos hoje: TJCE 1º grau. Próximos: TJSP, TRT-7, TJRJ.`,
          cause: { motivo: "tribunal_sem_motor", tribunal: tribunal.codigoTribunal },
        });
      }

      const sistemaCofre = sistemaCofrePorTribunal(tribunal.codigoTribunal);
      if (!sistemaCofre) {
        throw new TRPCError({
          code: "NOT_IMPLEMENTED",
          message: `Sistema cofre pra ${tribunal.siglaTribunal} ainda não mapeado`,
        });
      }

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });

      // Cofre é compartilhado pelo escritório: qualquer membro
      // (dono ou colaborador) usa as credenciais cadastradas no escritório.
      // Se `credencialId` foi informado, exige que ela seja do escritório,
      // compatível com o tribunal e ativa — caso contrário pega a primeira
      // ativa do sistema correto.
      let credencial: typeof cofreCredenciais.$inferSelect[] = [];
      if (input.credencialId) {
        credencial = await db
          .select()
          .from(cofreCredenciais)
          .where(
            and(
              eq(cofreCredenciais.id, input.credencialId),
              eq(cofreCredenciais.escritorioId, esc.escritorio.id),
              eq(cofreCredenciais.sistema, sistemaCofre),
              eq(cofreCredenciais.status, "ativa"),
            ),
          )
          .limit(1);

        if (credencial.length === 0) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              `Credencial selecionada não existe, expirou ou não é compatível com ` +
              `${tribunal.siglaTribunal}. Selecione outra ou cadastre uma nova no Cofre.`,
            cause: { motivo: "credencial_invalida", credencialId: input.credencialId },
          });
        }
      } else {
        credencial = await db
          .select()
          .from(cofreCredenciais)
          .where(
            and(
              eq(cofreCredenciais.escritorioId, esc.escritorio.id),
              eq(cofreCredenciais.sistema, sistemaCofre),
              eq(cofreCredenciais.status, "ativa"),
            ),
          )
          .limit(1);

        if (credencial.length === 0) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              `Pra consultar processos do ${tribunal.siglaTribunal}, ` +
              `cadastre sua credencial OAB-${tribunal.uf ?? ""} no Cofre. ` +
              `→ /processos?tab=cofre`,
            cause: { motivo: "credencial_ausente", tribunal: tribunal.codigoTribunal },
          });
        }
      }

      const credId = credencial[0].id;
      const storageState = await recuperarSessao(credId, { tentarRelogin: true });
      if (!storageState) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            `Sua credencial ${tribunal.siglaTribunal} expirou. ` +
            `Vá em Cofre de Credenciais → Validar pra renovar.`,
          cause: { motivo: "sessao_expirada", credencialId: credId },
        });
      }

      await consumirCreditos(
        esc.escritorio.id,
        ctx.user.id,
        CUSTOS.consulta_cnj,
        "consulta_cnj",
        `CNJ: ${input.cnj} (${tribunal.siglaTribunal})`,
      );

      const { requestId, status } = iniciarConsultaMotorProprio(input.cnj, storageState, credId);
      log.info(
        { cnj: input.cnj, requestId, tribunal: tribunal.codigoTribunal, credId },
        "[motor-proprio] consulta iniciada",
      );
      return { requestId, status };
    }),

  /**
   * Gera resumo executivo de um processo usando IA (OpenAI/Anthropic).
   *
   * Lê capa + últimas movimentações do `motorMonitoramentos.capaJson` +
   * `eventosProcesso` (dados já cacheados no DB pelos polls). Não consulta
   * tribunal — se não tem dados, sugere clicar "Histórico" antes (que
   * persiste capa+movs).
   *
   * API key vem de `admin_integracoes` (provedor "openai" ou "anthropic",
   * gerenciado pelo admin global do JuridFlow).
   *
   * Cobra 1 crédito.
   */
  resumoIA: protectedProcedure
    .input(
      z.object({
        cnj: z.string().min(15).max(30),
        monitoramentoId: z.number().int().positive().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "NOT_FOUND", message: "Escritório não encontrado" });

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });

      // Acha o monitoramento por id ou (escritório+searchKey). searchKey
      // está em formato mascarado (`mascararCnj`), então normaliza antes.
      const cnjMascarado = mascararCnj(input.cnj);
      let mon: typeof motorMonitoramentos.$inferSelect | undefined;
      if (input.monitoramentoId) {
        [mon] = await db
          .select()
          .from(motorMonitoramentos)
          .where(
            and(
              eq(motorMonitoramentos.id, input.monitoramentoId),
              eq(motorMonitoramentos.escritorioId, esc.escritorio.id),
            ),
          )
          .limit(1);
      } else {
        [mon] = await db
          .select()
          .from(motorMonitoramentos)
          .where(
            and(
              eq(motorMonitoramentos.escritorioId, esc.escritorio.id),
              eq(motorMonitoramentos.searchKey, cnjMascarado),
              eq(motorMonitoramentos.tipoMonitoramento, "movimentacoes"),
            ),
          )
          .limit(1);
      }

      if (!mon) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Monitoramento não encontrado pra esse CNJ. Crie o monitoramento primeiro.",
        });
      }

      // Capa + partes vêm do DB (persistidos pelo cron e pela busca sob
      // demanda). Se vazio, user precisa clicar "Histórico" antes — sem
      // dados não há o que resumir.
      const capa = mon.capaJson ? safeParse(mon.capaJson) : null;
      if (!capa) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Sem dados do processo ainda. Clique em 'Histórico' antes pra puxar capa + movimentações do tribunal.",
        });
      }

      // Pega as 20 movs mais recentes do escritório (mesmo padrão do
      // historicoMonitoramento — por cnjAfetado, não monitoramentoId, pra
      // pegar movs que sobraram de monitoramentos antigos recriados).
      const movs = await db
        .select({
          conteudo: eventosProcesso.conteudo,
          conteudoJson: eventosProcesso.conteudoJson,
          dataEvento: eventosProcesso.dataEvento,
        })
        .from(eventosProcesso)
        .where(
          and(
            eq(eventosProcesso.escritorioId, esc.escritorio.id),
            eq(eventosProcesso.cnjAfetado, mon.searchKey),
            eq(eventosProcesso.tipo, "movimentacao"),
          ),
        )
        .orderBy(desc(eventosProcesso.dataEvento))
        .limit(20);

      // Resolve API key — preferência OpenAI primeiro, depois Anthropic
      const [openaiReg] = await db
        .select()
        .from(adminIntegracoes)
        .where(
          and(
            eq(adminIntegracoes.provedor, "openai"),
            eq(adminIntegracoes.status, "conectado"),
          ),
        )
        .limit(1);
      const [anthropicReg] = await db
        .select()
        .from(adminIntegracoes)
        .where(
          and(
            eq(adminIntegracoes.provedor, "anthropic"),
            eq(adminIntegracoes.status, "conectado"),
          ),
        )
        .limit(1);

      let provider: "openai" | "anthropic" | null = null;
      let apiKey: string | null = null;
      if (openaiReg?.apiKeyEncrypted && openaiReg.apiKeyIv && openaiReg.apiKeyTag) {
        try {
          apiKey = adminDecrypt(openaiReg.apiKeyEncrypted, openaiReg.apiKeyIv, openaiReg.apiKeyTag);
          provider = "openai";
        } catch { /* ignore, tenta anthropic */ }
      }
      if (!apiKey && anthropicReg?.apiKeyEncrypted && anthropicReg.apiKeyIv && anthropicReg.apiKeyTag) {
        try {
          apiKey = adminDecrypt(anthropicReg.apiKeyEncrypted, anthropicReg.apiKeyIv, anthropicReg.apiKeyTag);
          provider = "anthropic";
        } catch { /* ignore */ }
      }

      if (!apiKey || !provider) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Integração com IA não configurada. Peça ao administrador do JuridFlow pra configurar OpenAI ou Anthropic em Admin → Integrações.",
        });
      }

      // Cobra antes do gasto externo (mesmo padrão de consultarCNJ).
      // Se IA falhar depois, o crédito já foi debitado — preferimos
      // "cobrança consistente" vs "evitar 1 cred perdido em raros falhas".
      await consumirCreditos(
        esc.escritorio.id,
        ctx.user.id,
        1,
        "resumo_ia",
        `Resumo IA: ${mon.searchKey}`,
      );

      const capaTyped = capa as Record<string, any>;
      const movsTexto = movs
        .map((m, i) => {
          const parsed = m.conteudoJson ? safeParse(m.conteudoJson) : null;
          const data = (parsed as any)?.data ?? m.dataEvento;
          const texto = (parsed as any)?.texto ?? m.conteudo ?? "";
          return `${i + 1}. [${data instanceof Date ? data.toISOString().slice(0, 10) : data}] ${texto.slice(0, 700)}`;
        })
        .join("\n");

      // Calcula contexto temporal — IA usa pra dimensionar urgência e
      // sugerir o tom certo da mensagem ao cliente ("aguardando", "estagnado").
      const hoje = new Date();
      const diasDesdeDistribuicao = capaTyped.dataDistribuicao
        ? Math.floor((hoje.getTime() - new Date(capaTyped.dataDistribuicao).getTime()) / (1000 * 60 * 60 * 24))
        : null;
      const ultimaMovData = movs[0]?.dataEvento ? new Date(movs[0].dataEvento) : null;
      const diasDesdeUltimaMov = ultimaMovData
        ? Math.floor((hoje.getTime() - ultimaMovData.getTime()) / (1000 * 60 * 60 * 24))
        : null;

      const promptSystem = [
        "Você é um advogado sênior brasileiro experiente, atuando como consultor estratégico de outro advogado que precisa orientar o cliente dele.",
        "Sua resposta vai direto pra UI do escritório — o destinatário é o advogado, não o cliente final.",
        "",
        "REGRAS DURAS:",
        "1. Use APENAS as informações fornecidas. NÃO invente fatos, valores, datas, prazos ou jurisprudência.",
        "2. Se faltar dado essencial, diga explicitamente ('Sem mais movimentações pra análise — recomenda-se atualizar consulta').",
        "3. Tom: objetivo, técnico mas direto. Sem juridiquês desnecessário, sem floreios.",
        "4. Formato: markdown com as 4 SEÇÕES OBRIGATÓRIAS abaixo. Mantenha SEMPRE essa estrutura, mesmo se alguma seção ficar curta.",
        "",
        "ESTRUTURA OBRIGATÓRIA (use os emojis exatos como cabeçalho de cada seção):",
        "",
        "### 📍 Situação atual",
        "1-3 frases dizendo em que fase o processo está e quem fez a última mov relevante. Cite data se ajuda.",
        "",
        "### 🎯 Análise estratégica",
        "Bullets curtos (3-5) com:",
        "- Pontos críticos detectados (prazos correndo, decisões pendentes, riscos processuais)",
        "- Oportunidades táticas (recurso cabível, acordo viável, prescrição próxima, etc)",
        "- Pontos de atenção (estagnação suspeita, partes em revelia, etc)",
        "Se nada estratégico se destaca, diga isso explicitamente: 'Processo em curso regular, sem pontos críticos imediatos.'",
        "",
        "### ✅ Próximas ações recomendadas",
        "Lista numerada e accionable (3-5 itens). Cada item deve ser uma AÇÃO concreta com prazo/urgência quando aplicável.",
        "Exemplo: '1. Protocolar réplica até DD/MM (prazo de X dias correndo desde a contestação).'",
        "Se não há ação imediata, escreva: 'Aguardar próxima movimentação. Reavaliar em N dias se nada mudar.'",
        "",
        "### 💬 Mensagem pronta pro cliente",
        "Parágrafo único (3-6 frases) em linguagem LEIGA e tranquilizadora, pronto pra copiar/colar no WhatsApp do cliente.",
        "Não use jargão jurídico. Explique o que aconteceu e qual o próximo passo de forma compreensível.",
        "Comece com 'Oi, [nome do cliente],' ou 'Bom dia, [nome do cliente],' (literal — o advogado completa).",
        "Termine com algo proativo: 'Qualquer dúvida, estou aqui.' ou similar.",
      ].join("\n");

      const promptUser = [
        `## Dados do processo`,
        `- CNJ: ${mon.searchKey}`,
        `- Tribunal: ${(mon.tribunal || "").toUpperCase()}`,
        capaTyped.classe ? `- Classe: ${capaTyped.classe}` : null,
        capaTyped.assunto ? `- Assunto: ${capaTyped.assunto}` : null,
        capaTyped.valorCausaCentavos
          ? `- Valor da causa: R$ ${(capaTyped.valorCausaCentavos / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
          : null,
        capaTyped.dataDistribuicao
          ? `- Distribuído em: ${capaTyped.dataDistribuicao}${diasDesdeDistribuicao !== null ? ` (há ${diasDesdeDistribuicao} dias)` : ""}`
          : null,
        capaTyped.juiz ? `- Juiz: ${capaTyped.juiz}` : null,
        capaTyped.vara ? `- Vara: ${capaTyped.vara}` : null,
        capaTyped.comarca ? `- Comarca: ${capaTyped.comarca}` : null,
        diasDesdeUltimaMov !== null ? `- Última movimentação: há ${diasDesdeUltimaMov} dias` : null,
        capaTyped.partes && Array.isArray(capaTyped.partes) && capaTyped.partes.length > 0
          ? `\n## Partes\n${capaTyped.partes.map((p: any) => `- **${p.polo || "?"}**: ${p.nome}${p.advogados ? ` (adv: ${Array.isArray(p.advogados) ? p.advogados.map((a: any) => a.nome ?? a).join(", ") : p.advogados})` : ""}`).join("\n")}`
          : null,
        movs.length > 0
          ? `\n## Últimas ${movs.length} movimentações (mais recentes primeiro)\n${movsTexto}`
          : `\n## Movimentações\nNenhuma movimentação registrada ainda — processo recém-monitorado ou sem atividade.`,
      ]
        .filter(Boolean)
        .join("\n");

      let resumo: string;
      try {
        if (provider === "anthropic") {
          const res = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
              model: "claude-opus-4-7",
              system: promptSystem,
              messages: [{ role: "user", content: promptUser }],
              max_tokens: 2200,
              temperature: 0.4,
            }),
            signal: AbortSignal.timeout(30000),
          });
          if (!res.ok) {
            const text = await res.text();
            throw new Error(`Anthropic ${res.status}: ${text.slice(0, 200)}`);
          }
          const data = (await res.json()) as { content?: Array<{ text?: string }> };
          resumo = (data.content?.[0]?.text || "").trim();
        } else {
          const res = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: "gpt-4o",
              messages: [
                { role: "system", content: promptSystem },
                { role: "user", content: promptUser },
              ],
              max_tokens: 2200,
              temperature: 0.4,
            }),
            signal: AbortSignal.timeout(30000),
          });
          if (!res.ok) {
            const text = await res.text();
            throw new Error(`OpenAI ${res.status}: ${text.slice(0, 200)}`);
          }
          const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
          resumo = (data.choices?.[0]?.message?.content || "").trim();
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error({ err: msg, cnj: mon.searchKey, provider }, "[resumoIA] chamada à IA falhou");
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Falha ao gerar resumo: ${msg.slice(0, 200)}. Crédito foi debitado — entre em contato com o suporte se precisar de reembolso.`,
        });
      }

      if (!resumo) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "IA retornou resposta vazia. Tente novamente em alguns minutos.",
        });
      }

      // Bridge `capa` → JuditLawsuit shape pro frontend setar processoCompleto
      const processo = adaptarParaJuditShape(
        {
          capa: capaTyped,
          movimentacoes: movs.map((m) => {
            const parsed = m.conteudoJson ? safeParse(m.conteudoJson) : null;
            return {
              data: (parsed as any)?.data ?? (m.dataEvento instanceof Date ? m.dataEvento.toISOString() : m.dataEvento),
              texto: (parsed as any)?.texto ?? m.conteudo ?? "",
            };
          }),
          tribunal: mon.tribunal,
        },
        mon.searchKey,
      );

      log.info(
        { monId: mon.id, cnj: mon.searchKey, provider, resumoLen: resumo.length },
        "[resumoIA] gerado",
      );

      return { resumo, processo, fonte: "ia" };
    }),

  /**
   * Busca processos por CPF ou CNPJ — retorna lista de CNJs encontrados
   * onde a pessoa aparece como parte. Não traz detalhes (capa/movs);
   * pra ver detalhes user clica num resultado e cai em `consultarCNJ`.
   *
   * Cobra 3 créditos flat (não varia com número de resultados).
   *
   * Hoje só funciona pra TJCE (único tribunal com adapter de CPF).
   * Outros tribunais retornam NOT_IMPLEMENTED.
   */
  consultarDocumento: protectedProcedure
    .input(
      z.object({
        tipo: z.enum(["cpf", "cnpj"]),
        valor: z.string().min(11).max(20),
        credencialId: z.number().int().positive().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "NOT_FOUND", message: "Escritório não encontrado" });

      const docLimpo = input.valor.replace(/\D/g, "");
      if (input.tipo === "cpf" && docLimpo.length !== 11) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "CPF deve ter 11 dígitos" });
      }
      if (input.tipo === "cnpj" && docLimpo.length !== 14) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "CNPJ deve ter 14 dígitos" });
      }

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });

      // Resolve credencial: selecionada ou primeira ativa do escritório
      // (preferindo pje_tjce, fallback esaj_tjce). Mesma lógica de
      // `criarMonitoramentoNovasAcoes`.
      let cred: typeof cofreCredenciais.$inferSelect | undefined;
      if (input.credencialId) {
        [cred] = await db
          .select()
          .from(cofreCredenciais)
          .where(
            and(
              eq(cofreCredenciais.id, input.credencialId),
              eq(cofreCredenciais.escritorioId, esc.escritorio.id),
              eq(cofreCredenciais.status, "ativa"),
            ),
          )
          .limit(1);
      } else {
        const todas = await db
          .select()
          .from(cofreCredenciais)
          .where(
            and(
              eq(cofreCredenciais.escritorioId, esc.escritorio.id),
              eq(cofreCredenciais.status, "ativa"),
            ),
          );
        const suportadas = todas.filter(
          (c) => c.sistema === "pje_tjce" || c.sistema === "esaj_tjce",
        );
        cred = suportadas.find((c) => c.sistema === "pje_tjce") ?? suportadas[0];
      }

      if (!cred) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Pra buscar processos por CPF/CNPJ, cadastre sua credencial OAB no Cofre. " +
            "→ /processos?tab=cofre",
          cause: { motivo: "credencial_ausente" },
        });
      }

      // Mapeia sistema → tribunal (hoje só TJCE)
      const codigoTribunal =
        cred.sistema === "pje_tjce" || cred.sistema === "esaj_tjce" ? "tjce" : null;
      if (!codigoTribunal) {
        throw new TRPCError({
          code: "NOT_IMPLEMENTED",
          message: `Busca por CPF/CNPJ ainda só funciona pra TJCE. Sistema ${cred.sistema} entra em sprint futura.`,
        });
      }

      const storageState = await recuperarSessao(cred.id, { tentarRelogin: true });
      if (!storageState) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            `Sua credencial ${cred.apelido} expirou. ` +
            `Vá em Cofre de Credenciais → Validar pra renovar.`,
          cause: { motivo: "sessao_expirada", credencialId: cred.id },
        });
      }

      await consumirCreditos(
        esc.escritorio.id,
        ctx.user.id,
        CUSTOS.consulta_documento,
        "consulta_documento",
        `${input.tipo.toUpperCase()}: ${docLimpo.slice(0, 3)}*** (${codigoTribunal.toUpperCase()})`,
      );

      const { requestId, status } = iniciarConsultaDocumentoMotorProprio(
        input.tipo,
        docLimpo,
        storageState,
        codigoTribunal,
        cred.id,
      );
      log.info(
        { tipo: input.tipo, requestId, tribunal: codigoTribunal },
        "[motor-proprio] consulta documento iniciada",
      );
      return { requestId, status };
    }),

  /**
   * Consulta CNJ síncrona — sem polling.
   *
   * Existe pra alimentar o "Carregar detalhes" de cards de busca por
   * CPF/CNPJ: a busca por documento retorna só lista de CNJs (sem
   * capa/movs pra economizar créditos). Quando o user clica num card
   * pra ver detalhes, frontend chama essa procedure e espera o
   * scraper terminar (~10-30s).
   *
   * Cobra 1 cred (mesma tarifa de `consultarCNJ`). Retorna lawsuit
   * shape direto pronto pro `ProcessoCard` renderizar (sem o boilerplate
   * de page_data).
   *
   * Timeout: 60s. Se o scraper demorar mais, frontend recebe erro e
   * o crédito JÁ foi debitado (mesma política de `resumoIA`).
   */
  consultarCNJSincrono: protectedProcedure
    .input(z.object({
      cnj: z.string().min(15).max(30),
      credencialId: z.number().int().positive().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "NOT_FOUND", message: "Escritório não encontrado" });

      const tribunal = parseCnjTribunal(input.cnj);
      if (!tribunal) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "CNJ inválido — verifique o formato",
        });
      }
      if (!tribunal.temMotorProprio) {
        throw new TRPCError({
          code: "NOT_IMPLEMENTED",
          message: `Consulta direta pra ${tribunal.siglaTribunal} ainda não disponível.`,
        });
      }

      const sistemaCofre = sistemaCofrePorTribunal(tribunal.codigoTribunal);
      if (!sistemaCofre) {
        throw new TRPCError({
          code: "NOT_IMPLEMENTED",
          message: `Sistema cofre pra ${tribunal.siglaTribunal} ainda não mapeado`,
        });
      }

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });

      // Mesma lógica de resolução de credencial de `consultarCNJ`.
      let credencial: typeof cofreCredenciais.$inferSelect[] = [];
      if (input.credencialId) {
        credencial = await db
          .select()
          .from(cofreCredenciais)
          .where(
            and(
              eq(cofreCredenciais.id, input.credencialId),
              eq(cofreCredenciais.escritorioId, esc.escritorio.id),
              eq(cofreCredenciais.sistema, sistemaCofre),
              eq(cofreCredenciais.status, "ativa"),
            ),
          )
          .limit(1);
      }
      if (credencial.length === 0) {
        credencial = await db
          .select()
          .from(cofreCredenciais)
          .where(
            and(
              eq(cofreCredenciais.escritorioId, esc.escritorio.id),
              eq(cofreCredenciais.sistema, sistemaCofre),
              eq(cofreCredenciais.status, "ativa"),
            ),
          )
          .limit(1);
      }
      if (credencial.length === 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Cadastre uma credencial OAB-${tribunal.uf ?? ""} no Cofre.`,
        });
      }

      const credId = credencial[0].id;
      const storageState = await recuperarSessao(credId, { tentarRelogin: true });
      if (!storageState) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Sessão expirou. Vá no Cofre → Validar.`,
        });
      }

      await consumirCreditos(
        esc.escritorio.id,
        ctx.user.id,
        CUSTOS.consulta_cnj,
        "consulta_cnj",
        `Detalhe CNJ: ${input.cnj} (${tribunal.siglaTribunal})`,
      );

      let resultado;
      try {
        resultado = await consultarTjce(
          input.cnj,
          storageState,
          getConfigTribunal(tribunal.codigoTribunal) ?? undefined,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error({ cnj: input.cnj, err: msg }, "[consultarCNJSincrono] scraper crashed");
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Falha no scraper: ${msg.slice(0, 200)}. Crédito foi debitado.`,
        });
      }

      if (!resultado.ok) {
        // Erro de domínio (captcha, processo sigiloso, etc) — devolve o
        // motivo pro frontend mostrar mensagem específica, mas mantém
        // crédito debitado (caller já pagou pela tentativa).
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: resultado.mensagemErro ?? "Erro desconhecido",
          cause: { categoria: resultado.categoriaErro },
        });
      }

      // Adapta `ResultadoScraper.capa+movimentacoes` pro mesmo shape
      // que `obterResultadoMotorProprio` produz pro frontend (JuditLawsuit).
      // Sem reuso direto pq aquela função usa o cache do runner — aqui
      // já temos `resultado` em mãos.
      const capa = resultado.capa;
      const lawsuit = capa
        ? {
            code: capa.cnj,
            instance: 1,
            name: capa.classe ?? capa.cnj,
            tribunal_acronym: resultado.tribunal.toUpperCase(),
            county: capa.comarca ?? "",
            city: capa.comarca ?? "",
            state: capa.uf ?? "",
            distribution_date: capa.dataDistribuicao ?? "",
            status: capa.status ?? undefined,
            judge: capa.juiz ?? undefined,
            amount: capa.valorCausaCentavos != null
              ? capa.valorCausaCentavos / 100
              : undefined,
            last_step: resultado.movimentacoes[0]
              ? {
                  step_id: `motor:${resultado.movimentacoes[0].data}`,
                  step_date: resultado.movimentacoes[0].data,
                  content: resultado.movimentacoes[0].texto,
                  steps_count: resultado.movimentacoes.length,
                }
              : undefined,
            subjects: capa.assuntos.map((a, idx) => ({
              code: `motor-${idx}`,
              name: a,
            })),
            classifications: capa.classe
              ? [{ code: "main", name: capa.classe }]
              : [],
            parties: capa.partes.map((p) => ({
              name: p.nome,
              side: (p.polo === "passivo" ? "Passive" : "Active") as
                | "Active"
                | "Passive",
              person_type:
                p.tipo === "juridica"
                  ? "Legal Entity"
                  : p.tipo === "fisica"
                    ? "Natural Person"
                    : "Unknown",
              main_document: p.documento ?? undefined,
              lawyers: p.advogados.map((a) => ({
                name: a.nome,
                main_document: a.oab ?? undefined,
              })),
            })),
            steps: resultado.movimentacoes.map((m) => ({
              step_id: `motor:${m.data}:${m.texto.slice(0, 16)}`,
              step_date: m.data,
              content: m.texto,
              step_type: m.tipo ?? undefined,
            })),
          }
        : null;

      log.info(
        { cnj: input.cnj, tribunal: tribunal.codigoTribunal, capaPresente: !!capa, movsCount: resultado.movimentacoes.length },
        "[consultarCNJSincrono] ok",
      );

      return { lawsuit };
    }),

  /** Verifica status de uma consulta em andamento */
  statusConsulta: protectedProcedure
    .input(z.object({ requestId: z.string() }))
    .query(({ input }) => {
      if (!ehRequestMotorProprio(input.requestId)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "RequestId inválido" });
      }
      const status = obterStatusMotorProprio(input.requestId);
      if (!status) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Consulta não encontrada (TTL 30min expirou)",
        });
      }
      return status;
    }),

  /** Retorna o resultado completo da consulta (ResultadoScraper shape) */
  resultados: protectedProcedure
    .input(z.object({ requestId: z.string() }))
    .mutation(({ input }) => {
      if (!ehRequestMotorProprio(input.requestId)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "RequestId inválido" });
      }
      const r = obterResultadoMotorProprio(input.requestId);
      if (!r) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Consulta não encontrada (TTL 30min expirou)",
        });
      }
      return r;
    }),

  /** Histórico de transações do escritório */
  transacoes: protectedProcedure
    .input(z.object({ limite: z.number().min(1).max(100).default(50) }).optional())
    .query(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) return [];
      const db = await getDb();
      if (!db) return [];
      return db
        .select()
        .from(motorTransacoes)
        .where(eq(motorTransacoes.escritorioId, esc.escritorio.id))
        .orderBy(desc(motorTransacoes.createdAt))
        .limit(input?.limite ?? 50);
    }),

  /** Admin: adiciona créditos manualmente (após pagamento via Stripe etc) */
  adicionarCreditos: adminProcedure
    .input(
      z.object({
        escritorioId: z.number().int().positive(),
        quantidade: z.number().int().positive(),
        motivo: z.string().min(1).max(255),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });

      let [creditos] = await db
        .select()
        .from(motorCreditos)
        .where(eq(motorCreditos.escritorioId, input.escritorioId))
        .limit(1);

      if (!creditos) {
        await db.insert(motorCreditos).values({
          escritorioId: input.escritorioId,
          saldo: 0,
          totalComprado: 0,
          totalConsumido: 0,
        });
        const [novo] = await db
          .select()
          .from(motorCreditos)
          .where(eq(motorCreditos.escritorioId, input.escritorioId))
          .limit(1);
        creditos = novo;
      }

      const novoSaldo = creditos.saldo + input.quantidade;
      await db
        .update(motorCreditos)
        .set({
          saldo: novoSaldo,
          totalComprado: creditos.totalComprado + input.quantidade,
        })
        .where(eq(motorCreditos.id, creditos.id));

      await db.insert(motorTransacoes).values({
        escritorioId: input.escritorioId,
        tipo: "compra",
        quantidade: input.quantidade,
        saldoAnterior: creditos.saldo,
        saldoDepois: novoSaldo,
        operacao: "compra_admin",
        detalhes: input.motivo,
        userId: ctx.user.id,
      });

      return { adicionados: input.quantidade, saldoNovo: novoSaldo };
    }),

  // ─── MONITORAMENTOS (Sprint 2) ──────────────────────────────────────────
  // Cobra cred imediatamente (primeira mensalidade) na criação. Cron mensal
  // (cobrarMonitoramentosMensais) cobra renovação após 30 dias.

  meusMonitoramentos: protectedProcedure
    .input(
      z
        .object({
          tipoMonitoramento: z.enum(["movimentacoes", "novas_acoes"]).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return [];
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) return [];

      // Permissão: gestor/dono vê todos do escritório. Atendente/SDR vê
      // apenas mon de clientes onde ele é responsável (JOIN com contatos
      // por searchKey/cpfCnpj e responsavelId).
      const { checkPermission } = await import("../escritorio/check-permission");
      const perm = await checkPermission(ctx.user.id, "processos", "ver");
      const filtraPorResponsavel = !perm.verTodos && perm.verProprios;

      const filtros = [eq(motorMonitoramentos.escritorioId, esc.escritorio.id)];
      if (input?.tipoMonitoramento) {
        filtros.push(eq(motorMonitoramentos.tipoMonitoramento, input.tipoMonitoramento));
      }

      let rows;
      if (filtraPorResponsavel) {
        // INNER JOIN com contatos: monitoramento.searchKey = contato.cpfCnpj
        // (sanitizado) E contato.responsavelId = colabId. Cliente sem contato
        // cadastrado fica invisível pra atendente.
        const { contatos } = await import("../../drizzle/schema");
        rows = await db
          .select({ mon: motorMonitoramentos })
          .from(motorMonitoramentos)
          .innerJoin(
            contatos,
            and(
              eq(contatos.escritorioId, esc.escritorio.id),
              eq(contatos.responsavelId, esc.colaborador.id),
              // Match flexível: searchKey vs cpfCnpj limpo (sem máscara)
              sql`REPLACE(REPLACE(REPLACE(${contatos.cpfCnpj}, '.', ''), '-', ''), '/', '') = ${motorMonitoramentos.searchKey}`,
            ),
          )
          .where(and(...filtros))
          .orderBy(desc(motorMonitoramentos.createdAt));
        return rows.map((r) => enriquecerMonitorComCapa(r.mon));
      }

      // Gestor/dono: tudo do escritório
      rows = await db
        .select()
        .from(motorMonitoramentos)
        .where(and(...filtros))
        .orderBy(desc(motorMonitoramentos.createdAt));
      return rows.map((r) => enriquecerMonitorComCapa(r));
    }),

  criarMonitoramento: protectedProcedure
    .input(
      z.object({
        numeroCnj: z.string().min(15).max(30),
        credencialId: z.number().int().positive(),
        apelido: z.string().max(255).optional(),
        recurrenceHoras: z.number().int().min(1).max(168).default(6),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "NOT_FOUND", message: "Escritório não encontrado" });

      const tribunal = parseCnjTribunal(input.numeroCnj);
      if (!tribunal) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "CNJ inválido" });
      }
      if (!tribunal.temMotorProprio) {
        throw new TRPCError({
          code: "NOT_IMPLEMENTED",
          message: `Monitoramento para ${tribunal.siglaTribunal} ainda em desenvolvimento. Hoje cobrimos: TJCE 1º grau.`,
        });
      }

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });

      // Confirma credencial pertence ao escritório (compartilhado entre dono + colaboradores)
      const [cred] = await db
        .select()
        .from(cofreCredenciais)
        .where(
          and(
            eq(cofreCredenciais.id, input.credencialId),
            eq(cofreCredenciais.escritorioId, esc.escritorio.id),
            eq(cofreCredenciais.status, "ativa"),
          ),
        )
        .limit(1);
      if (!cred) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Credencial não encontrada ou inativa. Cadastre/valide em /processos?tab=cofre.",
        });
      }

      // Cobra primeira mensalidade
      await consumirCreditos(
        esc.escritorio.id,
        ctx.user.id,
        CUSTOS.monitorar_processo_mes,
        "monitorar_processo_mes",
        `Monitor CNJ ${input.numeroCnj} (${tribunal.siglaTribunal})`,
      );

      const cnjMascarado = mascararCnj(input.numeroCnj);
      const result = await db.insert(motorMonitoramentos).values({
        escritorioId: esc.escritorio.id,
        criadoPor: ctx.user.id,
        tipoMonitoramento: "movimentacoes",
        searchType: "lawsuit_cnj",
        searchKey: cnjMascarado,
        apelido: input.apelido ?? cnjMascarado,
        tribunal: tribunal.codigoTribunal,
        credencialId: input.credencialId,
        status: "ativo",
        recurrenceHoras: input.recurrenceHoras,
        ultimaCobrancaEm: new Date(),
      });
      const insertId =
        (result as unknown as { insertId: number }[])[0]?.insertId ??
        (result as unknown as { insertId: number }).insertId;

      log.info(
        { user: ctx.user.id, monId: insertId, cnj: cnjMascarado, tribunal: tribunal.codigoTribunal },
        "[motor-proprio] monitoramento de processo criado",
      );

      return { id: insertId, custoCred: CUSTOS.monitorar_processo_mes };
    }),

  pausarMonitoramento: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "NOT_FOUND", message: "Escritório não encontrado" });
      const [mon] = await db
        .select()
        .from(motorMonitoramentos)
        .where(
          and(
            eq(motorMonitoramentos.id, input.id),
            eq(motorMonitoramentos.escritorioId, esc.escritorio.id),
          ),
        )
        .limit(1);
      if (!mon) throw new TRPCError({ code: "NOT_FOUND", message: "Monitoramento não encontrado" });
      await db
        .update(motorMonitoramentos)
        .set({ status: "pausado" })
        .where(eq(motorMonitoramentos.id, input.id));
      return { ok: true };
    }),

  reativarMonitoramento: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "NOT_FOUND", message: "Escritório não encontrado" });
      const [mon] = await db
        .select()
        .from(motorMonitoramentos)
        .where(
          and(
            eq(motorMonitoramentos.id, input.id),
            eq(motorMonitoramentos.escritorioId, esc.escritorio.id),
          ),
        )
        .limit(1);
      if (!mon) throw new TRPCError({ code: "NOT_FOUND", message: "Monitoramento não encontrado" });
      await db
        .update(motorMonitoramentos)
        .set({ status: "ativo" })
        .where(eq(motorMonitoramentos.id, input.id));
      return { ok: true };
    }),

  deletarMonitoramento: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "NOT_FOUND", message: "Escritório não encontrado" });
      // Verifica que monitoramento pertence ao escritório
      const [mon] = await db
        .select()
        .from(motorMonitoramentos)
        .where(
          and(
            eq(motorMonitoramentos.id, input.id),
            eq(motorMonitoramentos.escritorioId, esc.escritorio.id),
          ),
        )
        .limit(1);
      if (!mon) throw new TRPCError({ code: "NOT_FOUND", message: "Monitoramento não encontrado" });
      // Hard delete — eventos_processo associados ficam (auditoria)
      await db.delete(motorMonitoramentos).where(eq(motorMonitoramentos.id, input.id));
      return { ok: true };
    }),

  historicoMonitoramento: protectedProcedure
    .input(
      z.object({
        monitoramentoId: z.number().int().positive(),
        page: z.number().int().min(1).default(1).optional(),
        pageSize: z.number().int().min(1).max(200).default(50).optional(),
        // mantido pra compat com chamadas antigas
        limite: z.number().int().min(1).max(200).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      const limite = input.limite ?? input.pageSize ?? 50;
      if (!db) return { items: [], eventos: [], totalNaoLidas: 0 };
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) return { items: [], eventos: [], totalNaoLidas: 0 };
      const [mon] = await db
        .select()
        .from(motorMonitoramentos)
        .where(
          and(
            eq(motorMonitoramentos.id, input.monitoramentoId),
            eq(motorMonitoramentos.escritorioId, esc.escritorio.id),
          ),
        )
        .limit(1);
      if (!mon) throw new TRPCError({ code: "NOT_FOUND", message: "Monitoramento não encontrado" });

      // Filtra por (escritorioId + cnjAfetado) em vez de só
      // monitoramentoId. Caso de uso real: user delete e recria
      // monitoramento do mesmo CNJ — events antigos ficam órfãos
      // com monitoramentoId antigo, novos INSERT batem dedup
      // (hashDedup não inclui monId), e a UI ficava vazia mesmo
      // com dados no DB. Filtrando por CNJ pega o histórico todo
      // do escritório, independente de quantas vezes o monitoramento
      // foi recriado. escritorioId garante isolamento multi-tenant.
      const eventos = await db
        .select()
        .from(eventosProcesso)
        .where(
          and(
            eq(eventosProcesso.escritorioId, esc.escritorio.id),
            eq(eventosProcesso.cnjAfetado, mon.searchKey),
          ),
        )
        .orderBy(desc(eventosProcesso.dataEvento))
        .limit(limite);

      // Shape compat com frontend antigo (esperava resp Judit):
      // items[].responseType + items[].responseData. Mapeia eventos
      // pra esse formato. O frontend (Processos.tsx steps.map) lê
      // s.step_date e s.content (Judit shape). Quando o evento veio
      // do scraper TJCE, conteudoJson tem {data, texto, tipo} —
      // adaptamos aqui pro frontend não precisar saber de qual fonte
      // vem o dado.
      function adaptarMov(parsed: any, fallbackTexto: string, fallbackData: Date | string) {
        if (parsed && typeof parsed === "object") {
          // Já no shape Judit: passa direto.
          if ("step_date" in parsed || "content" in parsed) return parsed;
          // Shape MovimentacaoProcesso (TJCE scraper): adapta.
          if ("data" in parsed || "texto" in parsed) {
            return {
              step_date: parsed.data ?? fallbackData,
              content: parsed.texto ?? fallbackTexto,
              type: parsed.tipo ?? null,
            };
          }
        }
        return { step_date: fallbackData, content: fallbackTexto };
      }
      const items = eventos.map((e) => ({
        id: e.id,
        responseType: e.tipo === "movimentacao" ? "step" : e.tipo,
        responseData: adaptarMov(e.conteudoJson ? safeParse(e.conteudoJson) : null, e.conteudo, e.dataEvento),
        createdAt: e.createdAt,
        lido: e.lido,
      }));
      const naoLidas = eventos.filter((e) => !e.lido).length;

      // Capa e partes vêm do monitoramento (persistidos pelo cron e
      // pela busca sob demanda). Adaptamos pra Judit shape aqui pra
      // que o frontend (MonitoramentoCard) leia os mesmos campos
      // (tribunal_acronym, amount, instance, parties[].name/side/...)
      // que ele já renderiza no caminho do `processoCompleto` state.
      const capaParsed = mon.capaJson ? safeParse(mon.capaJson) : null;
      const partesParsed = mon.partesJson ? safeParse(mon.partesJson) : null;
      // Passar movs reais (extraídas dos eventos_processo) pro adapter
      // pra que `capa.steps` também tenha dados como redundância. Se o
      // frontend cair em algum fluxo que não monta steps via items,
      // ainda pega do spread {...capa}.
      const movsParaAdapter = eventos
        .filter((e) => e.tipo === "movimentacao")
        .map((e) => {
          const parsed = (e.conteudoJson ? safeParse(e.conteudoJson) : null) as
            | { data?: string; texto?: string }
            | null;
          if (parsed && (parsed.data || parsed.texto)) return parsed;
          return { data: e.dataEvento, texto: e.conteudo };
        });
      const capaParsedTyped = capaParsed as { partes?: unknown[] } | null;
      const capa = capaParsedTyped
        ? adaptarParaJuditShape(
            {
              capa: {
                ...capaParsedTyped,
                partes: partesParsed ?? capaParsedTyped.partes ?? [],
              },
              movimentacoes: movsParaAdapter,
              tribunal: mon.tribunal,
            },
            mon.searchKey,
          )
        : null;

      log.info(
        { monId: mon.id, totalEventos: eventos.length, totalMovs: movsParaAdapter.length, temCapa: !!capa },
        "[processos] historicoMonitoramento",
      );

      return { items, eventos, capa, partes: capa?.parties ?? [], totalNaoLidas: naoLidas };
    }),

  // Dispara consulta direta do processo associado a um monitoramento.
  // Cobra 1 cred. Útil quando o user clica "Histórico" no card pra
  // forçar atualização imediata em vez de esperar o cron de 6h.
  buscarProcessoCompleto: protectedProcedure
    .input(z.object({ monitoramentoId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "NOT_FOUND", message: "Escritório não encontrado" });

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });

      const [mon] = await db
        .select()
        .from(motorMonitoramentos)
        .where(
          and(
            eq(motorMonitoramentos.id, input.monitoramentoId),
            eq(motorMonitoramentos.escritorioId, esc.escritorio.id),
          ),
        )
        .limit(1);
      if (!mon) throw new TRPCError({ code: "NOT_FOUND", message: "Monitoramento não encontrado" });

      if (!mon.credencialId) {
        return { encontrado: false, mensagem: "Monitoramento sem credencial vinculada" };
      }

      const sessao = await recuperarSessao(mon.credencialId, { tentarRelogin: true });
      if (!sessao) {
        return {
          encontrado: false,
          mensagem: "Sessão expirou. Vá em Cofre de Credenciais → Validar pra renovar.",
        };
      }

      // Cobra 1 cred (mesma tarifa de consultarCNJ direta)
      await consumirCreditos(
        esc.escritorio.id,
        ctx.user.id,
        CUSTOS.consulta_cnj,
        "consulta_cnj",
        `Histórico monitoramento ${mon.searchKey}`,
      );

      const cfgTribunal = getConfigTribunal(mon.tribunal);
      let resultado;
      if (cfgTribunal) {
        resultado = await consultarTjce(mon.searchKey, sessao, cfgTribunal);
      } else {
        return {
          encontrado: false,
          mensagem: `Tribunal ${mon.tribunal} ainda sem adapter implementado.`,
        };
      }

      if (!resultado.ok) {
        await db
          .update(motorMonitoramentos)
          .set({ ultimoErro: resultado.mensagemErro ?? "Erro na consulta", ultimaConsultaEm: new Date() })
          .where(eq(motorMonitoramentos.id, mon.id));
        return { encontrado: false, mensagem: resultado.mensagemErro ?? "Erro desconhecido" };
      }

      // Persiste movs no DB (mesma lógica do cron, mas como busca foi
      // sob demanda do user marcamos lido=true — não dispara notif).
      // Sem isso, o user pagava 1 cred toda vez que abrisse o card e o
      // refresh perdia tudo (state in-memory).
      const capaJson = resultado.capa ? JSON.stringify(resultado.capa) : null;
      const partesJson = resultado.capa?.partes
        ? JSON.stringify(resultado.capa.partes)
        : null;

      // Contadores pra log diagnóstico — sem visibilidade no que está
      // sendo persistido, fica difícil distinguir "scraper veio vazio"
      // de "INSERT falhou silenciosamente" quando o user reporta movs
      // não aparecendo após refresh.
      let inseridos = 0;
      let dedup = 0;
      let dataInvalida = 0;
      let erroInsert = 0;
      try {
        for (const mov of resultado.movimentacoes) {
          // Valida data antes de tentar inserir — Invalid Date faz
          // MySQL rejeitar com erro genérico que cai no catch dedup
          // sem distinção. Pula explicitamente.
          const dataParsed = new Date(mov.data);
          if (Number.isNaN(dataParsed.getTime())) {
            dataInvalida++;
            continue;
          }
          const { dedup: dedupHash, jaConhecida } = await resolverDedupMovimentacao(
            db,
            mon.escritorioId,
            mon.searchKey,
            mov.data,
            mov.texto,
          );
          if (jaConhecida) {
            // Já gravada sob o hash legado (migrada agora) — conta como dedup.
            dedup++;
            continue;
          }
          try {
            await db.insert(eventosProcesso).values({
              monitoramentoId: mon.id,
              escritorioId: mon.escritorioId,
              tipo: "movimentacao",
              dataEvento: dataParsed,
              fonte: "pje",
              conteudo: mov.texto,
              conteudoJson: JSON.stringify(mov),
              cnjAfetado: mon.searchKey,
              hashDedup: dedupHash,
              lido: true,
            });
            inseridos++;
          } catch (err) {
            const errAny = err as any;
            // Drizzle envolve mysql2 — err.message é só "Failed
            // query: ..." (sem "Duplicate"). A verdade fica em
            // err.cause.code === "ER_DUP_ENTRY". Antes o detector
            // checava err.message, classificava dedup como erro real
            // e enchia o log de warns falsos.
            const isDedup =
              errAny?.cause?.code === "ER_DUP_ENTRY" ||
              errAny?.cause?.errno === 1062;
            if (isDedup) {
              dedup++;
            } else {
              erroInsert++;
              const msg = err instanceof Error ? err.message : String(err);
              log.warn(
                {
                  err: msg,
                  causeMessage: errAny?.cause?.message,
                  causeCode: errAny?.cause?.code,
                  causeSqlMessage: errAny?.cause?.sqlMessage,
                  causeSqlState: errAny?.cause?.sqlState,
                  causeErrno: errAny?.cause?.errno,
                  monId: mon.id,
                  cnj: mon.searchKey,
                  movData: mov.data,
                },
                "[buscarProcessoCompleto] INSERT eventoProcesso falhou (não-dedup)",
              );
            }
          }
        }
        await db
          .update(motorMonitoramentos)
          .set({
            ultimaConsultaEm: new Date(),
            ultimaMovimentacaoEm: resultado.movimentacoes[0]?.data
              ? new Date(resultado.movimentacoes[0].data)
              : null,
            ultimaMovimentacaoTexto: resultado.movimentacoes[0]?.texto?.slice(0, 500) ?? null,
            capaJson,
            partesJson,
            status: "ativo",
            ultimoErro: null,
          })
          .where(eq(motorMonitoramentos.id, mon.id));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn(
          { err: msg, monId: mon.id, cnj: mon.searchKey },
          "[buscarProcessoCompleto] persistência falhou (UPDATE ou loop externo)",
        );
      }

      // Adapta ResultadoScraper → shape JuditLawsuit-like que o
      // frontend `MonitoramentoCard` espera (steps, parties, code, etc).
      const processoAdaptado = adaptarParaJuditShape(resultado, mon.searchKey);
      const totalMovs = resultado.movimentacoes.length;
      log.info(
        { monId: mon.id, cnj: mon.searchKey, totalMovs, inseridos, dedup, dataInvalida, erroInsert, latenciaMs: resultado.latenciaMs },
        "[motor-proprio] buscarProcessoCompleto",
      );
      return { encontrado: true, processo: processoAdaptado, totalMovs };
    }),

  // ─── NOVAS AÇÕES por CPF/CNPJ (Sub-sprint 2.2) ─────────────────────────
  // Implementa em sub-sprint 2.2 quando consultarPorCpf adapter estiver pronto.
  // Stubs aqui pra typecheck do frontend não quebrar.

  criarMonitoramentoNovasAcoes: protectedProcedure
    .input(
      z.object({
        tipo: z.enum(["cpf", "cnpj"]),
        valor: z.string().min(11).max(20),
        apelido: z.string().max(255).optional(),
        // Opcional: se omitido, backend auto-seleciona a primeira credencial
        // ativa do usuário (TJCE). Frontend pode chamar sem credencial.
        credencialId: z.number().int().positive().optional(),
        recurrenceHoras: z.number().int().min(1).max(168).default(6),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "NOT_FOUND", message: "Escritório não encontrado" });

      const docLimpo = input.valor.replace(/\D/g, "");
      if (input.tipo === "cpf" && docLimpo.length !== 11) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "CPF deve ter 11 dígitos" });
      }
      if (input.tipo === "cnpj" && docLimpo.length !== 14) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "CNPJ deve ter 14 dígitos" });
      }

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });

      // Confirma posse da credencial. Cofre é compartilhado pelo escritório:
      // qualquer membro (dono ou colaborador) usa as credenciais cadastradas
      // pelo escritório.
      let cred: typeof cofreCredenciais.$inferSelect | undefined;
      if (input.credencialId) {
        [cred] = await db
          .select()
          .from(cofreCredenciais)
          .where(
            and(
              eq(cofreCredenciais.id, input.credencialId),
              eq(cofreCredenciais.escritorioId, esc.escritorio.id),
              eq(cofreCredenciais.status, "ativa"),
            ),
          )
          .limit(1);
      } else {
        // Auto-seleção: prefere pje_tjce, fallback esaj_tjce. Qualquer
        // credencial ativa do escritório com sistema suportado.
        const todas = await db
          .select()
          .from(cofreCredenciais)
          .where(
            and(
              eq(cofreCredenciais.escritorioId, esc.escritorio.id),
              eq(cofreCredenciais.status, "ativa"),
            ),
          );
        const suportadas = todas.filter(
          (c) => c.sistema === "pje_tjce" || c.sistema === "esaj_tjce",
        );
        cred = suportadas.find((c) => c.sistema === "pje_tjce") ?? suportadas[0];
      }
      if (!cred) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Nenhuma credencial ativa de TJCE encontrada. Cadastre uma em Processos → Cofre antes de criar monitoramento.",
        });
      }

      // Mapeia sistema cofre → tribunal. Hoje só TJCE 1º grau.
      const tribunalDaCred = cred.sistema === "esaj_tjce" || cred.sistema === "pje_tjce" ? "tjce" : null;
      if (!tribunalDaCred) {
        throw new TRPCError({
          code: "NOT_IMPLEMENTED",
          message: `Monitoramento de novas ações ainda só funciona pra TJCE. Sistema ${cred.sistema} entra em sprint futura.`,
        });
      }

      // Cobra primeira mensalidade (15 cred)
      await consumirCreditos(
        esc.escritorio.id,
        ctx.user.id,
        CUSTOS.monitorar_pessoa_mes,
        "monitorar_pessoa_mes",
        `Monitor ${input.tipo.toUpperCase()} ${docLimpo.slice(0, 3)}***`,
      );

      // "Desde quando alertar": busca um contato no escritório com o
      // mesmo CPF/CNPJ. Se achar, usa `createdAt` dele — só CNJs ajuizados
      // a partir da data de cadastro do cliente viram alerta. Se não há
      // contato (busca solta), fica NULL e comportamento volta ao antigo.
      const { contatos: tabelaContatos } = await import("../../drizzle/schema");
      const { sql: sqlOp } = await import("drizzle-orm");
      const cnjQuery = await db
        .select({ id: tabelaContatos.id, createdAt: tabelaContatos.createdAt })
        .from(tabelaContatos)
        .where(
          and(
            eq(tabelaContatos.escritorioId, esc.escritorio.id),
            sqlOp`REPLACE(REPLACE(REPLACE(REPLACE(${tabelaContatos.cpfCnpj}, '.', ''), '-', ''), '/', ''), ' ', '') = ${docLimpo}`,
          ),
        )
        .limit(1);
      const dataReferenciaCadastro = cnjQuery[0]?.createdAt ?? null;

      const result = await db.insert(motorMonitoramentos).values({
        escritorioId: esc.escritorio.id,
        criadoPor: ctx.user.id,
        tipoMonitoramento: "novas_acoes",
        searchType: input.tipo,
        searchKey: docLimpo,
        apelido: input.apelido ?? `${input.tipo.toUpperCase()} ${docLimpo.slice(0, 3)}***`,
        tribunal: tribunalDaCred,
        credencialId: cred.id,
        status: "ativo",
        recurrenceHoras: input.recurrenceHoras,
        cnjsConhecidos: "[]",
        ultimaCobrancaEm: new Date(),
        dataReferenciaCadastro,
      });
      const insertId =
        (result as unknown as { insertId: number }[])[0]?.insertId ??
        (result as unknown as { insertId: number }).insertId;

      log.info(
        { user: ctx.user.id, monId: insertId, tipo: input.tipo, tribunal: tribunalDaCred },
        "[motor-proprio] monitoramento de novas ações criado",
      );

      return { id: insertId, custoCred: CUSTOS.monitorar_pessoa_mes };
    }),

  listarNovasAcoes: protectedProcedure
    .input(
      z.object({
        apenasNaoLidas: z.boolean().optional(),
        limite: z.number().int().min(1).max(100).default(20),
        cursor: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      const empty = { acoes: [], monitoramentos: [], totalNaoLidas: 0, hasMore: false, nextCursor: 0 };
      const db = await getDb();
      if (!db) return empty;
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) return empty;

      // Frontend (Processos.tsx) espera campos enriquecidos: cnj,
      // tribunal, clienteApelido, clienteSearchKey/Type — eventos_processo
      // só tem cnjAfetado e os ids relacionais. JOIN com
      // motor_monitoramentos puxa apelido/searchKey/searchType/tribunal
      // do contexto do monitoramento que disparou o evento.
      // Campos detalhados do CNJ (classeProcesso, valorCausa, polos) não
      // existem em eventos_processo — o cron registra só "apareceu". Pra
      // ver detalhes o user clica e dispara consulta sob demanda.
      // dataDistribuicao no frontend é só "quando aconteceu" — pra novas
      // ações é a hora em que o cron detectou (não temos a distribuição
      // real sem consulta detalhada). Mapeamos dataEvento pro nome que
      // o frontend já espera pra evitar mexer na UI.
      // Pedimos limite+1 pra detectar se há mais páginas sem precisar de
      // segunda query de COUNT(*). Se vier limite+1, fatiamos e marcamos
      // hasMore=true.
      //
      // apenasNaoLidas filtra `lido=false`. O cron grava `lido=true` em
      // três casos que NÃO devem alertar: baseline (primeira execução do
      // monitoramento), cliente como polo ativo (autor) e ajuizado antes
      // do cadastro do cliente. Sem este filtro, esses eventos silenciados
      // apareciam como cards "novos" e processos antigos (ex: 2015)
      // contavam como alerta porque `createdAt` é a hora do INSERT.
      const condicoes = [
        eq(eventosProcesso.escritorioId, esc.escritorio.id),
        eq(eventosProcesso.tipo, "nova_acao"),
      ];
      if (input.apenasNaoLidas) {
        condicoes.push(eq(eventosProcesso.lido, false));
      }

      const acoesRaw = await db
        .select({
          id: eventosProcesso.id,
          cnj: eventosProcesso.cnjAfetado,
          tribunal: motorMonitoramentos.tribunal,
          dataDistribuicao: eventosProcesso.dataEvento,
          conteudo: eventosProcesso.conteudo,
          lido: eventosProcesso.lido,
          createdAt: eventosProcesso.createdAt,
          monitoramentoId: eventosProcesso.monitoramentoId,
          clienteApelido: motorMonitoramentos.apelido,
          clienteSearchKey: motorMonitoramentos.searchKey,
          clienteSearchType: motorMonitoramentos.searchType,
        })
        .from(eventosProcesso)
        .leftJoin(
          motorMonitoramentos,
          eq(motorMonitoramentos.id, eventosProcesso.monitoramentoId),
        )
        .where(and(...condicoes))
        .orderBy(desc(eventosProcesso.createdAt))
        .offset(input.cursor)
        .limit(input.limite + 1);

      const monitoramentos = await db
        .select()
        .from(motorMonitoramentos)
        .where(
          and(
            eq(motorMonitoramentos.escritorioId, esc.escritorio.id),
            eq(motorMonitoramentos.tipoMonitoramento, "novas_acoes"),
          ),
        );

      // Filtra eventos cujo CNJ tem DV inválido — defesa em profundidade
      // contra "CNJs fantasmas" que o cron pré-fix capturou (ex: o
      // placeholder "9999999-99.9999.9.99.9999" do form do PJe TJCE).
      // O fix do scraper (PR #205) já impede contaminação futura via
      // validarCnj em extrairCnjs, mas o lixo histórico fica no DB —
      // este filtro garante que não polui a UI mesmo sem cleanup
      // explícito de cada placeholder conhecido.
      const acoesFiltradas = acoesRaw.filter((a) => a.cnj && validarCnj(a.cnj));

      // hasMore detecta a presença do +1 da query (antes do filtro de DV
      // inválido — o filtro pode reduzir o tamanho mas não muda se há
      // próxima página no DB).
      const hasMore = acoesRaw.length > input.limite;
      const acoesValidas = hasMore
        ? acoesFiltradas.slice(0, input.limite)
        : acoesFiltradas;

      // totalNaoLidas precisa ser o contador GLOBAL (não da página), porque
      // o badge no cabeçalho da aba mostra esse número e a UI faz query
      // separada com limite=1 só pra ele. COUNT separado é mais barato que
      // varrer todas as páginas e é preciso.
      const [contagem] = await db
        .select({ total: sql<number>`count(*)` })
        .from(eventosProcesso)
        .where(
          and(
            eq(eventosProcesso.escritorioId, esc.escritorio.id),
            eq(eventosProcesso.tipo, "nova_acao"),
            eq(eventosProcesso.lido, false),
          ),
        );
      const naoLidas = Number(contagem?.total ?? 0);
      return {
        acoes: acoesValidas,
        monitoramentos,
        totalNaoLidas: naoLidas,
        hasMore,
        nextCursor: hasMore ? input.cursor + input.limite : input.cursor + acoesValidas.length,
      };
    }),

  marcarNovaAcaoLida: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "NOT_FOUND", message: "Escritório não encontrado" });

      await db
        .update(eventosProcesso)
        .set({ lido: true })
        .where(
          and(
            eq(eventosProcesso.id, input.id),
            eq(eventosProcesso.escritorioId, esc.escritorio.id),
          ),
        );
      return { ok: true };
    }),

  /** Remove uma nova ação detectada (hard delete). Usado quando o usuário
   *  identifica falso positivo — vamos sumir com o card. Filtra por
   *  escritorioId pra evitar deletar registro de outro escritório. */
  removerNovaAcao: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "NOT_FOUND", message: "Escritório não encontrado" });

      await db
        .delete(eventosProcesso)
        .where(
          and(
            eq(eventosProcesso.id, input.id),
            eq(eventosProcesso.escritorioId, esc.escritorio.id),
          ),
        );
      return { ok: true };
    }),

  /**
   * Força polling sob demanda de UM monitoramento de novas ações.
   * Não cobra crédito (já está na mensalidade de 15 cred/mês).
   * Útil pra validar adapter sem esperar cron de 1h.
   */

  /**
   * Inicia atualização em lote de TODOS os monitoramentos ativos do
   * escritório. Não cobra créditos (já estão na mensalidade).
   *
   * Retorna `operacaoId` imediatamente. Frontend pode acompanhar via
   * `progressoAtualizacao(operacaoId)` ou ouvir SSE `info` com
   * `dados.kind === "atualizacao_progresso"`.
   *
   * Operação roda em background — se user sair da página e voltar,
   * pode chamar `operacoesPendentes` pra retomar exibição.
   */
  atualizarTodosMonitoramentos: protectedProcedure
    .input(
      z.object({
        // Opcional: restringir a um subset. Sem isso, atualiza tudo.
        monitoramentoIds: z.array(z.number().int().positive()).max(200).optional(),
      }).optional(),
    )
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "NOT_FOUND", message: "Escritório não encontrado" });

      const { iniciarAtualizacaoTodos } = await import("../processos/atualizacao-runner");
      try {
        const { operacaoId, total } = await iniciarAtualizacaoTodos(
          ctx.user.id,
          esc.escritorio.id,
          { monitoramentoIds: input?.monitoramentoIds },
        );
        return { operacaoId, total };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new TRPCError({ code: "BAD_REQUEST", message: msg });
      }
    }),

  /** Lê progresso de uma operação de atualização em andamento. */
  progressoAtualizacao: protectedProcedure
    .input(z.object({ operacaoId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { obterProgressoAtualizacao } = await import("../processos/atualizacao-runner");
      const op = obterProgressoAtualizacao(input.operacaoId, ctx.user.id);
      if (!op) {
        // Pode ser que TTL expirou ou usuário errado — retorna null
        // (UI sabe que perdeu a operação e pode oferecer reiniciar).
        return null;
      }
      return {
        operacaoId: op.id,
        status: op.status,
        iniciadoEm: new Date(op.iniciadoEm).toISOString(),
        finalizadoEm: op.finalizadoEm ? new Date(op.finalizadoEm).toISOString() : null,
        total: op.total,
        processados: op.processados,
        ok: op.ok,
        erro: op.erro,
        detectadasTotal: op.detectadasTotal,
        monitores: op.monitores,
      };
    }),

  /**
   * Lista operações de atualização em curso pelo user. Frontend chama
   * ao montar a página: se houver operação pendente, retoma o drawer
   * "Atualizando…" sem o user perder o progresso por mudança de aba.
   */
  operacoesPendentes: protectedProcedure.query(async ({ ctx }) => {
    const { listarOperacoesPendentes } = await import("../processos/atualizacao-runner");
    return listarOperacoesPendentes(ctx.user.id).map((op) => ({
      operacaoId: op.id,
      status: op.status,
      total: op.total,
      processados: op.processados,
      ok: op.ok,
      erro: op.erro,
      iniciadoEm: new Date(op.iniciadoEm).toISOString(),
    }));
  }),

  atualizarNovasAcoesAgora: protectedProcedure
    .input(z.object({ monitoramentoId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "NOT_FOUND", message: "Escritório não encontrado" });

      const [mon] = await db
        .select()
        .from(motorMonitoramentos)
        .where(
          and(
            eq(motorMonitoramentos.id, input.monitoramentoId),
            eq(motorMonitoramentos.escritorioId, esc.escritorio.id),
            eq(motorMonitoramentos.tipoMonitoramento, "novas_acoes"),
          ),
        )
        .limit(1);
      if (!mon) throw new TRPCError({ code: "NOT_FOUND", message: "Monitoramento não encontrado" });

      // Reaproveita EXATAMENTE a lógica do cron (pollarUmMonitoramentoNovasAcoes),
      // que aplica os filtros de relevância — polo ativo (cliente é o autor),
      // ajuizado antes do cadastro do cliente e CNJ muito antigo sem data de
      // referência. Antes esta procedure duplicava a lógica SEM esses filtros:
      // marcava TODA ação como não-lida e somava todas em totalNovasAcoes,
      // reintroduzindo os falsos-positivos que o cron silencia. A função do
      // cron trata credencial/sessão ausente internamente (grava status="erro"
      // e devolve `erro`), então não repetimos as checagens aqui.
      const { pollarUmMonitoramentoNovasAcoes } = await import(
        "../processos/cron-monitoramento"
      );
      const inicio = Date.now();
      const r = await pollarUmMonitoramentoNovasAcoes(mon);
      const latenciaMs = Date.now() - inicio;

      if (!r.ok) {
        return { ok: false, mensagem: r.erro ?? "Erro desconhecido" };
      }

      // cnjsTotal = total de CNJs já conhecidos após o poll (a função do cron
      // atualiza cnjsConhecidos no DB). Re-lê pra montar o toast que o
      // frontend mostra ("baseline: N processos" / "N já conhecidos").
      const [monAtualizado] = await db
        .select({ cnjsConhecidos: motorMonitoramentos.cnjsConhecidos })
        .from(motorMonitoramentos)
        .where(eq(motorMonitoramentos.id, mon.id))
        .limit(1);
      let cnjsTotal = 0;
      if (monAtualizado?.cnjsConhecidos) {
        try {
          const arr = JSON.parse(monAtualizado.cnjsConhecidos) as string[];
          cnjsTotal = Array.isArray(arr) ? arr.length : 0;
        } catch {
          /* cnjsConhecidos malformado → mantém 0 */
        }
      }

      // cnjsNovos agora reflete só as ações RELEVANTES (r.detectadas) —
      // consistente com o cron e com o badge "N ações novas". Antes contava
      // todas as novas (incl. polo ativo / antigas), inflando o número.
      return {
        ok: true,
        cnjsTotal,
        cnjsNovos: r.baseline ? 0 : r.detectadas,
        baseline: r.baseline ?? false,
        latenciaMs,
      };
    }),
});
