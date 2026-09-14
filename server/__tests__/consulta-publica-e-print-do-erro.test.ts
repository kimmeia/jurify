/**
 * Os dois resíduos que a entrega de 13/09 deixou anotados, agora fechados.
 *
 * 1. `consultarCNJSincrono` nunca ganhou o desvio de consulta pública que o
 *    `consultarCNJ` recebeu em 12/09 — ela pedia credencial pra tribunal que
 *    não tem login. Ficou pior quando `sistemaCofrePorTribunal` passou a
 *    devolver a credencial nacional pros 24 TRTs: TRT2 e TRT15, que funcionam
 *    pela consulta aberta, passaram a tentar o login do PJe-JT, que não
 *    responde. Os dois caminhos agora nascem do MESMO despachante.
 *
 * 2. A foto do erro se perdia. `tirarScreenshotErro` já fotografava a tela do
 *    tribunal na falha e gravava em `scripts/spike-motor-proprio/samples/`, que
 *    é disco efêmero do container: o robô tirava a prova do que viu e a jogava
 *    fora. Quando o portal muda de layout, essa foto é a diferença entre ver e
 *    adivinhar — foi exatamente o que faltou no diagnóstico de 13/09.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { nomeSeguroDePrint, pastaDoPrint } from "../processos/print-do-erro";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

const routerProcessos = ler("server/routers/processos.ts");
const cron = ler("server/processos/cron-monitoramento.ts");
const schema = ler("drizzle/schema.ts");
const migration = ler("drizzle/0228_monitor_erro_print.sql");
const tela = ler("client/src/pages/Processos.tsx");

/** O corpo de uma procedure, pra assertiva não pegar a procedure vizinha. */
function corpoProcedure(nome: string, proximo: string): string {
  const i = routerProcessos.indexOf(`${nome}: protectedProcedure`);
  expect(i).toBeGreaterThan(-1);
  const j = routerProcessos.indexOf(`${proximo}:`, i);
  expect(j).toBeGreaterThan(i);
  return routerProcessos.slice(i, j);
}

describe("consultarCNJSincrono atende consulta pública", () => {
  const corpo = corpoProcedure("consultarCNJSincrono", "statusConsulta");

  it("decide pelo MESMO critério do consultarCNJ e não pede credencial ao tribunal aberto", () => {
    expect(corpo).toContain(
      "const consultaPublica = !tribunalRequerCredencial(tribunal.codigoTribunal);",
    );
    // Tudo que é do Cofre — sistema, credencial, sessão — vive DENTRO do ramo
    // que exige credencial. Fora dele, o tribunal aberto não é perguntado.
    const ramo = corpo.slice(
      corpo.indexOf("if (!consultaPublica) {"),
      corpo.indexOf("await contarUso("),
    );
    expect(ramo).toContain("sistemaCofrePorTribunal(tribunal.codigoTribunal)");
    expect(ramo).toContain("escolherCredencial(db, esc.escritorio.id, {");
    expect(ramo).toContain("recuperarSessao(credId, tribunal.codigoTribunal, {");
  });

  it("o scrape sai do despachante, não do adapter do TJCE cravado", () => {
    // Era `consultarTjce(input.cnj, storageState, cfgTribunal)`: com a config do
    // TJCE por padrão e sem caminho nenhum pro adapter aberto.
    expect(corpo).toContain(
      "resultado = await consultarProcesso(tribunal.codigoTribunal, input.cnj, storageState);",
    );
    expect(corpo).not.toContain("await consultarTjce(");
  });

  it("sessão null é o que o despachante recebe na consulta pública", () => {
    expect(corpo).toContain("let storageState: string | null = null;");
  });

  it("cobra igual, e só depois de passar por todas as guardas", () => {
    const guarda = corpo.indexOf("if (!consultaPublica) {");
    const cobranca = corpo.indexOf('await contarUso(esc.escritorio.id, "consulta_processo");');
    const scrape = corpo.indexOf("await consultarProcesso(");
    expect(guarda).toBeGreaterThan(-1);
    expect(cobranca).toBeGreaterThan(guarda);
    expect(scrape).toBeGreaterThan(cobranca);
  });

  it("tribunal do registro sem endereço mapeado não chega a cobrar", () => {
    const ramo = corpo.slice(
      corpo.indexOf("if (!consultaPublica) {"),
      corpo.indexOf("await contarUso("),
    );
    expect(ramo).toContain("if (!getConfigTribunal(tribunal.codigoTribunal)) {");
  });

  it("o portão do tribunal candidato continua de pé nesta procedure", () => {
    expect(corpo).toContain(
      "await exigirTribunalComprovado(db, esc.escritorio.id, tribunal.codigoTribunal);",
    );
  });
});

