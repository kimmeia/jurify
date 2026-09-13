/**
 * Central de ajuda — o manual que mora dentro do sistema.
 *
 * O que estas amarras impedem, cada uma nascida de um jeito de o manual
 * mentir sem ninguém ver:
 *  - tarefa apontando pra rota que não existe mais (o botão "Abrir a tela"
 *    caía no 404) — as rotas são DERIVADAS do App.tsx, não listadas à mão;
 *  - passo citando botão que a tela não tem («Testar login» quando o botão
 *    se chama «Validar») — todo rótulo entre «» tem que existir no arquivo
 *    da tela;
 *  - print referenciado que não está em client/public (a tela mostrava a
 *    moldura quebrada);
 *  - a Central caindo atrás do porteiro de módulo ou da guarda de
 *    assinatura (quem não tem o módulo é justamente quem precisa ler);
 *  - o botão "Ajuda" sumindo da barra lateral;
 *  - uma segunda lista de tarefas nascendo em outro arquivo e as duas
 *    divergindo.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  GRUPOS_AJUDA,
  TAREFAS_AJUDA,
  buscarTarefas,
  tarefaCompleta,
  tarefaPorId,
  type TarefaCompleta,
} from "../../client/src/pages/ajuda/tarefas";
import { ler, semComentarios } from "./_paginas-publicas";

const raiz = join(__dirname, "..", "..");

const TAREFAS_COMPLETAS_ESPERADAS = [
  "conectar-whatsapp",
  "cadastrar-cliente",
  "vigiar-processo",
  "convidar-equipe",
  "cobrar-cliente",
] as const;

const completas = TAREFAS_AJUDA.filter(tarefaCompleta) as readonly TarefaCompleta[];

/** Todos os `path="..."` do <Switch> do App.tsx. */
function rotasDoApp(): string[] {
  const app = ler("client/src/App.tsx");
  const corpo = app.slice(app.indexOf("<Switch>"), app.indexOf("</Switch>"));
  return [...corpo.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]);
}

/** "/processos?tab=cofre" casa com "/processos"; "/ajuda/x" casa com "/ajuda/:tarefa". */
function rotaExiste(destino: string, rotas: string[]): boolean {
  const caminho = destino.split("?")[0];
  return rotas.some((r) => {
    const re = new RegExp("^" + r.replace(/:[^/]+/g, "[^/]+") + "$");
    return re.test(caminho);
  });
}

/** Tudo que a tarefa escreve entre «aspas angulares». */
function rotulosCitados(t: TarefaCompleta): string[] {
  const textos = [
    t.antesDeComecar,
    ...t.passos.flatMap((p) => [p.titulo, p.texto]),
    ...t.depois,
    ...t.seNaoDeuCerto.flatMap((f) => [f.titulo, f.texto]),
  ];
  return textos.flatMap((s) => [...s.matchAll(/«([^»]+)»/g)].map((m) => m[1]));
}

function arquivosTsx(dir: string): string[] {
  const saida: string[] = [];
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) saida.push(...arquivosTsx(caminho));
    else if (nome.endsWith(".tsx") || nome.endsWith(".ts")) saida.push(caminho);
  }
  return saida;
}

