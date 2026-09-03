/**
 * Auditoria de lançamento (03/09) — Processos e Cofre, cinco achados:
 *
 *  processos-9  "Monitorar" duas vezes cobrava duas vezes (sem UNIQUE por CNJ).
 *  processos-8  A importação criava monitor além do teto do plano, cobrando cada um.
 *  processos-5  "Cadastrar e testar login" não testava; a credencial ficava
 *               "validando" e sumia dos seletores.
 *  processos-2  O menu do card testava só os status legados da Judit e nunca
 *               oferecia Pausar/Reativar.
 *  processos-6  Credencial "pje_trfN" era validada no TJCE e nunca atendia o TRF.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  SISTEMA_PJE_NACIONAL,
  configPorSistema,
  sistemaAtendeTribunal,
  sistemasQueAtendem,
  tribunaisPjeDisponiveis,
  tribunalDoSistema,
} from "../processos/tribunais-pdpj";
import { sistemaCofrePorTribunal } from "../processos/cnj-parser";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

/** Recorte entre dois marcadores; falha nomeando o marcador que sumiu. */
function recorte(fonte: string, inicio: string, fim: string): string {
  const i = fonte.indexOf(inicio);
  expect(i, `marcador "${inicio}"`).toBeGreaterThan(-1);
  const f = fonte.indexOf(fim, i + inicio.length);
  expect(f, `marcador "${fim}" depois de "${inicio}"`).toBeGreaterThan(i);
  return fonte.slice(i, f);
}

const processos = ler("server/routers/processos.ts");
const importar = ler("server/escritorio/router-importar-processos.ts");
const cron = ler("server/escritorio/cron-revalidar-cofre.ts");
const tela = ler("client/src/pages/Processos.tsx");
const dialogo = ler("client/src/pages/processos/ImportarAdvboxDialog.tsx");

// ─────────────────────────────────────────────────────────────────────────────

