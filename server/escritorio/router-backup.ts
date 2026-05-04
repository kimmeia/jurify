/**
 * Router tRPC — Backup do escritório.
 *
 * Apenas o cargo `dono` pode gerar e baixar o backup. O backup contém
 * dados pessoais (LGPD) — manter restrito ao responsável legal pelo
 * escritório, não a todo gestor/atendente.
 *
 * Não armazena server-side: gera, retorna em base64, descarta. UI
 * decodifica e oferece download.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { getEscritorioPorUsuario } from "./db-escritorio";
import {
  gerarBackupEscritorioJson,
  gerarBackupEscritorioSql,
  type ManifestoBackup,
} from "../backup/escritorio-backup";
import {
  EXCLUIR_NAO_RELEVANTE,
  EXCLUIR_SEGREDO,
  TABELAS_INCLUIR,
} from "../backup/escritorio-tabelas";

function exigirDono(cargo: string) {
  if (cargo !== "dono") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Apenas o dono do escritório pode gerar backup. Peça ao dono pra rodar.",
    });
  }
}

export const backupRouter = router({
  /**
   * Preview do escopo: lista das tabelas incluídas, excluídas (com
   * motivo) e estimativa de linhas. Roda só `SELECT COUNT(*)` por
   * tabela — rápido. UI mostra antes do dono apertar "Gerar".
   */
  previewEscopo: protectedProcedure.query(async ({ ctx }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id);
    if (!esc) throw new TRPCError({ code: "FORBIDDEN", message: "Sem escritório vinculado" });
    exigirDono(esc.colaborador.cargo);

    const { getDb } = await import("../db");
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });

    const conn: any = (db as any).$client ?? db;
    const incluidas: Array<{ nome: string; categoria: string; linhas: number; colunasOmitidas?: string[] }> = [];
    let totalLinhas = 0;
    for (const tab of TABELAS_INCLUIR) {
      const [rows] = (await conn.execute(
        `SELECT COUNT(*) AS c FROM \`${tab.nomeBanco}\` WHERE \`${tab.colunaEscritorio}\` = ?`,
        [esc.escritorio.id],
      )) as [Array<{ c: number | bigint }>, unknown];
      const linhas = Number(rows[0]?.c ?? 0);
      totalLinhas += linhas;
      incluidas.push({
        nome: tab.nomeBanco,
        categoria: tab.categoria,
        linhas,
        colunasOmitidas: tab.colunasOmitir,
      });
    }
    return {
      escritorioId: esc.escritorio.id,
      escritorioNome: esc.escritorio.nome,
      totalLinhas,
      incluidas,
      excluidasPorSegredo: EXCLUIR_SEGREDO,
      excluidasNaoRelevantes: EXCLUIR_NAO_RELEVANTE,
    };
  }),

  /**
   * Gera backup. `formato`: "json" = ZIP de JSONs; "sql" = .sql.gz; ambos
   * = ZIP contendo o JSON + o .sql.gz dentro. Retorna base64 — o front
   * decodifica e baixa via `Blob`.
   */
  gerar: protectedProcedure
    .input(z.object({ formato: z.enum(["json", "sql", "ambos"]) }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "FORBIDDEN", message: "Sem escritório vinculado" });
      exigirDono(esc.colaborador.cargo);

      const escritorioId = esc.escritorio.id;
      const escritorioNome = esc.escritorio.nome;
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const slug = escritorioNome.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `escritorio-${escritorioId}`;

      let buffer: Buffer;
      let nomeArquivo: string;
      let mime: string;
      let manifesto: ManifestoBackup | null = null;

      if (input.formato === "json") {
        const r = await gerarBackupEscritorioJson(escritorioId, escritorioNome);
        buffer = r.zipBuffer;
        manifesto = r.manifesto;
        nomeArquivo = `backup-${slug}-${stamp}.zip`;
        mime = "application/zip";
      } else if (input.formato === "sql") {
        buffer = await gerarBackupEscritorioSql(escritorioId);
        nomeArquivo = `backup-${slug}-${stamp}.sql.gz`;
        mime = "application/gzip";
      } else {
        // ambos: ZIP contendo backup.zip + backup.sql.gz + manifesto
        const JSZip = (await import("jszip")).default;
        const json = await gerarBackupEscritorioJson(escritorioId, escritorioNome);
        const sql = await gerarBackupEscritorioSql(escritorioId);
        manifesto = json.manifesto;
        const wrapper = new JSZip();
        wrapper.file(`backup-jsons.zip`, json.zipBuffer);
        wrapper.file(`backup-${slug}.sql.gz`, sql);
        wrapper.file("manifesto.json", JSON.stringify(json.manifesto, null, 2));
        buffer = await wrapper.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } });
        nomeArquivo = `backup-${slug}-${stamp}-completo.zip`;
        mime = "application/zip";
      }

      return {
        nomeArquivo,
        mime,
        tamanhoBytes: buffer.length,
        base64: buffer.toString("base64"),
        manifesto,
      };
    }),
});
