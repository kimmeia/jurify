/**
 * "Um cliente não assinou 3 documentos e o status mudou para assinado. O
 * quarto (que eu assinei como teste) ficou com 2 ícones e os outros não."
 * (dono, 11/09/2026.)
 *
 * O que o código diz, conferido linha a linha: quem grava "assinado" é UM
 * caminho só — o /assinar/:token — e ele mexe no documento daquele link,
 * escopado por id. Só que quando a estampa do PDF falha, a assinatura é
 * registrada assim mesmo (certo: o cliente assinou de verdade, a falha é
 * nossa) e o motivo ia para o log. A ficha mostrava o MESMO selo verde nos
 * dois casos, e a única pista era um ícone que faltava.
 *
 * Agora o estado é DERIVADO dos dados. E a prova de que alguém assinou é o
 * desenho/IP, não `assinantNome`: esse é pré-preenchido com o nome do contato
 * na CRIAÇÃO do documento, antes de existir qualquer assinatura — quem
 * confiasse nele chamaria de assinado um registro que ninguém tocou.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

import {
  ESTADOS_ASSINATURA,
  EXPLICACAO_ESTADO,
  ROTULO_ESTADO,
  estadoDaAssinatura,
  pedeAtencao,
  podeGerarComprovante,
} from "../../shared/assinatura-estado";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

const assinadoCompleto = {
  status: "assinado",
  assinadoAt: "2026-09-11T14:37:00.000Z",
  assinantNome: "Alexandre Yirtici Sahin",
  assinaturaImagemUrl: "/uploads/assinaturas/escritorio_1/assinatura_9_1.png",
  ipAssinatura: "179.108.10.2",
  documentoAssinadoUrl: "/uploads/assinaturas/escritorio_1/assinado_9_1.pdf",
};

describe("o estado é derivado dos dados, não do campo status sozinho", () => {
  it("com comprovante é assinado", () => {
    expect(estadoDaAssinatura(assinadoCompleto)).toBe("assinado");
  });

  it("assinado sem o PDF carimbado vira 'sem comprovante'", () => {
    expect(estadoDaAssinatura({ ...assinadoCompleto, documentoAssinadoUrl: null })).toBe("sem_comprovante");
  });

  it("documento que é link externo nunca teria carimbo — não é falha", () => {
    expect(
      estadoDaAssinatura({ ...assinadoCompleto, documentoAssinadoUrl: null, documentoExterno: true }),
    ).toBe("assinado_externo");
  });

  it("assinado sem NENHUM vestígio de quem assinou é inconsistente", () => {
    expect(
      estadoDaAssinatura({
        status: "assinado",
        assinadoAt: "2026-09-10T12:00:00.000Z",
        assinantNome: "Alexandre Yirtici Sahin",
        assinaturaImagemUrl: null,
        ipAssinatura: null,
        documentoAssinadoUrl: null,
      }),
    ).toBe("inconsistente");
  });

  it("o nome pré-preenchido NÃO conta como prova", () => {
    // `criar` e `criarDeModelo` gravam assinantNome com o nome do contato na
    // criação. Aceitar isso como prova apagaria justamente o caso do dono.
    const so_nome = {
      status: "assinado",
      assinadoAt: "2026-09-10T12:00:00.000Z",
      assinantNome: "Fulano de Tal",
      assinaturaImagemUrl: null,
      ipAssinatura: null,
      documentoAssinadoUrl: null,
    };
    expect(estadoDaAssinatura(so_nome)).toBe("inconsistente");
  });

  it("só o IP já basta como vestígio (assinatura antiga, sem PNG guardado)", () => {
    expect(
      estadoDaAssinatura({
        status: "assinado",
        assinadoAt: "2026-09-10T12:00:00.000Z",
        assinaturaImagemUrl: null,
        ipAssinatura: "179.108.10.2",
        documentoAssinadoUrl: null,
      }),
    ).toBe("sem_comprovante");
  });

  it("assinado sem DATA é inconsistente, mesmo com desenho", () => {
    expect(estadoDaAssinatura({ ...assinadoCompleto, assinadoAt: null })).toBe("inconsistente");
  });

  it("os estados que não são assinatura passam direto", () => {
    expect(estadoDaAssinatura({ status: "pendente", assinadoAt: null })).toBe("pendente");
    expect(estadoDaAssinatura({ status: "enviado", assinadoAt: null })).toBe("enviado");
    expect(estadoDaAssinatura({ status: "visualizado", assinadoAt: null })).toBe("visualizado");
    expect(estadoDaAssinatura({ status: "expirado", assinadoAt: null })).toBe("expirado");
    expect(estadoDaAssinatura({ status: "recusado", assinadoAt: null })).toBe("recusado");
  });

  it("expirado e cancelado vencem qualquer derivação", () => {
    expect(estadoDaAssinatura({ ...assinadoCompleto, status: "expirado" })).toBe("expirado");
    expect(estadoDaAssinatura({ ...assinadoCompleto, status: "recusado" })).toBe("recusado");
  });

  it("só dois estados pedem ação de quem cuida", () => {
    const pedem = ESTADOS_ASSINATURA.filter(pedeAtencao);
    expect(pedem).toEqual(["sem_comprovante", "inconsistente"]);
  });

  it("todo estado tem rótulo e explicação — nenhum selo fica mudo", () => {
    for (const e of ESTADOS_ASSINATURA) {
      expect(ROTULO_ESTADO[e]).toBeTruthy();
      expect(EXPLICACAO_ESTADO[e]).toBeTruthy();
    }
  });
});

describe("o botão 'Gerar comprovante' só aparece quando dá para refazer", () => {
  it("aparece no assinado sem comprovante que tem desenho guardado", () => {
    expect(podeGerarComprovante({ ...assinadoCompleto, documentoAssinadoUrl: null })).toBe(true);
  });

  it("não aparece sem o desenho — não há do que refazer o carimbo", () => {
    expect(
      podeGerarComprovante({ ...assinadoCompleto, documentoAssinadoUrl: null, assinaturaImagemUrl: null }),
    ).toBe(false);
  });

  it("não aparece em documento que já tem comprovante", () => {
    expect(podeGerarComprovante(assinadoCompleto)).toBe(false);
  });

  it("não aparece em link externo (não existe arquivo nosso para carimbar)", () => {
    expect(
      podeGerarComprovante({ ...assinadoCompleto, documentoAssinadoUrl: null, documentoExterno: true }),
    ).toBe(false);
  });
});

describe("o servidor guarda o motivo em vez de só logar", () => {
  const router = ler("server/escritorio/router-assinaturas.ts");

  it("a falha da estampa vira campo no registro", () => {
    expect(router).toContain("comprovanteErro = err instanceof Error ? err.message : String(err);");
    expect(router).toContain("comprovanteErro,\n      }).where(eq(assinaturasDigitais.id, doc.id));");
  });

  it("assinar continua NÃO sendo recusado quando o carimbo falha", () => {
    // Recusar seria pior para quem assinou direito por causa de um problema
    // nosso. A assinatura fica registrada; o comprovante sai depois.
    expect(router).toContain('status: "assinado",');
    expect(router).toContain("Falha ao estampar PDF — assinatura registrada sem documentoAssinadoUrl");
  });

  it("a lista devolve o que a ficha precisa para derivar o estado", () => {
    expect(router).toContain("comprovanteErro: r.comprovanteErro || null,");
    expect(router).toContain("temDesenhoAssinatura: !!r.assinaturaImagemUrl,");
    expect(router).toContain("temIpAssinatura: !!r.ipAssinatura,");
    expect(router).toContain("documentoExterno: !!(r.documentoUrl && !caminhoInterno(r.documentoUrl))");
  });

  it("a lista NÃO manda o caminho do desenho junto (só o booleano)", () => {
    const mapper = router.slice(router.indexOf("return rows.map(r => ({"), router.indexOf("/** Cria documento para assinatura */"));
    expect(mapper).not.toContain("assinaturaImagemUrl: r.assinaturaImagemUrl");
  });
});