describe("Central de ajuda — conteúdo (tarefas.ts)", () => {
  it("as cinco tarefas combinadas estão completas e todas as outras são «em breve»", () => {
    const ids = completas.map((t) => t.id).sort();
    expect(ids).toEqual([...TAREFAS_COMPLETAS_ESPERADAS].sort());
    for (const t of TAREFAS_AJUDA) {
      if (!TAREFAS_COMPLETAS_ESPERADAS.includes(t.id as (typeof TAREFAS_COMPLETAS_ESPERADAS)[number])) {
        expect(t.emBreve, `${t.id} não é uma das cinco e precisa ser emBreve`).toBe(true);
      }
    }
  });

  it("tarefa completa tem todos os campos obrigatórios preenchidos", () => {
    for (const t of completas) {
      const onde = `tarefa ${t.id}`;
      expect(t.titulo.trim(), onde).not.toBe("");
      expect(t.tempo.trim(), onde).not.toBe("");
      expect(t.quemPode.trim(), onde).not.toBe("");
      expect(t.palavrasChave.length, `${onde}: palavras-chave`).toBeGreaterThan(0);
      expect(t.antesDeComecar.trim(), onde).not.toBe("");
      expect(t.passos.length, `${onde}: passos`).toBeGreaterThanOrEqual(3);
      for (const p of t.passos) {
        expect(p.titulo.trim(), onde).not.toBe("");
        expect(p.texto.trim(), onde).not.toBe("");
      }
      expect(t.depois.length, `${onde}: depois`).toBeGreaterThan(0);
      expect(t.seNaoDeuCerto.length, `${onde}: se não deu certo`).toBeGreaterThan(0);
      expect(t.tarefasLigadas.length, `${onde}: tarefas ligadas`).toBeGreaterThan(0);
      expect(t.abrirTela.rota.startsWith("/"), `${onde}: rota`).toBe(true);
      expect(t.abrirTela.rotulo.trim(), onde).not.toBe("");
      expect(existsSync(join(raiz, t.arquivoTela)), `${onde}: arquivoTela ${t.arquivoTela} não existe`).toBe(true);
      for (const a of t.arquivosApoio ?? []) {
        expect(existsSync(join(raiz, a)), `${onde}: arquivo de apoio ${a} não existe`).toBe(true);
      }
    }
  });

  it("ids são únicos, em kebab-case, e todo grupo é um dos grupos do menu", () => {
    const ids = TAREFAS_AJUDA.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of TAREFAS_AJUDA) {
      expect(t.id, `id fora do padrão: ${t.id}`).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(GRUPOS_AJUDA as readonly string[], `grupo desconhecido em ${t.id}`).toContain(t.grupo);
    }
  });

  it("os grupos da Central são EXATAMENTE os grupos do menu lateral, na mesma ordem", () => {
    const layout = ler("client/src/components/AppLayout.tsx");
    const bloco = layout.slice(layout.indexOf("const GRUPOS_MENU"), layout.indexOf("export default function AppLayout"));
    const titulos = [...bloco.matchAll(/titulo:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(titulos.length, "GRUPOS_MENU não foi lido").toBeGreaterThan(0);
    expect([...GRUPOS_AJUDA]).toEqual(titulos);
  });

  it("toda rota de «Abrir a tela» existe no App.tsx (derivado, não listado)", () => {
    const rotas = rotasDoApp();
    expect(rotas.length).toBeGreaterThan(20);
    for (const t of completas) {
      expect(rotaExiste(t.abrirTela.rota, rotas), `${t.id}: rota ${t.abrirTela.rota} não existe no App.tsx`).toBe(true);
    }
  });

  it("a rota de «Abrir a tela» só leva ?tab=/?novo= que a tela realmente lê", () => {
    for (const t of completas) {
      const query = t.abrirTela.rota.split("?")[1];
      if (!query) continue;
      const tela = ler(t.arquivoTela);
      for (const [chave] of new URLSearchParams(query)) {
        expect(tela, `${t.id}: a tela ${t.arquivoTela} não lê ?${chave}=`).toContain(`get("${chave}")`);
      }
    }
  });

  it("toda tarefa ligada aponta para uma tarefa que existe", () => {
    for (const t of completas) {
      for (const id of t.tarefasLigadas) {
        expect(tarefaPorId(id), `${t.id} liga para "${id}", que não existe`).toBeTruthy();
        expect(id, `${t.id} liga para si mesma`).not.toBe(t.id);
      }
    }
  });

  it("todo rótulo citado entre «» existe, letra por letra, no arquivo da tela", () => {
    for (const t of completas) {
      const fontes = [t.arquivoTela, ...(t.arquivosApoio ?? [])].map((a) => ler(a)).join("\n");
      const citados = rotulosCitados(t);
      expect(citados.length, `${t.id}: nenhum rótulo citado — o manual precisa nomear os botões`).toBeGreaterThan(3);
      for (const r of citados) {
        expect(fontes.includes(r), `${t.id}: «${r}» não existe em ${t.arquivoTela} nem nos arquivos de apoio`).toBe(true);
      }
    }
  });

  it("todo print referenciado existe em client/public/ajuda", () => {
    let prints = 0;
    for (const t of completas) {
      for (const p of t.passos) {
        if (!p.print) continue;
        prints++;
        expect(p.print, `${t.id}: print fora de /ajuda/`).toMatch(/^\/ajuda\/[a-z0-9-]+\.png$/);
        expect(existsSync(join(raiz, "client", "public", p.print)), `${t.id}: falta o arquivo ${p.print}`).toBe(true);
      }
      expect(t.passos.filter((p) => p.print).length, `${t.id}: no máximo 2 prints por tarefa`).toBeLessThanOrEqual(2);
    }
    expect(prints, "nenhuma tarefa tem print").toBeGreaterThan(0);
  });

  it("a busca acha por título e por palavra-chave, sem acento e sem caixa", () => {
    expect(buscarTarefas("VIGIAR").map((t) => t.id)).toContain("vigiar-processo");
    expect(buscarTarefas("pje").map((t) => t.id)).toContain("vigiar-processo");
    expect(buscarTarefas("cobranca").map((t) => t.id)).toContain("cobrar-cliente");
    expect(buscarTarefas("boleto pix").map((t) => t.id)).toEqual(["cobrar-cliente"]);
    expect(buscarTarefas("xyzw-nada")).toHaveLength(0);
    expect(buscarTarefas("   ")).toHaveLength(TAREFAS_AJUDA.length);
  });
});

describe("Central de ajuda — rotas e navegação", () => {
  it("/ajuda e /ajuda/:tarefa estão dentro de ClientAreaNoGuard (sem porteiro de módulo nem guarda de assinatura)", () => {
    const app = semComentarios(ler("client/src/App.tsx"));
    const corpo = app.slice(app.indexOf("<Switch>"), app.indexOf("</Switch>"));
    const blocos = [...corpo.matchAll(/<Route\b[\s\S]*?<\/Route>/g)].map((m) => m[0]);
    for (const path of ["/ajuda", "/ajuda/:tarefa"]) {
      const bloco = blocos.find((b) => b.includes(`path="${path}"`));
      expect(bloco, `rota ${path} não está no App.tsx`).toBeTruthy();
      expect(bloco, `${path} precisa de <ClientAreaNoGuard>`).toContain("<ClientAreaNoGuard>");
      expect(bloco, `${path} não pode passar pelo <ClientArea> (porteiro + assinatura)`).not.toMatch(/<ClientArea>/);
    }
    expect(blocos.find((b) => b.includes('path="/ajuda/:tarefa"'))).toContain("<AjudaTarefa");
    expect(blocos.find((b) => b.includes('path="/ajuda"'))).toContain("<Ajuda ");
  });

  it("o botão «Ajuda» está no rodapé da barra lateral, ao lado do Buscar, e leva a /ajuda", () => {
    const layout = semComentarios(ler("client/src/components/AppLayout.tsx"));
    const rodape = layout.slice(layout.indexOf("<SidebarFooter"), layout.indexOf("</SidebarFooter>"));
    expect(rodape, "rodapé da barra lateral não encontrado").not.toBe("");
    expect(rodape).toContain("⌘K");
    const i = rodape.indexOf('aria-label="Ajuda"');
    expect(i, "botão Ajuda sumiu do rodapé").toBeGreaterThan(-1);
    const botao = rodape.slice(rodape.lastIndexOf("<button", i), rodape.indexOf("</button>", i));
    expect(botao).toContain('setLocation("/ajuda")');
    expect(botao).toContain("<CircleHelp");
    expect(botao).toContain(">Ajuda<");
    // Ajuda não passa pelo `navigateOrBlock`: sem plano é quando mais se lê.
    expect(botao).not.toContain("navigateOrBlock");
  });

  it("no celular, o menu do avatar do modo atendimento também tem «Ajuda» e a rota não é jogada de volta", () => {
    const layout = semComentarios(ler("client/src/components/AppLayout.tsx"));
    const foco = layout.slice(layout.indexOf("{isMobile && modoFocadoMobile && ("), layout.indexOf("Abrir versão completa"));
    expect(foco, "menu do modo atendimento não encontrado").not.toBe("");
    expect(foco).toContain('setLocation("/ajuda")');
    expect(foco).toContain("<span>Ajuda</span>");
    const guarda = layout.slice(layout.indexOf("const permitida"), layout.indexOf("if (!permitida)"));
    expect(guarda, "o modo focado precisa deixar /ajuda passar").toContain('location.startsWith("/ajuda")');
  });

  it("o «?» de cada tela coberta aponta pra tarefa certa, e só pra tarefas que existem", () => {
    const esperado: Record<string, string> = {
      "client/src/pages/Processos.tsx": "vigiar-processo",
      "client/src/pages/Clientes.tsx": "cadastrar-cliente",
      "client/src/pages/Financeiro.tsx": "cobrar-cliente",
    };
    for (const [arquivo, tarefa] of Object.entries(esperado)) {
      const src = ler(arquivo);
      expect(src, `${arquivo} não importa AjudaDaTela`).toContain('from "@/components/AjudaDaTela"');
      expect(src, `${arquivo} não tem o ? da tarefa ${tarefa}`).toContain(`<AjudaDaTela tarefa="${tarefa}" />`);
    }
    const conf = ler("client/src/pages/Configuracoes.tsx");
    expect(conf).toContain('<AjudaDaTela tarefa="convidar-equipe" />');
    expect(conf).toContain('<AjudaDaTela tarefa="conectar-whatsapp" />');

    for (const arquivo of arquivosTsx(join(raiz, "client", "src"))) {
      const src = readFileSync(arquivo, "utf8");
      for (const m of src.matchAll(/<AjudaDaTela tarefa="([^"]+)"/g)) {
        const t = tarefaPorId(m[1]);
        expect(t, `${arquivo} aponta pra tarefa inexistente ${m[1]}`).toBeTruthy();
        expect(t && tarefaCompleta(t), `${arquivo}: o ? não pode levar a tarefa «em breve» (${m[1]})`).toBe(true);
      }
    }
  });

  it("o componente AjudaDaTela é um link pra /ajuda/<id> com o tooltip «Como fazer isso»", () => {
    const src = ler("client/src/components/AjudaDaTela.tsx");
    expect(src).toContain("href={`/ajuda/${tarefa}`}");
    expect(src).toContain("<TooltipContent>Como fazer isso</TooltipContent>");
    expect(src).toContain("<CircleHelp");
  });

  it("a Central lê o WhatsApp comercial da MESMA procedure da LP — nunca um número escrito", () => {
    const home = ler("client/src/pages/Ajuda.tsx");
    expect(home).toContain("trpc.subscription.contatoComercial.useQuery");
    expect(home).toContain("https://wa.me/${whatsapp}");
    expect(home, "número de telefone cravado na Central").not.toMatch(/wa\.me\/\d{8,}/);
    expect(ler("client/src/pages/ajuda/tarefas.ts"), "número cravado no conteúdo").not.toMatch(/\b55\d{10,11}\b/);
  });

  it("a página da tarefa avisa (e não bloqueia) quando falta o módulo, com o mesmo contrato do ModuloGuard", () => {
    const src = ler("client/src/pages/ajuda/AjudaTarefa.tsx");
    expect(src).toContain('from "@/components/ModuloGuard"');
    expect(src).toContain("useModulosContratados()");
    expect(src).toContain("contratoLibera(contratados, [tarefa.modulo])");
    expect(src).toContain("Este recurso depende do módulo");
    expect(src, "o aviso precisa ser RENDERIZADO, não só definido").toContain("<AvisoModulo modulo={tarefa.modulo} />");
    const corpo = src.slice(src.indexOf("export default function AjudaTarefa"));
    // avisa, não bloqueia: entre calcular `semModulo` e renderizar não pode
    // haver saída condicional — os passos continuam na tela sem o módulo.
    const depois = corpo.slice(corpo.indexOf("const semModulo"));
    const ateORender = depois.slice(0, depois.indexOf("return"));
    expect(ateORender, "sem módulo a página AVISA; não pode sair antes dos passos").not.toMatch(/\bif\s*\(/);
    expect(corpo.indexOf("<AvisoModulo")).toBeLessThan(corpo.indexOf("tarefa.passos.map"));
    // hooks ANTES da saída antecipada (React #310)
    expect(corpo.indexOf("useModulosContratados()")).toBeLessThan(corpo.indexOf("if (!tarefa) return"));
    expect(src).toContain("Esta tarefa não existe");
  });
});

describe("Central de ajuda — fonte única e servir os prints", () => {
  it("nenhuma tela lê a lista de tarefas de outro lugar que não tarefas.ts", () => {
    const fonteUnica = join(raiz, "client", "src", "pages", "ajuda", "tarefas.ts");
    const usos: string[] = [];
    for (const arquivo of arquivosTsx(join(raiz, "client", "src"))) {
      const src = readFileSync(arquivo, "utf8");
      const rel = arquivo.slice(raiz.length + 1);
      if (arquivo !== fonteUnica) {
        // uma segunda lista com o mesmo título é a divergência que se quer impedir
        expect(src, `${rel} define tarefa por fora de tarefas.ts`).not.toContain('titulo: "Vigiar um processo"');
        expect(src, `${rel} declara a própria lista de tarefas`).not.toMatch(/const TAREFAS[A-Z_]* = \[/);
      }
      if (/\b(TAREFAS_AJUDA|tarefaPorId|buscarTarefas|tarefasDoGrupo|GRUPOS_AJUDA)\b/.test(src) && arquivo !== fonteUnica) {
        usos.push(rel);
        expect(src, `${rel} usa a lista sem importar de pages/ajuda/tarefas`).toMatch(/from "(@\/pages\/ajuda\/tarefas|\.\/tarefas|\.\.\/ajuda\/tarefas)"/);
      }
    }
    expect(usos, "a home e a página da tarefa precisam ler de tarefas.ts").toEqual(
      expect.arrayContaining(["client/src/pages/Ajuda.tsx", "client/src/pages/ajuda/AjudaTarefa.tsx"]),
    );
  });

  it("a pasta client/public/ajuda existe e o static de produção não redireciona /ajuda pra /ajuda/", () => {
    // Com a pasta dist/public/ajuda no ar, o `express.static` padrão devolve
    // 301 → "/ajuda/" antes de o index.html ter a vez (medido). O `redirect:
    // false` é o que mantém a URL limpa e a rota do app inteira.
    expect(existsSync(join(raiz, "client", "public", "ajuda"))).toBe(true);
    const vite = semComentarios(ler("server/_core/vite.ts"));
    const serve = vite.slice(vite.indexOf("export function serveStatic"));
    expect(serve).toMatch(/express\.static\(distPath,\s*\{\s*redirect:\s*false\s*\}\)/);
  });

  it("os prints são PNG de até 250 KB, nomeados <tarefa>-<n>.png por tarefa que existe", () => {
    const dir = join(raiz, "client", "public", "ajuda");
    const arquivos = readdirSync(dir).filter((a) => a.endsWith(".png"));
    expect(arquivos.length).toBeGreaterThan(0);
    for (const a of arquivos) {
      const m = a.match(/^([a-z0-9-]+)-(\d)\.png$/);
      expect(m, `nome fora do padrão: ${a}`).toBeTruthy();
      expect(tarefaPorId(m![1]), `${a} não pertence a tarefa nenhuma`).toBeTruthy();
      const kb = statSync(join(dir, a)).size / 1024;
      expect(kb, `${a} tem ${Math.round(kb)} KB — reduzir pra 1200px`).toBeLessThanOrEqual(250);
      const cabecalho = readFileSync(join(dir, a)).subarray(0, 8).toString("hex");
      expect(cabecalho, `${a} não é PNG`).toBe("89504e470d0a1a0a");
    }
  });
});
