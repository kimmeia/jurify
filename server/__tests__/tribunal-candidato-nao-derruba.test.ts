/**
 * Portal candidato não fala pela credencial, e não aceita processo sem prova.
 *
 * Em 13/09/2026 os 24 TRTs entraram no registro do PJe com o endereço DEDUZIDO
 * do padrão histórico do PJe-JT. Nenhum foi aberto por ninguém. Três estragos
 * saíram disso, e é o que estes testes travam:
 *
 *  1. O registro foi de 16 pra 40 tribunais, e a grade do Cofre de uma
 *     credencial nacional foi de 30 pra 78 logins REAIS — 48 deles TRT. O
 *     "Testar tudo" roda a fila em série, dezenas de segundos por login.
 *  2. `validarMinha` grava o resultado de cada teste na LINHA DA CREDENCIAL.
 *     Como os TRTs estão no fim da fila e nenhum tem como responder, era
 *     sempre um TRT que dava a palavra final — e a credencial do TJCE, que
 *     funciona todo dia, terminava a bateria marcada como "erro".
 *  3. CNJ trabalhista passou a ser aceito no monitoramento. Cada ciclo do cron
 *     tentava um login no endereço deduzido, falhava, e a falha marcava a
 *     credencial compartilhada como expirada — com notificação "credencial
 *     caiu" pro dono.
 *
 * A regra que ficou: o resultado POR TRIBUNAL continua sendo gravado sempre
 * (`registrarTribunal`), a célula do TRT fica vermelha e explicada, e nada sai
 * da tela. O que o candidato não faz mais é falar pela credencial nem aceitar
 * processo antes de um login de verdade ter passado nele.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  coberturaTribunais,
  mensagemTribunalEmTeste,
  tribunalEmTeste,
} from "../../shared/tribunais-pje";
import { falhaDerrubaCredencial } from "../escritorio/cofre-helpers";
import { tribunalPrecisaDeProva } from "../processos/tribunal-comprovado";
import { segundoGrauMapeado, tribunaisPjeDisponiveis } from "../processos/tribunais-pdpj";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

const helpers = ler("server/escritorio/cofre-helpers.ts");
const routerCofre = ler("server/escritorio/router-cofre-credenciais.ts");
const routerProcessos = ler("server/routers/processos.ts");
const routerImportar = ler("server/escritorio/router-importar-processos.ts");
const comprovado = ler("server/processos/tribunal-comprovado.ts");
const grade = ler("client/src/components/GradeTribunais.tsx");
const tela = ler("client/src/pages/Processos.tsx");
const pacote = JSON.parse(ler("package.json")) as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

describe("quem é candidato", () => {
  it("os 24 TRTs são candidatos e nenhum TJ ou TRF é", () => {
    const emTeste = coberturaTribunais().emTeste.map((t) => t.codigo);
    expect(emTeste.length).toBe(24);
    for (const codigo of emTeste) expect(tribunalEmTeste(codigo)).toBe(true);
    for (const codigo of ["tjce", "tjmt", "tjrj", "trf1", "trf5"]) {
      expect(tribunalEmTeste(codigo)).toBe(false);
    }
  });

  it("tribunal desconhecido, vazio ou nulo não é candidato", () => {
    expect(tribunalEmTeste("tjsp")).toBe(false);
    expect(tribunalEmTeste("")).toBe(false);
    expect(tribunalEmTeste(null)).toBe(false);
    expect(tribunalEmTeste(undefined)).toBe(false);
  });

  it("TRT2 e TRT15 são candidatos pelo caminho da credencial, mas não pedem prova — a consulta pública deles funciona", () => {
    // Os dois estão na consulta pública: `tribunalRequerCredencial` é false, e o
    // robô vigia por número sem login nenhum. Pedir prova de credencial neles
    // barraria um caminho que já funciona.
    expect(tribunalEmTeste("trt2")).toBe(true);
    expect(tribunalEmTeste("trt15")).toBe(true);
    expect(tribunalPrecisaDeProva("trt2")).toBe(false);
    expect(tribunalPrecisaDeProva("trt15")).toBe(false);
  });

  it("os outros 22 TRTs pedem prova; TJ, TRF e consulta pública não", () => {
    const pedem = tribunaisPjeDisponiveis().filter(tribunalPrecisaDeProva);
    expect(pedem.length).toBe(22);
    expect(pedem.every((t) => t.startsWith("trt"))).toBe(true);
    for (const t of ["tjce", "tjmt", "trf1", "trf6"]) {
      expect(tribunalPrecisaDeProva(t)).toBe(false);
    }
  });
});

describe("falha do candidato não derruba a credencial", () => {
  it("a régua diz não pro candidato e sim pro caminho comprovado", () => {
    expect(falhaDerrubaCredencial("trt7")).toBe(false);
    expect(falhaDerrubaCredencial("trt24")).toBe(false);
    expect(falhaDerrubaCredencial("tjce")).toBe(true);
    expect(falhaDerrubaCredencial("tjmt")).toBe(true);
    expect(falhaDerrubaCredencial("trf1")).toBe(true);
  });

  it("o relogin automático só marca a credencial como expirada quando a régua permite", () => {
    const trecho = helpers.slice(
      helpers.indexOf("async function tentarReloginAutomaticoImpl"),
      helpers.indexOf("export async function marcarCredencialExpirada"),
    );
    // Os DOIS caminhos de falha (login recusado e crash técnico) passam pela
    // régua. Conferir só um deixava o outro escapar — foi o que a mutação pegou.
    expect(trecho.match(/if \(falhaDerrubaCredencial\(tribunal\)\) \{/g)?.length).toBe(2);
    // Três chamadas no total: as duas guardadas pela régua, mais a de
    // "não pôde ser decriptada" — essa É da credencial, não de portal nenhum, e
    // continua global de propósito.
    expect(trecho.match(/await marcarCredencialExpirada\(credencialId,/g)?.length).toBe(3);
    expect(trecho).toContain('marcarCredencialExpirada(credencialId, "Credencial não pôde ser decriptada")');
    // Nunca solta: toda falha vira linha daquele tribunal, inclusive a do crash
    // (sucesso, falha de login e erro técnico — três gravações).
    expect(trecho.match(/registrarTribunal\(credencialId, tribunal,/g)?.length).toBe(3);
    expect(trecho).toMatch(/motivo: `Erro técnico: \$\{msg\.slice\(0, 200\)\}`,\s*\n\s*\}\);/);
  });

  it("o 'Validar' (e portanto o 'Testar tudo') só deixa a FALHA escrever na credencial quando é caminho comprovado", () => {
    expect(routerCofre).toMatch(
      /if \(resultado\.ok \|\| falhaDerrubaCredencial\(tribunalAlvo\)\) \{\s*\n\s*await atualizarStatusAposLogin\(/,
    );
    // Sucesso sempre promove — é ele que religa monitoramento preso.
    expect(routerCofre).toContain("falhaDerrubaCredencial,");
    // O resultado por tribunal continua sendo gravado em qualquer caso.
    expect(routerCofre).toContain("await registrarTribunal(input.id, tribunalAlvo, {");
  });
});

describe("a grade do Cofre tira o candidato da bateria sem tirar da tela", () => {
  it("o servidor marca cada linha com `emTeste` pela mesma régua da shared", () => {
    expect(routerCofre).toContain("emTeste: tribunalEmTeste(t),");
  });

  it("a bateria roda só caminho comprovado com endereço, e a tela usa ESSA conta", () => {
    expect(grade).toMatch(
      /export function alvosDaBateria[\s\S]{0,200}?filter\(\(t\) => !t\.semCobertura && !t\.emTeste\)/,
    );
    // A tela não pode ter a sua própria conta: a barra de progresso prometia um
    // total e a fila rodava outro.
    expect(tela).toContain("const alvos = alvosDaBateria(");
    expect(tela).toContain("alvosDaBateria((q.data.tribunais ?? []) as any[]).length");
    expect(tela).not.toContain('filter((t: any) => !t.semCobertura).length');
  });

  it("o candidato continua na grade, numa dobra, testável um por um", () => {
    expect(grade).toContain("Em teste — Justiça do Trabalho");
    expect(grade).toContain("const candidatos = tribunais.filter((t) => t.emTeste);");
    // `linhaDoEstado` desde 13/09: a grade passou a ser UMA linha por estado
    // (o cartão media 2.566px). O mesmo desenho serve aos dois caminhos —
    // é isso que esta amarra guarda, não o nome antigo.
    expect(grade).toContain("{estadosCandidatos.map((estado) => linhaDoEstado(estado))}");
    expect(grade).toContain("{estados.map((estado) => linhaDoEstado(estado))}");
  });

  it("as contagens do rodapé falam do caminho comprovado — senão diriam '48 falharam'", () => {
    expect(grade).toContain("comprovados.filter((t) => !t.semCobertura && t.status === s).length");
  });

  it("medido: a bateria da credencial nacional cai de 78 pra 30 alvos", () => {
    // Reproduz a conta do servidor (alcance × grau, menos os sem endereço) e
    // confere o efeito da dobra. Números vêm do registro, não digitados.
    const alcance = tribunaisPjeDisponiveis();
    const linhas = alcance.flatMap((t) =>
      [1, 2].map((grau) => ({
        tribunal: t,
        semCobertura: grau === 2 && !segundoGrauMapeado(t),
        emTeste: tribunalEmTeste(t),
      })),
    );
    expect(linhas.filter((l) => !l.semCobertura).length).toBe(78);
    expect(linhas.filter((l) => !l.semCobertura && !l.emTeste).length).toBe(30);
  });
});

describe("processo de tribunal candidato só entra com prova de login", () => {
  it("a prova é uma linha `ativa` daquele tribunal, numa credencial não removida do escritório", () => {
    // As DUAS leituras precisam das três condições: a de um tribunal
    // (`escritorioProvouTribunal`) e a do lote da importação
    // (`tribunaisProvadosDoEscritorio`). Conferir o arquivo inteiro deixava
    // tirar de uma e o literal continuar de pé na outra — a mutação pegou.
    const umTribunal = comprovado.slice(
      comprovado.indexOf("export async function escritorioProvouTribunal"),
      comprovado.indexOf("export async function tribunaisProvadosDoEscritorio"),
    );
    const oLote = comprovado.slice(
      comprovado.indexOf("export async function tribunaisProvadosDoEscritorio"),
      comprovado.indexOf("export async function exigirTribunalComprovado"),
    );
    expect(umTribunal).toContain('eq(cofreCredencialTribunais.tribunal, codigoTribunal)');
    for (const consulta of [umTribunal, oLote]) {
      expect(consulta.length).toBeGreaterThan(100);
      expect(consulta).toContain('eq(cofreCredencialTribunais.status, "ativa")');
      expect(consulta).toContain("eq(cofreCredenciais.escritorioId, escritorioId)");
      expect(consulta).toContain('ne(cofreCredenciais.status, "removida")');
    }
  });

  it("as quatro portas de processo passam pelo portão", () => {
    // consultarCNJ, consultarCNJSincrono, criarMonitoramento e
    // criarMonitoramentoNovasAcoes. Se nascer uma quinta porta sem o portão,
    // esta conta acusa.
    expect(routerProcessos.match(/await exigirTribunalComprovado\(/g)?.length).toBe(4);
    expect(routerProcessos).toContain(
      "await exigirTribunalComprovado(db, esc.escritorio.id, tribunal.codigoTribunal);",
    );
    expect(routerProcessos).toContain(
      "await exigirTribunalComprovado(db, esc.escritorio.id, tribunalDaCred);",
    );
  });

  it("a consulta é barrada ANTES de cobrar do plano", () => {
    const trecho = routerProcessos.slice(
      routerProcessos.indexOf("consultarCNJ: protectedProcedure"),
      routerProcessos.indexOf("consultarStatus"),
    );
    const portao = trecho.indexOf("await exigirTribunalComprovado(");
    const cobranca = trecho.indexOf('contarUso(esc.escritorio.id, "consulta_processo")', portao);
    expect(portao).toBeGreaterThan(-1);
    // A única cobrança ANTES do portão é a da consulta pública, que nem chega
    // no portão (tribunal de consulta pública retorna antes).
    expect(cobranca).toBeGreaterThan(portao);
  });

  it("a importação de planilha não cria o monitor, explica a linha, e pergunta ao banco UMA vez", () => {
    expect(routerImportar).toContain("tribunalPrecisaDeProva(linha.codigoTribunal)");
    expect(routerImportar).toContain("!tribunaisProvados.has(linha.codigoTribunal)");
    expect(routerImportar).toContain("motivo: mensagemTribunalEmTeste(siglaDoTribunal(linha.codigoTribunal)),");
    // Uma consulta pro lote inteiro: por linha, uma planilha de 500 processos
    // viraria 500 idas ao banco. A leitura tem que vir ANTES da decisão linha a
    // linha — é o que garante que ela não está dentro do laço.
    expect(routerImportar.match(/tribunaisProvadosDoEscritorio\(db,/g)?.length).toBe(1);
    expect(routerImportar.indexOf("tribunaisProvadosDoEscritorio(db,")).toBeLessThan(
      routerImportar.indexOf("tribunalPrecisaDeProva(linha.codigoTribunal)"),
    );
  });

  it("a mensagem diz o que falta e onde fazer", () => {
    const m = mensagemTribunalEmTeste("TRT7");
    expect(m).toContain("TRT7");
    expect(m).toContain("Cofre");
    expect(m).toContain("teste de login");
  });
});

describe("linkedom é dependência de produção", () => {
  it("o parser novo do PJe importa linkedom, então ele não pode viver em devDependencies", () => {
    // `pnpm build` usa `--packages=external`: o pacote não é embutido, é
    // resolvido em runtime. Em devDependencies, o dia em que
    // `adapters/parse/pje-lista.ts` entrar no caminho de produção o servidor
    // morre no import — e o teste que pega isso é este, não o typecheck.
    expect(ler("server/processos/adapters/parse/dom.ts")).toContain('from "linkedom"');
    expect(pacote.dependencies.linkedom).toBeTruthy();
    expect(pacote.devDependencies.linkedom).toBeUndefined();
  });
});
