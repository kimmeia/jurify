/**
 * Atribuição por anúncio no Relatório Comercial (fatia 3 do Click-to-WhatsApp).
 *
 * O que estes testes protegem, e por quê:
 *
 *  1. **Uma definição de receita só.** O `recebido` por anúncio NÃO é
 *     recalculado: chega pronto de `atribuirRecebidoAosFechamentos`, a mesma
 *     distribuição que alimenta o card Recebido e o agrupamento por origem.
 *     Uma segunda conta na mesma tela daria dois números certos que não
 *     conversam — e o dono confere relatório somando com a mão.
 *
 *  2. **O período conta pelo CLIQUE.** A pergunta é quanto lead cada anúncio
 *     trouxe na janela; contar pelo fechamento responderia outra coisa e
 *     silenciaria o anúncio que traz muito e converte pouco, que é
 *     justamente o que o relatório existe para expor.
 *
 *  3. **O título do anúncio é texto de fora.** Vem do criativo, escrito pelo
 *     anunciante, e criativo com emoji é comum. As 14 fontes padrão do PDF só
 *     escrevem WinAnsi — sem filtro, o pdfkit imprime glifo errado no lugar.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { agruparPorAnuncio } from "../escritorio/router-relatorios";
import { gerarComercialPdf } from "../escritorio/relatorios-comercial-pdf";

const raiz = join(__dirname, "..", "..");
const router = readFileSync(join(raiz, "server", "escritorio", "router-relatorios.ts"), "utf8");
const pdf = readFileSync(join(raiz, "server", "escritorio", "relatorios-comercial-pdf.ts"), "utf8");
const envio = readFileSync(join(raiz, "server", "escritorio", "relatorios-envio.ts"), "utf8");
const tela = readFileSync(join(raiz, "client", "src", "pages", "Relatorios.tsx"), "utf8");

const ref = (id: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    sourceId: id,
    sourceType: "ad",
    sourceUrl: `https://fb.me/${id}`,
    titulo: `Anúncio ${id}`,
    corpo: "corpo",
    midiaTipo: "video",
    imagemUrl: "",
    videoUrl: "",
    thumbnailUrl: "",
    ctwaClid: `clid-${id}`,
    ...extra,
  });

describe("agruparPorAnuncio", () => {
  it("agrupa pelo id do anúncio e rotula pelo criativo", () => {
    const g = agruparPorAnuncio(
      [
        { contatoId: 1, origemAnuncio: ref("A") },
        { contatoId: 2, origemAnuncio: ref("A") },
        { contatoId: 3, origemAnuncio: ref("B") },
      ],
      [],
    );
    expect(g).toHaveLength(2);
    expect(g.map((x) => x.anuncioId).sort()).toEqual(["A", "B"]);
    expect(g.find((x) => x.anuncioId === "A")!.leads).toBe(2);
    expect(g.find((x) => x.anuncioId === "A")!.titulo).toBe("Anúncio A");
  });

  it("anúncio sem título não vira linha em branco", () => {
    const [g] = agruparPorAnuncio([{ contatoId: 1, origemAnuncio: ref("A", { titulo: "" }) }], []);
    expect(g.titulo).toBe("Anúncio sem título");
  });

  it("só conta fechamento de quem realmente fechou", () => {
    const g = agruparPorAnuncio(
      [
        { contatoId: 1, origemAnuncio: ref("A") },
        { contatoId: 2, origemAnuncio: ref("A") },
      ],
      [{ contatoId: 1, valor: 1000, recebido: 400 }],
    );
    expect(g[0]).toMatchObject({ leads: 2, fechados: 1, valorFechado: 1000, recebido: 400 });
  });

  it("cliente com dois contratos soma valor e recebido, e conta como UM fechado", () => {
    // `fechados` conta o LEAD que fechou, não o número de contratos: senão a
    // taxa de conversão passaria de 100% para quem fecha duas ações.
    const g = agruparPorAnuncio(
      [{ contatoId: 1, origemAnuncio: ref("A") }],
      [
        { contatoId: 1, valor: 1000, recebido: 400 },
        { contatoId: 1, valor: 500, recebido: 100 },
      ],
    );
    expect(g[0]).toMatchObject({ leads: 1, fechados: 1, valorFechado: 1500, recebido: 500 });
  });

  it("origem corrompida não vira anúncio fantasma", () => {
    const g = agruparPorAnuncio(
      [
        { contatoId: 1, origemAnuncio: "não é json" },
        { contatoId: 2, origemAnuncio: null },
        { contatoId: 3, origemAnuncio: "[1,2,3]" },
        // Objeto válido, mas sem NADA que identifique o anúncio: sem este
        // caso, a guarda da chave e a rejeição do array se mascaram e
        // nenhum teste consegue dizer qual das duas está trabalhando.
        { contatoId: 4, origemAnuncio: '{"sourceType":"ad","midiaTipo":"video"}' },
        { contatoId: 5, origemAnuncio: ref("A") },
      ],
      [],
    );
    expect(g).toHaveLength(1);
    expect(g[0].anuncioId).toBe("A");
  });

  it("referral sem id de anúncio agrupa pelo título, não num balde só", () => {
    // A Meta nem sempre manda `source_id` (post orgânico, criativo antigo).
    // Jogar todos num balde vazio fundiria anúncios diferentes numa linha.
    const g = agruparPorAnuncio(
      [
        { contatoId: 1, origemAnuncio: JSON.stringify({ titulo: "Rescisão" }) },
        { contatoId: 2, origemAnuncio: JSON.stringify({ titulo: "Rescisão" }) },
        { contatoId: 3, origemAnuncio: JSON.stringify({ titulo: "INSS" }) },
      ],
      [],
    );
    expect(g).toHaveLength(2);
    expect(g.map((x) => x.titulo).sort()).toEqual(["INSS", "Rescisão"]);
  });

  it("ordena por quem trouxe dinheiro; empate, por quem trouxe lead", () => {
    const g = agruparPorAnuncio(
      [
        { contatoId: 1, origemAnuncio: ref("pouco") },
        { contatoId: 2, origemAnuncio: ref("muito") },
        { contatoId: 3, origemAnuncio: ref("muito") },
        { contatoId: 4, origemAnuncio: ref("volume") },
        { contatoId: 5, origemAnuncio: ref("volume") },
        { contatoId: 6, origemAnuncio: ref("volume") },
      ],
      [
        { contatoId: 1, valor: 100, recebido: 50 },
        { contatoId: 2, valor: 100, recebido: 900 },
      ],
    );
    expect(g.map((x) => x.anuncioId)).toEqual(["muito", "pouco", "volume"]);
  });

  it("centavos não viram dízima", () => {
    const g = agruparPorAnuncio(
      [{ contatoId: 1, origemAnuncio: ref("A") }],
      [
        { contatoId: 1, valor: 0.1, recebido: 0.1 },
        { contatoId: 1, valor: 0.2, recebido: 0.2 },
      ],
    );
    expect(g[0].valorFechado).toBe(0.3);
    expect(g[0].recebido).toBe(0.3);
  });
});

describe("o servidor não cria uma segunda conta de dinheiro", () => {
  it("o recebido por anúncio vem de `porLead`, a mesma distribuição do card Recebido", () => {
    const i = router.indexOf("const anuncios = agruparPorAnuncio(");
    expect(i).toBeGreaterThan(0);
    const bloco = router.slice(i, i + 700);
    expect(bloco).toContain("porLead.get(Number(r.leadId))");
    expect(bloco).toContain("fechamentosDetalheRows");
  });

  it("o período dos leads conta pelo CLIQUE no anúncio, não pelo fechamento", () => {
    const i = router.indexOf("const leadsDeAnuncioRows");
    expect(i).toBeGreaterThan(0);
    const bloco = router.slice(i, i + 600);
    expect(bloco).toContain("contatos.origemAnuncioEm");
    expect(bloco).toContain("isNotNull(contatos.origemAnuncio)");
  });

  it("a consulta dos leads é escopada por escritório", () => {
    const i = router.indexOf("const leadsDeAnuncioRows");
    const bloco = router.slice(i, i + 600);
    expect(bloco).toContain("eq(contatos.escritorioId, eid)");
  });

  it("o payload leva o campo pro PDF e pra tela", () => {
    expect(router).toMatch(/fechamentosPorOrigem,\s*\n\s*anuncios,/);
  });
});

describe("PDF do Comercial", () => {
  it("declara o campo no contrato (senão o PDF não enxerga)", () => {
    expect(pdf).toMatch(/anuncios\?:\s*Array<\{/);
  });

  it("desenha a seção e ela é opcional", () => {
    expect(pdf).toContain("DE QUAL ANÚNCIO VEIO O LEAD");
    expect(pdf).toContain("if (data.anuncios && data.anuncios.length > 0)");
  });

  it("a nota de metodologia explica de onde vem o número", () => {
    const i = pdf.indexOf("Nota de metodologia");
    const nota = pdf.slice(i, i + 2600);
    expect(nota).toContain("De qual anúncio veio o lead");
    expect(nota).toContain("CLIQUE");
  });

  it("o título do anúncio passa pelo filtro WinAnsi", () => {
    const i = pdf.indexOf("DE QUAL ANÚNCIO VEIO O LEAD");
    const secao = pdf.slice(i, i + 3000);
    expect(secao).toContain("textoParaPdfWinAnsi(a.titulo)");
  });

  it("gera o PDF de verdade com criativo cheio de emoji, sem quebrar", async () => {
    const base: any = {
      periodo: { dataInicio: "2026-09-01", dataFim: "2026-09-14" },
      periodoAnterior: { dataInicio: "2026-08-01", dataFim: "2026-08-14" },
      kpis: {
        faturado: 7800, variacaoFaturado: 0, clientesPagantes: 3, variacaoClientesPagantes: 0,
        clientesFechados: 3, contratosFechados: 3, variacaoContratosFechados: 0,
        valorTotalFechado: 24000, ticketMedio: 8000,
      },
      ranking: [], cobrancasPorDia: [], etapas: {}, leadsPorCanal: [], fechamentosPorOrigem: [],
      anuncios: [
        {
          anuncioId: "120210000000000111",
          titulo: "🔥 Foi demitido sem justa causa? 👉 Veja o que a empresa te deve — ação rápida ✅",
          tipo: "ad", midiaTipo: "video", sourceUrl: "https://fb.me/a",
          leads: 3, fechados: 1, valorFechado: 6800, recebido: 3400,
        },
        {
          anuncioId: "", titulo: "", tipo: "post", midiaTipo: "image", sourceUrl: "",
          leads: 2, fechados: 0, valorFechado: 0, recebido: 0,
        },
      ],
      filtros: { setorId: null, atendenteId: null },
    };
    const buf = await gerarComercialPdf({ data: base, detalhes: [], nomeEscritorio: "Escritório Teste" });
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("taxa com zero lead não vira divisão por zero no papel", async () => {
    const base: any = {
      periodo: { dataInicio: "2026-09-01", dataFim: "2026-09-14" },
      periodoAnterior: { dataInicio: "2026-08-01", dataFim: "2026-08-14" },
      kpis: {
        faturado: 0, variacaoFaturado: 0, clientesPagantes: 0, variacaoClientesPagantes: 0,
        clientesFechados: 0, contratosFechados: 0, variacaoContratosFechados: 0,
        valorTotalFechado: 0, ticketMedio: 0,
      },
      ranking: [], cobrancasPorDia: [], etapas: {}, leadsPorCanal: [], fechamentosPorOrigem: [],
      anuncios: [{ anuncioId: "X", titulo: "Sem lead", tipo: "ad", midiaTipo: "image", sourceUrl: "", leads: 0, fechados: 0, valorFechado: 0, recebido: 0 }],
      filtros: { setorId: null, atendenteId: null },
    };
    const buf = await gerarComercialPdf({ data: base, detalhes: [], nomeEscritorio: "Escritório Teste" });
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
});

describe("envio programado e tela", () => {
  it("o e-mail programado usa a MESMA procedure do PDF — a seção entra sozinha", () => {
    // Se um dia isso virar geração própria, a seção do anúncio some do e-mail
    // sem ninguém perceber: o papel baixado teria uma seção a mais que o enviado.
    const i = envio.indexOf('if (relatorio === "comercial")');
    expect(i).toBeGreaterThan(0);
    expect(envio.slice(i, i + 300)).toContain('chamar("exportarComercialPdf", filtros)');
  });

  it("o cartão da tela some para quem não anuncia", () => {
    const i = tela.indexOf("function AnunciosCard");
    expect(i).toBeGreaterThan(0);
    expect(tela.slice(i, i + 300)).toContain("if (itens.length === 0) return null;");
  });

  it("a tabela rola com as colunas legíveis no celular", () => {
    const i = tela.indexOf("function AnunciosCard");
    const comp = tela.slice(i, i + 5000);
    expect(comp).toContain("overflow-x-auto");
    expect(comp).toContain("min-w-[560px]");
  });
});