describe("dadosDaAssinatura — a prova que já existia e ninguém mostrava", () => {
  const router = ler("server/escritorio/router-assinaturas.ts");
  const proc = router.slice(
    router.indexOf("dadosDaAssinatura: protectedProcedure"),
    router.indexOf("gerarComprovante: protectedProcedure"),
  );

  it("é escopada pelo escritório", () => {
    expect(proc).toContain("eq(assinaturasDigitais.escritorioId, esc.escritorio.id)");
  });

  it("devolve os campos que respondem 'foi mesmo assinado?'", () => {
    for (const campo of ["assinantNome", "assinanteCpf", "ipAssinatura", "assinaturaImagemUrl", "assinadoAt"]) {
      expect(proc).toContain(campo);
    }
  });

  it("documento de outro escritório não vaza — some como não encontrado", () => {
    expect(proc).toContain('code: "NOT_FOUND"');
  });
});

describe("gerarComprovante refaz o carimbo do que já foi assinado", () => {
  const router = ler("server/escritorio/router-assinaturas.ts");
  const proc = router.slice(router.indexOf("gerarComprovante: protectedProcedure"));

  it("é escopada pelo escritório", () => {
    expect(proc).toContain("eq(assinaturasDigitais.escritorioId, esc.escritorio.id)");
  });

  it("recusa documento que não foi assinado", () => {
    expect(proc).toContain("Este documento ainda não foi assinado.");
  });

  it("recusa sem o desenho guardado", () => {
    expect(proc).toContain("Não há desenho de assinatura guardado");
  });

  it("recusa link externo, explicando por quê", () => {
    expect(proc).toContain("O documento original é um link externo");
  });

  it("não pede nada ao cliente: usa o desenho e os dados já gravados", () => {
    expect(proc).toContain("nomeCompleto: doc.assinantNome || \"\"");
    expect(proc).toContain("assinadoAt: new Date(doc.assinadoAt)");
  });

  it("dando certo, o motivo da falha é limpo (auto-cura)", () => {
    expect(proc).toContain("set({ documentoAssinadoUrl, comprovanteErro: null })");
  });

  it("dando errado, o motivo novo fica gravado — o botão não 'não faz nada'", () => {
    expect(proc).toContain("set({ comprovanteErro: motivo })");
  });
});

