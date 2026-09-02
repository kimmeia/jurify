import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

/**
 * Filtro de Clientes: campos que se cruzam, marcações que somam.
 *
 * O desenho antigo era recorte único (`segmento`): marcar VIP desmarcava
 * "com débito", e não havia como perguntar "quem é da Camila E está devendo".
 * Trocar por campos combináveis é o que o dono pediu, e é o que estas amarras
 * protegem — junto com as duas coisas que quase se perderam no caminho.
 */

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

describe("o servidor cruza os campos e soma dentro de cada um", () => {
  const router = ler("server/escritorio/router-clientes.ts");
  const listar = router.slice(router.indexOf("listar: protectedProcedure"), router.indexOf("detalhe: protectedProcedure"));

  it("aceita um campo por pergunta, não um recorte só", () => {
    for (const campo of ["responsaveis", "cobranca", "origens", "marcas", "cadastroDe", "cadastroAte"]) {
      expect(listar, campo).toContain(`${campo}:`);
    }
  });

  it("dentro do campo as opções SOMAM — `inArray`/`or`, nunca igualdade crua", () => {
    // `eq(responsavelId, X)` só aceitaria um; marcar dois devolveria vazio, que
    // é o contrário do que o clique quer dizer.
    expect(listar).toMatch(/inArray\(contatos\.responsavelId, input\.responsaveis\)/);
    expect(listar).toMatch(/inArray\(contatos\.origem, input\.origens\)/);
    expect(listar).toMatch(/or\(\.\.\.porMarca\)/);
    expect(listar).toMatch(/or\(\.\.\.porCobranca\)/);
  });

  it("entre campos eles CRUZAM — cada bloco estreita o mesmo WHERE", () => {
    const blocos = listar.match(/where = and\(where, /g) ?? [];
    expect(blocos.length).toBeGreaterThanOrEqual(8);
  });

  it("campo não perguntado não estreita nada", () => {
    // Sem o guard de comprimento, `[]` viraria "responsável em nenhum" e a
    // lista voltaria vazia sem ninguém ter filtrado.
    for (const campo of ["responsaveis", "origens", "marcas", "cobranca"]) {
      expect(listar, campo).toContain(`input?.${campo}?.length`);
    }
  });

  it('"em dia" exclui quem tem vencida — senão o cliente aparece nos dois', () => {
    expect(listar).toMatch(/em_dia.*AND NOT/s);
  });

  it("a ponta de cima do período é inclusiva", () => {
    // Com `T00:00:00` nas duas pontas, quem cadastrou às 15h do dia final
    // ficava de fora e o filtro parecia perder gente.
    expect(listar).toContain("T23:59:59.999");
  });

  it("o segmento antigo continua de pé — outras telas ainda o usam", () => {
    expect(listar).toContain("segmento:");
    expect(listar).toContain('seg === "com_debito"');
  });

  it("nada do recorte antigo se perdeu: inativo/suspenso/encerrado viraram marcas", () => {
    const marcas = listar.slice(listar.indexOf("marcas: z.array"), listar.indexOf("cadastroDe:"));
    for (const m of ["vip", "docs", "semResp", "inativo", "suspenso", "encerrado"]) {
      expect(marcas, m).toContain(`"${m}"`);
    }
  });

  it("continua preso ao escritório", () => {
    const cobranca = listar.slice(listar.indexOf("input?.cobranca?.length"), listar.indexOf("input?.cadastroDe"));
    expect(cobranca.match(/escritorioId\} = \$\{perm\.escritorioId\}/g)?.length).toBeGreaterThanOrEqual(2);
  });
});

describe("a tela pergunta o que o servidor sabe responder", () => {
  const tela = ler("client/src/pages/Clientes.tsx");

  it("manda `undefined` quando o campo está vazio", () => {
    expect(tela).toMatch(/responsaveis: filtros\.responsaveis\.length \? filtros\.responsaveis : undefined/);
    expect(tela).toMatch(/marcas: filtros\.marcas\.length \? filtros\.marcas : undefined/);
  });

  it("a lista da tela não refiltra por cima — o servidor já entregou filtrado", () => {
    expect(tela).not.toContain("aplicarSegmento(base, segmento");
  });

  it("o campo de data é mascarado, não o seletor nativo", () => {
    // `input type=date` desenha no idioma do NAVEGADOR: num Chrome em inglês
    // sai mm/dd/aaaa, e "03/04" fica ambíguo num sistema jurídico.
    const bloco = tela.slice(tela.indexOf("Período personalizado"), tela.indexOf("Conta pela data de cadastro"));
    expect(bloco).toContain('placeholder="dd/mm/aaaa"');
    expect(bloco).not.toContain('type="date"');
  });

  it("data que não existe não vira filtro", () => {
    // 31/02 viraria 03/03 se fosse só `new Date(...)`.
    const conv = tela.slice(tela.indexOf("function brParaIso"), tela.indexOf("function isoParaBr"));
    expect(conv).toContain("d.getDate() === Number(dd)");
    expect(conv).toContain("d.getMonth() + 1 === Number(mm)");
  });
});

