/**
 * Backup do escritório — só os dados do escritório dado (filtrado por
 * escritorioId). Gera ZIP de JSONs (uma entrada por tabela) e/ou SQL
 * filtrado (.sql.gz). Não armazena server-side: a UI streaming pro
 * navegador, o servidor descarta após o response.
 *
 * Allowlist em `escritorio-tabelas.ts`. Tabelas com chaves criptografadas
 * (asaas_config, judit_credenciais, canais_integrados) ficam de fora.
 * Tabelas incluídas que TÊM colunas sensíveis (ex: agentes_ia.openaiApiKey)
 * têm essas colunas omitidas do JSON.
 */
import { spawn } from "node:child_process";
import { createGzip } from "node:zlib";
import JSZip from "jszip";
import { getDb } from "../db";
import {
  EXCLUIR_NAO_RELEVANTE,
  EXCLUIR_SEGREDO,
  TABELAS_INCLUIR,
  type TabelaBackup,
} from "./escritorio-tabelas";

export interface ManifestoBackup {
  versao: 1;
  geradoEm: string; // ISO
  escritorioId: number;
  escritorioNome: string;
  tabelas: Array<{
    nome: string;
    categoria: "dados" | "configs";
    linhas: number;
    colunasOmitidas?: string[];
  }>;
  excluidasPorSegredo: ReadonlyArray<{ nomeBanco: string; motivo: string }>;
  excluidasNaoRelevantes: ReadonlyArray<{ nomeBanco: string; motivo: string }>;
  aviso: string;
}

const AVISO_LGPD =
  "ATENÇÃO: este arquivo contém dados pessoais dos contatos do escritório (nomes, CPF/CNPJ, telefones, e-mails, conversas). " +
  "Armazene em local seguro. Sob a LGPD, o escritório é responsável pelo tratamento desses dados.";

/**
 * Faz SELECT * (com colunas omitidas) na tabela filtrando por
 * escritorioId. Retorna array de linhas como objetos JS.
 */
async function lerLinhasTabela(
  tab: TabelaBackup,
  escritorioId: number,
): Promise<Record<string, unknown>[]> {
  const db = await getDb();
  if (!db) throw new Error("DB indisponível");

  const colunasOmitir = new Set(tab.colunasOmitir ?? []);

  // Drizzle não tem helper p/ "select all but exclude X" sem importar a
  // tabela. Usamos query bruta — mais leve e funciona pra qualquer schema.
  const sql = `SELECT * FROM \`${tab.nomeBanco}\` WHERE \`${tab.colunaEscritorio}\` = ?`;
  const conn: any = (db as any).$client ?? db;
  const [rows] = (await conn.execute(sql, [escritorioId])) as [any[], unknown];

  if (colunasOmitir.size === 0) return rows as Record<string, unknown>[];
  return (rows as Record<string, unknown>[]).map((row) => {
    const limpo: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      if (!colunasOmitir.has(k)) limpo[k] = v;
    }
    return limpo;
  });
}

/**
 * Gera ZIP com um JSON por tabela + manifesto.json. Buffer único —
 * para escritórios grandes, considerar streaming, mas pro v1 buffer é
 * mais simples e suficiente até dezenas de MB.
 */
export async function gerarBackupEscritorioJson(
  escritorioId: number,
  escritorioNome: string,
): Promise<{ zipBuffer: Buffer; manifesto: ManifestoBackup }> {
  const zip = new JSZip();
  const tabelasManifesto: ManifestoBackup["tabelas"] = [];

  for (const tab of TABELAS_INCLUIR) {
    const linhas = await lerLinhasTabela(tab, escritorioId);
    zip.file(`tabelas/${tab.nomeBanco}.json`, JSON.stringify(linhas, null, 2));
    tabelasManifesto.push({
      nome: tab.nomeBanco,
      categoria: tab.categoria,
      linhas: linhas.length,
      colunasOmitidas: tab.colunasOmitir,
    });
  }

  const manifesto: ManifestoBackup = {
    versao: 1,
    geradoEm: new Date().toISOString(),
    escritorioId,
    escritorioNome,
    tabelas: tabelasManifesto,
    excluidasPorSegredo: EXCLUIR_SEGREDO,
    excluidasNaoRelevantes: EXCLUIR_NAO_RELEVANTE,
    aviso: AVISO_LGPD,
  };
  zip.file("manifesto.json", JSON.stringify(manifesto, null, 2));

  const zipBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } });
  return { zipBuffer, manifesto };
}

