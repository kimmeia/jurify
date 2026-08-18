/**
 * Sondas novas do robô auditor.
 *
 * O dono autorizou usar o robô pra olhar o banco de produção. Ele não é um
 * console de SQL — é um catálogo de invariantes que roda read-only e mostra
 * as linhas que violam cada afirmação. Então "consultar o banco" aqui é
 * escrever a pergunta como invariante e deixar a varredura responder.
 *
 * Estas cinco fecham perguntas que ficaram abertas nesta sessão:
 *
 *   AGD-01  o `responsavelId` que passou a ser aceito nos formulários está
 *           apontando pra gente do escritório certo?
 *   AGD-02  o par de datas novo nasceu invertido em algum lugar?
 *   AGD-03  algum escritório já passou do teto da lista da Agenda — que é a
 *           condição em que ela esconde evento sem avisar?
 *   MOV-01  quantas movimentações ainda afirmam "não tem documento" com o
 *           número da peça escrito no próprio rótulo?
 *   KAN-02  quais cards apagados deixaram rastro no histórico do Kanban?
 */

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { REGRAS } from "../admin/auditoria/regras";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

const regrasSrc = ler("server/admin/auditoria/regras.ts");
const routerAgenda = ler("server/escritorio/router-agenda.ts");
const painel = ler("client/src/pages/admin/AdminRoboAuditor.tsx");

const buscar = (id: string) => {
  const r = REGRAS.find((x) => x.id === id);
  expect(r, `regra ${id} não existe`).toBeDefined();
  return r!;
};

describe("as cinco sondas entraram no catálogo", () => {
  it("com domínio e severidade coerentes com o que investigam", () => {
    expect(buscar("AGD-01").dominio).toBe("multi_tenant");
    expect(buscar("AGD-01").severidade).toBe("critico");
    expect(buscar("AGD-02").dominio).toBe("agenda");
    expect(buscar("AGD-03").dominio).toBe("observabilidade");
    expect(buscar("MOV-01").dominio).toBe("motor");
    expect(buscar("KAN-02").dominio).toBe("kanban");
  });

  it("nenhuma se autoriza a corrigir nada", () => {
    // Sonda que escreve deixa de ser sonda. As cinco entram em shadow como
    // qualquer regra, e nenhuma é nível A.
    for (const id of ["AGD-01", "AGD-02", "AGD-03", "MOV-01", "KAN-02"]) {
      expect(buscar(id).shadow, id).toBe(true);
      expect(buscar(id).nivel, id).not.toBe("A");
    }
  });

  it("o painel sabe rotular o domínio novo", () => {
    // Domínio sem rótulo cai no fallback e aparece como "agenda" minúsculo
    // no meio de nomes próprios.
    expect(painel).toContain('agenda: "Agenda"');
  });
});

describe("o teto da AGD-03 é o teto de verdade", () => {
  it("bate com o corte aplicado em agenda.listar", () => {
    // Se um mudar e o outro não, a regra passa a relatar um limite que não
    // existe — e some justamente o alarme que ela deveria dar.
    const noRouter = routerAgenda.match(/const TETO_LADO = (\d+);/);
    const naRegra = regrasSrc.match(/const TETO_LISTA_AGENDA = (\d+);/);
    expect(noRouter, "TETO_LADO sumiu do router").not.toBeNull();
    expect(naRegra, "TETO_LISTA_AGENDA sumiu da regra").not.toBeNull();
    expect(naRegra![1]).toBe(noRouter![1]);
  });
});

describe("MOV-01 pergunta o que dá pra responder", () => {
  it("usa o mesmo leitor de rótulo que o cron usa pra gravar", () => {
    // Se a regra tivesse regex própria, ela mediria a si mesma em vez de
    // medir o que o cron faz.
    expect(regrasSrc).toContain('import { lerDocumentoNoRotulo } from "../../../shared/documento-no-rotulo"');
    expect(regrasSrc).toContain("const doc = lerDocumentoNoRotulo(c.conteudo)");
  });

  it("estreita no SQL e julga no parser", () => {
    // REGEXP sozinho casaria data e número de folha; o parser sozinho teria
    // que varrer a tabela inteira em JS.
    expect(regrasSrc).toContain("REGEXP '[0-9]{6,12}'");
    expect(regrasSrc).toContain("limite * FOLGA_CANDIDATOS");
  });

  it("mostra o mais recente primeiro", () => {
    // Achado recente = a leitura está falhando agora. Achado só em linha
    // velha = acervo de antes da correção. A ordem é o que separa os dois.
    expect(regrasSrc).toContain("orderBy(desc(eventosProcesso.dataEvento))");
  });

  it("mostra se o id já foi gravado no evento", () => {
    expect(regrasSrc).toContain("jaGravado: c.documentoIdTribunal");
  });
});

describe("KAN-02 preserva a evidência", () => {
  it("não propõe apagar o histórico órfão", () => {
    // O rastro é a única prova de que aqueles cards existiram. Apagar é
    // destruir a evidência do próprio incidente.
    const r = buscar("KAN-02");
    expect(r.nivel).toBe("C");
    expect(r.correcaoPrevista).toContain("Nenhuma automática");
  });

  it("agrupa por card, não lista movimento a movimento", () => {
    // 70 cards apagados com 5 movimentos cada dariam 350 linhas de ruído
    // pra 70 fatos.
    expect(regrasSrc).toContain("groupBy(kanbanMovimentacoes.cardId)");
  });
});
