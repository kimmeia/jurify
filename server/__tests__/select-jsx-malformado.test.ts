/**
 * Varredura textual atrás de <Select> malformado nos .tsx do client.
 *
 * Existe por causa de um bug real que chegou em produção: o editor de "está no
 * dia e horário" do SmartFlow foi inserido DENTRO do <SelectContent>, junto com
 * as opções do dropdown. Resultado — os campos de hora e os botões de dia só
 * existiam com o menu aberto, e o dono não conseguia configurar nada. Todo
 * fluxo criado ficou com a janela padrão, a condição passou a casar sempre, e
 * os leads foram distribuídos pro time errado.
 *
 * Nada pegou isso: `tsc` valida tipos, não posição de JSX; o zod do save é
 * `z.record(z.any())`; e os 3542 testes eram todos de servidor.
 *
 * A varredura é grosseira de propósito — mesma escolha do guard de hooks. Cobre
 * as duas formas que esse estrago assume e mais nada.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { globSync } from "node:fs";

const RAIZ = join(__dirname, "..", "..", "client", "src");

function arquivosTsx(): string[] {
  return globSync("**/*.tsx", { cwd: RAIZ }).map((f) => join(RAIZ, f));
}

/**
 * Blocos <SelectContent> … </SelectContent>, recortados por ÍNDICE e não por
 * linha. O arquivo do Atendimento tem diálogos inteiros numa única linha, com
 * campos de formulário antes do Select — recortando por linha, esses campos
 * caíam dentro do bloco e viravam falso positivo.
 */
function blocosSelectContent(fonte: string): Array<{ linha: number; corpo: string }> {
  const blocos: Array<{ linha: number; corpo: string }> = [];
  const ABRE = "<SelectContent";
  const FECHA = "</SelectContent>";
  let cursor = 0;
  while (true) {
    const inicio = fonte.indexOf(ABRE, cursor);
    if (inicio === -1) break;
    // Aninhamento: conta aberturas antes de aceitar o fechamento.
    let profundidade = 1;
    let i = inicio + ABRE.length;
    let fim = -1;
    while (i < fonte.length) {
      const proxAbre = fonte.indexOf(ABRE, i);
      const proxFecha = fonte.indexOf(FECHA, i);
      if (proxFecha === -1) break;
      if (proxAbre !== -1 && proxAbre < proxFecha) {
        profundidade++;
        i = proxAbre + ABRE.length;
        continue;
      }
      profundidade--;
      i = proxFecha + FECHA.length;
      if (profundidade === 0) { fim = i; break; }
    }
    if (fim === -1) break;
    blocos.push({
      linha: fonte.slice(0, inicio).split("\n").length,
      corpo: fonte.slice(inicio, fim),
    });
    cursor = fim;
  }
  return blocos;
}

describe("nenhum controle interativo dentro de <SelectContent>", () => {
  /**
   * O conteúdo de um Select é lista de opções. Input, textarea ou botão ali
   * dentro é bloco enfiado no lugar errado: o Radix trata os filhos como itens
   * navegáveis por teclado, então o controle nem recebe digitação — e, fora do
   * menu aberto, ele simplesmente não existe na tela.
   */
  it("não há <Input>, <Textarea> ou <button> dentro do dropdown", () => {
    const ofensas: string[] = [];
    for (const arquivo of arquivosTsx()) {
      const fonte = readFileSync(arquivo, "utf-8");
      if (!fonte.includes("<SelectContent")) continue;
      for (const bloco of blocosSelectContent(fonte)) {
        for (const tag of ["<Input", "<Textarea", "<button", "<input", "<textarea"]) {
          if (bloco.corpo.includes(tag)) {
            ofensas.push(
              `${arquivo.replace(RAIZ, "client/src")}:${bloco.linha} — ${tag} dentro de <SelectContent>`,
            );
          }
        }
      }
    }
    expect(ofensas, ofensas.join("\n")).toEqual([]);
  });
});

describe("opção de Select que depende de si mesma pra aparecer", () => {
  /**
   * `{x.operador === "abc" && <SelectItem value="abc">}` só mostra a opção
   * quando ela JÁ está escolhida — ou seja, nunca dá pra escolher.
   *
   * O padrão tem um uso legítimo: manter na lista um valor APOSENTADO, pra que
   * um registro antigo continue exibindo o rótulo certo em vez de abrir com o
   * seletor em branco. Por isso a exceção é explícita — a linha precisa dizer
   * "· antigo" no rótulo, o que obriga quem escreve a declarar a intenção.
   */
  it("toda opção condicionada ao próprio valor está marcada como antiga", () => {
    const padrao = /===\s*["']([a-z_]+)["']\s*&&[\s\S]{0,120}?<SelectItem\s+value=["']\1["'][^>]*>([^<]*)</g;
    const ofensas: string[] = [];
    for (const arquivo of arquivosTsx()) {
      const fonte = readFileSync(arquivo, "utf-8");
      if (!fonte.includes("<SelectItem")) continue;
      for (const m of fonte.matchAll(padrao)) {
        const rotulo = (m[2] || "").trim();
        if (!rotulo.includes("· antigo")) {
          const linha = fonte.slice(0, m.index).split("\n").length;
          ofensas.push(
            `${arquivo.replace(RAIZ, "client/src")}:${linha} — opção "${m[1]}" só aparece quando já está selecionada; ` +
              `se for valor aposentado, marque o rótulo com "· antigo", senão ninguém consegue escolher`,
          );
        }
      }
    }
    expect(ofensas, ofensas.join("\n")).toEqual([]);
  });
});