describe("processos-9 — um CNJ, um monitoramento", () => {
  const criar = recorte(processos, "criarMonitoramento: protectedProcedure", "pausarMonitoramento: protectedProcedure");

  it("procura o monitor existente do escritório por CNJ mascarado e tipo", () => {
    const busca = recorte(criar, "const [existente]", "if (existente)");
    expect(busca).toContain("eq(motorMonitoramentos.escritorioId, esc.escritorio.id)");
    expect(busca).toContain('eq(motorMonitoramentos.tipoMonitoramento, "movimentacoes")');
    expect(busca).toContain("eq(motorMonitoramentos.searchKey, cnjMascarado)");
    // A chave gravada é a mascarada — a busca tem que usar a mesma forma.
    expect(criar.indexOf("const cnjMascarado = mascararCnj(input.numeroCnj)")).toBeLessThan(criar.indexOf("const [existente]"));
  });

  it("devolve o existente sem cobrar, ANTES do limite e do crédito", () => {
    const iExistente = criar.indexOf("if (existente)");
    const iLimite = criar.indexOf("verificarLimiteMonitoramentos(esc.escritorio.id");
    const iCobranca = criar.indexOf("consumirCreditos(");
    const iInsert = criar.indexOf("db.insert(motorMonitoramentos)");
    expect(iExistente).toBeGreaterThan(-1);
    expect(iExistente).toBeLessThan(iLimite);
    expect(iLimite).toBeLessThan(iCobranca);
    expect(iCobranca).toBeLessThan(iInsert);
    const retorno = recorte(criar, "if (existente)", "// Limite do plano");
    expect(retorno).toContain("custoCred: 0");
    expect(retorno).toContain("jaExistia: true");
    expect(retorno).toContain("status: existente.status");
  });

  it("o caso novo se declara como novo", () => {
    expect(criar).toContain("jaExistia: false");
  });

  it("a tela avisa 'já monitorado' em vez de comemorar, nas três mutations", () => {
    const aviso = recorte(tela, "function avisarSeJaMonitorado", "function ProcessoCard(");
    expect(aviso).toContain("if (!d?.jaExistia) return false;");
    expect(aviso).toContain('toast.info("Este processo já está monitorado — nada foi cobrado."');
    expect(aviso).toContain('d.status === "pausado" ? "Ele está pausado; reative pelo menu do card." : undefined');

    const blocos = tela.split("trpc.processos.criarMonitoramento.useMutation(").slice(1);
    expect(blocos, "consulta avulsa, aba Monitoramento e Novas Ações").toHaveLength(3);
    for (const b of blocos) {
      const onSuccess = b.slice(0, b.indexOf("onError"));
      expect(onSuccess).toContain("avisarSeJaMonitorado(d)");
    }
  });

  it("o botão do card trava enquanto o pedido está em voo", () => {
    const card = recorte(tela, "function ProcessoCard(", "function ConsultarTab()");
    expect(card).toContain("monitorando?: boolean;");
    const botao = recorte(card, "{onMonitorar && d.code && (", "Monitorar\n");
    expect(botao).toContain("disabled={monitorando}");
    expect(botao).toContain("{monitorando\n                  ? <Loader2");
  });

  it("o handler ignora o 2º clique e o card sabe qual CNJ está em voo", () => {
    const handler = recorte(tela, "const handleMonitorar = (cnj: string, processo?: any) => {", "// Resolve credencial");
    expect(handler).toContain("if (monitorarMut.isPending) return;");
    expect(tela).toContain("monitorando={monitorarMut.isPending && monitorarMut.variables?.numeroCnj === cnj}");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("processos-8 — importação respeita o teto do plano sem cobrar o excedente", () => {
  const executar = recorte(importar, "executarAdvbox: protectedProcedure", "export const __test");
  const antesDoLoop = executar.slice(0, executar.indexOf("for (const linha of input.linhas)"));
  const loop = executar.slice(executar.indexOf("for (const linha of input.linhas)"));

  it("lê o limite uma vez, antes do loop, só quando vai monitorar", () => {
    expect(antesDoLoop).toContain('verificarLimiteMonitoramentos(perm.escritorioId, "movimentacoes")');
    const bloco = recorte(antesDoLoop, "let vagasMonitoramento", "carregarMapaContatos");
    expect(bloco).toContain("if (input.monitorar)");
    // null = sem teto (fail-open do helper) — nunca vira 0 por acidente.
    expect(bloco).toContain("limiteMon.maximo == null ? null : Math.max(0, limiteMon.maximo - limiteMon.atual)");
  });

  it("acima das vagas: não cobra, não insere, conta e explica na linha", () => {
    const ramo = recorte(loop, "resultado.monitoramentosCriados >= vagasMonitoramento", "} else {");
    expect(ramo).not.toContain("consumirCreditosEscritorio(");
    expect(ramo).not.toContain("db.insert(motorMonitoramentos)");
    expect(ramo).toContain("resultado.monitoramentosLimitePlano++");
    expect(ramo).toContain("Limite do plano (${maximoMonitoramento} processos vigiados): monitor não criado, sem cobrança.");
    // A checagem vem ANTES do ramo que cobra.
    expect(loop.indexOf("resultado.monitoramentosCriados >= vagasMonitoramento")).toBeLessThan(loop.indexOf("consumirCreditosEscritorio("));
    // `vagasMonitoramento !== null` é o que preserva o fail-open.
    expect(loop).toContain("vagasMonitoramento !== null &&");
  });

  it("o contador nasce em 0 no resultado", () => {
    expect(recorte(executar, "const resultado = {", "};")).toContain("monitoramentosLimitePlano: 0,");
  });

  it("o dialog acumula o contador e mostra o card só quando há excedente", () => {
    expect(recorte(dialogo, "type ResultadoFinal = {", "};")).toContain("monitoramentosLimitePlano: number;");
    expect(recorte(dialogo, "const acumulado: ResultadoFinal = {", "};")).toContain("monitoramentosLimitePlano: 0,");
    expect(dialogo).toContain("acumulado.monitoramentosLimitePlano += r.monitoramentosLimitePlano ?? 0;");
    const card = recorte(dialogo, "{resultado.monitoramentosLimitePlano > 0 && (", "</div>\n                  )}");
    expect(card).toContain("Fora do limite do plano");
    expect(card).toContain("{resultado.monitoramentosLimitePlano}");
    // O bloco "Monitoramento" precisa aparecer mesmo quando SÓ houve excedente.
    expect(dialogo).toContain("resultado.monitoramentosLimitePlano > 0) && (");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("processos-5 — 'Cadastrar e testar login' testa de verdade", () => {
  const cofre = recorte(tela, "function CofreTab()", "const creds = credenciais || [];");
  const validarApos = recorte(cofre, "const validarAposCadastroMut", "const cadastrarMut =");
  const cadastrar = recorte(cofre, "const cadastrarMut =", "const removerMut =");

  it("existe um hook próprio pra validação pós-cadastro, declarado antes do cadastro", () => {
    expect(validarApos).toContain("trpc.cofreCredenciais.validarMinha.useMutation(");
    expect(cofre.indexOf("const validarAposCadastroMut")).toBeLessThan(cofre.indexOf("const cadastrarMut ="));
  });

  it("ramifica pelo contrato real de validarMinha (ok / semCobertura / mensagem), não por `status`", () => {
    expect(validarApos).toContain("if (r?.totpSecretNovo) setSecretNovo(r.totpSecretNovo);");
    expect(validarApos.indexOf("r?.semCobertura")).toBeLessThan(validarApos.indexOf("r?.ok"));
    expect(validarApos).toContain('toast.warning("Cadastrada, mas sem cobertura", { description: r.mensagem })');
    expect(validarApos).toContain('toast.success("Credencial cadastrada e login confirmado", { description: r.mensagem })');
    expect(validarApos).toContain('toast.error("Cadastrada, mas o login falhou", { description: r?.mensagem, duration: 12000 })');
    expect(validarApos).toContain('toast.error("Cadastrada, mas não deu pra testar o login", { description: e.message })');
    expect(validarApos).toContain("refetch();");
    expect(validarApos).not.toContain("data?.status");
  });

  it("o cadastro dispara o login e para de prometer resultado que não teve", () => {
    expect(cadastrar).toContain('toast.info("Credencial cadastrada. Testando o login no tribunal…")');
    expect(cadastrar).toContain("validarAposCadastroMut.mutate({ id: data.id })");
    expect(cadastrar).not.toContain("Validação pendente");
    expect(cadastrar).not.toContain('data.status === "ativa"');
    // O resto do onSuccess continua: fecha o dialog, limpa o form, recarrega.
    expect(cadastrar).toContain("setNovoOpen(false);");
    expect(cadastrar).toContain("setQrLido(null);");
    expect(cadastrar).toContain("refetch();");
  });

  it("os seletores aceitam 'validando', como a aba Monitoramento já fazia", () => {
    const filtro = 'c.status === "ativa" || c.status === "validando"';
    expect(recorte(tela, "function NovasAcoesTab()", "const LIMITE_PAGINA")).toContain(filtro);
    expect(dialogo).toContain(filtro);
    // Consulta avulsa + aba Monitoramento + Novas Ações.
    expect(tela.split(filtro).length - 1).toBeGreaterThanOrEqual(3);
  });

  it("o servidor da importação aceita o que o dialog oferece", () => {
    expect(importar).toContain('inArray(cofreCredenciais.status, ["ativa", "validando"])');
    expect(importar).not.toContain('eq(cofreCredenciais.status, "ativa")');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("processos-2 — Pausar/Reativar no menu do card", () => {
  const card = recorte(tela, "function MonitoramentoCard(", "function MonitorarTab(");

  it("decide pelo status que o servidor grava, mantendo o legado no OR", () => {
    // A borda e o avatar já usavam este `pausado`; só o menu testava os
    // valores legados da Judit ("created"/"updating"/"paused").
    expect(card).toContain('const pausado = status === "paused" || status === "pausado";');
    expect(card).not.toContain('status === "created" || status === "updated"');
    expect(card.indexOf("const pausado =")).toBeLessThan(card.indexOf("{!pausado && ("));
  });

  it("Pausar quando não está pausado; Reativar quando está", () => {
    const menu = recorte(card, "{!pausado && (", "Excluir");
    expect(menu.indexOf("Pausar monitoramento")).toBeGreaterThan(-1);
    expect(menu.indexOf("{pausado && (")).toBeGreaterThan(menu.indexOf("Pausar monitoramento"));
    expect(menu.indexOf("Reativar")).toBeGreaterThan(menu.indexOf("{pausado && ("));
  });

  it("a bolinha de saúde reconhece 'pausado'", () => {
    const dot = recorte(tela, "function MonitorHealthDot(", "function poloDaParte(");
    expect(dot).toContain('statusJudit === "paused" || statusJudit === "pausado"');
  });

  it("falha ao pausar/reativar avisa em vez de sumir", () => {
    const pausar = recorte(tela, "const pausarMut = trpc.processos.pausarMonitoramento.useMutation(", "const reativarMut");
    expect(pausar).toContain('toast.error("Não foi possível pausar", { description: e.message })');
    const reativar = recorte(tela, "const reativarMut = trpc.processos.reativarMonitoramento.useMutation(", "const deletarMut");
    expect(reativar).toContain('toast.error("Não foi possível reativar", { description: e.message })');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("processos-6 — credencial PJe TRF validada e usada no TRF", () => {
  it("pje_trf1 resolve o portal do TRF1, não o do TJCE", () => {
    expect(configPorSistema("pje_trf1")?.urlEntrada).toBe("https://pje1g.trf1.jus.br/pje/login.seam");
    expect(tribunalDoSistema("pje_trf1")).toBe("trf1");
    expect(sistemaAtendeTribunal("pje_trf1", "trf1")).toBe(true);
    expect(sistemaAtendeTribunal("pje_trf1", "tjce")).toBe(false);
  });

  it("o que não é PJe do registro continua null", () => {
    expect(configPorSistema("pje_*")).toBeNull();
    expect(configPorSistema("pje_trf4")).toBeNull();
    expect(configPorSistema("pje_trf5")).toBeNull();
    expect(configPorSistema("eproc_trf2")).toBeNull();
    expect(configPorSistema("pje_restrito_trt7")).toBeNull();
  });

  it("TODO id de sistema que o cofre oferece resolve tribunal", () => {
    // Mesma construção de SISTEMAS_VALIDOS em router-cofre-credenciais.
    for (const t of tribunaisPjeDisponiveis()) {
      const id = `pje_${t === "tjdf" ? "tjdft" : t}`;
      expect(tribunalDoSistema(id), id).toBe(t);
      expect(sistemaAtendeTribunal(id, t), id).toBe(true);
    }
  });

  it("sistemasQueAtendem: específico primeiro, nacional depois, sem repetir", () => {
    expect(sistemasQueAtendem("trf1")).toEqual(["pje_trf1", SISTEMA_PJE_NACIONAL]);
    expect(sistemasQueAtendem("tjdf")).toEqual(["pje_tjdft", SISTEMA_PJE_NACIONAL]);
    expect(sistemasQueAtendem("tjce")).toEqual(["pje_tjce", SISTEMA_PJE_NACIONAL]);
    // Fora do registro (consulta pública, sem motor): só a nacional.
    expect(sistemasQueAtendem("trf5")).toEqual([SISTEMA_PJE_NACIONAL]);
    expect(sistemasQueAtendem("tjsp")).toEqual([SISTEMA_PJE_NACIONAL]);
    for (const t of tribunaisPjeDisponiveis()) {
      const lista = sistemasQueAtendem(t);
      expect(new Set(lista).size, t).toBe(lista.length);
      expect(lista[lista.length - 1]).toBe(SISTEMA_PJE_NACIONAL);
    }
  });

  it("pros TJs a lista é a MESMA de antes ([sistemaCofre, nacional]); só o TRF ganhou o específico", () => {
    for (const t of tribunaisPjeDisponiveis()) {
      const cofre = sistemaCofrePorTribunal(t);
      if (t.startsWith("trf")) {
        // O cnj-parser continua nomeando a nacional pros TRFs (o import depende disso).
        expect(cofre, t).toBe(SISTEMA_PJE_NACIONAL);
        expect(sistemasQueAtendem(t)[0]).toBe(`pje_${t}`);
      } else {
        expect(sistemasQueAtendem(t), t).toEqual([cofre, SISTEMA_PJE_NACIONAL]);
      }
    }
  });

  it("consultarCNJ e consultarCNJSincrono escolhem pela lista que inclui o específico", () => {
    const usos = processos.split("sistemas: sistemasQueAtendem(tribunal.codigoTribunal)").length - 1;
    expect(usos, "consultarCNJ + consultarCNJSincrono (escolha e fallback)").toBe(3);
    expect(processos).not.toContain("sistemas: [sistemaCofre, SISTEMA_PJE_NACIONAL]");
  });

  it("o cron de revalidação passa a enxergar pje_trfN sem mudança nele", () => {
    // Ele pula o que `configPorSistema` não resolve; agora resolve.
    expect(cron).toContain("const cfgTribunal = configPorSistema(c.sistema);");
    for (const n of [1, 2, 3, 6]) expect(configPorSistema(`pje_trf${n}`)).not.toBeNull();
  });
});
