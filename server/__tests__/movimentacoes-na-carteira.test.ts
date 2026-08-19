/**
 * Movimentações dentro de Processos — a reestruturação aprovada no mockup
 * de 19/08, junto com a correção do "99 fantasma": o badge do menu contava
 * 30 dias e a tela abria em 7, então o menu gritava 99 com a tela jurando
 * "nada pendente". Cada um estava certo no seu período — o usuário via uma
 * contradição.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

describe("menu lateral", () => {
  const layout = ler("client/src/components/AppLayout.tsx");

  it("Movimentações saiu como item — virou aba de Processos", () => {
    expect(layout).not.toContain('id: "movimentacoes"');
    expect(layout).not.toContain('rota: "/movimentacoes"');
  });

  it("o contador de não lidas migrou pro item Processos", () => {
    // Sem isso o número sumia do menu junto com o item — e o contador é o
    // que puxa a pessoa pra dentro quando o tribunal publica algo.
    expect(layout).toContain("processos: contMovs?.naoLidas ?? 0");
    expect(layout).not.toContain("movimentacoes: contMovs?.naoLidas");
  });
});

describe("página Processos", () => {
  const processos = ler("client/src/pages/Processos.tsx");

  it("a central é a primeira aba e a default", () => {
    expect(processos).toContain('value="central"');
    expect(processos).toContain("<MovimentacoesCentral />");
    expect(processos).toContain('return "central";');
  });

  it("a aba Consultar saiu; a consulta avulsa virou modal do cabeçalho", () => {
    expect(processos).not.toContain('value="consultar"');
    expect(processos).toContain("Consultar CNJ");
    expect(processos).toContain("<ConsultarTab />");
  });

  it("deep-links antigos continuam válidos", () => {
    // `?tab=movimentacoes` sempre foi o Monitoramento (vínculo de cliente,
    // abrirMonitor) — renomear o valor quebraria links já enviados.
    expect(processos).toContain('t === "movimentacoes"');
    expect(processos).toContain('sp.get("abrirMonitor") === "1"');
  });
});

describe("rota antiga /movimentacoes", () => {
  it("segue válida, servida pela página Processos", () => {
    const app = ler("client/src/App.tsx");
    const rota = app.slice(app.indexOf('path="/movimentacoes"'));
    expect(rota.slice(0, 200)).toContain("<Processos />");
  });
});

describe("o 99 fantasma — menu e tela contam a mesma coisa", () => {
  it("o contador serve as duas janelas de uma vez", () => {
    const router = ler("server/processos/router-movimentacoes.ts");
    expect(router).toContain("naoLidasSemana");
    expect(router).toContain("contarMovimentacoesNaoLidas(perm.escritorioId, 7)");
  });

  it("a função aceita a janela como parâmetro", () => {
    const contador = ler("server/processos/contador-movimentacoes.ts");
    expect(contador).toContain("dias: number = DIAS_JANELA_MOVIMENTACOES");
  });

  it("a central abre na mesma janela do badge do menu (30 dias)", () => {
    const central = ler("client/src/pages/Movimentacoes.tsx");
    expect(central).toContain("useState(30)");
    // E mostra a contagem em cada opção de período — a contradição visual
    // ("menu 99, tela vazia") deixa de ser possível.
    expect(central).toContain("naoLidasSemana");
    expect(central).toContain("contadorMenu?.naoLidas");
  });

  it("resolver movimentação derruba o contador do menu junto", () => {
    const central = ler("client/src/pages/Movimentacoes.tsx");
    expect(central).toContain("utils.movimentacoes.contador.invalidate()");
  });
});
