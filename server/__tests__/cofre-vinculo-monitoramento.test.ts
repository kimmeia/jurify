/**
 * Remover credencial não pode deixar processo órfão.
 *
 * `motor_monitoramentos.credencial_id` guarda o ID da credencial. Remover a
 * credencial era um `UPDATE status='removida'` e nada mais: os processos
 * continuavam apontando pra ela, o robô tentava usar um login apagado, e o
 * escritório descobria dias depois que 420 processos estavam parados. A tela
 * não mostrava esse vínculo em lugar nenhum, então o motivo era invisível.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

const router = ler("server/escritorio/router-cofre-credenciais.ts");
const helpers = ler("server/escritorio/cofre-helpers.ts");
const tela = ler("client/src/pages/Processos.tsx");

describe("a remoção trata o vínculo", () => {
  it("mede o impacto antes de remover", () => {
    expect(router).toContain("calcularImpacto");
    expect(router).toContain("impactoRemocao");
  });

  it("passa os processos pra outra credencial quando existe uma", () => {
    expect(router).toContain("impacto.destinoSugerido");
    expect(router).toContain("aplicarRepontar(tx, aceitos");
  });

  it("decide tudo antes de escrever qualquer coisa", () => {
    // Pedir confirmação depois de já ter movido metade deixaria o banco num
    // estado que ninguém escolheu.
    const i = router.indexOf("removerMinha: protectedProcedure");
    const corpo = router.slice(i, i + 4200);
    const posThrow = corpo.indexOf("confirmarPausarMonitoramentos)");
    const posEscrita = corpo.indexOf("await db.transaction(async (tx)");
    expect(posThrow).toBeGreaterThan(0);
    expect(posEscrita).toBeGreaterThan(posThrow);
  });

  it("não deixa preso na credencial removida quem o destino não atende", () => {
    // Sem isto, o filtro por tribunal criaria o próprio órfão que este código
    // veio consertar: o processo ficaria apontando pra credencial apagada.
    expect(router).toContain("pausarSemCredencial");
    expect(router).toContain("const vaoPausar =");
  });

  it("recusa remover em silêncio quando isso pausa processo", () => {
    // Sem confirmação explícita, remover parava o robô sem dizer nada — que é
    // exatamente como o problema apareceu.
    expect(router).toContain("confirmarPausarMonitoramentos");
    expect(router).toContain("PRECONDITION_FAILED");
  });

  it("pausa, não marca erro", () => {
    // Nada falhou: foi decisão de quem removeu. "erro" mandaria o cron tentar
    // de novo pra sempre contra uma credencial que não existe mais.
    expect(router).toContain('status: "pausado"');
    expect(router).toContain("PAUSA_POR_REMOCAO");
  });

  it("o destino sugerido ATENDE os tribunais e está ativo", () => {
    // Antes a regra era "mesmo texto no campo sistema", o que deixava a
    // credencial nacional de fora como destino de uma de um estado só — o
    // sistema concluía "não há destino" e pausava os processos com a solução
    // ali do lado.
    const i = router.indexOf("async function calcularImpacto");
    const trecho = router.slice(i, i + 3000);
    expect(trecho).toContain("sistemaAtendeTribunal(c.sistema, t)");
    expect(trecho).toContain('eq(cofreCredenciais.status, "ativa")');
    expect(trecho).toContain("ne(cofreCredenciais.id, credencialId)");
  });
});

describe("repontar", () => {
  it("recusa destino que não atende o tribunal daqueles processos", () => {
    expect(router).toContain("não atende o tribunal desses processos");
  });

  it("não aceita destino removido", () => {
    expect(router).toContain('destino.status === "removida"');
  });

  it("desfaz a pausa que a própria remoção causou", () => {
    // `deveReligarMonitoramento` se recusa a religar pausado — a regra existe
    // porque pausa costuma ser escolha de quem usa. Esta pausa foi efeito
    // colateral nosso, e sem a exceção o processo ficaria parado pra sempre.
    expect(router).toContain("a.ultimoErro?.startsWith(PAUSA_POR_REMOCAO)");
  });

  it("não apaga erro de outra natureza", () => {
    expect(router).toContain("deveReligarMonitoramento");
  });

  it("não amarra credencial em processo de tribunal público", () => {
    // TRF-5 consulta sem cofre: o vínculo nulo dele é proposital, não órfão.
    // Reapontar "os que estão sem credencial" carimbaria uma OAB do TJCE em
    // processo federal — e ainda religaria monitoramento parado por outro
    // motivo.
    expect(router).toContain("if (!tribunalRequerCredencial(c.tribunal)) desvincular.push(c.id);");
    // E o destino precisa atender aquele tribunal: uma credencial do TJCE não
    // abre processo do TJMG, mas uma nacional abre os dois.
    expect(router).toContain("sistemaAtendeTribunal(sistemaDestino, c.tribunal)");
  });

  it("escolher e executar são dois atos", () => {
    // Mover centenas de processos no onChange de um <select> é a mesma classe
    // de acidente que apaga uma coluna inteira num clique.
    expect(tela).toContain("setRepontarAlvo");
    expect(tela).toContain("Reapontar {repontarAlvo?.total} processo(s)");
  });
});

describe("o vínculo fica visível", () => {
  it("existe consulta de processos apontando pra credencial que não atende", () => {
    expect(router).toContain("vinculosOrfaos");
    expect(router).toContain('saudavel: cred?.status === "ativa"');
  });

  it("a tela mostra o painel e deixa reapontar", () => {
    expect(tela).toContain("listaOrfaos");
    expect(tela).toContain("repontarMonitoramentos");
    expect(tela).toContain("reapontar para…");
  });

  it("o diálogo de remoção diz quantos processos dependem", () => {
    expect(tela).toContain("impactoRemocao");
    expect(tela).toContain("processo(s) monitorado(s)");
  });

  it("o aviso de sucesso conta o que aconteceu com os processos", () => {
    expect(tela).toContain("r?.repontados");
    expect(tela).toContain("r?.pausados");
  });
});

describe("credencial removida não volta sozinha", () => {
  it("o relogin automático se recusa a usar credencial apagada", () => {
    // Não é só higiene de status: seria o sistema entrando no portal do
    // tribunal com um login que o dono mandou apagar.
    expect(helpers).toContain('cred.status === "removida"');
    expect(helpers).toContain("relogin ignorado: credencial removida");
  });

  it("existe a checagem central de removida", () => {
    expect(helpers).toContain("export async function estaRemovida");
  });

  it("sessão viva de credencial removida não é entregue", () => {
    // A sessão fica noutra tabela e o cookie vale até 90 minutos. O bloqueio
    // no relogin não alcançava este caso: sessão viva nem chega a tentar
    // relogin, e o sistema seguia entrando no tribunal com um login apagado.
    const i = helpers.indexOf("export async function recuperarSessao");
    const corpo = helpers.slice(i, i + 900);
    expect(corpo).toContain("estaRemovida(credencialId)");
  });

  it("remover apaga a sessão guardada", () => {
    expect(router).toContain("delete(cofreSessoes)");
  });

  it("login em voo não regrava a sessão depois da remoção", () => {
    const i = helpers.indexOf("export async function salvarSessao");
    expect(helpers.slice(i, i + 800)).toContain("estaRemovida(credencialId)");
  });
});

describe("o que a revisão adversarial pegou", () => {
  it("o painel enxerga o vínculo NULO, que é o estado que a remoção cria", () => {
    // Era o pior defeito da primeira versão: a remoção zerava credencialId e
    // o painel filtrava isNotNull. Os processos pausados sumiam da única tela
    // que existe pra consertá-los, e a mensagem da pausa mandava reapontar
    // por um caminho que não existia.
    const i = router.indexOf("vinculosOrfaos: protectedProcedure");
    const corpo = router.slice(i, i + 2600);
    expect(corpo).not.toContain("isNotNull(motorMonitoramentos.credencialId)");
    expect(corpo).toContain("semVinculo");
  });

  it("nenhum candidato é descartado em silêncio", () => {
    // O `continue` deixava o monitoramento fora dos dois baldes, e o vínculo
    // envenenado sobrevivia à remoção — o bug original de volta.
    expect(router).toContain("desvincular.push(c.id)");
    expect(router).toContain("desvincularSemPausar");
  });

  it("a tela só oferece credencial que atende aquele tribunal", () => {
    expect(router).toContain("const atendem = (tribunal: string)");
    expect(tela).toContain("(o.destinos ?? []).map");
  });

  it("credencial caída pede validação, não mudança em massa", () => {
    expect(router).toContain('"reapontar" | "revalidar"');
    expect(tela).toContain('o.acao === "reapontar" && (');
  });

  it("pausa deliberada do escritório não é reescrita nem religada depois", () => {
    // Sobrescrever o motivo dela faria o reapontar seguinte religar um
    // processo que alguém desligou de propósito — voltando a consumir crédito
    // sem ninguém ter pedido.
    expect(router).toContain('a.status === "pausado"');
    expect(router).toContain("jaPausados");
  });

  it("erro de outra natureza sobrevive à pausa", () => {
    expect(router).toContain("Erro anterior:");
    expect(router).toContain("classificarErroMonitor(anterior)");
  });

  it("o motivo da pausa é diagnosticável pela tela do processo", () => {
    // Sem as palavras "sem credencial", classificarErroMonitor devolvia
    // "desconhecida" e o processo parado não dizia por quê.
    expect(router).toContain("sem credencial");
  });

  it("as escritas da remoção são uma transação só", () => {
    // São quatro. Morrer entre a terceira e a quarta deixaria os processos
    // desvinculados com a credencial ainda viva na lista.
    const i = router.indexOf("removerMinha: protectedProcedure");
    expect(router.slice(i, i + 4200)).toContain("await db.transaction(async (tx) =>");
  });

  it("a confirmação da tela reflete um número que apareceu de verdade", () => {
    // `true` fixo anulava a trava do servidor: o clique viraria consentimento
    // a um número que a pessoa pode nunca ter visto.
    expect(tela).toContain("confirmarPausarMonitoramentos: impacto.data != null");
    expect(tela).not.toContain("confirmarPausarMonitoramentos: true");
  });

  it("o impacto não vem de cache velho", () => {
    expect(tela).toContain('staleTime: 0, refetchOnMount: "always"');
  });
});
