/**
 * Router tRPC — Backup global do banco (admin Jurify).
 *
 * Lista os dumps existentes em S3 (gerados pelo cron diário ou sob
 * demanda), gera um novo backup sob demanda, e gera URL pré-assinada
 * pra download direto do S3 pelo navegador.
 *
 * Restore NÃO é exposto aqui — é destrutivo demais pra "botão". A UI
 * mostra instruções de restore manual via mysql CLI.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, router } from "../_core/trpc";
import {
  executarBackupGlobal,
  listarBackupsGlobais,
  obterConfigBackupDoEnv,
  urlAssinadaDownload,
} from "../backup/admin-backup";

function exigirCfg() {
  const cfg = obterConfigBackupDoEnv();
  if (!cfg) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Backup não configurado: defina BACKUP_BUCKET, BACKUP_BUCKET_ENDPOINT, BACKUP_BUCKET_REGION, BACKUP_ACCESS_KEY, BACKUP_SECRET_KEY no .env do servidor.",
    });
  }
  return cfg;
}

export const adminBackupRouter = router({
  /** True/false se as variáveis de ambiente do bucket estão definidas. */
  status: adminProcedure.query(() => {
    return { configurado: obterConfigBackupDoEnv() != null };
  }),

  /**
   * Lista os dumps `*.sql.gz` no bucket sob `mysql/<database>/`. Ordena
   * do mais recente. Retorna até `limite` (default 50).
   */
  listar: adminProcedure
    .input(z.object({ limite: z.number().min(1).max(200).default(50) }).optional())
    .query(async ({ input }) => {
      const cfg = exigirCfg();
      const limite = input?.limite ?? 50;
      const lista = await listarBackupsGlobais(cfg);
      return lista.slice(0, limite).map((reg) => ({
        key: reg.key,
        database: reg.database,
        tamanhoBytes: reg.tamanhoBytes,
        criadoEm: reg.criadoEm.toISOString(),
      }));
    }),

  /**
   * Dispara mysqldump → gzip → upload S3 sob demanda. Demora ~30s pra
   * banco pequeno; pode passar de minutos pra DBs grandes. UI deve
   * indicar loading + permitir refresh manual.
   */
  gerarAgora: adminProcedure.mutation(async () => {
    const cfg = exigirCfg();
    const reg = await executarBackupGlobal(cfg);
    return {
      key: reg.key,
      database: reg.database,
      tamanhoBytes: reg.tamanhoBytes,
      criadoEm: reg.criadoEm.toISOString(),
    };
  }),

  /**
   * URL S3 pré-assinada (15 min) pra download direto pelo navegador.
   */
  urlDownload: adminProcedure
    .input(z.object({ key: z.string().min(1) }))
    .query(async ({ input }) => {
      const cfg = exigirCfg();
      const url = await urlAssinadaDownload(cfg, input.key);
      return { url, expiraEmMinutos: 15 };
    }),
});
