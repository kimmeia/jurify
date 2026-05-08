/**
 * Migração one-shot: userCredits (legacy) → escritorio_creditos.
 *
 * Por que existe: o sistema tinha 2 fontes de saldo desencontradas. Admin
 * Jurify e webhooks antigos creditavam em `userCredits.userId` (individual),
 * mas todos os fluxos de cobrança real (`consumirCredito` em db.ts:530,
 * `consumirCreditos` em processos.ts:100) já liam de `escritorio_creditos`.
 *
 * Resultado: clientes compraram saldo que nunca chegou ao escritório onde
 * o sistema cobra. Esta migração resolve em 1 passada idempotente.
 *
 * Idempotência: registra transação tipo=bonus com operacao="migracao_legacy"
 * pra cada escritório. Se já existe, pula (não credita 2x).
 */

import { eq, and } from "drizzle-orm";
import { getDb } from "../db";
import { users, userCredits, escritorios, escritorioTransacoes } from "../../drizzle/schema";
import { creditarEscritorio } from "./escritorio-creditos";
import { createLogger } from "../_core/logger";

const log = createLogger("migrate-legacy-credits");

const OPERACAO_MIGRACAO = "migracao_legacy_userCredits";

export interface MigrationResult {
  processados: number;
  migrados: number;
  totalCreditos: number;
  pulados: number;
  erros: number;
  detalhes: Array<{
    userId: number;
    userName: string;
    escritorioId: number;
    saldoLegacy: number;
    status: "migrado" | "ja_migrado" | "sem_saldo" | "sem_escritorio" | "erro";
    erro?: string;
  }>;
}

export async function migrarCreditosLegacyParaEscritorio(): Promise<MigrationResult> {
  const db = await getDb();
  if (!db) throw new Error("DB indisponível");

  const result: MigrationResult = {
    processados: 0,
    migrados: 0,
    totalCreditos: 0,
    pulados: 0,
    erros: 0,
    detalhes: [],
  };

  // Pega todos os donos de escritório (escritorios.ownerId → users)
  const donos = await db
    .select({
      userId: users.id,
      userName: users.name,
      escritorioId: escritorios.id,
      escritorioNome: escritorios.nome,
    })
    .from(escritorios)
    .innerJoin(users, eq(users.id, escritorios.ownerId));

  log.info({ totalDonos: donos.length }, "iniciando migração");

  for (const dono of donos) {
    result.processados++;

    try {
      // Verifica idempotência: já tem transação de migração pra esse escritório?
      const [jaMigrado] = await db
        .select({ id: escritorioTransacoes.id })
        .from(escritorioTransacoes)
        .where(
          and(
            eq(escritorioTransacoes.escritorioId, dono.escritorioId),
            eq(escritorioTransacoes.operacao, OPERACAO_MIGRACAO),
          ),
        )
        .limit(1);

      if (jaMigrado) {
        result.pulados++;
        result.detalhes.push({
          userId: dono.userId,
          userName: dono.userName ?? "(sem nome)",
          escritorioId: dono.escritorioId,
          saldoLegacy: 0,
          status: "ja_migrado",
        });
        continue;
      }

      // Lê saldo legacy do dono
      const [legacy] = await db
        .select()
        .from(userCredits)
        .where(eq(userCredits.userId, dono.userId))
        .limit(1);

      const saldoLegacy = legacy
        ? Math.max(0, legacy.creditsTotal - legacy.creditsUsed)
        : 0;

      if (saldoLegacy === 0) {
        result.pulados++;
        result.detalhes.push({
          userId: dono.userId,
          userName: dono.userName ?? "(sem nome)",
          escritorioId: dono.escritorioId,
          saldoLegacy: 0,
          status: "sem_saldo",
        });
        continue;
      }

      // Credita no escritório (registra transação automaticamente)
      await creditarEscritorio(
        dono.escritorioId,
        dono.userId,
        saldoLegacy,
        "bonus",
        OPERACAO_MIGRACAO,
        `Migração saldo legacy userCredits (${saldoLegacy} créditos do user ${dono.userName})`,
      );

      // Zera userCredits do dono pra refletir consumo total
      // (mantém linha pra histórico/auditoria, só zera disponível)
      if (legacy) {
        await db
          .update(userCredits)
          .set({ creditsUsed: legacy.creditsTotal })
          .where(eq(userCredits.userId, dono.userId));
      }

      result.migrados++;
      result.totalCreditos += saldoLegacy;
      result.detalhes.push({
        userId: dono.userId,
        userName: dono.userName ?? "(sem nome)",
        escritorioId: dono.escritorioId,
        saldoLegacy,
        status: "migrado",
      });

      log.info(
        { userId: dono.userId, escritorioId: dono.escritorioId, saldoLegacy },
        "migrado",
      );
    } catch (err: any) {
      result.erros++;
      result.detalhes.push({
        userId: dono.userId,
        userName: dono.userName ?? "(sem nome)",
        escritorioId: dono.escritorioId,
        saldoLegacy: 0,
        status: "erro",
        erro: err?.message ?? String(err),
      });
      log.error(
        { userId: dono.userId, err: err?.message },
        "erro ao migrar",
      );
    }
  }

  log.info(
    {
      processados: result.processados,
      migrados: result.migrados,
      totalCreditos: result.totalCreditos,
      pulados: result.pulados,
      erros: result.erros,
    },
    "migração finalizada",
  );

  return result;
}
