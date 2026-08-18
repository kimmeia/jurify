/**
 * O documento que estava na tela o tempo todo.
 *
 * A timeline do PJe escreve o movimento junto com o número e o tipo da peça:
 * "Proferido despacho de mero expediente 226277277 - Despacho". O scraper
 * descarta os links `javascript:void(0)` — que é como o PJe monta os links JSF
 * — e, sem URL, o evento era gravado como `sem_documento`. A tela então
 * afirmava "o tribunal não anexou peça nenhuma", com o número da peça escrito
 * duas linhas acima.
 *
 * Ler o rótulo não custa requisição nenhuma e muda o que a tela pode afirmar:
 * de "não existe" para "existe, ainda não lemos".
 */

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { lerDocumentoNoRotulo } from "../../shared/documento-no-rotulo";
import { urlsCandidatasDocumento, baixarDocumentoPorId } from "../processos/documento-por-id";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

const cron = ler("server/processos/cron-monitoramento.ts");
const router = ler("server/processos/router-movimentacoes.ts");
const drawer = ler("client/src/components/MovimentacaoDetalheDrawer.tsx");
const migration = ler("drizzle/0192_documento_no_rotulo.sql");

describe("ler a peça no rótulo", () => {
  it("pega id e tipo no formato mais comum", () => {
    // Os três rótulos vieram de prints reais da tela.
    expect(lerDocumentoNoRotulo("Embargos de Declaração Não-acolhidos 226220878 - Sentença")).toEqual({
      id: "226220878",
      tipo: "Sentença",
      movimento: "Embargos de Declaração Não-acolhidos",
    });
    expect(lerDocumentoNoRotulo("Proferido despacho de mero expediente 226277277 - Despacho")).toEqual({
      id: "226277277",
      tipo: "Despacho",
      movimento: "Proferido despacho de mero expediente",
    });
    expect(lerDocumentoNoRotulo("Juntada de Petição de Contra-razões 213403847 - Contrarrazões")).toEqual({
      id: "213403847",
      tipo: "Contrarrazões",
      movimento: "Juntada de Petição de Contra-razões",
    });
  });

  it("pega o formato “Documento: <id>”, que não diz o tipo", () => {
    const r = lerDocumentoNoRotulo("Publicado Intimação em 23/06/2026. Documento: 207819057");
    expect(r?.id).toBe("207819057");
    expect(r?.tipo).toBeNull();
  });

  it("movimento de rotina continua sem documento", () => {
    // Se qualquer texto virasse "tem documento", o botão de ler apareceria em
    // tudo e gastaria crédito à toa.
    expect(lerDocumentoNoRotulo("Conclusos para decisão")).toBeNull();
    expect(lerDocumentoNoRotulo("Decorrido prazo de MARIA DA SILVA em 12/08/2026")).toBeNull();
    expect(lerDocumentoNoRotulo("")).toBeNull();
    expect(lerDocumentoNoRotulo(null)).toBeNull();
  });

  it("não confunde data, número pequeno nem CNJ com id de documento", () => {
    expect(lerDocumentoNoRotulo("Intimação expedida em 23/06/2026")).toBeNull();
    expect(lerDocumentoNoRotulo("Prazo de 15 - dias")).toBeNull();
    // CNJ sem máscara tem 20 dígitos — acima do teto.
    expect(lerDocumentoNoRotulo("Distribuído 02659482020248060001 - Sorteio")).toBeNull();
  });

  it("intervalo de folhas não é documento", () => {
    // "fls. 120 - 340": o que vem depois do traço é só número.
    expect(lerDocumentoNoRotulo("Juntada de documentos fls. 226220878 - 340")).toBeNull();
  });
});

describe("o cron para de chamar de “sem documento”", () => {
  it("rótulo com peça vira pendente, não sem_documento", () => {
    const i = cron.indexOf("function camposTeor");
    const corpo = cron.slice(i, i + 1600);
    expect(corpo).toContain("const noRotulo = lerDocumentoNoRotulo(mov.texto)");
    expect(corpo).toContain('(mov.documentoUrl || noRotulo ? "pendente" : "sem_documento")');
  });

  it("guarda id e tipo no evento", () => {
    const i = cron.indexOf("function camposTeor");
    const corpo = cron.slice(i, i + 1600);
    expect(corpo).toContain("documentoIdTribunal: noRotulo?.id ?? null");
    expect(corpo).toContain("documentoTipo: noRotulo?.tipo ?? null");
  });

  it("a migration é não-destrutiva", () => {
    expect(migration).toContain("ADD COLUMN documentoIdTribunal VARCHAR(32) DEFAULT NULL");
    expect(migration).toContain("ADD COLUMN documentoTipo VARCHAR(64) DEFAULT NULL");
  });
});

