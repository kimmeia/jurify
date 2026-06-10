/**
 * Importação de extrato Asaas em segundo plano — espelho do sync
 * histórico de cobranças (`asaas-sync-historico.ts`).
 *
 * O usuário escolhe um período (pode ser anos); o cron processa janelas
 * de `extratoSyncDiasPorTick` dias a cada `extratoSyncIntervaloMinutos`,
 * com o cursor andando do dia mais recente pro mais antigo. Cada janela
 * reusa `sincronizarExtratoAsaas` (idempotente por UNIQUE em
 * `despesas.asaasFinTransId` — reprocessar não duplica).
 *
 * Cota do Asaas (25k req/12h compartilhada com todo o resto): quando uma
 * janela volta `parcial=true` (429/cota), o cursor NÃO anda e
 * `extratoSyncProximaTentativaEm` é setado pra +60min — o cron pula o
 * escritório até lá e retoma sozinho, sem intervenção. A janela
 * reprocessa por inteiro (idempotência cobre o que já entrou).
 */

import { eq, inArray } from "drizzle-orm";
import { getDb } from "../db";
import { asaasConfig, escritorios } from "../../drizzle/schema";
import { decrypt } from "../escritorio/crypto-utils";
import { AsaasClient } from "./asaas-client";
import { sincronizarExtratoAsaas } from "./asaas-extrato";
import { contarDiasInclusivos, subtrairDias } from "./asaas-sync-historico";
import { createLogger } from "../_core/logger";

const log = createLogger("asaas-extrato-historico");

/** Backoff quando a cota corta a janela no meio. */
const BACKOFF_COTA_MS = 60 * 60_000;

export interface ExtratoSyncCfgElegibilidade {
  extratoSyncStatus: string;
  extratoSyncUltimaJanelaEm: Date | null;
  extratoSyncIntervaloMinutos: number;
  extratoSyncProximaTentativaEm: Date | null;
}

/**
 * Determina se um escritório está pronto pra processar a próxima janela
 * de extrato. Mesmo critério do sync de cobranças, mais o backoff de
 * cota (`proximaTentativaEm` no futuro → pula).
 */
export function elegivelParaProximaJanelaExtrato(
  cfg: ExtratoSyncCfgElegibilidade,
  agora: Date = new Date(),
): boolean {
  if (cfg.extratoSyncStatus === "agendado") return true;
  if (cfg.extratoSyncStatus !== "executando") return false;
  if (
    cfg.extratoSyncProximaTentativaEm &&
    cfg.extratoSyncProximaTentativaEm.getTime() > agora.getTime()
  ) {
    return false;
  }
  if (!cfg.extratoSyncUltimaJanelaEm) return true;
  const passouMs = agora.getTime() - cfg.extratoSyncUltimaJanelaEm.getTime();
  return passouMs >= cfg.extratoSyncIntervaloMinutos * 60_000;
}

/**
 * Calcula a janela [inicio, fim] do próximo tick a partir do cursor.
 * O cursor é o dia mais recente ainda não concluído; a janela cobre
 * `diasPorTick` dias pra trás, sem passar do limite inferior `de`.
 */
export function calcularJanelaExtrato(opts: {
  cursor: string;
  de: string;
  diasPorTick: number;
}): { inicio: string; fim: string; dias: number } {
  const fim = opts.cursor;
  const inicioBruto = subtrairDias(fim, Math.max(1, opts.diasPorTick) - 1);
  const inicio = inicioBruto < opts.de ? opts.de : inicioBruto;
  return { inicio, fim, dias: contarDiasInclusivos(inicio, fim) };
}

/**
 * Função-cron: processa 1 janela de extrato pra cada escritório elegível.
 * Chamada periodicamente (5 min) por `cron-jobs.ts`.
 */
