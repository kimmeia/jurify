/**
 * Import de backup do escritório — restaura o estado do escritório a partir
 * de um ZIP gerado por `gerarBackupEscritorioJson`. Operação destrutiva:
 * APAGA todos os dados atuais do escritório antes de inserir.
 *
 * Garantias:
 * - Validação do manifesto: versão suportada (v2) e escritorioId == alvo.
 * - Conexão dedicada do pool mysql2 — necessário pra que
 *   `SET FOREIGN_KEY_CHECKS=0` e a transação fiquem na mesma sessão.
 *   Outras queries no app (de outras conexões do pool) NÃO veem essa flag,
 *   então continuam validando FKs normalmente.
 * - Transação única (BEGIN/COMMIT). Rollback total em qualquer erro.
 * - DELETE em ordem reversa, INSERT em ordem direta. IDs preservados via
 *   INSERT explícito — FKs entre tabelas continuam apontando pro lugar certo.
 * - Self-ref de `cliente_pastas.parentId` resolvida pelo FK_CHECKS=0.
 * - Chunking: INSERT em batches de 500 linhas (pra não estourar
 *   `max_allowed_packet` em tabelas com colunas TEXT longas).
 *
 * Restore admin (banco global) NÃO é feito aqui — é só import escopado num
 * único escritório existente. Tenant target = mesmo escritorioId do backup.
 */
import JSZip from "jszip";
import { getDb } from "../db";
import { ORDEM_TOPOLOGICA, TABELAS_INCLUIR, TABELAS_SATELITE } from "./escritorio-tabelas";
import type { ManifestoBackup } from "./escritorio-backup";

export interface PreviewImport {
  manifesto: ManifestoBackup;
  /**
   * Pra cada tabela: quantas linhas existem hoje no escritório (vão ser
   * apagadas) e quantas vêm no backup (vão ser inseridas).
   */
  tabelas: Array<{
    nome: string;
    vaiApagar: number;
    vaiInserir: number;
  }>;
  totalApagar: number;
  totalInserir: number;
}

const TAMANHO_BATCH_INSERT = 500;

/**
 * Constrói um mapa nomeBanco → metadados (filtroSql / colunaEscritorio)
 * pra DELETE/COUNT por escritório, abrangendo principais + satélites.
 */
function montarMapaTabelas(): Map<
  string,
  { filtroWhere: string; tipo: "principal" | "satelite" }
> {
  const m = new Map<string, { filtroWhere: string; tipo: "principal" | "satelite" }>();
  for (const t of TABELAS_INCLUIR) {
    m.set(t.nomeBanco, {
      filtroWhere: `\`${t.colunaEscritorio}\` = ?`,
      tipo: "principal",
    });
  }
  for (const t of TABELAS_SATELITE) {
    m.set(t.nomeBanco, { filtroWhere: t.filtroSql, tipo: "satelite" });
  }
  return m;
}

/**
 * Lê o manifesto + cada tabelas/<nome>.json do ZIP. Valida estrutura.
 * Não toca no banco.
 */
async function carregarZip(
  zipBuffer: Buffer,
): Promise<{ manifesto: ManifestoBackup; linhasPorTabela: Map<string, Record<string, unknown>[]> }> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(zipBuffer);
  } catch {
    throw new Error("Arquivo enviado não é um ZIP válido.");
  }

  const manifestoFile = zip.file("manifesto.json");
  if (!manifestoFile) {
    throw new Error(
      "ZIP não tem manifesto.json. Pra importar, use um arquivo gerado pela aba Backup deste escritório.",
    );
  }
  let manifesto: ManifestoBackup;
  try {
    manifesto = JSON.parse(await manifestoFile.async("string")) as ManifestoBackup;
  } catch {
    throw new Error("manifesto.json corrompido — JSON inválido.");
  }

  if (manifesto.versao !== 2) {
    throw new Error(
      `Versão do backup (${manifesto.versao}) não é suportada pelo import. Gere um novo backup pela aba Backup e tente novamente.`,
    );
  }

  const linhasPorTabela = new Map<string, Record<string, unknown>[]>();
  const todasTabelas = [
    ...TABELAS_INCLUIR.map((t) => t.nomeBanco),
    ...TABELAS_SATELITE.map((t) => t.nomeBanco),
  ];
  for (const nome of todasTabelas) {
    const f = zip.file(`tabelas/${nome}.json`);
    if (!f) {
      throw new Error(
        `ZIP incompleto: tabelas/${nome}.json faltando. Backup foi gerado por uma versão antiga? Gere um novo.`,
      );
    }
    let linhas: Record<string, unknown>[];
    try {
      linhas = JSON.parse(await f.async("string"));
    } catch {
      throw new Error(`Arquivo tabelas/${nome}.json corrompido — JSON inválido.`);
    }
    if (!Array.isArray(linhas)) {
      throw new Error(`tabelas/${nome}.json não é um array de linhas.`);
    }
    linhasPorTabela.set(nome, linhas);
  }
  return { manifesto, linhasPorTabela };
}

/**
 * Preview SEM tocar no banco — só lê o ZIP e roda COUNT(*) por tabela
 * pra mostrar quantas linhas vão ser apagadas. Usado pro dry-run da UI.
 */