describe("a ficha do cliente para de se espremer", () => {
  const tela = ler("client/src/pages/Clientes.tsx");
  const hero = tela.slice(tela.indexOf("═══════════ HERO DO CLIENTE"), tela.indexOf("Mini KPIs do cliente"));

  it("o cabeçalho é a faixa azul do tema, não branco", () => {
    expect(hero).toContain("var(--hero)");
    expect(hero).toContain("text-hero-fg");
  });

  it("o nome tem linha própria — não divide espaço com os botões", () => {
    // Oito botões `shrink-0` na mesma linha deixavam o nome com o que sobrava,
    // e ele quebrava uma palavra por linha.
    const ini = hero.indexOf("<h2");
    expect(ini).toBeGreaterThan(0);
    const linhaDoNome = hero.slice(ini, hero.indexOf("</h2>"));
    expect(linhaDoNome).not.toContain("Button");
    expect(hero).toMatch(/border-t border-white\/20 pt-3/);
  });

  it("as ações raras seguem alcançáveis pelo menu", () => {
    for (const acao of ["Voltar para Lead", "Mesclar com outro cliente", "Encerrar serviço", "Excluir cliente"]) {
      expect(hero, acao).toContain(acao);
    }
    expect(hero).toContain("DropdownMenuTrigger");
  });

  it("a coluna da esquerda tem busca logo abaixo do Voltar", () => {
    const ini = tela.indexOf("function ListaCompactaClientes");
    const coluna = tela.slice(ini, tela.indexOf("\nfunction ", ini + 10));
    const iVoltar = coluna.indexOf("Voltar para a lista");
    const iBusca = coluna.indexOf("Nome, CPF ou telefone");
    expect(iVoltar).toBeGreaterThan(0);
    expect(iBusca).toBeGreaterThan(iVoltar);
  });
});

describe("o dialog abre na largura que o código pede", () => {
  it("largura sem `sm:` perde pro `sm:max-w-lg` do componente base", () => {
    // Variante vence utilitário puro na ordem da folha: `max-w-3xl` pedia
    // 768px e o dialog abria em 512px, esmagando a grade de duas colunas.
    const base = ler("client/src/components/ui/dialog.tsx");
    expect(base).toContain("sm:max-w-lg");
    for (const arq of [
      "client/src/pages/Processos.tsx",
      "client/src/pages/processos/ImportarAdvboxDialog.tsx",
      "client/src/pages/configuracoes/templates-tab.tsx",
    ]) {
      const largas = ler(arq).match(/DialogContent className="[^"]*max-w-(?:xl|2xl|3xl|4xl|5xl|6xl|7xl|\[)[^"]*"/g) ?? [];
      for (const m of largas) expect(m, `${arq}: ${m}`).toContain("sm:max-w-");
    }
  });
});

describe("o menu estreito continua dizendo o nome de cada item", () => {
  it("o rótulo desce pra baixo do ícone em vez de sumir", () => {
    // Recolhido, o padrão do shadcn esconde o texto — viravam 16 ícones
    // anônimos, que foi a queixa.
    const css = ler("client/src/index.css");
    expect(css).toContain('.menu-rotulado[data-collapsible="icon"]');
    expect(css).toMatch(/\.rotulo-item\s*\{[^}]*display:\s*block/s);
    const layout = ler("client/src/components/AppLayout.tsx");
    expect(layout).toContain("menu-rotulado");
    expect(layout).toContain('className="flex-1 rotulo-item"');
    // 3rem só cabe o ícone.
    expect(layout).toContain('"--sidebar-width-icon": "4.5rem"');
  });
});
