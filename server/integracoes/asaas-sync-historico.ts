/**
 * Sincronização histórica controlada por janelas — anti-rate-limit.
 *
 * PROBLEMA: o sync "tradicional" (`syncCobrancasEscritorio`) itera por TODOS
 * os customers vinculados e puxa TODAS as cobranças deles de uma vez. Em
 * escritórios grandes (centenas de customers), isso dispara N requests em
 * segundos. O Asaas tem cota de janela longa — estoura com 429 e bloqueia
 * por 12h. Pior cenário: na primeira conexão de um escritório novo.
 *
 * SOLUÇÃO: o usuário escolhe o período passado que quer importar (24h,
 * 7d, 30d, custom) e o intervalo entre janelas (default 60min). O cron
 * `processarSyncHistorico` processa 1 janela de 1 dia por tick e por
 * escritório elegível. Webhook continua cobrindo eventos futuros em
 * tempo real — esta sync só preenche o passado.
 *
 * ALGORITMO:
 *  - status='agendado' → cursor inicia em `historicoSyncAte` (mais recente)
 *  - cada tick processa 1 dia: dateCreated entre [cursor, cursor]
 *  - decrementa cursor 1 dia
 *  - quando cursor < `historicoSyncDe`, marca status='concluido'
 *  - 429 → marca status='pausado' + mensagem; usuário retoma manualmente
 *
 * IDEMPOTÊNCIA:
 *  - Upsert via ON DUPLICATE KEY (asaasPaymentId é UNIQUE por escritório)
 *  - Janelas reprocessadas (ex: usuário canceou e reiniciou) só causam
 *    UPDATE (sem duplicar cobranças)
 */

import { and, eq, inArray, isNull, or, lt, sql } from "drizzle-orm";
import { getDb } from "../db";
import {
  asaasClientes,
  asaasCobrancas,
  asaasConfig,
} from "../../drizzle/schema";
import { decrypt } from "../escritorio/crypto-utils";
import { AsaasClient } from "./asaas-client";
import { extrairDataPagamento } from "./asaas-sync";
import { inferirAtendentePorCobranca } from "../escritorio/db-financeiro";
import { createLogger } from "../_core/logger";

const log = createLogger("integracoes-asaas-sync-historico");

/**
 * Subtrai N dias de uma data ISO (YYYY-MM-DD). Retorna nova data ISO.
 * Trabalha em UTC pra evitar surpresa de timezone — todas as datas
 * trocadas com o Asaas são neutras de fuso.
 */
function subtrairDias(iso: string, dias: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - dias);
  return dt.toISOString().slice(0, 10);
}

/**
 * Conta dias inclusivos entre duas datas ISO (YYYY-MM-DD).
 * Exemplo: contarDias("2026-05-01", "2026-05-10") = 10.
 */
export function contarDiasInclusivos(de: string, ate: string): number {
  const [ya, ma, da] = de.split("-").map(Number);
  const [yb, mb, db] = ate.split("-").map(Number);
  const dtA = Date.UTC(ya, ma - 1, da);
  const dtB = Date.UTC(yb, mb - 1, db);
  const diff = Math.floor((dtB - dtA) / 86400000);
  return Math.max(0, diff + 1);
}

/**
 * Determina se um escritório está pronto pra processar a próxima janela.
 * Critério:
 *  - status='agendado': sempre processa (1ª janela)
 *  - status='executando': processa se passou intervaloMinutos desde
 *    `historicoSyncUltimaJanelaEm`, ou se essa for null
 *  - outros status (pausado/concluido/erro/inativo): NÃO processa
 */
function elegivelParaProximaJanela(
  cfg: {
    historicoSyncStatus: string;
    historicoSyncUltimaJanelaEm: Date | null;
    historicoSyncIntervaloMinutos: number;
  },
  agora: Date = new Date(),
): boolean {
  if (cfg.historicoSyncStatus === "agendado") return true;
  if (cfg.historicoSyncStatus !== "executando") return false;
  if (!cfg.historicoSyncUltimaJanelaEm) return true;
  const passouMs = agora.getTime() - cfg.historicoSyncUltimaJanelaEm.getTime();
  return passouMs >= cfg.historicoSyncIntervaloMinutos * 60_000;
}

