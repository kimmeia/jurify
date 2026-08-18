/**
 * Uma credencial do PDPJ valendo em todos os PJe.
 *
 * O login é nacional — o mesmo CPF/OAB entra em qualquer estado. O cofre
 * amarrava cada credencial a UM sistema, então monitorar processo de outro
 * estado exigia cadastrar a mesma pessoa de novo: a mesma senha guardada N
 * vezes e N credenciais quase idênticas na lista, que é exatamente o terreno
 * onde nasceu a confusão entre a 38.828 e a 38.838.
 *
 * A parte que não é óbvia, e que estes testes protegem mais: a SESSÃO. Cada
 * PJe é um portal com cookies próprios, e uma credencial servindo vários
 * estados com uma sessão só faria o acesso a um derrubar o do outro — o
 * tribunal passaria a ver login atrás de login da mesma conta.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  SISTEMA_PJE_NACIONAL,
  sistemaAtendeTribunal,
  tribunaisPjeDisponiveis,
  tribunalDoSistema,
} from "../processos/tribunais-pdpj";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

const helpers = ler("server/escritorio/cofre-helpers.ts");
const router = ler("server/escritorio/router-cofre-credenciais.ts");
const processos = ler("server/routers/processos.ts");
const migration = ler("drizzle/0190_cofre_multi_tribunal.sql");
const grade = ler("client/src/components/GradeTribunais.tsx");
const tela = ler("client/src/pages/Processos.tsx");

describe("alcance da credencial", () => {
  it("o sistema nacional atende qualquer PJe do registro", () => {
    for (const t of tribunaisPjeDisponiveis()) {
      expect(sistemaAtendeTribunal(SISTEMA_PJE_NACIONAL, t)).toBe(true);
    }
  });

  it("não atende tribunal fora do motor", () => {
    // TRF-5 roda por consulta pública e não usa cofre; e-SAJ não tem adapter.
    expect(sistemaAtendeTribunal(SISTEMA_PJE_NACIONAL, "trf5")).toBe(false);
    expect(sistemaAtendeTribunal(SISTEMA_PJE_NACIONAL, "tjsp")).toBe(false);
  });

  it("credencial de um estado só continua valendo só nele", () => {
    expect(sistemaAtendeTribunal("pje_tjce", "tjce")).toBe(true);
    expect(sistemaAtendeTribunal("pje_tjce", "tjmg")).toBe(false);
  });

  it("o sistema nacional não nomeia estado nenhum", () => {
    // Quem for testar precisa dizer qual — "testar a credencial" não significa
    // nada quando ela vale em doze lugares.
    expect(tribunalDoSistema(SISTEMA_PJE_NACIONAL)).toBeNull();
    expect(tribunalDoSistema("pje_tjce")).toBe("tjce");
  });

  it("a busca por credencial aceita a nacional", () => {
    // O filtro por sistema virou parâmetro do seletor único de credencial (a
    // consulta literal existia copiada em cinco lugares). A intenção é a
    // mesma: a do tribunal serve, e a nacional também.
    expect(processos).toContain("sistemas: [sistemaCofre, SISTEMA_PJE_NACIONAL]");
    expect(processos).toContain("inArray(cofreCredenciais.sistema, opcoes.sistemas)");
  });
});

describe("uma sessão por tribunal", () => {
  it("a sessão é gravada e lida com o tribunal junto", () => {
    expect(helpers).toContain("eq(cofreSessoes.tribunal, tribunal)");
  });

  it("salvar não apaga a sessão dos outros estados", () => {
    // Era a política antiga, de quando a credencial valia num estado só.
    // Mantê-la faria o acesso a MG derrubar a sessão viva do CE.
    const i = helpers.indexOf("export async function salvarSessao");
    const corpo = helpers.slice(i, i + 1400);
    expect(corpo).toContain("eq(cofreSessoes.tribunal, tribunal)");
  });

  it("o relogin usa o portal do tribunal pedido, não o do sistema gravado", () => {
    // Com alcance nacional o sistema não nomeia estado: derivar o portal dele
    // devolveria null e o relogin nunca aconteceria.
    expect(helpers).toContain("getConfigTribunal(tribunal)");
    expect(helpers).not.toContain("configPorSistema(cred.sistema)");
  });

  it("a fila de relogin é por credencial E tribunal", () => {
    // Deduplicar só por credencial faria o segundo estado esperar pelo
    // primeiro e receber a sessão do portal errado.
    expect(helpers).toContain("const chave = `${credencialId}:${tribunal}`");
  });

  it("a migration preserva a sessão que já existia", () => {
    // Sem o backfill, a sessão viva do TJCE viraria órfã no deploy e o
    // primeiro acesso faria login à toa.
    expect(migration).toContain("SET s.tribunalSessao = SUBSTRING(c.sistema, 5)");
    expect(migration).toContain("ADD COLUMN tribunalSessao");
  });
});

describe("o resultado é por estado", () => {
  it("existe registro por (credencial, tribunal)", () => {
    // Sem ele, uma falha em MG derrubaria a credencial inteira e o CE, que
    // funciona, apareceria quebrado junto.
    expect(helpers).toContain("export async function registrarTribunal");
    expect(migration).toContain("cofre_credencial_tribunais");
    expect(migration).toContain("uq_cofre_cred_tribunal");
  });

  it("a validação diz em qual tribunal testou", () => {
    expect(router).toContain("const tribunalAlvo =");
    expect(router).toContain("tribunal: tribunalAlvo,");
  });

  it("a consulta devolve TODOS os estados do alcance, não só os testados", () => {
    // O "não testado" é a informação principal: prometer os doze e descobrir
    // na hora do prazo qual não responde seria pior que não oferecer.
    expect(router).toContain("tribunaisDaCredencial");
    expect(router).toContain('status: r?.status ?? ("nao_testado" as const)');
  });
});

describe("a lista de sistemas sai do motor", () => {
  it("não é mais escrita à mão", () => {
    // A lista fixa divergiu: prometia E-SAJ TJSP e TRT-7, sem adapter, e
    // escondia 9 estados que o motor já atendia.
    expect(router).toContain("tribunaisPjeDisponiveis()");
    expect(router).not.toContain("em desenvolvimento");
    expect(router).not.toContain("esaj_tjsp");
  });

  it("oferece o alcance nacional como primeira opção", () => {
    expect(router).toContain("id: SISTEMA_PJE_NACIONAL");
  });

  it("o cadastro só aceita sistema que o motor sabe usar", () => {
    // Eram 26 ids, incluindo e-SAJ e e-Proc sem adapter: o cofre guardava a
    // senha criptografada pra um sistema que nunca ia conseguir usá-la.
    expect(router).toContain("const SISTEMAS_VALIDOS: readonly SistemaCofre[] = [");
    expect(router).not.toContain('"eproc_trf2"');
    expect(router).not.toContain('"pje_restrito_trt7"');
  });
});

describe("trocar o alcance sem remover", () => {
  it("existe procedure pra isso", () => {
    // Sem ela, o caminho pra tornar nacional uma credencial que já existe era
    // remover e cadastrar de novo — a mesma sequência que parou 420 processos.
    expect(router).toContain("alterarAlcance: protectedProcedure");
  });

  it("não passa perto de remover: só troca o campo", () => {
    const i = router.indexOf("alterarAlcance: protectedProcedure");
    const corpo = router.slice(i, i + 3600);
    expect(corpo).toContain("set({ sistema: input.sistema })");
    expect(corpo).not.toContain('status: "removida"');
  });

  it("estreitar o alcance avisa antes de pausar processo", () => {
    const i = router.indexOf("alterarAlcance: protectedProcedure");
    const corpo = router.slice(i, i + 3600);
    expect(corpo).toContain("confirmarPausarMonitoramentos");
    expect(corpo).toContain("PRECONDITION_FAILED");
  });

  it("apaga a sessão dos tribunais que saíram do alcance", () => {
    // Cookie de portal que a credencial não atende mais não serve pra nada e
    // não tem por que ficar guardado.
    const i = router.indexOf("alterarAlcance: protectedProcedure");
    expect(router.slice(i, i + 3600)).toContain("foraDoAlcance");
  });

  it("as escritas são uma transação só", () => {
    const i = router.indexOf("alterarAlcance: protectedProcedure");
    expect(router.slice(i, i + 3600)).toContain("await db.transaction(async (tx)");
  });
});

describe("quem pode assumir os processos", () => {
  it("a busca de destino pergunta se ATENDE, não se o texto é igual", () => {
    // Comparar `sistema` literalmente deixava a credencial nacional de fora
    // como destino de uma credencial de um estado só: o sistema concluía "não
    // há destino" e pausava os processos com a solução ali do lado.
    expect(router).toContain("sistemaAtendeTribunal(c.sistema, t)");
    expect(router).not.toContain("eq(cofreCredenciais.sistema, cred.sistema)");
  });

  it("o corte por tribunal também", () => {
    expect(router).toContain("sistemaAtendeTribunal(sistemaDestino, c.tribunal)");
  });

  it("o painel de órfãos oferece a nacional como destino", () => {
    expect(router).toContain("sistemaAtendeTribunal(c.sistema, tribunal)");
  });

  it("escolhe o destino que cobre mais processos", () => {
    expect(router).toContain("cobre: tribunaisEmJogo.filter");
  });
});

describe("a tela", () => {
  it("deixa escolher entre um estado e todos", () => {
    expect(tela).toContain("Onde essa credencial vale");
    expect(tela).toContain("SISTEMA_NACIONAL");
  });

  it("mostra a grade só pra credencial nacional", () => {
    expect(tela).toContain("c.sistema === SISTEMA_NACIONAL");
    expect(tela).toContain("GradeDaCredencial");
  });

  it("chama “não testado” de não testado, sem prometer", () => {
    expect(grade).toContain("não testado");
    expect(grade).toContain("é honesto, não é promessa");
    expect(grade).not.toContain("em desenvolvimento");
  });

  it("dá pra testar um estado sem esperar aparecer processo dele", () => {
    expect(grade).toContain("onTestar");
    expect(tela).toContain("validar.mutate({ id: credencialId, tribunal })");
  });

  it("o alcance se troca pelo card, sem remover nada", () => {
    expect(tela).toContain("setAlcanceAlvo");
    expect(tela).toContain("alterarAlcance.mutate");
  });

  it("estreitar o alcance confirma em dois cliques, com o número na tela", () => {
    // O servidor recusa e devolve QUANTOS processos param; essa mensagem vira
    // o aviso, e só o segundo clique confirma. Mandar `true` de saída faria o
    // primeiro clique consentir com um número que ninguém viu.
    expect(tela).toContain("setAlcancePendente");
    expect(tela).toContain("confirmarPausarMonitoramentos: alcancePendente?.sistema === o.id");
  });
});
