/**
 * Cobertura por GRAU no PJe.
 *
 * Achado do dono (31/08): no PJe o acesso costuma ser separado por 1º e 2º
 * grau. O Cofre validava só o 1º e guardava o resultado por tribunal, então
 * "TJRJ validado" não dizia nada sobre o 2º.
 *
 * O que estes testes travam:
 *  1. Pedir o 2º grau de um estado com endereço próprio NÃO cai no padrão
 *     derivado. Era isso que fazia o cron consultar um host que nem resolve —
 *     calado, porque ele engole a falha e segue só com o 1º grau.
 *  2. Onde não dá pra derivar com honestidade, a resposta é `null` em vez de
 *     um endereço inventado.
 *  3. O registro no Cofre passa a ser por (credencial, tribunal, grau).
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { getConfigTribunal, segundoGrauMapeado } from "../processos/tribunais-pdpj";

describe("2º grau dos estados com endereço próprio", () => {
  it("TJRJ usa o host validado no 1º grau, trocando /1g por /2g", () => {
    const g1 = getConfigTribunal("tjrj", 1)!;
    const g2 = getConfigTribunal("tjrj", 2)!;
    expect(g1.urlBusca).toContain("tjrj.pje.jus.br/1g/");
    expect(g2).not.toBeNull();
    expect(g2.urlBusca).toContain("tjrj.pje.jus.br/2g/");
    // O derivado (pje.tjrj.jus.br) nem resolve DNS — foi o que motivou o
    // override do 1º grau em 20/08.
    expect(g2.urlEntrada).not.toContain("pje.tjrj.jus.br");
    expect(g2.grau).toBe(2);
  });

  it("TJRN troca o subdomínio pje1g por pje2g", () => {
    const g2 = getConfigTribunal("tjrn", 2)!;
    expect(g2.urlEntrada).toContain("pje2g.tjrn.jus.br");
    expect(g2.urlBusca).toContain("pje2g.tjrn.jus.br");
  });

  it("TJPE segue no host da nuvem, não no endereço antigo", () => {
    const g2 = getConfigTribunal("tjpe", 2)!;
    expect(g2.urlEntrada).toContain("pje.cloud.tjpe.jus.br/2g/");
    expect(g2.urlEntrada).not.toContain("pje.tjpe.jus.br/pje2grau");
  });

  it("TJDF mantém o host com T (tjdft) também no 2º grau", () => {
    const g2 = getConfigTribunal("tjdf", 2)!;
    expect(g2.urlEntrada).toContain("pje.tjdft.jus.br");
    // O id interno continua sendo o código do CNJ.
    expect(g2.tribunal).toBe("tjdf");
  });

  it("TJPA e TJRO devolvem null — o endereço deles não carrega grau", () => {
    expect(getConfigTribunal("tjpa", 2)).toBeNull();
    expect(getConfigTribunal("tjro", 2)).toBeNull();
    expect(segundoGrauMapeado("tjpa")).toBe(false);
    expect(segundoGrauMapeado("tjro")).toBe(false);
    // O 1º grau deles continua funcionando normalmente.
    expect(getConfigTribunal("tjpa", 1)).not.toBeNull();
    expect(getConfigTribunal("tjro", 1)).not.toBeNull();
  });

  it("estado sem override continua derivando o 2º grau do padrão", () => {
    const g2 = getConfigTribunal("tjce", 2)!;
    expect(g2.urlBusca).toBe(
      "https://pje.tjce.jus.br/pje2grau/Processo/ConsultaProcesso/listView.seam",
    );
    expect(segundoGrauMapeado("tjce")).toBe(true);
  });

  it("tribunal fora do motor não ganha 2º grau do nada", () => {
    expect(getConfigTribunal("tjsp", 2)).toBeNull();
    expect(segundoGrauMapeado("tjsp")).toBe(false);
  });

  it("grau 1 é o padrão quando ninguém diz", () => {
    expect(getConfigTribunal("tjce")).toEqual(getConfigTribunal("tjce", 1));
  });
});

describe("Justiça Federal", () => {
  it("os TRFs no PJe entram com endereço por grau no subdomínio", () => {
    for (const n of [1, 2, 3, 6]) {
      const g1 = getConfigTribunal(`trf${n}`, 1)!;
      const g2 = getConfigTribunal(`trf${n}`, 2)!;
      expect(g1, `trf${n} precisa estar no registro`).not.toBeNull();
      expect(g1.urlEntrada).toBe(`https://pje1g.trf${n}.jus.br/pje/login.seam`);
      expect(g2.urlEntrada).toBe(`https://pje2g.trf${n}.jus.br/pje/login.seam`);
      expect(segundoGrauMapeado(`trf${n}`)).toBe(true);
    }
  });

  it("TRF5 fica fora do registro — ele roda sem credencial", () => {
    // Entrar aqui faria o sistema exigir cofre onde o acesso é aberto.
    expect(getConfigTribunal("trf5", 1)).toBeNull();
  });

  it("TRF4 fica fora — usa eproc, que é adapter novo e não linha de registro", () => {
    expect(getConfigTribunal("trf4", 1)).toBeNull();
  });

  it("processo federal exige credencial, não passa por consulta pública", async () => {
    const { sistemaCofrePorTribunal } = await import("../processos/cnj-parser");
    // `null` significa "consulta pública" pro import de processos. Sem estas
    // linhas ele criaria monitoramento federal sem credencial, que depois
    // falharia todo dia por não ter sessão.
    for (const n of [1, 2, 3, 6]) {
      expect(sistemaCofrePorTribunal(`trf${n}`)).toBe("pje_*");
    }
    expect(sistemaCofrePorTribunal("trf5")).toBeNull();
  });

  it("o login nacional do PDPJ atende os TRFs", async () => {
    const { sistemaAtendeTribunal } = await import("../processos/tribunais-pdpj");
    expect(sistemaAtendeTribunal("pje_*", "trf1")).toBe(true);
    expect(sistemaAtendeTribunal("pje_*", "trf5")).toBe(false);
  });
});

describe("registro por grau no Cofre", () => {
  const helpers = fs.readFileSync(
    path.resolve(__dirname, "../escritorio/cofre-helpers.ts"),
    "utf-8",
  );
  const router = fs.readFileSync(
    path.resolve(__dirname, "../escritorio/router-cofre-credenciais.ts"),
    "utf-8",
  );
  const sql = fs.readFileSync(
    path.resolve(__dirname, "../../drizzle/0213_cofre_grau.sql"),
    "utf-8",
  );

  it("o grau entra na linha gravada", () => {
    const bloco = helpers.slice(helpers.indexOf("export async function registrarTribunal"));
    expect(bloco).toMatch(/grau: 1 \| 2 = 1/);
    expect(bloco).toMatch(/\.values\(\{ credencialId, tribunal, grau, \.\.\.valores \}\)/);
  });

  it("a validação repassa o grau pro registro", () => {
    expect(router).toMatch(/registrarTribunal\(input\.id, tribunalAlvo, \{[\s\S]{0,140}\}, input\.grau\)/);
  });

  it("a config buscada é a do grau pedido", () => {
    expect(router).toMatch(/getConfigTribunal\(tribunalAlvo, input\.grau\)/);
  });

  it("só o 1º grau grava sessão — a sessão é guardada por tribunal", () => {
    // Sem isso, testar o 2º grau trocaria os cookies que o monitoramento diário
    // usa pelos de um portal consultado de vez em quando.
    expect(router).toMatch(/resultado\.storageStateJson && input\.grau === 1/);
  });

  it("2º grau sem endereço mapeado não vira 'login falhou'", () => {
    // Marcar como erro mandaria o operador procurar problema na senha dele.
    expect(router).toMatch(/semCobertura: true as const/);
    const bloco = router.slice(
      router.indexOf("if (!cfgTribunal && input.grau === 2"),
      router.indexOf("if (cfgTribunal) {"),
    );
    expect(bloco.length).toBeGreaterThan(0);
    expect(bloco).not.toMatch(/registrarTribunal/);
  });

  it("migration é aditiva e a UNIQUE passa a incluir o grau", () => {
    expect(sql).toMatch(/ADD COLUMN grauCT TINYINT NOT NULL DEFAULT 1/);
    const idx = sql.slice(sql.indexOf("CREATE UNIQUE INDEX uq_cofre_cred_tribunal"));
    expect(idx).toContain("credencialIdCT");
    expect(idx).toContain("tribunalCT");
    expect(idx).toContain("grauCT");
  });
});

describe("bateria de teste roda em fila", () => {
  const tela = fs.readFileSync(
    path.resolve(__dirname, "../../client/src/pages/Processos.tsx"),
    "utf-8",
  );

  it("um login por vez, sequencial", () => {
    const bloco = tela.slice(tela.indexOf("async function rodarLote"));
    const corpo = bloco.slice(0, bloco.indexOf("if (!q.data) return null"));
    // Paralelizar login da mesma conta é o caminho curto pro tribunal
    // bloquear a credencial.
    expect(corpo).toMatch(/for \(let i = 0; i < alvos\.length; i\+\+\)/);
    expect(corpo).toMatch(/await validarAsync\.mutateAsync\(/);
    expect(corpo).not.toMatch(/Promise\.all/);
  });

  it("portal fora do ar não derruba o resto da fila", () => {
    const bloco = tela.slice(tela.indexOf("async function rodarLote"));
    const corpo = bloco.slice(0, bloco.indexOf("if (!q.data) return null"));
    expect(corpo).toMatch(/\} catch \{[\s\S]{0,200}falhas\+\+;/);
  });

  it("o que não tem endereço mapeado fica fora da fila", () => {
    const bloco = tela.slice(tela.indexOf("async function rodarLote"));
    expect(bloco.slice(0, 400)).toMatch(/filter\(\(t\) => !t\.semCobertura\)/);
  });
});