describe("a foto do erro sobrevive ao deploy", () => {
  it("uma pasta por escritório, dentro de /uploads", () => {
    expect(pastaDoPrint(7)).toBe("monitor-erros/escritorio_7");
  });

  it("o nome do arquivo é saneado — ele entra numa URL e num caminho de disco", () => {
    expect(nomeSeguroDePrint("/tmp/a/pje-tjce-detalhe-nao-abriu-123.png")).toBe(
      "pje-tjce-detalhe-nao-abriu-123.png",
    );
    // Travessia de diretório e espaço não passam.
    expect(nomeSeguroDePrint("../../etc/passwd")).toBe("passwd.png");
    expect(nomeSeguroDePrint("/x/foto do erro.png")).toBe("foto_do_erro.png");
    expect(nomeSeguroDePrint("/x/...png")).toBe("png.png");
    expect(nomeSeguroDePrint("")).toBe("print.png");
  });

  it("copia e apaga em vez de renomear — o volume é outro mount", () => {
    const mod = ler("server/processos/print-do-erro.ts");
    expect(mod).toContain("fs.copyFileSync(caminhoOrigem, destino);");
    expect(mod).not.toContain("renameSync");
    // Problema de disco não pode derrubar o ciclo do cron.
    expect(mod).toContain("} catch (err) {");
    expect(mod).toContain("return null;");
  });

  it("a coluna existe no schema e na migration, com o MESMO nome físico", () => {
    expect(schema).toContain('ultimoErroPrintUrl: varchar("ultimo_erro_print_url", { length: 500 })');
    expect(migration).toContain("ALTER TABLE motor_monitoramentos");
    expect(migration).toContain("ADD COLUMN ultimo_erro_print_url VARCHAR(500) DEFAULT NULL");
  });

  it("o cron guarda a foto no erro, escopada pelo escritório do monitoramento", () => {
    expect(cron).toContain("const printUrl = await guardarPrintDoErro(\n        mon.escritorioId,");
    expect(cron).toContain("ultimoErroPrintUrl: printUrl,");
  });

  it("sucesso limpa a foto em TODOS os caminhos que limpam o erro", () => {
    // Foto de erro antigo ao lado de monitoramento saudável manda procurar
    // problema na tela errada. São 4 caminhos de sucesso no poll.
    const poll = cron.slice(
      cron.indexOf("export async function pollarUmMonitoramentoMovs"),
      cron.indexOf("export async function pollMonitoramentosMovs"),
    );
    expect(poll.length).toBeGreaterThan(1000);
    const limpaErro = poll.match(/ultimoErro: null,/g)?.length ?? 0;
    const limpaFoto = poll.match(/ultimoErroPrintUrl: null,/g)?.length ?? 0;
    expect(limpaErro).toBe(4);
    expect(limpaFoto).toBe(limpaErro);
  });

  it("a tela oferece a foto, e só quando há erro e foto", () => {
    expect(tela).toContain("{mon.diagnostico && mon.ultimoErroPrintUrl && (");
    expect(tela).toContain("ver a tela do tribunal");
    expect(tela).toContain('href={mon.ultimoErroPrintUrl}');
  });
});
