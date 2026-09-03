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
  const layout = ler("client/src/components/AppLayout.tsx");
  const css = ler("client/src/index.css");

  const trecho = (de: string, ate: string) => {
    const i = layout.indexOf(de);
    expect(i, `âncora sumiu do AppLayout: ${de}`).toBeGreaterThan(-1);
    const f = layout.indexOf(ate, i);
    expect(f, `fim do trecho sumiu: ${ate}`).toBeGreaterThan(-1);
    return layout.slice(i, f);
  };

  it("o rail é estilizado pelo className do botão, não por CSS solto", () => {
    /*
     * A primeira tentativa foi uma regra em index.css:
     *
     *   .menu-rotulado[data-collapsible="icon"] [data-sidebar="menu-button"]
     *
     * Ela NUNCA casou. `data-collapsible` fica no <div> externo do Sidebar e o
     * className passado ao componente vai parar no container interno — o
     * seletor pedia os dois no MESMO elemento. Resultado no ar: rail de 4.5rem
     * com botões de 32px encostados à esquerda (12px fora do centro) e sem
     * rótulo nenhum. A amarra anterior conferia a STRING do seletor, então
     * passou verde o tempo todo.
     *
     * O que quebra é o COMPOSTO — classe nossa colada no atributo, os dois
     * exigidos no mesmo elemento. A forma descendente
     * `[data-collapsible="icon"] .alguma-classe` casa perfeitamente e não tem
     * culpa nenhuma; index.css é a folha do app inteiro (AdminLayout,
     * DashboardLayout, LP) e proibir o atributo inteiro vetava até o comentário
     * que explica esta regra.
     */
    expect(css).not.toMatch(/[.\w-]\[data-collapsible/);
  });

  it("o botão deixa de ser 32px e vira coluna quando o menu recolhe", () => {
    // Sem vencer `size-8!` o botão fica 32px dentro de um rail de 72px e
    // encosta na esquerda — é exatamente o desalinhamento relatado.
    //
    // Empate de especificidade entre dois `!important`: quem desempata é a
    // ordem de emissão, e o Tailwind emite shorthand antes de longhand. Por
    // isso é `h-auto`/`w-full` contra `size-8` e `px`/`py` contra `p` —
    // `size-*`/`p-*` aqui empatariam e o override voltaria a perder.
    const geometria = trecho("const CLASSES_ITEM_RAIL", ";");
    for (const classe of [
      "group-data-[collapsible=icon]:h-auto!",
      "group-data-[collapsible=icon]:w-full!",
      "group-data-[collapsible=icon]:flex-col",
      "group-data-[collapsible=icon]:justify-center",
      "group-data-[collapsible=icon]:px-0.5!",
      "group-data-[collapsible=icon]:py-1.5!",
    ]) {
      expect(geometria, classe).toContain(classe);
    }
    expect(geometria).not.toContain("group-data-[collapsible=icon]:size-");
    expect(geometria).not.toMatch(/group-data-\[collapsible=icon\]:p-[\d.]/);
  });

  it("todo item do rail usa a MESMA geometria", () => {
    // O "Assinar plano" ficou 32px de fundo chapado ao lado de itens de 39px
    // enquanto tinha className próprio. Compartilhar a constante é o que
    // impede a segunda cópia de envelhecer sozinha.
    //
    // Contar MENÇÃO do identificador não serve: trocar `className={X}` por
    // `title={X}` mantém a contagem e quebra a tela. Por isso as duas costuras
    // são conferidas no ponto de USO, dentro de um className.
    for (const uso of [
      "className={`relative h-[34px] transition-all ${CLASSES_ITEM_RAIL}",
      "className={`relative h-9 transition-all font-normal ${CLASSES_ITEM_RAIL}`}",
      "<span className={`flex-1 rotulo-item ${CLASSES_ROTULO_RAIL}`}>",
      "<span className={CLASSES_ROTULO_RAIL}>Assinar plano</span>",
    ]) {
      expect(layout, uso).toContain(uso);
    }
  });

  it("o componente-base continua deixando o rótulo aparecer", () => {
    /*
     * Tudo aqui depende do shadcn NÃO esconder o rótulo no modo ícone: se
     * `sidebarMenuButtonVariants` ganhar um `hidden` sob
     * `group-data-[collapsible=icon]:`, voltam os 16 ícones anônimos e nenhuma
     * asserção sobre o AppLayout enxerga isso — todas leem o consumidor.
     * O bloco do dialog, logo acima, já prende o componente-base assim.
     */
    const sidebar = ler("client/src/components/ui/sidebar.tsx");
    const variantes = sidebar.slice(
      sidebar.indexOf("const sidebarMenuButtonVariants"),
      sidebar.indexOf("VariantProps<typeof sidebarMenuButtonVariants>"),
    );
    expect(variantes).not.toMatch(/group-data-\[collapsible=icon\]:[^\s"]*hidden/);
    // E a geometria que o override precisa vencer é ESTA. Se o shadcn trocar
    // `size-8!`/`p-2!` por outra coisa, o desempate por ordem de emissão muda
    // de lado e o rail volta a 32px — melhor a suíte avisar.
    expect(variantes).toContain("group-data-[collapsible=icon]:size-8!");
    expect(variantes).toContain("group-data-[collapsible=icon]:p-2!");
  });

  it("o rótulo continua na tela, menor, embaixo do ícone", () => {
    const rotulo = trecho("const CLASSES_ROTULO_RAIL", ";");
    expect(rotulo).toContain("group-data-[collapsible=icon]:text-[8.5px]");
    expect(rotulo).toContain("group-data-[collapsible=icon]:text-center");
    expect(rotulo).toContain("group-data-[collapsible=icon]:w-full");
    // O `truncate` do shadcn mira `>span:last-child`, que num item com badge
    // é o CONTADOR. O rótulo precisa do seu.
    expect(rotulo).toContain("group-data-[collapsible=icon]:truncate");
  });

  it("o rail cabe um nome — 3rem só cabe o ícone", () => {
    expect(layout).toContain('"--sidebar-width-icon": "4.5rem"');
  });

  it("o item que ficou embaixo da dobra continua alcançável", () => {
    // Item mais alto × 16 itens: o menu passa da tela. O shadcn poda a rolagem
    // no modo ícone (`group-data-[collapsible=icon]:overflow-hidden`), então
    // sem isto os últimos itens somem sem nem barra pra revelá-los.
    const conteudo = trecho("<SidebarContent", ">");
    expect(conteudo).toContain("group-data-[collapsible=icon]:overflow-y-auto");
    // ...mas SEM a barra ocupando largura. `.rolagem-menu` é barra clássica
    // (scrollbar-width: thin), que reserva espaço: medido em Chromium com barra
    // clássica, viewport de 768px, ela comia 10px dos 72px — botão de 56 pra
    // 46, ícones 5px fora do centro do logo e do rodapé, 5 rótulos truncando.
    expect(conteudo).toContain("group-data-[collapsible=icon]:[scrollbar-width:none]!");
    expect(conteudo).toContain("group-data-[collapsible=icon]:[&::-webkit-scrollbar]:w-0!");
  });

  it("a borda some no rail e SÓ no rail", () => {
    // `border-r-0` sem `!` perde pro `group-data-[side=left]:border-r` do
    // shadcn (mais específico) e sobra um fio à direita. Com o `!` sem variante
    // ele passava a vencer nos DOIS estados e o menu ABERTO perdia a borda que
    // está no ar hoje — no escuro, a única divisa entre menu e conteúdo.
    const borda = trecho('collapsible="icon"', ">");
    expect(borda).toContain("group-data-[collapsible=icon]:border-r-0!");
    expect(borda).not.toMatch(/[\s"]border-r-0!/);
  });

  it("o ponto do badge se ancora no ícone, não no canto do botão", () => {
    // `right-1.5` era relativo ao botão; com ele ocupando a largura do rail o
    // ponto ficava 7,5px longe do ícone que ele anota.
    const ponto = trecho("absolute right-1.5 top-1.5 hidden", 'item.tomBadge === "alerta" ? "bg-danger"');
    expect(ponto).toContain("group-data-[collapsible=icon]:left-1/2");
    expect(ponto).toContain("group-data-[collapsible=icon]:right-auto");
  });

  it("o selo do Assinar plano não vira uma terceira linha", () => {
    // Em coluna, um selo no fluxo empilha embaixo do rótulo e só ESTE item
    // fica mais alto que o rail inteiro.
    const selo = trecho('<span className={CLASSES_ROTULO_RAIL}>Assinar plano</span>', "</Badge>");
    expect(selo).toContain("group-data-[collapsible=icon]:absolute");
    expect(selo).toContain("group-data-[collapsible=icon]:ml-0");
  });
});

describe("dentro da faixa de destaque a tinta semântica inverte", () => {
  const css = ler("client/src/index.css");
  const faixa = css.slice(css.indexOf(".faixa-hero {"), css.indexOf("}", css.indexOf(".faixa-hero {")));

  it("os papéis de cor são redefinidos pra superfície escura", () => {
    // `--danger-fg` é a tinta de card BRANCO. Sobre o navy ela dava 1,22:1 —
    // foi o "botão vermelho apagado" e a "etiqueta verde escura".
    for (const papel of ["success", "danger", "warning", "info", "neutral"]) {
      expect(faixa, `--${papel}-fg`).toContain(`--${papel}-fg:`);
      expect(faixa, `--${papel}-bg`).toContain(`--${papel}-bg:`);
    }
    expect(faixa).toContain("--foreground: var(--hero-fg)");
  });

  it("a tinta clareia e o véu escurece", () => {
    // Véu claro sob tinta clara é briga consigo mesma: com branco a 15% a
    // etiqueta verde ficava em 3,2:1.
    const clareza = (papel: string) => {
      const m = faixa.match(new RegExp(`--${papel}-fg: oklch\\(([\\d.]+)`));
      return m ? Number(m[1]) : NaN;
    };
    for (const papel of ["success", "danger", "warning"]) {
      expect(clareza(papel), papel).toBeGreaterThan(0.7);
      expect(faixa, `${papel}-bg`).toMatch(new RegExp(`--${papel}-bg: oklch\\(0 0 0 / `));
    }
  });

  it("toda faixa se declara, senão os filhos herdam a tinta de card", () => {
    for (const arq of [
      "client/src/pages/Clientes.tsx",
      "client/src/pages/Configuracoes.tsx",
      "client/src/pages/Atendimento.tsx",
      "client/src/pages/admin/AdminClients.tsx",
    ]) {
      expect(ler(arq), arq).toContain("faixa-hero");
    }
  });

  it("a faixa não se pinta com token que ela mesma reescreve", () => {
    // A primeira versão do cabeçalho do admin usava `bg-info`; ao redefinir
    // `--info` pros filhos, ela apagava o próprio azul e virava quase branca.
    const reescritos = ["info", "success", "danger", "warning", "neutral"];
    for (const arq of [
      "client/src/pages/Clientes.tsx",
      "client/src/pages/Configuracoes.tsx",
      "client/src/pages/Atendimento.tsx",
      "client/src/pages/admin/AdminClients.tsx",
    ]) {
      const txt = ler(arq);
      for (const m of txt.matchAll(/faixa-hero[^"]*/g)) {
        for (const papel of reescritos) {
          expect(m[0], `${arq}: bg-${papel}`).not.toMatch(new RegExp(`\\bbg-${papel}\\b`));
        }
      }
    }
  });
});