interface ConexaoMysql {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

function parseDatabaseUrl(url: string): ConexaoMysql {
  const u = new URL(url);
  if (!u.protocol.startsWith("mysql")) {
    throw new Error(`DATABASE_URL não é MySQL: ${u.protocol}`);
  }
  return {
    host: u.hostname,
    port: u.port ? parseInt(u.port, 10) : 3306,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ""),
  };
}

/**
 * Gera SQL.gz do escritório usando `mysqldump --where="<col>=X"`. Roda
 * um dump por tabela (mysqldump aceita só uma cláusula `--where` por
 * invocação) e concatena os outputs gzipados. Não inclui as colunas
 * sensíveis — pra essas tabelas (agentes_ia), usa `--ignore-table`
 * temporariamente e injeta um INSERT manual com as colunas seguras.
 *
 * Pra v1: simplificação — `--ignore-table` para tabelas com
 * `colunasOmitir`, e o JSON delas (no ZIP) cobre o gap. Quem quiser
 * restore via SQL puro reimporta JSON também.
 */
export async function gerarBackupEscritorioSql(
  escritorioId: number,
): Promise<Buffer> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL não definida");
  const conn = parseDatabaseUrl(databaseUrl);

  const partes: Buffer[] = [];
  const cabecalho = `-- Backup escritório ${escritorioId} gerado em ${new Date().toISOString()}\n` +
    `-- Filtrado por escritorioId. Colunas com chaves criptografadas omitidas.\n` +
    `-- Pra restaurar:\n` +
    `--   gunzip backup-${escritorioId}.sql.gz | mysql -u USUARIO -p NOME_DO_BANCO\n\n`;
  partes.push(Buffer.from(cabecalho));

  for (const tab of TABELAS_INCLUIR) {
    if (tab.colunasOmitir && tab.colunasOmitir.length > 0) {
      // Pula no dump SQL — JSON cobre
      partes.push(
        Buffer.from(
          `-- (tabela \`${tab.nomeBanco}\` exportada apenas no JSON do ZIP — contém colunas sensíveis omitidas)\n\n`,
        ),
      );
      continue;
    }
    const dump = await executarMysqldumpFiltrado(conn, tab, escritorioId);
    partes.push(dump);
  }

  const sqlConcat = Buffer.concat(partes);

  return new Promise<Buffer>((resolve, reject) => {
    const gz = createGzip({ level: 9 });
    const chunks: Buffer[] = [];
    gz.on("data", (c: Buffer) => chunks.push(c));
    gz.on("end", () => resolve(Buffer.concat(chunks)));
    gz.on("error", reject);
    gz.end(sqlConcat);
  });
}

function executarMysqldumpFiltrado(
  conn: ConexaoMysql,
  tab: TabelaBackup,
  escritorioId: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const where = `${tab.colunaEscritorio}=${escritorioId}`;
    const dump = spawn(
      "mysqldump",
      [
        `--host=${conn.host}`,
        `--port=${conn.port}`,
        `--user=${conn.user}`,
        `--password=${conn.password}`,
        "--single-transaction",
        "--quick",
        "--no-create-info",
        "--skip-add-drop-table",
        "--skip-add-locks",
        "--set-gtid-purged=OFF",
        "--column-statistics=0",
        `--where=${where}`,
        conn.database,
        tab.nomeBanco,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );

    let stderr = "";
    const chunks: Buffer[] = [];
    dump.stdout.on("data", (c: Buffer) => chunks.push(c));
    dump.stderr.on("data", (c: Buffer) => {
      stderr += c.toString();
    });
    dump.on("error", reject);
    dump.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `mysqldump falhou em ${tab.nomeBanco} (exit=${code}): ${stderr.slice(0, 300)}`,
          ),
        );
        return;
      }
      resolve(Buffer.concat(chunks));
    });
  });
}
