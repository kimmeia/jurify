/**
 * O robô clica no link do PROCESSO, não no botão "Ações".
 *
 * O caso real: o dono reportou "O processo apareceu na busca, mas a página
 * dele não abriu". O clique era `locator("a, b, c").first()`, que devolve o
 * primeiro do HTML — não o primeiro da lista de preferências. Bastava o botão
 * "Ações" vir antes na linha pra o robô abrir um menu e nunca o processo. E
 * os ids do RichFaces citados no seletor (`j_id492`) são gerados pelo JSF:
 * mudam quando o tribunal republica o portal, que é o "funcionava e parou".
 *
 * A escolha passou a ser pelo NÚMERO escrito no link. E quando mesmo assim a
 * página não abre, a consulta responde com a lista do tribunal (que o robô já
 * leu) em vez de devolver erro.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = join(__dirname, "../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf8");
const adapter = ler("scripts/spike-motor-proprio/poc-2-esaj-login/adapters/pje-tjce.ts");
const capaLista = ler("server/processos/capa-da-lista.ts");

describe("abrir a página do processo", () => {
  it("o link é escolhido pelo número do processo, não pela ordem no HTML", () => {
    expect(adapter).toContain("private async marcarLinkDoProcesso(");
    // dígitos do link × dígitos do CNJ pedido
    expect(adapter).toMatch(/digitos\(a\.textContent\)\.includes\(cnj\)/);
  });

  it("o botão «Ações» nunca é o escolhido", () => {
    expect(adapter).toMatch(/const ehAcoes =/);
    expect(adapter).toMatch(/porNumero \?\? porClasse \?\? links\.find\(\(a\) => !ehAcoes\(a\)\)/);
  });

  it("o clique mira o link marcado, e a marcação é refeita a cada tentativa", () => {
    const i = adapter.indexOf("for (let tentativa = 1");
    expect(i, "o laço de tentativas sumiu").toBeGreaterThan(-1);
    const laco = adapter.slice(i, i + 1600);
    expect(laco).toContain("marcarLinkDoProcesso(pageBusca, cnjLimpo)");
    expect(laco).toContain("SELETOR_LINK_MARCADO");
    // sem link marcado, o comportamento é o de antes — nada regride
    expect(laco).toContain(": seletorLinkResultado");
  });

  it("a lista do tribunal vira capa de verdade, com o que ela NÃO tem em branco", () => {
    expect(capaLista).toContain("export function capaDaListaComoCapa(");
    const i = capaLista.indexOf("export function capaDaListaComoCapa(");
    const corpo = capaLista.slice(i, i + 900);
    for (const campo of ["juiz: null", "comarca: null", "status: null"]) {
      expect(corpo, `${campo} — a lista não traz isso e não pode ser chutado`).toContain(campo);
    }
    expect(corpo).toContain('tipo: "desconhecido" as const');
    expect(corpo).toContain("advogados: []");
  });
});