export async function processarSyncExtrato(): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const candidatos = await db
    .select()
    .from(asaasConfig)
    .where(inArray(asaasConfig.extratoSyncStatus, ["agendado", "executando"] as const));

  for (const cfg of candidatos) {
    if (!elegivelParaProximaJanelaExtrato(cfg)) continue;
    if (!cfg.extratoSyncCursor || !cfg.extratoSyncDe) {
      log.warn(
        { escritorioId: cfg.escritorioId },
        "[asaas-extrato-historico] config sem cursor/limite — marcando erro",
      );
      await db
        .update(asaasConfig)
        .set({
          extratoSyncStatus: "erro",
          extratoSyncErroMensagem: "Configuração incompleta (cursor/período ausente).",
        })
        .where(eq(asaasConfig.id, cfg.id));
      continue;
    }

    try {
      if (!cfg.apiKeyEncrypted || !cfg.apiKeyIv || !cfg.apiKeyTag) continue;
      let client: AsaasClient;
      try {
        const apiKey = decrypt(cfg.apiKeyEncrypted, cfg.apiKeyIv, cfg.apiKeyTag);
        client = new AsaasClient(apiKey, cfg.modo);
      } catch {
        continue;
      }

      // Despesas geradas pelo cron precisam de um "criado por" — usa o
      // dono do escritório (mesmo critério do botão manual).
      const [esc] = await db
        .select({ ownerId: escritorios.ownerId })
        .from(escritorios)
        .where(eq(escritorios.id, cfg.escritorioId))
        .limit(1);
      if (!esc) continue;

      const janela = calcularJanelaExtrato({
        cursor: cfg.extratoSyncCursor,
        de: cfg.extratoSyncDe,
        diasPorTick: cfg.extratoSyncDiasPorTick,
      });

      const r = await sincronizarExtratoAsaas(cfg.escritorioId, client, {
        startDate: janela.inicio,
        finishDate: janela.fim,
        criadoPorUserId: esc.ownerId,
      });

      if (r.parcial) {
        // Cota cortou no meio: cursor NÃO anda (janela reprocessa inteira
        // — idempotente). Backoff de 1h e o cron retoma sozinho.
        const proxima = new Date(Date.now() + BACKOFF_COTA_MS);
        await db
          .update(asaasConfig)
          .set({
            extratoSyncStatus: "executando",
            extratoSyncProximaTentativaEm: proxima,
            extratoSyncUltimaJanelaEm: new Date(),
            // Conta o que entrou antes do corte (não se perde).
            extratoSyncDespesasImportadas:
              cfg.extratoSyncDespesasImportadas + r.novasDespesas,
            extratoSyncDuplicadas: cfg.extratoSyncDuplicadas + r.duplicadas,
            extratoSyncErros: cfg.extratoSyncErros + r.erros,
            extratoSyncErroMensagem:
              "Limite de requisições do Asaas — retomada automática agendada.",
          })
          .where(eq(asaasConfig.id, cfg.id));
        log.warn(
          { escritorioId: cfg.escritorioId, janela, proximaTentativa: proxima.toISOString() },
          "[asaas-extrato-historico] janela parcial por cota — backoff 1h",
        );
        continue;
      }

      const proximoCursor = subtrairDias(janela.inicio, 1);
      const concluiu = proximoCursor < cfg.extratoSyncDe;

      await db
        .update(asaasConfig)
        .set({
          extratoSyncStatus: concluiu ? "concluido" : "executando",
          extratoSyncCursor: concluiu ? null : proximoCursor,
          extratoSyncDiasFeitos: cfg.extratoSyncDiasFeitos + janela.dias,
          extratoSyncDespesasImportadas:
            cfg.extratoSyncDespesasImportadas + r.novasDespesas,
          extratoSyncDuplicadas: cfg.extratoSyncDuplicadas + r.duplicadas,
          extratoSyncErros: cfg.extratoSyncErros + r.erros,
          extratoSyncUltimaJanelaEm: new Date(),
          extratoSyncProximaTentativaEm: null,
          extratoSyncErroMensagem: null,
          ...(concluiu ? { extratoSyncConcluidoEm: new Date() } : {}),
        })
        .where(eq(asaasConfig.id, cfg.id));

      log.info(
        {
          escritorioId: cfg.escritorioId,
          janela,
          novas: r.novasDespesas,
          duplicadas: r.duplicadas,
          erros: r.erros,
          concluiu,
        },
        "[asaas-extrato-historico] janela processada",
      );
    } catch (err: any) {
      log.error(
        { err: err?.message, escritorioId: cfg.escritorioId },
        "[asaas-extrato-historico] exceção inesperada",
      );
      try {
        await db
          .update(asaasConfig)
          .set({
            extratoSyncStatus: "erro",
            extratoSyncErroMensagem: `Erro inesperado: ${err?.message ?? "?"}`.slice(0, 512),
            extratoSyncUltimaJanelaEm: new Date(),
          })
          .where(eq(asaasConfig.id, cfg.id));
      } catch {
        /* swallow */
      }
    }
  }
}
