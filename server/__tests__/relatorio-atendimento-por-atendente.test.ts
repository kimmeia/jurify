/**
 * Pacote aprovado no mockup de 21/08: relatório de Atendimento com quadro
 * operacional por atendente (separado do comercial), e o conserto do
 * episódio sem dono — a causa do "597 é muito pouco": atendimento aberto
 * antes de a conversa ter atendente ficava sem dono pra sempre e sumia de
 * qualquer relatório filtrado por setor/atendente.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

describe("episódio ganha dono no primeiro humano", () => {
  const episodios = ler("server/atendimento/episodios.ts");

  it("resposta manual da equipe preenche quem abriu quando estava vazio", () => {
    // COALESCE preserva o congelamento: dono já definido nunca muda.
    const upd = episodios.slice(episodios.indexOf("if (!ultimo) return null;"));
    expect(upd).toContain("atendenteAbriu: sql`COALESCE(${atendimentos.atendenteAbriu}, ${args.atendenteId})`");
    expect(upd).toContain("atendenteAtual: sql`COALESCE(${atendimentos.atendenteAtual}, ${args.atendenteId})`");
  });

  it("assumir/transferir também define quem abriu quando era NULL", () => {
    const tr = episodios.slice(episodios.indexOf("export async function transferirEpisodioDaConversa"));
    expect(tr).toContain("COALESCE(${atendimentos.atendenteAbriu}, ${novoAtendenteId})");
  });

  it("a migration repara o histórico nas três frentes", () => {
    const mig = ler("drizzle/0199_episodio_dono_do_atendimento.sql");
    expect(mig).toContain("SET atendenteAbriuAtd = atendenteAtualAtd");
    expect(mig).toContain("m.remetenteIdMsg");
    expect(mig).toContain("m.direcaoMsg = 'saida'");
    expect(mig).toContain("SET atendenteAtualAtd = atendenteAbriuAtd");
  });
});

describe("relatório: quadro operacional por atendente", () => {
  const router = ler("server/escritorio/router-relatorios.ts");

  it("uma consulta só traz iniciados, resolvidos, em andamento e 1ª resposta", () => {
    expect(router).toContain("resolvidos: sql<number>`SUM(CASE WHEN ${atendimentos.fechadoEm} IS NOT NULL AND ${atendimentos.motivoFechamento} = 'resolvido'");
    expect(router).toContain("emAndamento: sql<number>`SUM(CASE WHEN ${atendimentos.fechadoEm} IS NULL");
    expect(router).toContain("AVG(TIMESTAMPDIFF(SECOND, ${atendimentos.abertoEm}, ${atendimentos.primeiraRespostaEm}))");
  });

  it("episódio do robô vira linha própria — não some da soma", () => {
    expect(router).toContain('"Sem atendente (robô)"');
  });

  it("o estoque do Inbox sai junto, pro rodapé que explica o \"não bate\"", () => {
    expect(router).toContain("estoqueConversas: {");
  });

  it("uma taxa só: ganhos ÷ atendimentos iniciados, no card e na tabela", () => {
    expect(router).toContain("Math.round((leadsGanhos / atendimentosIniciados) * 100)");
    expect(router).toContain("Math.round((leadsGanhosAnt / atdIniciadosAnt) * 100)");
    expect(router).not.toContain("leadsGanhos / totalConversas");
  });
});

describe("PDF e tela com as duas tabelas", () => {
  it("o PDF ganhou o quadro operacional, o comercial separado e a nota", () => {
    const pdf = ler("server/escritorio/relatorios-atendimento-pdf.ts");
    expect(pdf).toContain('"Atendimento por atendente"');
    expect(pdf).toContain('"Comercial por atendente"');
    expect(pdf).toContain("Por que estes números não batem");
    expect(pdf).toContain("tabelaAtendimento?: Array<{");
  });

  it("a tela mostra os dois quadros e a explicação do estoque", () => {
    const tela = ler("client/src/pages/Relatorios.tsx");
    expect(tela).toContain('titulo="Atendimento por atendente"');
    expect(tela).toContain('titulo="Comercial por atendente"');
    expect(tela).toContain("Por que estes números não batem com o Inbox");
    // A coluna Atend. saiu da tabela comercial — mora no quadro operacional.
    const comercial = tela.slice(tela.indexOf('titulo="Comercial por atendente"'));
    expect(comercial).not.toContain("{a.atendimentos}");
  });
});
