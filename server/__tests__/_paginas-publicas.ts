/**
 * Quem é "página pública" — derivado do App.tsx, não listado à mão.
 *
 * Lista fixa envelhece calada: rota pública nova entra sem ninguém lembrar
 * de acrescentar o arquivo, e as amarras que dependem dela ficam verdes por
 * não terem olhado. Aqui a fonte da verdade é o <Switch>: rota que não passa
 * por nenhuma guarda de sessão é rota que estranho abre.
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";

export const raiz = join(__dirname, "..", "..");
export const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

/** Componentes que só renderizam com sessão — rota que passa por eles é privada. */
const GUARDAS = [
  "ClientArea",
  "ClientAreaNoGuard",
  "AdminArea",
  "AppLayout",
  "AdminLayout",
  "SubscriptionGuard",
  "ModuloGuard",
];

/**
 * Telas montadas fora do AdminLayout que fazem o gate por dentro (Redirect
 * quando `user.role !== "admin"`). Não são públicas. O teste-âncora em
 * pagina-publica-url-autenticada.test.ts confere que o gate continua lá — se
 * alguém tirar, a tela volta pra varredura.
 */
export const GATE_PROPRIO = ["client/src/pages/admin/AdminPlanoEditor.tsx"];

function resolverArquivo(spec: string): string | null {
  if (!spec.startsWith("./") && !spec.startsWith("@/")) return null;
  const base = join(raiz, "client/src", spec.slice(2));
  for (const ext of [".tsx", ".ts", "/index.tsx"]) {
    if (existsSync(base + ext)) return (base + ext).slice(raiz.length + 1);
  }
  return null;
}

export function paginasPublicas(): string[] {
  const app = ler("client/src/App.tsx");
  const imports = new Map<string, string>();
  for (const i of app.matchAll(/^import\s+(\w+)\s+from\s+["'](.+?)["'];?$/gm)) {
    imports.set(i[1], i[2]);
  }
  const corpo = app.slice(app.indexOf("<Switch>"), app.indexOf("</Switch>"));

  const achados = new Set<string>();
  for (const bloco of corpo.matchAll(/<Route\b[\s\S]*?(?:\/>|<\/Route>)/g)) {
    const texto = bloco[0];
    if (GUARDAS.some((g) => texto.includes(`<${g}`))) continue;
    for (const c of texto.matchAll(/component=\{(\w+)\}|<([A-Z]\w*)\b/g)) {
      const nome = c[1] || c[2];
      if (nome === "Route" || nome === "Redirect") continue;
      const spec = imports.get(nome);
      const arquivo = spec ? resolverArquivo(spec) : null;
      if (arquivo && !GATE_PROPRIO.includes(arquivo)) achados.add(arquivo);
    }
  }
  return [...achados].sort();
}

export function semComentarios(fonte: string): string {
  return fonte
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
}
