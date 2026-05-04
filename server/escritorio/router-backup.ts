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
  executarImportEscritorio,
  previewImportEscritorio,
} from "../backup/escritorio-import";
import {
  EXCLUIR_NAO_RELEVANTE,
  EXCLUIR_SEGREDO,
  TABELAS_INCLUIR,
  TABELAS_SATELITE,
} from "../backup/escritorio-tabelas";
import { obterConfigBackupDoEnv } from "../backup/admin-backup";
import {
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";

type CtxUser = { id: number; role?: string | null; impersonatedBy?: string };

/**
 * Backup do escritório exige privilégio de Dono. Aceita também:
 * - admin Jurify (`role === "admin"`) — debug/suporte direto;
 * - admin impersonando (`impersonatedBy` presente) — propaga privilégio
 *   do admin original (já passou pelo gate em `/admin`); ações ficam
 *   logadas em nome do admin original conforme banner de impersonação;
 * - dono canônico via `escritorios.ownerId` — imune a alterações em
 *   cargos personalizados (cliente pode ter cargo "Dono" capitalizado
 *   ou "Sócio Fundador" e ainda assim ser o dono real do escritório).
 */
export function exigirDonoOuAdmin(
  user: CtxUser,
  esc: { escritorio: { ownerId: number }; colaborador: { cargo: string } },
) {
  if (user.role === "admin") return;
  if (user.impersonatedBy) return;
  if (esc.escritorio.ownerId === user.id) return;
  if (esc.colaborador.cargo === "dono") return;
  throw new TRPCError({
    code: "FORBIDDEN",
    message:
      "Apenas o dono do escritório pode gerar/importar backup. " +
      "Peça ao dono pra rodar, ou peça ao admin Jurify pra ajudar.",
  });
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
    exigirDonoOuAdmin(ctx.user as CtxUser, esc);

    const { getDb } = await import("../db");
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB indisponível" });

    const conn: any = (db as any).$client ?? db;
    const incluidas: Array<{
      nome: string;
      categoria: string;
      tipo: "principal" | "satelite";
      linhas: number;
      colunasOmitidas?: string[];
    }> = [];
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
        tipo: "principal",
        linhas,
        colunasOmitidas: tab.colunasOmitir,
      });
    }
    for (const tab of TABELAS_SATELITE) {
      const [rows] = (await conn.execute(
        `SELECT COUNT(*) AS c FROM \`${tab.nomeBanco}\` WHERE ${tab.filtroSql}`,
        [esc.escritorio.id],
      )) as [Array<{ c: number | bigint }>, unknown];
      const linhas = Number(rows[0]?.c ?? 0);
      totalLinhas += linhas;
      incluidas.push({
        nome: tab.nomeBanco,
        categoria: tab.categoria,
        tipo: "satelite",
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
      exigirDonoOuAdmin(ctx.user as CtxUser, esc);

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

  /**
   * Solicita URL S3 pré-assinada (PUT, 30min) pra upload do ZIP de
   * import. Cliente sobe direto pro bucket — sem passar pelo express
   * (que tem body limit 15MB, insuficiente pra ZIPs grandes).
   *
   * Key sempre dentro de `imports/escritorio_<id>/<uuid>.zip` — o
   * escritorioId é fixado no servidor, então mesmo que o cliente envie
   * pra outra key, as procedures seguintes só aceitam keys com prefixo
   * do escritório atual.
   */
  solicitarUploadImport: protectedProcedure.mutation(async ({ ctx }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id);
    if (!esc) throw new TRPCError({ code: "FORBIDDEN", message: "Sem escritório vinculado" });
    exigirDonoOuAdmin(ctx.user as CtxUser, esc);
    const cfg = obterConfigBackupDoEnv();
    if (!cfg) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Bucket S3 não configurado — peça ao admin Jurify pra configurar.",
      });
    }
    const s3 = montarS3Client(cfg);
    const key = `imports/escritorio_${esc.escritorio.id}/${randomUUID()}.zip`;
    const url = await getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket: cfg.bucket,
        Key: key,
        ContentType: "application/zip",
      }),
      { expiresIn: 30 * 60 },
    );
    return { url, key, expiraEmMinutos: 30 };
  }),

  /**
   * Preview do import: baixa o ZIP do S3, valida e retorna o que vai
   * acontecer (linhas a apagar / inserir por tabela). Não toca no banco.
   */
  previewImport: protectedProcedure
    .input(z.object({ key: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "FORBIDDEN", message: "Sem escritório vinculado" });
      exigirDonoOuAdmin(ctx.user as CtxUser, esc);
      garantirKeyDoEscritorio(input.key, esc.escritorio.id);
      const cfg = obterConfigBackupDoEnv();
      if (!cfg) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Bucket S3 não configurado" });
      const buffer = await baixarObjetoS3(cfg, input.key);
      return await previewImportEscritorio(buffer, esc.escritorio.id);
    }),

  /**
   * Executa o import. Operação destrutiva — exige confirmação textual
   * exata "SUBSTITUIR TUDO". Após sucesso/falha, deleta o objeto S3.
   */
  executarImport: protectedProcedure
    .input(
      z.object({
        key: z.string().min(1),
        confirmacao: z.literal("SUBSTITUIR TUDO"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "FORBIDDEN", message: "Sem escritório vinculado" });
      exigirDonoOuAdmin(ctx.user as CtxUser, esc);
      garantirKeyDoEscritorio(input.key, esc.escritorio.id);
      const cfg = obterConfigBackupDoEnv();
      if (!cfg) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Bucket S3 não configurado" });

      const buffer = await baixarObjetoS3(cfg, input.key);
      try {
        const relatorio = await executarImportEscritorio(buffer, esc.escritorio.id);
        await deletarObjetoS3(cfg, input.key).catch(() => {});
        return relatorio;
      } catch (err) {
        await deletarObjetoS3(cfg, input.key).catch(() => {});
        throw err;
      }
    }),
});

function garantirKeyDoEscritorio(key: string, escritorioId: number): void {
  const prefixo = `imports/escritorio_${escritorioId}/`;
  if (!key.startsWith(prefixo)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Key não pertence ao escritório atual.",
    });
  }
}

function montarS3Client(cfg: ReturnType<typeof obterConfigBackupDoEnv>): S3Client {
  if (!cfg) throw new Error("Config S3 não disponível");
  return new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    forcePathStyle: true,
  });
}

async function baixarObjetoS3(
  cfg: NonNullable<ReturnType<typeof obterConfigBackupDoEnv>>,
  key: string,
): Promise<Buffer> {
  const s3 = montarS3Client(cfg);
  const res = await s3.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
  if (!res.Body) throw new Error("Objeto S3 vazio");
  // Body é um Readable (Node) ou ReadableStream (Web). No Node usamos
  // transformToByteArray (disponível desde @aws-sdk v3.300+).
  const bytes = await (res.Body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray();
  return Buffer.from(bytes);
}

async function deletarObjetoS3(
  cfg: NonNullable<ReturnType<typeof obterConfigBackupDoEnv>>,
  key: string,
): Promise<void> {
  const s3 = montarS3Client(cfg);
  await s3.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }));
}