describe("a ficha mostra o estado real", () => {
  const tela = ler("client/src/pages/clientes/detail-tabs.tsx");
  const dialog = ler("client/src/pages/clientes/dados-da-assinatura.tsx");

  it("o selo usa o estado derivado, não o status cru", () => {
    expect(tela).toContain("CORES_ESTADO_ASSINATURA[estado]");
    expect(tela).toContain("ROTULO_ESTADO[estado]");
    expect(tela).not.toContain("STATUS_ASSINATURA_LABELS[a.status]");
  });

  it("os dois estados problemáticos ganham linha explicando", () => {
    // A ligação, não só o testid: `{false && (...)}` deixaria o texto no
    // arquivo com a linha nunca aparecendo na tela.
    expect(tela).toContain("{atencao && (");
    expect(tela).toContain('data-testid="aviso-estado-assinatura"');
    expect(tela).toContain("EXPLICACAO_ESTADO[estado]");
  });

  it("a regra vem do shared — a tela não tem cópia da lógica", () => {
    expect(tela).toContain('from "@shared/assinatura-estado"');
    expect(dialog).toContain('from "@shared/assinatura-estado"');
  });

  it("o diálogo grita quando não há vestígio nenhum de assinatura", () => {
    expect(dialog).toContain("não tem nenhum vestígio de quem assinou");
    expect(dialog).toContain('data-testid="dados-da-assinatura"');
  });

  it("a mutation de gerar comprovante avisa quando falha", () => {
    expect(tela).toContain("Não deu para gerar o comprovante");
  });

  it("o botão de baixar o PDF assinado continua onde estava", () => {
    expect(tela).toContain('title="Baixar PDF assinado (com carimbo + página de certificação)"');
  });
});

describe("a migration é não-destrutiva", () => {
  const sql = ler("drizzle/0220_assinatura_comprovante_erro.sql");

  it("só acrescenta coluna, com default nulo", () => {
    expect(sql).toContain("ADD COLUMN comprovanteErro TEXT DEFAULT NULL");
    expect(sql).not.toMatch(/DROP|DELETE|UPDATE/i);
  });

  it("o boot também cria a coluna (banco que não roda migration na mão)", () => {
    expect(ler("server/_core/auto-migrate.ts")).toContain(
      "ALTER TABLE assinaturas_digitais ADD COLUMN comprovanteErro TEXT DEFAULT NULL",
    );
  });
});