export async function previewImportEscritorio(
  zipBuffer: Buffer,
  escritorioId: number,
): Promise<PreviewImport> {
  const { manifesto, linhasPorTabela } = await carregarZip(zipBuffer);

  if (manifesto.escritorioId !== escritorioId) {
    throw new Error(
      `Backup é do escritório ${manifesto.escritorioId} — só pode ser importado nele. Você está logado no escritório ${escritorioId}.`,
    );
  }

  const db = await getDb();
  if (!db) throw new Error("DB indisponível");
  const conn: any = (db as any).$client ?? db;
  const mapa = montarMapaTabelas();

  const tabelas: PreviewImport["tabelas"] = [];
  let totalApagar = 0;
  let totalInserir = 0;

  for (const nome of ORDEM_TOPOLOGICA) {
    const meta = mapa.get(nome);
    if (!meta) continue;
    const [rows] = (await conn.execute(
      `SELECT COUNT(*) AS c FROM \`${nome}\` WHERE ${meta.filtroWhere}`,
      [escritorioId],
    )) as [Array<{ c: number | bigint }>, unknown];
    const vaiApagar = Number(rows[0]?.c ?? 0);
    const vaiInserir = linhasPorTabela.get(nome)?.length ?? 0;
    tabelas.push({ nome, vaiApagar, vaiInserir });
    totalApagar += vaiApagar;
    totalInserir += vaiInserir;
  }

  return { manifesto, tabelas, totalApagar, totalInserir };
}

/**
 * Executa o import. Conexão dedicada + transação + FK_CHECKS=0.
 * Rollback total em erro. Retorna o relatório da operação.
 */
export async function executarImportEscritorio(
  zipBuffer: Buffer,
  escritorioId: number,
): Promise<PreviewImport> {
  const { manifesto, linhasPorTabela } = await carregarZip(zipBuffer);

  if (manifesto.escritorioId !== escritorioId) {
    throw new Error(
      `Backup é do escritório ${manifesto.escritorioId} — só pode ser importado nele.`,
    );
  }

  const db = await getDb();
  if (!db) throw new Error("DB indisponível");
  const pool: any = (db as any).$client ?? db;
  if (typeof pool.getConnection !== "function") {
    throw new Error(
      "Pool MySQL não expõe getConnection — import precisa de conexão dedicada pra escopo de FK_CHECKS.",
    );
  }

  const mapa = montarMapaTabelas();
  const conn = await pool.getConnection();
  const relatorio: PreviewImport["tabelas"] = [];
  let totalApagar = 0;
  let totalInserir = 0;

  try {
    await conn.query("SET SESSION FOREIGN_KEY_CHECKS = 0");
    await conn.query("START TRANSACTION");

    // 1. DELETE em ordem reversa (folhas antes das raízes).
    for (const nome of [...ORDEM_TOPOLOGICA].reverse()) {
      const meta = mapa.get(nome);
      if (!meta) continue;
      const [res] = (await conn.execute(
        `DELETE FROM \`${nome}\` WHERE ${meta.filtroWhere}`,
        [escritorioId],
      )) as [{ affectedRows: number }, unknown];
      const affected = Number(res?.affectedRows ?? 0);
      relatorio.push({ nome, vaiApagar: affected, vaiInserir: 0 });
      totalApagar += affected;
    }

    // 2. INSERT em ordem direta (raízes antes das folhas), preservando IDs.
    for (const nome of ORDEM_TOPOLOGICA) {
      const linhas = linhasPorTabela.get(nome) ?? [];
      const idx = relatorio.findIndex((r) => r.nome === nome);
      if (linhas.length === 0) {
        if (idx === -1) relatorio.push({ nome, vaiApagar: 0, vaiInserir: 0 });
        continue;
      }
      const colunas = Object.keys(linhas[0]);
      if (colunas.length === 0) continue;

      const colunasEsc = colunas.map((c) => `\`${c}\``).join(",");
      const placeholderLinha = `(${colunas.map(() => "?").join(",")})`;

      // Chunking pra evitar estouro de max_allowed_packet (default 64MB).
      // Tabelas como `mensagens` têm colunas TEXT longas.
      for (let i = 0; i < linhas.length; i += TAMANHO_BATCH_INSERT) {
        const lote = linhas.slice(i, i + TAMANHO_BATCH_INSERT);
        const placeholders = lote.map(() => placeholderLinha).join(",");
        const valores = lote.flatMap((l) => colunas.map((c) => l[c] ?? null));
        await conn.execute(
          `INSERT INTO \`${nome}\` (${colunasEsc}) VALUES ${placeholders}`,
          valores,
        );
      }
      if (idx >= 0) relatorio[idx].vaiInserir = linhas.length;
      else relatorio.push({ nome, vaiApagar: 0, vaiInserir: linhas.length });
      totalInserir += linhas.length;
    }

    await conn.query("COMMIT");
  } catch (err) {
    await conn.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    await conn.query("SET SESSION FOREIGN_KEY_CHECKS = 1").catch(() => {});
    conn.release();
  }

  return { manifesto, tabelas: relatorio, totalApagar, totalInserir };
}