describe("baixar pelo id quando não há link", () => {
  it("as candidatas saem da instalação do tribunal, não de host fixo", () => {
    const urls = urlsCandidatasDocumento(
      "https://pje.tjce.jus.br/pje1grau/Processo/ConsultaProcesso/listView.seam",
      "226277277",
    );
    expect(urls.length).toBeGreaterThan(1);
    for (const u of urls) {
      expect(u.startsWith("https://pje.tjce.jus.br/pje1grau/"), u).toBe(true);
      expect(u).toContain("226277277");
    }
  });

  it("URL inválida não explode, devolve lista vazia", () => {
    expect(urlsCandidatasDocumento("não é url", "1")).toEqual([]);
  });

  it("para na primeira que serve e diz qual foi", async () => {
    const tentadas: string[] = [];
    const r = await baixarDocumentoPorId(
      "https://pje.tjce.jus.br/pje1grau/Processo/ConsultaProcesso/listView.seam",
      "226277277",
      async (url) => {
        tentadas.push(url);
        return tentadas.length < 2
          ? { ok: false, erro: "HTTP 404" }
          : { ok: true, texto: "Vistos. Intime-se a parte autora para manifestar-se em 15 dias." };
      },
    );
    expect(r.ok).toBe(true);
    expect(tentadas).toHaveLength(2);
    if (r.ok) expect(r.urlQueFuncionou).toBe(tentadas[1]);
  });

  it("HTTP 200 com corpo vazio não conta como sucesso", async () => {
    // Tribunal instável devolve página de erro com status 200. Aceitar isso
    // gravaria um teor em branco como se fosse o despacho.
    const r = await baixarDocumentoPorId(
      "https://pje.tjce.jus.br/pje1grau/Processo/ConsultaProcesso/listView.seam",
      "1234567",
      async () => ({ ok: true, texto: "  \n " }),
    );
    expect(r.ok).toBe(false);
  });

  it("quando nada serve, a mensagem diz que a peça existe", async () => {
    const r = await baixarDocumentoPorId(
      "https://pje.tjce.jus.br/pje1grau/Processo/ConsultaProcesso/listView.seam",
      "226277277",
      async () => ({ ok: false, erro: "HTTP 403" }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.erro).toContain("226277277");
      expect(r.erro).toContain("existe no tribunal");
    }
  });

  it("o baixarTeor aceita evento sem URL, desde que tenha id", () => {
    const i = router.indexOf("baixarTeor: protectedProcedure");
    const corpo = router.slice(i, i + 4000);
    // O id vem do campo gravado na coleta OU do rótulo, derivado na leitura:
    // movimentação anterior ao extrator não tem o campo, mas tem o rótulo.
    expect(corpo).toContain("const documentoId = documentoIdDoEvento(row.ev)");
    expect(corpo).toContain("!row.ev.teorUrl && !documentoId");
    expect(corpo).toContain("baixarDocumentoPorId");
    // A rota que funcionou fica gravada pra próxima leitura ir direto.
    expect(corpo).toContain("teorUrl: urlUsada");
  });
});

describe("a tela para de mentir", () => {
  it("peça identificada muda o título e libera o botão", () => {
    expect(drawer).toContain("const pecaIdentificada = data?.documentoId");
    expect(drawer).toContain("identificado, ainda não lido");
    expect(drawer).toContain("falhaTeor?.podeBaixar && (data.teorUrl || data.documentoId)");
  });

  it("o detalhe devolve id e tipo, derivados do rótulo quando faltam", () => {
    // Gravar na coleta congelava a resposta: tudo que já existia quando o
    // extrator entrou no ar ficou em "sem_documento" com o id escrito no
    // próprio rótulo.
    expect(router).toContain("documentoId: documentoIdDoEvento(row.ev)");
    expect(router).toContain("documentoTipo: documentoTipoDoEvento(row.ev)");
  });
});
