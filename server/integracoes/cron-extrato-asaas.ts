/**
 * Cron: sincroniza extrato Asaas (taxas, transferências, mensalidade Asaas)
 * pra todos os escritórios com Asaas conectado.
 *
 * Rodar 1x/dia (madrugada BRT) puxando os últimos 3 dias — margem de
 * segurança contra reagendamentos do Asaas. Idempotente via UNIQUE INDEX
 * (escritorioId, asaasFinTransId), então rodar 3 dias só importa novas
 * movimentações.
 *
 * Antes desse cron, a única forma de trazer taxas Asaas e transferências
 * pra dentro do app era o botão manual "Sincronizar extrato" em
 * Configurações → Integrações. Quem não clicava perdia visibilidade.
 */

import { eq, isNotNull } from "drizzle-orm";
import { getDb } from "../db";
import { asaasConfig, colaboradores } from "../../drizzle/schema";
import { createLogger } from "../_core/logger";
import { getAsaasClient } from "./router-asaas";
import { sincronizarExtratoAsaas } from "./asaas-extrato";

const log = createLogger("cron-extrato-asaas");

/** Janela de busca: últimos N dias. Idempotente, então repetir é seguro. */
const DIAS_JANELA = 3;

/** Limite defensivo de escritórios processados por execução. Escritório
 *  novo entra no próximo dia se passar do limite — não é crítico. */
const MAX_ESCRITORIOS_POR_RUN = 1000;

export async function sincronizarExtratoTodosEscritorios(): Promise<{
  processados: number;
  novasDespesas: number;
  duplicadas: number;
  falhas: number;
}> {
  const db = await getDb();
  if (!db) {
    log.warn("DB indisponível, pulando sincronização de extrato");
    return { processados: 0, novasDespesas: 0, duplicadas: 0, falhas: 0 };
  }

  // Escritórios com Asaas conectado (apiKey criptografada não-nula).
  const configs = await db
    .select({
      escritorioId: asaasConfig.escritorioId,
    })
    .from(asaasConfig)
    .where(isNotNull(asaasConfig.apiKeyEncrypted))
    .limit(MAX_ESCRITORIOS_POR_RUN);

  if (configs.length === 0) {
    log.info("Nenhum escritório com Asaas conectado");
    return { processados: 0, novasDespesas: 0, duplicadas: 0, falhas: 0 };
  }

  const hoje = new Date();
  const finishDate = hoje.toISOString().slice(0, 10);
  const desde = new Date(hoje);
  desde.setDate(desde.getDate() - DIAS_JANELA);
  const startDate = desde.toISOString().slice(0, 10);

  let novasTotal = 0;
  let dupTotal = 0;
  let falhasTotal = 0;
  let processados = 0;

  for (const cfg of configs) {
    const escritorioId = cfg.escritorioId;
    try {
      const client = await getAsaasClient(escritorioId);
      if (!client) {
        log.debug({ escritorioId }, "Sem client Asaas (apiKey inválida?), pulando");
        continue;
      }

      // Pega um colaborador qualquer do escritório pra registrar como
      // "criou" nas despesas geradas. Idealmente seria o dono — mas pra
      // efeitos de auditoria do cron, qualquer ativo do escritório serve.
      const [colab] = await db
        .select({ userId: colaboradores.userId })
        .from(colaboradores)
        .where(eq(colaboradores.escritorioId, escritorioId))
        .limit(1);
      if (!colab) {
        log.warn({ escritorioId }, "Escritório sem colaborador, pulando");
        continue;
      }

      const r = await sincronizarExtratoAsaas(escritorioId, client, {
        startDate,
        finishDate,
        criadoPorUserId: colab.userId,
      });
      novasTotal += r.novasDespesas;
      dupTotal += r.duplicadas;
      processados++;

      if (r.novasDespesas > 0) {
        log.info(
          { escritorioId, novas: r.novasDespesas, duplicadas: r.duplicadas },
          "Extrato sincronizado",
        );
      }
    } catch (err: any) {
      falhasTotal++;
      log.warn(
        { escritorioId, err: err?.message ?? String(err) },
        "Falha ao sincronizar extrato (não-fatal, continua próximo)",
      );
    }
  }

  log.info(
    { processados, novasTotal, dupTotal, falhasTotal, startDate, finishDate },
    "Cron extrato finalizado",
  );

  return {
    processados,
    novasDespesas: novasTotal,
    duplicadas: dupTotal,
    falhas: falhasTotal,
  };
}