/**
 * Carrega o AsaasClient pra um escritório a partir da config criptografada.
 * Retorna null se não há key ou erro de decriptação.
 */
async function getClientPorEscritorio(
  cfg: { apiKeyEncrypted: string | null; apiKeyIv: string | null; apiKeyTag: string | null; modo: "sandbox" | "producao" },
): Promise<AsaasClient | null> {
  if (!cfg.apiKeyEncrypted || !cfg.apiKeyIv || !cfg.apiKeyTag) return null;
  try {
    const apiKey = decrypt(cfg.apiKeyEncrypted, cfg.apiKeyIv, cfg.apiKeyTag);
    return new AsaasClient(apiKey, cfg.modo);
  } catch {
    return null;
  }
}

/**
 * Processa 1 janela de 1 dia pra um escritório específico. Retorna
 * `{ ok: true }` se processou (com sucesso ou via "0 cobranças"),
 * `{ ok: false, pausarPor }` quando deve pausar (429 ou erro recuperável),
 * `{ ok: false, erroFatal }` quando precisa marcar erro definitivo.
 *
 * Esta função NÃO atualiza o cursor ou status do escritório — o caller
 * (`processarSyncHistorico`) é quem decide o que fazer com o resultado.
 */
async function processarJanelaUm(
  client: AsaasClient,
  escritorioId: number,
  diaIso: string,
): Promise<
  | { ok: true; novas: number; atualizadas: number }
  | { ok: false; tipo: "rate_limit"; mensagem: string }
  | { ok: false; tipo: "erro_fatal"; mensagem: string }
> {
  const db = await getDb();
  if (!db) return { ok: false, tipo: "erro_fatal", mensagem: "DB indisponível" };

  let novas = 0;
  let atualizadas = 0;
  let offset = 0;
  let hasMore = true;

  // Mapa em memória: asaasCustomerId → contatoId (do CRM). Resolvido
  // uma vez por janela pra evitar SELECTs repetidos por cobrança.
  const vinculos = await db
    .select({
      asaasCustomerId: asaasClientes.asaasCustomerId,
      contatoId: asaasClientes.contatoId,
    })
    .from(asaasClientes)
    .where(eq(asaasClientes.escritorioId, escritorioId));
  const customerToContato = new Map(
    vinculos.map((v) => [v.asaasCustomerId, v.contatoId]),
  );

  while (hasMore) {
    let res;
    try {
      res = await client.listarCobrancasPorJanela({
        dateCreatedGe: diaIso,
        dateCreatedLe: diaIso,
        offset,
        limit: 100,
      });
    } catch (err: any) {
      const status = err?.response?.status ?? err?.cause?.response?.status;
      if (status === 429) {
        return {
          ok: false,
          tipo: "rate_limit",
          mensagem:
            "Cota do Asaas excedida (429). Sincronização pausada — retome manualmente quando o limite resetar.",
        };
      }
      const detalhe =
        err?.response?.data?.errors?.[0]?.description ?? err?.message ?? "Erro desconhecido";
      return {
        ok: false,
        tipo: status === 401 || status === 403 ? "erro_fatal" : "rate_limit",
        mensagem: `HTTP ${status ?? "?"}: ${detalhe}`,
      };
    }

    for (const cob of res.data) {
      if (cob.deleted) continue;

      const contatoId = customerToContato.get(cob.customer) ?? null;
      const [local] = await db
        .select({ id: asaasCobrancas.id })
        .from(asaasCobrancas)
        .where(and(
          eq(asaasCobrancas.escritorioId, escritorioId),
          eq(asaasCobrancas.asaasPaymentId, cob.id),
        ))
        .limit(1);

      if (local) {
        // Já existe — apenas atualiza status/data/líquido (não toca
        // atribuição manual existente)
        await db
          .update(asaasCobrancas)
          .set({
            status: cob.status,
            valor: cob.value.toString(),
            valorLiquido: cob.netValue?.toString() || null,
            vencimento: cob.dueDate,
            dataPagamento: extrairDataPagamento(cob),
            descricao: cob.description || null,
            invoiceUrl: cob.invoiceUrl,
            bankSlipUrl: cob.bankSlipUrl || null,
            formaPagamento: (cob.billingType as any) || "UNDEFINED",
            ...(contatoId ? { contatoId } : {}),
          })
          .where(eq(asaasCobrancas.id, local.id));
        atualizadas++;
      } else {
        const atendenteInferido = await inferirAtendentePorCobranca(
          escritorioId,
          cob.externalReference || null,
          contatoId,
        );
        await db
          .insert(asaasCobrancas)
          .values({
            escritorioId,
            contatoId,
            asaasPaymentId: cob.id,
            asaasCustomerId: cob.customer,
            valor: cob.value.toString(),
            valorLiquido: cob.netValue?.toString() || null,
            vencimento: cob.dueDate,
            formaPagamento: (cob.billingType as any) || "UNDEFINED",
            status: cob.status,
            descricao: cob.description || null,
            invoiceUrl: cob.invoiceUrl,
            bankSlipUrl: cob.bankSlipUrl || null,
            dataPagamento: extrairDataPagamento(cob),
            externalReference: cob.externalReference || null,
            atendenteId: atendenteInferido,
          })
          .onDuplicateKeyUpdate({
            set: {
              status: cob.status,
              valor: cob.value.toString(),
              valorLiquido: cob.netValue?.toString() || null,
              vencimento: cob.dueDate,
              dataPagamento: extrairDataPagamento(cob),
              descricao: cob.description || null,
            },
          });
        novas++;
      }
    }

    hasMore = res.hasMore;
    offset += res.limit;
  }

  return { ok: true, novas, atualizadas };
}

