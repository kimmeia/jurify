/**
 * Migra modelos de contrato legados (placeholders `{{N}}`) pra novo
 * formato com placeholders nomeados (`{{nome completo}}`).
 *
 * Pra cada modelo no banco que ainda tem placeholders numéricos:
 *   1. Lê o DOCX do disco
 *   2. Pra cada placeholder no JSON `placeholders`:
 *      - Se `tipo=variavel` com `variavel=cliente.nome`: novo nome =
 *        label do catálogo ("Nome completo")
 *      - Se `tipo=manual` com `label=Valor da causa`: novo nome =
 *        label definido pelo user
 *   3. Substitui `{{N}}` no `word/document.xml` pelo novo nome
 *   4. Re-empacota DOCX, sobrescreve no disco
 *   5. Atualiza JSON `placeholders` pra incluir o campo `nome`
 *
 * Idempotente: skipa modelos já migrados (sem placeholders numéricos
 * no JSON).
 *
 * Conflito de nome (2 placeholders com mesmo label): sufixa com (2),
 * (3) etc. — usuário pode ajustar via UI depois.
 *
 * Uso:
 *   pnpm tsx scripts/migrate-modelos-placeholders.ts [--dry-run] [--escritorio=ID]
 *
 * Flags:
 *   --dry-run         simula sem escrever no DB ou no disco
 *   --escritorio=ID   migra só modelos desse escritório
 */

import "dotenv/config";
import path from "node:path";
import fs from "node:fs";
import PizZip from "pizzip";
import { eq } from "drizzle-orm";
import { getDb } from "../server/db";
import { modelosContrato } from "../drizzle/schema";
import { CATALOGO_BASE } from "../shared/modelos-contrato-variaveis";

interface PlaceholderLegado {
  numero?: number;
  nome?: string;
  tipo: "variavel" | "manual";
  variavel?: string;
  label?: string;
  dica?: string;
}

const UPLOAD_DIR = path.resolve("./uploads/modelos-contrato");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const escritorioFiltro = (() => {
  const arg = args.find((a) => a.startsWith("--escritorio="));
  return arg ? Number(arg.split("=")[1]) : null;
})();

function labelDoCatalogo(variavelPath: string): string | null {
  const v = CATALOGO_BASE.find((x) => x.path === variavelPath);
  return v?.label ?? null;
}

function uniqSuffix(usados: Set<string>, base: string): string {
  if (!usados.has(base)) {
    usados.add(base);
    return base;
  }
  for (let i = 2; i < 100; i++) {
    const candidato = `${base} (${i})`;
    if (!usados.has(candidato)) {
      usados.add(candidato);
      return candidato;
    }
  }
  // Fallback improvável
  const fallback = `${base} (${Date.now()})`;
  usados.add(fallback);
  return fallback;
}

async function main() {
  const db = await getDb();
  if (!db) {
    console.error("DB indisponível");
    process.exit(1);
  }

  const rows = await db.select().from(modelosContrato);
  const modelos = escritorioFiltro
    ? rows.filter((m) => m.escritorioId === escritorioFiltro)
    : rows;

  console.log(
    `[migrate-modelos] ${modelos.length} modelo(s) candidatos${
      escritorioFiltro ? ` (escritório ${escritorioFiltro})` : ""
    }${dryRun ? " — DRY RUN" : ""}`,
  );

  let migrados = 0;
  let skipped = 0;
  let falhas = 0;

  for (const m of modelos) {
    let placeholders: PlaceholderLegado[];
    try {
      placeholders = JSON.parse(m.placeholders);
    } catch {
      console.warn(`  [skip] modelo ${m.id}: JSON placeholders inválido`);
      skipped++;
      continue;
    }

    // Skipa se TODOS placeholders já têm `nome` (já migrado)
    const todosTemNome = placeholders.every((p) => typeof p.nome === "string" && p.nome.length > 0);
    if (todosTemNome) {
      skipped++;
      continue;
    }

    // Constrói mapeamento numero → novo nome amigável
    const usados = new Set<string>();
    const mapeamento = new Map<number, string>();
    const novosPlaceholders: PlaceholderLegado[] = [];

    for (const p of placeholders) {
      if (p.numero == null) {
        // Sem número e sem nome — descarta com warning
        console.warn(`  [skip] modelo ${m.id}: placeholder sem numero nem nome`);
        continue;
      }

      let baseNome: string;
      if (p.tipo === "variavel" && p.variavel) {
        baseNome = labelDoCatalogo(p.variavel) ?? p.variavel;
      } else if (p.tipo === "manual" && p.label) {
        baseNome = p.label;
      } else {
        baseNome = `Campo ${p.numero}`;
      }

      const novoNome = uniqSuffix(usados, baseNome);
      mapeamento.set(p.numero, novoNome);
      novosPlaceholders.push({
        ...p,
        nome: novoNome,
      });
    }

    if (mapeamento.size === 0) {
      console.warn(`  [skip] modelo ${m.id}: sem placeholders pra migrar`);
      skipped++;
      continue;
    }

    // Reescreve o DOCX: substitui {{N}} → {{novo nome}} no XML
    const arquivoUrl = m.arquivoUrl.replace("/uploads/modelos-contrato/", "");
    const filePath = path.join(UPLOAD_DIR, arquivoUrl);

    if (!fs.existsSync(filePath)) {
      console.warn(
        `  [skip] modelo ${m.id}: arquivo não encontrado em ${filePath}`,
      );
      skipped++;
      continue;
    }

    try {
      const buffer = fs.readFileSync(filePath);
      const zip = new PizZip(buffer);
      const docFile = zip.file("word/document.xml");
      if (!docFile) throw new Error("word/document.xml ausente");
      let xml = docFile.asText();

      // Substitui cada {{N}} pelo novo nome. Usa regex com captura
      // do número, e olha no mapeamento. Preserva espaços em volta.
      xml = xml.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, numStr) => {
        const num = Number(numStr);
        const novo = mapeamento.get(num);
        return novo ? `{{${novo}}}` : `{{${num}}}`;
      });

      zip.file("word/document.xml", xml);
      const buffOut = zip.generate({ type: "nodebuffer", compression: "DEFLATE" });

      if (dryRun) {
        console.log(
          `  [dry] modelo ${m.id} (${m.nome}): ${mapeamento.size} placeholder(s) seriam renomeados`,
        );
        for (const [num, nome] of mapeamento) {
          console.log(`        {{${num}}} → {{${nome}}}`);
        }
      } else {
        fs.writeFileSync(filePath, buffOut);
        await db
          .update(modelosContrato)
          .set({ placeholders: JSON.stringify(novosPlaceholders) })
          .where(eq(modelosContrato.id, m.id));
        console.log(
          `  [ok] modelo ${m.id} (${m.nome}): ${mapeamento.size} placeholder(s) migrado(s)`,
        );
      }
      migrados++;
    } catch (err) {
      console.error(
        `  [fail] modelo ${m.id} (${m.nome}):`,
        err instanceof Error ? err.message : String(err),
      );
      falhas++;
    }
  }

  console.log(
    `\n[migrate-modelos] resumo: ${migrados} migrado(s), ${skipped} skipped, ${falhas} falha(s)${
      dryRun ? " (DRY RUN — nada escrito)" : ""
    }`,
  );
  process.exit(falhas > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[migrate-modelos] erro fatal:", err);
  process.exit(1);
});
