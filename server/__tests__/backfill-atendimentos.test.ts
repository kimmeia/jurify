/**
 * Travas do backfill do histórico.
 *
 * Ele grava em massa numa tabela sem UNIQUE que barre duplicata, e quem aperta
 * o botão não tem como conferir o resultado linha a linha. As garantias que
 * tornam isso aceitável são estruturais, não de revisão — e é o que estes
 * testes prendem.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

const backfill = ler("server/atendimento/backfill.ts");
const script = ler("scripts/backfill-atendimentos.ts");
const router = ler("server/admin/router-admin-manutencao.ts");
const tela = ler("client/src/pages/admin/AdminManutencao.tsx");

describe("a régua não pode existir em dois lugares", () => {
  it("o script delega pro módulo em vez de reconstruir por conta", () => {
    // Duas reconstruções diferentes produziriam relatórios diferentes do mesmo
    // mês, dependendo de por onde o backfill foi rodado.
    expect(script).toContain('from "../server/atendimento/backfill"');
    expect(script).not.toContain("dividirEmEpisodios");
    expect(script).not.toContain("drizzle/schema");
  });

  it("o botão do painel chama a mesma função do script", () => {
    expect(router).toContain('from "../atendimento/backfill"');
    expect(router).toContain("reconstruirEpisodios");
  });

  it("o corte em episódios vem de shared/, junto com a regra do runtime", () => {
    expect(backfill).toContain('from "../../shared/atendimento-episodio"');
    expect(backfill).toContain("dividirEmEpisodios");
  });
});

describe("rodar de novo não pode duplicar", () => {
  it("só percorre conversa que ainda não tem episódio", () => {
    // É a única proteção contra duplicata: a tabela não tem UNIQUE. Sem este
    // filtro, apertar o botão duas vezes dobraria o histórico inteiro.
    expect(backfill).toContain("notExists");
    expect(backfill).toContain("aindaSemEpisodio");
  });

  it("pagina por cursor de id, não por OFFSET", () => {
    // Na simulação nada é gravado, então a janela do "ainda sem episódio" não
    // anda: com OFFSET a segunda página devolveria as mesmas linhas.
    expect(backfill).toContain("gt(conversas.id, cursor)");
    expect(backfill).not.toMatch(/\.offset\(/);
  });
});

describe("o começo perdido das conversas ativas", () => {
  it("candidata é a conversa cuja primeira mensagem antecede o primeiro episódio", () => {
    // Conversa que recebeu mensagem depois do deploy ganhou episódio ao vivo
    // começando naquele instante; a primeira fase pula ela pra não duplicar, e
    // o passado dela nunca seria olhado.
    expect(backfill).toContain("MIN(m.createdAtMsg) < MIN(a.abertoEmAtd)");
  });

  it("a correção se apaga sozinha na passada seguinte", () => {
    // Recuperado o começo, as duas datas coincidem e o HAVING deixa de casar.
    // Sem isso, cada clique repetiria o trabalho e empilharia episódios.
    expect(backfill).toContain("HAVING");
    expect(backfill).toMatch(/deixa de ser candidata|não volta na próxima passada/);
  });

  it("mexe só no episódio mais antigo da conversa", () => {
    // Os posteriores são do caminho ao vivo e estão corretos.
    expect(backfill).toContain("orderBy(asc(atendimentos.abertoEm), asc(atendimentos.id))");
  });

  it("sem correspondência entre episódio e mensagens, não mexe", () => {
    expect(backfill).toContain("if (k < 0) continue;");
  });

  it("a segunda fase só começa depois de a primeira acabar", () => {
    // Rodar as duas ao mesmo tempo faria a segunda ver como "sem começo"
    // conversas que a primeira ainda nem tinha chegado a reconstruir.
    expect(backfill).toContain("res.restantes === 0 && Date.now() - inicio <= orcamento");
  });

  it("o botão continua clicável com a primeira fase em 100%", () => {
    // A segunda fase roda depois da primeira: travar o botão ao chegar em 100%
    // deixaria essa parte inalcançável pela tela.
    expect(tela).toContain("const podeRodar =");
    expect(tela).not.toMatch(/disabled=\{rodando \|\| !pendente\}/);
  });
});

describe("o que conta como atendimento", () => {
  it("mensagem de sistema não vira primeira resposta", () => {
    // Transferência grava mensagem de sistema. Contá-la como resposta faria o
    // tempo de 1ª resposta virar "tempo até alguém repassar a conversa".
    expect(backfill).toContain('m.tipo === "sistema"');
  });

  it("saída é o que marca mensagem da equipe", () => {
    expect(backfill).toContain('m.direcao === "saida"');
  });
});

describe("quem pode apertar", () => {
  it("as duas mutations são de admin", () => {
    const mutations = router.match(/\w+:\s*\w+Procedure\.mutation/g) ?? [];
    expect(mutations.length).toBe(2);
    expect(mutations.every((m) => m.includes("adminProcedure"))).toBe(true);
  });
});

describe("a tela", () => {
  it("confirma a gravação com AlertDialog, não com confirm() do browser", () => {
    expect(tela).toContain("AlertDialog");
    expect(tela).not.toMatch(/(?<![.\w])confirm\(/);
  });

  it("oferece simular antes de aplicar", () => {
    expect(tela).toContain("simularEpisodios");
    expect(tela).toContain("Simular");
  });
});
