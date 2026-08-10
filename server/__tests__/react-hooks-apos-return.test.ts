/**
 * Trava contra o React #310 — "renderizou mais hooks que no render anterior".
 *
 * Aconteceu de verdade: um `useEffect` foi parar depois do `return` antecipado
 * do estado de carregando no editor do SmartFlow. Enquanto a query carregava,
 * o componente devolvia o spinner e o hook não era chamado; quando os dados
 * chegavam, ele passava a ser — e a contagem de hooks mudava entre renders.
 * A tela quebrava em produção com erro minificado.
 *
 * `tsc` não pega isso (não é erro de tipo) e o projeto não tem ESLint, então
 * o `eslint-plugin-react-hooks`, que é a ferramenta certa, não está no
 * caminho. Este teste cobre o caso específico que nos mordeu, de graça e sem
 * dependência nova.
 *
 * A heurística é deliberadamente conservadora e casa com o estilo da casa
 * (indentação de 2 espaços no corpo do componente): procura um bloco
 * `  if (…) { … return … }` no topo de uma função-componente e depois dele
 * qualquer chamada de hook no mesmo nível. Prefere deixar passar um caso
 * exótico a acusar em cima de código correto — teste que grita à toa vira
 * teste que ninguém lê.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const RAIZ = join(__dirname, "..", "..", "client", "src");

function arquivosTsx(dir: string): string[] {
  const saida: string[] = [];
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) saida.push(...arquivosTsx(caminho));
    else if (nome.endsWith(".tsx")) saida.push(caminho);
  }
  return saida;
}

/**
 * Início de componente. Precisa cobrir as três formas usadas no projeto —
 * `function X(`, `export function X(` e `export default function X(` — porque
 * uma forma não reconhecida faz o scanner colar dois componentes num só e
 * acusar hook de um como se fosse continuação do outro.
 */
const INICIO_COMPONENTE = /^export default function [A-Z]|^export function [A-Z]|^function [A-Z]|^(export )?const [A-Z]\w* = (\(|function|memo\(|forwardRef\()/;
const ABRE_IF = /^ {2}if \(/;
const FECHA_BLOCO = /^ {2}\}\s*$/;
const RETURN_INTERNO = /^ {4}return\b/m;
const CHAMADA_HOOK =
  /^ {2}(?:const .*=\s*)?use(?:State|Effect|LayoutEffect|Memo|Ref|Callback|Context|Reducer|ReactFlow)\s*\(/;

export interface HookForaDeOrdem {
  arquivo: string;
  componente: string;
  linhaHook: number;
  trecho: string;
}

function varrer(caminho: string): HookForaDeOrdem[] {
  const linhas = readFileSync(caminho, "utf-8").split("\n");
  const inicios: number[] = [];
  linhas.forEach((l, i) => {
    if (INICIO_COMPONENTE.test(l)) inicios.push(i);
  });
  inicios.push(linhas.length);

  const achados: HookForaDeOrdem[] = [];
  for (let k = 0; k < inicios.length - 1; k++) {
    const ini = inicios[k];
    const fim = inicios[k + 1];
    const componente = linhas[ini].trim().slice(0, 60);

    let j = ini;
    while (j < fim) {
      if (ABRE_IF.test(linhas[j])) {
        let f = j;
        while (f < fim && !FECHA_BLOCO.test(linhas[f])) f++;
        const bloco = linhas.slice(j, f).join("\n");
        // Só interessa o `if` que SAI do componente — os outros não mudam a
        // contagem de hooks.
        if (RETURN_INTERNO.test(bloco)) {
          for (let m = f + 1; m < fim; m++) {
            if (CHAMADA_HOOK.test(linhas[m])) {
              achados.push({
                arquivo: caminho.slice(caminho.indexOf("client/")),
                componente,
                linhaHook: m + 1,
                trecho: linhas[m].trim().slice(0, 80),
              });
              break;
            }
          }
        }
        j = f;
      }
      j++;
    }
  }
  return achados;
}

describe("hooks depois de return antecipado (React #310)", () => {
  it("nenhum componente do client chama hook depois de sair mais cedo", () => {
    const achados = arquivosTsx(RAIZ).flatMap(varrer);
    const relatorio = achados
      .map((a) => `${a.arquivo}:${a.linhaHook} — em ${a.componente}\n    ${a.trecho}`)
      .join("\n");
    expect(relatorio).toBe("");
  });

  it("a varredura de fato olha o editor do SmartFlow", () => {
    // Sem esta âncora, um erro de caminho faria o teste acima passar varrendo
    // zero arquivo — verde por não ter olhado nada.
    const arquivos = arquivosTsx(RAIZ);
    expect(arquivos.length).toBeGreaterThan(50);
    expect(arquivos.some((a) => a.endsWith("SmartFlowEditor.tsx"))).toBe(true);
  });
});
