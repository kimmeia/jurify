/**
 * Router tRPC — Atendimento ULTRA: IA + Linha do Tempo Unificada.
 *
 * Features inéditas no nicho jurídico:
 * - Brief Instantâneo (Magic Brief): prediz POR QUE o cliente está chamando
 * - Conversation Diff: o que mudou desde a última resposta do atendente
 * - Detecção de Ação: identifica intenção (2ª via boleto, agendar, etc)
 * - Compliance Guard: bloqueia respostas que violam ética OAB
 * - Linha do Tempo Unificada: WhatsApp + atos + financeiro + agenda + docs
 * - Persona Risk Score: detecta sinais de churn (devolução, troca de adv)
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getEscritorioPorUsuario } from "./db-escritorio";
import { getDb } from "../db";
import { conversas, contatos, mensagens, asaasCobrancas, agendamentos, eventosProcesso, clienteProcessos, assinaturasDigitais } from "../../drizzle/schema";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { chamarIA, parseJsonIA, resolverChaveIA } from "../_core/ai-call";
import { createLogger } from "../_core/logger";

const log = createLogger("router-atendimento-ia");

/** Reduz mensagens recentes a um bloco textual compacto pro contexto da IA. */
function resumirMensagens(msgs: any[], limite = 30): string {
  return msgs
    .slice(-limite)
    .map((m) => {
      const who = m.direcao === "entrada" ? "CLIENTE" : "ADV";
      const dt = m.createdAt ? new Date(m.createdAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
      const txt = (m.conteudo || "").slice(0, 300);
      return `[${dt}] ${who}: ${txt}`;
    })
    .join("\n");
}

export const atendimentoIaRouter = router({
  // ─── Brief Instantâneo ─────────────────────────────────────────────────────
  briefInstantaneo: protectedProcedure
    .input(z.object({ conversaId: z.number() }))
    .query(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Sem escritório");
      const db = await getDb();
      if (!db) throw new Error("DB indisponível");

      const [conv] = await db
        .select()
        .from(conversas)
        .where(and(eq(conversas.id, input.conversaId), eq(conversas.escritorioId, esc.escritorio.id)))
        .limit(1);
      if (!conv) throw new Error("Conversa não encontrada");

      const [contato] = conv.contatoId
        ? await db.select().from(contatos).where(eq(contatos.id, conv.contatoId)).limit(1)
        : [null];

      const msgs = await db
        .select()
        .from(mensagens)
        .where(eq(mensagens.conversaId, input.conversaId))
        .orderBy(desc(mensagens.createdAt))
        .limit(40);
      msgs.reverse();

      // Coleta contexto cross-module
      const proximaAud = conv.contatoId
        ? await db
            .select()
            .from(agendamentos)
            .where(
              and(
                eq(agendamentos.escritorioId, esc.escritorio.id),
                eq(agendamentos.contatoId, conv.contatoId),
                gte(agendamentos.dataInicio, new Date()),
              ),
            )
            .orderBy(agendamentos.dataInicio)
            .limit(1)
        : [];

      const cobs = conv.contatoId
        ? await db
            .select()
            .from(asaasCobrancas)
            .where(eq(asaasCobrancas.contatoId, conv.contatoId))
            .orderBy(desc(asaasCobrancas.id))
            .limit(8)
        : [];

      const procs = conv.contatoId
        ? await db
            .select()
            .from(clienteProcessos)
            .where(eq(clienteProcessos.contatoId, conv.contatoId))
            .limit(3)
        : [];

      const cnjs = procs.map((p: any) => p.cnj).filter(Boolean);
      const ultimosAtos = cnjs.length
        ? await db
            .select()
            .from(eventosProcesso)
            .where(
              and(
                eq(eventosProcesso.escritorioId, esc.escritorio.id),
                sql`${eventosProcesso.cnjAfetado} IN (${sql.join(cnjs.map((c) => sql`${c}`), sql`, `)})`,
              ),
            )
            .orderBy(desc(eventosProcesso.dataEvento))
            .limit(5)
        : [];

      // Sem IA: devolve um fallback determinístico
      const chave = await resolverChaveIA();
      if (!chave) {
        const motivo = msgs.length
          ? (msgs[msgs.length - 1]?.conteudo || "").slice(0, 140)
          : "Sem mensagens recentes";
        return {
          ia: false,
          motivo,
          contexto: {
            proximaAudiencia: proximaAud[0]?.titulo
              ? { titulo: proximaAud[0].titulo, data: proximaAud[0].dataInicio }
              : null,
            financeiro: cobs.length
              ? {
                  pagos: cobs.filter((c: any) => c.status === "RECEIVED" || c.status === "CONFIRMED").length,
                  pendentes: cobs.filter((c: any) => c.status === "PENDING").length,
                  vencidos: cobs.filter((c: any) => c.status === "OVERDUE").length,
                  total: cobs.length,
                }
              : null,
            ultimoAto: ultimosAtos[0]
              ? { tipo: ultimosAtos[0].tipo, data: ultimosAtos[0].dataEvento, resumo: (ultimosAtos[0].conteudo || "").slice(0, 200) }
              : null,
            processos: procs.length,
          },
        };
      }

      const contextoTxt = [
        `Cliente: ${contato?.nome || "?"}`,
        procs.length > 0
          ? `Processos ativos: ${procs.length} (${procs.map((p: any) => p.classe || p.cnj).slice(0, 2).join(", ")})`
          : "Sem processos ativos",
        proximaAud[0]
          ? `Próximo compromisso: ${proximaAud[0].titulo} em ${new Date(proximaAud[0].dataInicio).toLocaleString("pt-BR")}`
          : "Sem compromisso próximo agendado",
        cobs.length
          ? `Financeiro: ${cobs.filter((c: any) => c.status === "RECEIVED" || c.status === "CONFIRMED").length} pagas, ${cobs.filter((c: any) => c.status === "PENDING").length} pendentes, ${cobs.filter((c: any) => c.status === "OVERDUE").length} vencidas`
          : "Sem cobranças registradas",
        ultimosAtos[0]
          ? `Último ato processual: ${ultimosAtos[0].tipo} em ${new Date(ultimosAtos[0].dataEvento).toLocaleDateString("pt-BR")} — ${(ultimosAtos[0].conteudo || "").slice(0, 200)}`
          : "Sem atos processuais recentes",
        `\nÚltimas mensagens da conversa:\n${resumirMensagens(msgs, 25)}`,
      ].join("\n");

      try {
        const raw = await chamarIA({
          system: [
            "Você é um assistente jurídico que ajuda advogado a entender CONTEXTO da conversa em 1 frase.",
            "Sua resposta vai aparecer como BRIEF INSTANTÂNEO no topo do chat — 1 a 2 linhas, no máximo 200 caracteres.",
            "Tom: direto, objetivo, sem floreios. Trata o advogado como colega experiente.",
            "Foque em PREVER o motivo da conversa cruzando: prazo próximo + cobrança pendente + ato processual novo + tom da mensagem.",
            "NÃO use markdown. NÃO comece com 'O cliente...'. Vá direto ao ponto.",
            "Exemplos bons:",
            "  - 'Provável dúvida sobre audiência sex 14h. Ainda não recebeu link da videochamada.'",
            "  - 'Pedindo 2ª via do boleto vencido em 15/05 (R$ 375).'",
            "  - 'Cliente ansiosa após intimação de ontem sobre documentação.'",
          ].join("\n"),
          user: `${contextoTxt}\n\n---\nResponda APENAS com a frase do brief, sem aspas, sem prefixos.`,
          maxTokens: 200,
          temperature: 0.3,
        });
        return {
          ia: true,
          motivo: raw.trim().replace(/^["']|["']$/g, "").slice(0, 240),
          contexto: {
            proximaAudiencia: proximaAud[0]?.titulo
              ? { titulo: proximaAud[0].titulo, data: proximaAud[0].dataInicio }
              : null,
            financeiro: cobs.length
              ? {
                  pagos: cobs.filter((c: any) => c.status === "RECEIVED" || c.status === "CONFIRMED").length,
                  pendentes: cobs.filter((c: any) => c.status === "PENDING").length,
                  vencidos: cobs.filter((c: any) => c.status === "OVERDUE").length,
                  total: cobs.length,
                }
              : null,
            ultimoAto: ultimosAtos[0]
              ? { tipo: ultimosAtos[0].tipo, data: ultimosAtos[0].dataEvento, resumo: (ultimosAtos[0].conteudo || "").slice(0, 200) }
              : null,
            processos: procs.length,
          },
        };
      } catch (e: any) {
        log.warn({ err: e?.message, conversaId: input.conversaId }, "brief IA falhou");
        return {
          ia: false,
          motivo: msgs.length ? (msgs[msgs.length - 1]?.conteudo || "").slice(0, 140) : "Sem brief disponível",
          contexto: { proximaAudiencia: null, financeiro: null, ultimoAto: null, processos: procs.length },
          erro: "IA indisponível",
        };
      }
    }),

  // ─── Conversation Diff ─────────────────────────────────────────────────────
  conversationDiff: protectedProcedure
    .input(z.object({ conversaId: z.number() }))
    .query(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Sem escritório");
      const db = await getDb();
      if (!db) throw new Error("DB indisponível");

      const [conv] = await db
        .select()
        .from(conversas)
        .where(and(eq(conversas.id, input.conversaId), eq(conversas.escritorioId, esc.escritorio.id)))
        .limit(1);
      if (!conv) throw new Error("Conversa não encontrada");

      // Acha a última mensagem ENVIADA pelo atendente. O diff é o intervalo
      // entre essa mensagem e agora.
      const [ultMinha] = await db
        .select()
        .from(mensagens)
        .where(and(eq(mensagens.conversaId, input.conversaId), eq(mensagens.direcao, "saida")))
        .orderBy(desc(mensagens.createdAt))
        .limit(1);

      if (!ultMinha) {
        return { primeiraInteracao: true, desde: null, eventos: { mensagens: 0, atos: 0, pagosCent: 0, prazos: 0 } };
      }

      const desde = ultMinha.createdAt as Date;

      const msgsDesde = await db
        .select({ id: mensagens.id })
        .from(mensagens)
        .where(and(eq(mensagens.conversaId, input.conversaId), eq(mensagens.direcao, "entrada"), gte(mensagens.createdAt, desde)));

      const procs = conv.contatoId
        ? await db.select().from(clienteProcessos).where(eq(clienteProcessos.contatoId, conv.contatoId))
        : [];
      const cnjs = procs.map((p: any) => p.cnj).filter(Boolean);

      let atosDesde: any[] = [];
      if (cnjs.length) {
        atosDesde = await db
          .select()
          .from(eventosProcesso)
          .where(
            and(
              eq(eventosProcesso.escritorioId, esc.escritorio.id),
              sql`${eventosProcesso.cnjAfetado} IN (${sql.join(cnjs.map((c) => sql`${c}`), sql`, `)})`,
              gte(eventosProcesso.dataEvento, desde),
            ),
          )
          .orderBy(desc(eventosProcesso.dataEvento))
          .limit(10);
      }

      const cobsDesde = conv.contatoId
        ? await db
            .select()
            .from(asaasCobrancas)
            .where(
              and(
                eq(asaasCobrancas.contatoId, conv.contatoId),
                sql`${asaasCobrancas.status} IN ('RECEIVED', 'CONFIRMED')`,
              ),
            )
            .orderBy(desc(asaasCobrancas.id))
            .limit(10)
        : [];
      // Cobranças pagas após `desde` (compara via dataPagamento)
      const isoDesde = desde.toISOString().slice(0, 10);
      const cobsPagasNoIntervalo = cobsDesde.filter((c: any) => c.dataPagamento && c.dataPagamento >= isoDesde);
      const valorPago = cobsPagasNoIntervalo.reduce((acc: number, c: any) => acc + Math.round(parseFloat(c.valor || "0") * 100), 0);

      // Prazos críticos (audiência próxima, etc) – simples: agendamentos próximos 48h
      const limite48h = new Date(Date.now() + 48 * 60 * 60 * 1000);
      const agendaProx = conv.contatoId
        ? await db
            .select({ id: agendamentos.id, titulo: agendamentos.titulo, dataInicio: agendamentos.dataInicio })
            .from(agendamentos)
            .where(
              and(
                eq(agendamentos.escritorioId, esc.escritorio.id),
                eq(agendamentos.contatoId, conv.contatoId),
                gte(agendamentos.dataInicio, new Date()),
                sql`${agendamentos.dataInicio} <= ${limite48h}`,
              ),
            )
            .limit(5)
        : [];

      return {
        primeiraInteracao: false,
        desde: desde.toISOString(),
        diasDesde: Math.floor((Date.now() - desde.getTime()) / 86400000),
        eventos: {
          mensagens: msgsDesde.length,
          atos: atosDesde.length,
          pagosCent: valorPago,
          prazos: agendaProx.length,
        },
        atos: atosDesde.slice(0, 3).map((a: any) => ({
          tipo: a.tipo,
          data: a.dataEvento,
          resumo: (a.conteudo || "").slice(0, 160),
        })),
        prazos: agendaProx.map((a: any) => ({ id: a.id, titulo: a.titulo, data: a.dataInicio })),
      };
    }),

  // ─── Detecção de Ação ──────────────────────────────────────────────────────
  detectarAcao: protectedProcedure
    .input(z.object({ conversaId: z.number() }))
    .query(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Sem escritório");
      const db = await getDb();
      if (!db) throw new Error("DB indisponível");

      const [conv] = await db
        .select()
        .from(conversas)
        .where(and(eq(conversas.id, input.conversaId), eq(conversas.escritorioId, esc.escritorio.id)))
        .limit(1);
      if (!conv) throw new Error("Conversa não encontrada");

      const msgs = await db
        .select()
        .from(mensagens)
        .where(and(eq(mensagens.conversaId, input.conversaId), eq(mensagens.direcao, "entrada")))
        .orderBy(desc(mensagens.createdAt))
        .limit(5);
      const ultimaTxt = (msgs[0]?.conteudo || "").toLowerCase();

      // Detecção heurística primeiro — barata e instantânea
      const padroes: Array<{ tipo: string; rx: RegExp; descricao: string }> = [
        { tipo: "segunda_via_boleto", rx: /(2[ª°]?\s*via|segunda\s*via|reenvi[ae]r?\s*o?\s*boleto|nao\s*recebi.*boleto|esqueci.*pagar)/i, descricao: "Cliente pede 2ª via do boleto" },
        { tipo: "status_processo", rx: /(como\s*est[áa].*processo|andamento.*processo|alguma\s*not[íi]cia|novidade.*processo)/i, descricao: "Cliente pergunta sobre andamento do processo" },
        { tipo: "agendar_reuniao", rx: /(agendar|marcar).*(reuni[ãa]o|conversa|consulta|hor[áa]rio)/i, descricao: "Cliente quer agendar reunião" },
        { tipo: "audiencia_link", rx: /(link.*audi[êe]ncia|link.*zoom|link.*video|link.*reuni[ãa]o)/i, descricao: "Cliente pede link da audiência" },
        { tipo: "documento_pendente", rx: /(qual\s*documento|que.*documento.*preciso|levar.*documento)/i, descricao: "Cliente pergunta sobre documentos necessários" },
        { tipo: "risco_churn", rx: /(quero\s*meu\s*dinheiro|devolver?.*honor[áa]rio|trocar\s*de\s*advogad|cancelar\s*contrato|n[ãa]o\s*confio\s*mais)/i, descricao: "⚠️ Possível risco de churn — cliente insatisfeito" },
      ];
      const match = padroes.find((p) => p.rx.test(ultimaTxt));
      if (!match) return { detectada: false };

      // Para 2ª via boleto, busca cobranças pendentes
      let payload: any = { tipo: match.tipo, descricao: match.descricao, ultimaMensagem: msgs[0]?.conteudo?.slice(0, 200) };
      if (match.tipo === "segunda_via_boleto" && conv.contatoId) {
        const cobs = await db
          .select()
          .from(asaasCobrancas)
          .where(
            and(
              eq(asaasCobrancas.contatoId, conv.contatoId),
              sql`${asaasCobrancas.status} IN ('PENDING', 'OVERDUE')`,
            ),
          )
          .orderBy(asaasCobrancas.vencimento)
          .limit(3);
        payload.cobrancas = cobs.map((c: any) => ({
          id: c.id,
          asaasPaymentId: c.asaasPaymentId,
          valor: c.valor,
          vencimento: c.vencimento,
          status: c.status,
          invoiceUrl: c.invoiceUrl,
          bankSlipUrl: c.bankSlipUrl,
          pixQrCodePayload: c.pixQrCodePayload,
          descricao: c.descricao,
        }));
      }
      return { detectada: true, ...payload };
    }),

  // ─── Compliance Guard ──────────────────────────────────────────────────────
  complianceCheck: protectedProcedure
    .input(z.object({ rascunho: z.string().min(1).max(4000) }))
    .mutation(async ({ input }) => {
      const txt = input.rascunho;
      // Heurística rápida — flagra padrões clássicos sem chamar IA
      const heuristicas: Array<{ rx: RegExp; problema: string; sugestao: string }> = [
        {
          rx: /(vou\s*ganhar|com\s*certeza\s*ganh|vit[óo]ria\s*garantid|garantia\s*de\s*[êe]xito|sucesso\s*garantid)/i,
          problema: "Promessa de resultado (Art. 30, II do Cód. de Ética OAB)",
          sugestao: "Temos boas chances baseado em casos similares, mas o resultado final depende da apreciação do magistrado.",
        },
        {
          rx: /(pre[çc]o\s*mais\s*barato|menor\s*pre[çc]o\s*do\s*mercado|cobramos\s*menos)/i,
          problema: "Mercantilização da advocacia (Provimento 205/2021 OAB veda concorrência por preço)",
          sugestao: "Trabalhamos com transparência e excelência — agendar uma conversa para apresentar valores condizentes com o trabalho.",
        },
        {
          rx: /(processar\s*ele\s*pra\s*ele\s*pagar|fa[çc]o\s*ele\s*pagar)/i,
          problema: "Linguagem inadequada para comunicação cliente-advogado",
          sugestao: "Vamos avaliar todas as possibilidades legais para defender seus direitos.",
        },
      ];

      const achados = heuristicas.filter((h) => h.rx.test(txt));
      if (achados.length === 0) return { ok: true };

      return {
        ok: false,
        problemas: achados.map((h) => h.problema),
        sugestao: achados[0].sugestao,
        trechosFlag: achados.map((h) => {
          const match = txt.match(h.rx);
          return match ? match[0] : "";
        }).filter(Boolean),
      };
    }),

  // ─── Linha do Tempo Unificada ──────────────────────────────────────────────
  linhaTempoUnificada: protectedProcedure
    .input(z.object({ contatoId: z.number(), limite: z.number().default(60) }))
    .query(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Sem escritório");
      const db = await getDb();
      if (!db) throw new Error("DB indisponível");

      // Mensagens
      const msgs = await db
        .select({
          id: mensagens.id,
          tipo: mensagens.tipo,
          conteudo: mensagens.conteudo,
          direcao: mensagens.direcao,
          createdAt: mensagens.createdAt,
        })
        .from(mensagens)
        .innerJoin(conversas, eq(mensagens.conversaId, conversas.id))
        .where(and(eq(conversas.escritorioId, esc.escritorio.id), eq(conversas.contatoId, input.contatoId)))
        .orderBy(desc(mensagens.createdAt))
        .limit(input.limite);

      // Processos do cliente
      const procs = await db
        .select()
        .from(clienteProcessos)
        .where(eq(clienteProcessos.contatoId, input.contatoId));
      const cnjs = procs.map((p: any) => p.cnj).filter(Boolean);

      // Atos processuais
      const atos = cnjs.length
        ? await db
            .select()
            .from(eventosProcesso)
            .where(
              and(
                eq(eventosProcesso.escritorioId, esc.escritorio.id),
                sql`${eventosProcesso.cnjAfetado} IN (${sql.join(cnjs.map((c) => sql`${c}`), sql`, `)})`,
              ),
            )
            .orderBy(desc(eventosProcesso.dataEvento))
            .limit(input.limite)
        : [];

      // Pagamentos
      const cobs = await db
        .select()
        .from(asaasCobrancas)
        .where(eq(asaasCobrancas.contatoId, input.contatoId))
        .orderBy(desc(asaasCobrancas.id))
        .limit(input.limite);

      // Agendamentos
      const agen = await db
        .select()
        .from(agendamentos)
        .where(
          and(
            eq(agendamentos.escritorioId, esc.escritorio.id),
            eq(agendamentos.contatoId, input.contatoId),
          ),
        )
        .orderBy(desc(agendamentos.dataInicio))
        .limit(input.limite);

      // Assinaturas
      const assin = await db
        .select()
        .from(assinaturasDigitais)
        .where(
          and(
            eq(assinaturasDigitais.escritorioId, esc.escritorio.id),
            eq(assinaturasDigitais.contatoId, input.contatoId),
          ),
        )
        .orderBy(desc(assinaturasDigitais.id))
        .limit(input.limite);

      // Unifica numa lista cronológica
      type Evento = { id: string; tipo: "mensagem" | "ato" | "pagamento" | "agenda" | "documento" | "ligacao"; subtipo?: string; titulo: string; resumo?: string; data: string; canal?: string; meta?: any };
      const eventos: Evento[] = [];

      msgs.forEach((m: any) => {
        eventos.push({
          id: `msg-${m.id}`,
          tipo: "mensagem",
          subtipo: m.direcao === "entrada" ? "recebida" : "enviada",
          titulo: m.direcao === "entrada" ? "Mensagem recebida" : "Mensagem enviada",
          resumo: (m.conteudo || "").slice(0, 200),
          data: m.createdAt instanceof Date ? m.createdAt.toISOString() : String(m.createdAt),
          canal: "WhatsApp",
        });
      });

      atos.forEach((a: any) => {
        eventos.push({
          id: `ato-${a.id}`,
          tipo: "ato",
          subtipo: a.tipo,
          titulo: `${a.tipo}`,
          resumo: (a.conteudo || "").slice(0, 240),
          data: a.dataEvento instanceof Date ? a.dataEvento.toISOString() : String(a.dataEvento),
          meta: { cnj: a.cnjAfetado, fonte: a.fonte },
        });
      });

      cobs.forEach((c: any) => {
        const pago = c.status === "RECEIVED" || c.status === "CONFIRMED";
        const data = pago && c.dataPagamento ? c.dataPagamento + "T00:00:00Z" : (c.vencimento ? c.vencimento + "T00:00:00Z" : new Date().toISOString());
        eventos.push({
          id: `cob-${c.id}`,
          tipo: "pagamento",
          subtipo: pago ? "pago" : c.status === "OVERDUE" ? "vencido" : "pendente",
          titulo: pago ? `Pagamento recebido R$ ${c.valor}` : c.status === "OVERDUE" ? `Cobrança vencida R$ ${c.valor}` : `Cobrança pendente R$ ${c.valor}`,
          resumo: c.descricao || `Forma: ${c.formaPagamento}`,
          data,
          meta: { paymentId: c.asaasPaymentId, status: c.status },
        });
      });

      agen.forEach((a: any) => {
        eventos.push({
          id: `agenda-${a.id}`,
          tipo: "agenda",
          subtipo: a.tipo,
          titulo: a.titulo,
          resumo: a.descricao?.slice(0, 200),
          data: a.dataInicio instanceof Date ? a.dataInicio.toISOString() : String(a.dataInicio),
        });
      });

      assin.forEach((s: any) => {
        eventos.push({
          id: `assin-${s.id}`,
          tipo: "documento",
          subtipo: s.status || "pendente",
          titulo: s.titulo || "Documento para assinatura",
          resumo: `Status: ${s.status || "pendente"}`,
          data: (s.createdAt || s.updatedAt) instanceof Date ? (s.createdAt || s.updatedAt).toISOString() : String(s.createdAt || s.updatedAt || ""),
        });
      });

      eventos.sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime());

      return {
        eventos: eventos.slice(0, input.limite * 2),
        counts: {
          total: eventos.length,
          mensagens: msgs.length,
          atos: atos.length,
          pagamentos: cobs.length,
          agenda: agen.length,
          documentos: assin.length,
        },
      };
    }),

  // ─── Composer Sugestão (IA escreve resposta no tom selecionado) ────────────
  composerSugestao: protectedProcedure
    .input(z.object({
      conversaId: z.number(),
      tom: z.enum(["formal", "direto", "empatico", "amigavel"]).default("empatico"),
      hintAdvogado: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Sem escritório");
      const db = await getDb();
      if (!db) throw new Error("DB indisponível");

      const [conv] = await db
        .select()
        .from(conversas)
        .where(and(eq(conversas.id, input.conversaId), eq(conversas.escritorioId, esc.escritorio.id)))
        .limit(1);
      if (!conv) throw new Error("Conversa não encontrada");

      const [contato] = conv.contatoId
        ? await db.select().from(contatos).where(eq(contatos.id, conv.contatoId)).limit(1)
        : [null];

      const msgs = await db
        .select()
        .from(mensagens)
        .where(eq(mensagens.conversaId, input.conversaId))
        .orderBy(desc(mensagens.createdAt))
        .limit(20);
      msgs.reverse();

      const chave = await resolverChaveIA();
      if (!chave) {
        // Fallback determinístico — devolve template baseado no tom
        const primeiroNome = (contato?.nome || "Cliente").split(" ")[0];
        const templates: Record<string, string> = {
          formal: `Prezado(a) ${primeiroNome}, recebi sua mensagem. Estarei à disposição para tratar do tema. Atenciosamente.`,
          direto: `Olá ${primeiroNome}. Recebi e vou retornar com a posição em seguida.`,
          empatico: `Olá ${primeiroNome}! Fica tranquilo(a), vou cuidar disso pra você. Já te dou retorno.`,
          amigavel: `Oi ${primeiroNome}! Tudo bem? Recebi sua mensagem, vou te dar um retorno rapidinho.`,
        };
        return { ia: false, sugestao: templates[input.tom] || templates.empatico };
      }

      const tomDescricao = {
        formal: "formal, com tratamento 'Prezado(a)', cordialidade institucional, sem emojis. Termina com 'Atenciosamente'.",
        direto: "direto e objetivo, sem floreios, em 2-3 frases. Tratamento informal sem ser íntimo. Sem emojis.",
        empatico: "empático e acolhedor, demonstra que entendeu a preocupação. Pode usar 1 emoji discreto se ajudar a transmitir empatia. Tratamento informal.",
        amigavel: "amigável e leve, conversacional. Pode usar 1-2 emojis. Tratamento bem informal, como amigo.",
      }[input.tom];

      const ultimaCliente = [...msgs].reverse().find((m: any) => m.direcao === "entrada");

      try {
        const raw = await chamarIA({
          system: [
            "Você é um advogado brasileiro experiente respondendo via WhatsApp ao seu cliente.",
            `Tom da resposta: ${tomDescricao}`,
            "REGRAS DURAS:",
            "- NÃO faça promessa de resultado (vedado pelo Art. 30 II do Cód. Ética OAB).",
            "- NÃO mencione preço menor que concorrência (vedado pelo Provimento 205/2021).",
            "- Use APENAS info disponível, NÃO invente datas, valores, prazos.",
            "- Resposta enxuta: máximo 4 frases.",
            "- NÃO use markdown.",
            "- Comece direto na resposta — sem 'Aqui está a resposta:' ou similares.",
          ].join("\n"),
          user: [
            `Cliente: ${contato?.nome || "?"}`,
            `\nHistórico recente da conversa (mais recente embaixo):\n${resumirMensagens(msgs, 12)}`,
            ultimaCliente ? `\n\nÚltima mensagem do cliente:\n"${(ultimaCliente.conteudo || "").slice(0, 500)}"` : "",
            input.hintAdvogado ? `\n\nDica do advogado sobre o que responder: ${input.hintAdvogado}` : "",
            `\n\nComponha a resposta no tom '${input.tom}'.`,
          ].filter(Boolean).join("\n"),
          maxTokens: 400,
          temperature: 0.5,
        });
        return { ia: true, sugestao: raw.trim().replace(/^["']|["']$/g, "") };
      } catch (e: any) {
        log.warn({ err: e?.message, conversaId: input.conversaId }, "composerSugestao IA falhou");
        const primeiroNome = (contato?.nome || "Cliente").split(" ")[0];
        return { ia: false, sugestao: `Olá ${primeiroNome}! Recebi sua mensagem, vou te dar um retorno em instantes.`, erro: "IA indisponível" };
      }
    }),

  // ─── Persona Risk Score ────────────────────────────────────────────────────
  riskScore: protectedProcedure
    .input(z.object({ conversaId: z.number() }))
    .query(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Sem escritório");
      const db = await getDb();
      if (!db) throw new Error("DB indisponível");

      const [conv] = await db
        .select()
        .from(conversas)
        .where(and(eq(conversas.id, input.conversaId), eq(conversas.escritorioId, esc.escritorio.id)))
        .limit(1);
      if (!conv) throw new Error("Conversa não encontrada");

      const msgs = await db
        .select()
        .from(mensagens)
        .where(and(eq(mensagens.conversaId, input.conversaId), eq(mensagens.direcao, "entrada")))
        .orderBy(desc(mensagens.createdAt))
        .limit(20);

      let score = 90;
      const sinais: string[] = [];

      const txtConcat = msgs.map((m: any) => (m.conteudo || "").toLowerCase()).join(" ");
      const padroesNegativos: Array<{ rx: RegExp; penalidade: number; sinal: string }> = [
        { rx: /(trocar\s*de\s*advogad|dispensar.*advogad|outro\s*advogad)/i, penalidade: 35, sinal: "Mencionou trocar de advogado" },
        { rx: /(devolu[çc][ãa]o.*honor|quero\s*meu\s*dinheiro|reaver.*pago)/i, penalidade: 30, sinal: "Pediu devolução de honorários" },
        { rx: /(cancelar\s*contrato|desistir\s*do\s*processo)/i, penalidade: 28, sinal: "Falou em cancelar contrato" },
        { rx: /(n[ãa]o\s*confio|n[ãa]o\s*acredito\s*mais|perdi\s*a\s*confian[çc]a)/i, penalidade: 22, sinal: "Demonstrou perda de confiança" },
        { rx: /(p[ée]ssimo|horr[íi]vel|terr[íi]vel|inadmiss[íi]vel|absurdo)/i, penalidade: 12, sinal: "Linguagem fortemente negativa" },
        { rx: /(reclama[çc][ãa]o\s*na\s*oab|oab\s*vai\s*saber|processar.*advogad)/i, penalidade: 40, sinal: "🚨 Ameaça reclamação na OAB" },
      ];
      padroesNegativos.forEach((p) => {
        if (p.rx.test(txtConcat)) {
          score -= p.penalidade;
          sinais.push(p.sinal);
        }
      });

      // Padrões positivos compensam
      const padroesPositivos = [
        { rx: /(obrigad[ao]|valeu|gratid[ãa]o|excelente\s*trabalho)/i, bonus: 5 },
        { rx: /(confio\s*em\s*voc|estou\s*satisfeito)/i, bonus: 8 },
      ];
      padroesPositivos.forEach((p) => {
        if (p.rx.test(txtConcat)) score = Math.min(100, score + p.bonus);
      });

      score = Math.max(0, Math.min(100, score));
      const nivel = score >= 75 ? "saudavel" : score >= 50 ? "atenção" : score >= 25 ? "risco" : "critico";

      return { score, nivel, sinais, mensagensAnalisadas: msgs.length };
    }),
});