/**
 * Função-cron que processa 1 janela pra cada escritório elegível.
 * Chamada periodicamente (default 5 min) por `cron-jobs.ts`. Cada execução
 * faz no máximo 1 janela por escritório — o intervalo entre janelas do
 * MESMO escritório é controlado por `historicoSyncIntervaloMinutos`.
 */
export async function processarSyncHistorico(): Promise<void> {
  const db = await getDb();
  if (!db) return;

  // Pega configs em estados que potencialmente precisam de processamento.
  // Filtro fino (intervaloMinutos) feito em código pra simplicidade.
  const candidatos = await db
    .select()
    .from(asaasConfig)
    .where(
      and(
        inArray(asaasConfig.historicoSyncStatus, ["agendado", "executando"] as const),
        eq(asaasConfig.status, "conectado"),
      ),
    );

  if (candidatos.length === 0) return;

  const agora = new Date();
  const elegiveis = candidatos.filter((c) =>
    elegivelParaProximaJanela(
      {
        historicoSyncStatus: c.historicoSyncStatus,
        historicoSyncUltimaJanelaEm: c.historicoSyncUltimaJanelaEm,
        historicoSyncIntervaloMinutos: c.historicoSyncIntervaloMinutos,
      },
      agora,
    ),
  );

  if (elegiveis.length === 0) return;

  log.info(
    `[asaas-sync-historico] Processando ${elegiveis.length} escritório(s)`,
  );

  for (const cfg of elegiveis) {
    try {
      const client = await getClientPorEscritorio(cfg);
      if (!client) {
        await db
          .update(asaasConfig)
          .set({
            historicoSyncStatus: "erro",
            historicoSyncErroMensagem: "Credenciais Asaas indisponíveis",
            historicoSyncUltimaJanelaEm: new Date(),
          })
          .where(eq(asaasConfig.id, cfg.id));
        continue;
      }

      // Cursor: na 1ª janela (status='agendado') ainda não foi setado, então
      // usamos `historicoSyncAte` como ponto inicial. Em ticks seguintes
      // (status='executando'), usamos `historicoSyncCursor` que avança pra trás.
      const cursorDia =
        cfg.historicoSyncStatus === "agendado"
          ? cfg.historicoSyncAte
          : cfg.historicoSyncCursor;
      const limiteInferior = cfg.historicoSyncDe;

      if (!cursorDia || !limiteInferior) {
        await db
          .update(asaasConfig)
          .set({
            historicoSyncStatus: "erro",
            historicoSyncErroMensagem: "Período não configurado (de/ate ausentes)",
            historicoSyncUltimaJanelaEm: new Date(),
          })
          .where(eq(asaasConfig.id, cfg.id));
        continue;
      }

      // Se já passou do limite inferior, marca concluído sem processar.
      if (cursorDia < limiteInferior) {
        await db
          .update(asaasConfig)
          .set({
            historicoSyncStatus: "concluido",
            historicoSyncConcluidoEm: new Date(),
            historicoSyncUltimaJanelaEm: new Date(),
            historicoSyncErroMensagem: null,
          })
          .where(eq(asaasConfig.id, cfg.id));
        continue;
      }

      const resultado = await processarJanelaUm(client, cfg.escritorioId, cursorDia);

      if (resultado.ok) {
        const proximoCursor = subtrairDias(cursorDia, 1);
        const concluiu = proximoCursor < limiteInferior;
        await db
          .update(asaasConfig)
          .set({
            historicoSyncStatus: concluiu ? "concluido" : "executando",
            historicoSyncCursor: concluiu ? null : proximoCursor,
            historicoSyncDiasFeitos: cfg.historicoSyncDiasFeitos + 1,
            historicoSyncCobrancasImportadas:
              cfg.historicoSyncCobrancasImportadas + resultado.novas,
            historicoSyncCobrancasAtualizadas:
              cfg.historicoSyncCobrancasAtualizadas + resultado.atualizadas,
            historicoSyncUltimaJanelaEm: new Date(),
            ...(concluiu ? { historicoSyncConcluidoEm: new Date() } : {}),
            historicoSyncErroMensagem: null,
          })
          .where(eq(asaasConfig.id, cfg.id));

        log.info(
          {
            escritorioId: cfg.escritorioId,
            diaIso: cursorDia,
            novas: resultado.novas,
            atualizadas: resultado.atualizadas,
            concluiu,
          },
          "[asaas-sync-historico] janela processada",
        );
      } else if (resultado.tipo === "rate_limit") {
        // 429 — pausa pro usuário decidir. NÃO marca erro porque é
        // condição transitória (cota libera em 12h).
        await db
          .update(asaasConfig)
          .set({
            historicoSyncStatus: "pausado",
            historicoSyncErroMensagem: resultado.mensagem,
            historicoSyncUltimaJanelaEm: new Date(),
          })
          .where(eq(asaasConfig.id, cfg.id));
        log.warn(
          { escritorioId: cfg.escritorioId, mensagem: resultado.mensagem },
          "[asaas-sync-historico] pausado por rate limit",
        );
      } else {
        // Erro fatal (401/403 — credencial inválida). Marca erro e para.
        await db
          .update(asaasConfig)
          .set({
            historicoSyncStatus: "erro",
            historicoSyncErroMensagem: resultado.mensagem.slice(0, 512),
            historicoSyncUltimaJanelaEm: new Date(),
          })
          .where(eq(asaasConfig.id, cfg.id));
        log.warn(
          { escritorioId: cfg.escritorioId, mensagem: resultado.mensagem },
          "[asaas-sync-historico] erro fatal",
        );
      }
    } catch (err: any) {
      // Defesa final: erro inesperado no orquestrador
      log.error(
        { err: err.message, escritorioId: cfg.escritorioId },
        "[asaas-sync-historico] exceção inesperada",
      );
      try {
        await db
          .update(asaasConfig)
          .set({
            historicoSyncStatus: "erro",
            historicoSyncErroMensagem: `Erro inesperado: ${err.message}`.slice(0, 512),
            historicoSyncUltimaJanelaEm: new Date(),
          })
          .where(eq(asaasConfig.id, cfg.id));
      } catch {
        /* swallow */
      }
    }
  }
}

// Exportado pra testes — função pura e determinística.
export { elegivelParaProximaJanela, subtrairDias };
