/**
 * Três destravas comerciais, medidas antes de existirem.
 *
 * 1. CUPOM: `criarCupom` conferia `planosIds` contra a lista FIXA do código
 *    (free/basico/intermediario/completo). A tela do cupom, por sua vez, lista
 *    os planos de `listarPlanosEditaveis` — a tabela `planos`, por slug. Ou
 *    seja: o admin marcava «Escritório» no diálogo e o servidor respondia que o
 *    plano não existe. Nenhum dos três planos vendidos hoje (atende, escritorio,
 *    escala) podia entrar numa promoção.
 *
 * 2. EXTRAS AVULSOS: usuário a mais, processos a mais, CPFs a mais, número a
 *    mais foram anunciados com o pacote de 3 planos e ficaram sem mecanismo —
 *    o teto vive na linha do PLANO, sem lugar pra "este cliente comprou 200
 *    processos". Agora moram em `escritorio_addons` com produto `extra:<chave>`
 *    (mesma tabela dos módulos avulsos, `limiteMensal` = quantidade,
 *    `precoCentavos` = total congelado) e SOMAM ao teto do plano.
 *
 * 3. JURISIA: vendido no plano Escala desde 09/09, e a fatura não cobrava por
 *    ele. São dois caminhos de concessão e cada um quebrava de um lado — o
 *    cartão do JurisIA grava o produto `jurisia` seco, que a composição da
 *    fatura (que varre `modulo:%`) não via; o diálogo de módulos avulsos grava
 *    `modulo:jurisia`, que a leitura de acesso não via. Cobrava sem liberar, ou
 *    liberava sem cobrar.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  EXTRAS_AVULSOS,
  PRODUTO_EXTRA_PREFIXO,
  definicaoDoExtra,
  ehChaveExtra,
  extraParaProduto,
  produtoParaExtra,
  rotuloDoExtra,
  somarAoTeto,
} from "../../shared/extras-avulsos";
import { calcularFatura } from "../../shared/fatura-modulos";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

const admin = ler("server/routers/admin.ts");
const limitesMon = ler("server/processos/limites-monitoramento.ts");
const planLimits = ler("server/billing/plan-limits.ts");
const configuracoes = ler("server/escritorio/router-configuracoes.ts");
const cobranca = ler("server/billing/modulos-cobranca.ts");
const addonsRepo = ler("server/billing/addons-repo.ts");
const cartao = ler("client/src/pages/admin/ModulosCobrancaCard.tsx");

describe("cupom aceita os planos que estão à venda", () => {
  it("a conferência é contra o CATÁLOGO, com a lista fixa só como reserva", () => {
    const trecho = admin.slice(
      admin.indexOf("// Validar planos existem"),
      admin.indexOf("// Codigo case-insensitive"),
    );
    expect(trecho).toContain("getAllPlanos");
    expect(trecho).toContain("doCatalogo.map((p) => p.slug)");
    // A lista fixa não sai (base sem catálogo continua funcionando), mas deixa
    // de ser a única verdade.
    expect(trecho).toContain("...PLANS.map((p) => p.id)");
    expect(trecho).not.toMatch(/if \(!PLANS\.find\(\(p\) => p\.id === pid\)\)/);
  });

  it("a lista fixa do código não tem os planos vendidos — é por isso que ela não pode decidir sozinha", () => {
    const produtos = ler("server/billing/products.ts");
    for (const slug of ["atende", "escritorio", "escala"]) {
      expect(produtos).not.toContain(`id: "${slug}"`);
    }
  });
});

describe("extras avulsos: a regra de soma", () => {
  it("os quatro extras anunciados existem, e o produto sai do prefixo", () => {
    expect(EXTRAS_AVULSOS.map((e) => e.chave)).toEqual(["usuarios", "processos", "cpfs", "numeros"]);
    expect(extraParaProduto("processos")).toBe(`${PRODUTO_EXTRA_PREFIXO}processos`);
    expect(produtoParaExtra("extra:processos")).toBe("processos");
    // Outra família de add-on não pode ser lida como extra.
    expect(produtoParaExtra("modulo:financeiro")).toBeNull();
    expect(produtoParaExtra("jurisia")).toBeNull();
    expect(produtoParaExtra("extra:inventado")).toBeNull();
    // Este caso é o que prova que o PREFIXO é conferido, e não só a chave:
    // "modulousuarios" tem seis letras antes de uma chave válida, então quem
    // cortasse cego devolveria "usuarios" pra um produto que não é extra.
    expect(produtoParaExtra("modulousuarios")).toBeNull();
    expect(ehChaveExtra("numeros")).toBe(true);
    expect(ehChaveExtra("nada")).toBe(false);
  });

  it("soma ao teto quando o teto existe", () => {
    expect(somarAoTeto(300, 200, { zeroEIlimitado: true })).toBe(500);
    expect(somarAoTeto(1, 1, { zeroEIlimitado: false })).toBe(2);
  });

  it("teto ILIMITADO continua ilimitado — somar viraria rebaixamento", () => {
    // O maior risco desta entrega: transformar "sem limite" em "limitado ao
    // extra". `null` e, onde zero libera, `0` significam sem teto.
    expect(somarAoTeto(null, 200, { zeroEIlimitado: true })).toBeNull();
    expect(somarAoTeto(null, 200, { zeroEIlimitado: false })).toBeNull();
    expect(somarAoTeto(0, 200, { zeroEIlimitado: true })).toBe(0);
  });

  it("onde zero significa NENHUM, o extra soma de verdade", () => {
    // Conexões de WhatsApp: plano com 0 não é ilimitado, é sem WhatsApp. Quem
    // vende um número pra esse plano precisa que a soma aconteça.
    expect(somarAoTeto(0, 1, { zeroEIlimitado: false })).toBe(1);
  });

  it("extra zerado ou inválido devolve o teto intocado", () => {
    expect(somarAoTeto(300, 0, { zeroEIlimitado: true })).toBe(300);
    expect(somarAoTeto(300, -5, { zeroEIlimitado: true })).toBe(300);
    expect(somarAoTeto(300, Number.NaN, { zeroEIlimitado: true })).toBe(300);
  });

  it("cada extra declara o que zero significa no teto dele", () => {
    expect(definicaoDoExtra("numeros")?.zeroEIlimitado).toBe(false);
    for (const chave of ["usuarios", "processos", "cpfs"] as const) {
      expect(definicaoDoExtra(chave)?.zeroEIlimitado).toBe(true);
    }
  });

  it("o rótulo da fatura concorda com o número", () => {
    expect(rotuloDoExtra("processos", 200)).toBe("+200 processos vigiados");
    expect(rotuloDoExtra("numeros", 1)).toBe("+1 número de WhatsApp");
  });
});

describe("extras avulsos: onde o teto é cobrado", () => {
  it("processos e CPFs vigiados somam o extra", () => {
    expect(limitesMon).toContain('tipo === "movimentacoes" ? "processos" : "cpfs"');
    expect(limitesMon).toContain("tetoComExtra(");
  });

  it("colaboradores somam o extra", () => {
    const trecho = planLimits.slice(
      planLimits.indexOf('case "colaboradores": {'),
      planLimits.indexOf('case "conversas": {'),
    );
    expect(trecho).toContain('tetoComExtra(escritorioId, "usuarios"');
  });

  it("conexões de WhatsApp somam o extra nos TRÊS caminhos, por uma função só", () => {
    // A conta estava copiada em três lugares (a leitura da tela e os dois que
    // criam canal). Extra que valesse só num deles faria o número comprado
    // funcionar ou não dependendo de por onde o cliente entrou.
    expect(configuracoes).toContain("async function limiteConexoesWhatsapp(");
    expect(configuracoes.match(/limiteConexoesWhatsapp\(/g)?.length).toBe(4);
    expect(configuracoes).not.toMatch(/const limite = plano\?\.limites\.maxConexoesWhatsapp \?\? 0;/);
    // Cortesia continua acima de qualquer teto.
    expect(configuracoes).toContain("if (cortesia) return 999999;");
  });
});

describe("extras avulsos: a fatura cobra", () => {
  it("a linha do extra entra no subtotal, somada como está (sem multiplicar)", () => {
    const fatura = calcularFatura({
      nomePlano: "Escritório",
      precoPacoteCentavos: 29700,
      avulsos: [],
      extras: [{ chave: "processos", rotulo: "+200 processos vigiados", precoCentavos: 4900 }],
      atendentesAtivos: 0,
      atendentesInclusos: null,
      precoAtendenteAdicionalCentavos: 0,
      desconto: null,
      agoraMs: 0,
    });
    expect(fatura.subtotalCentavos).toBe(34600);
    expect(fatura.itens.filter((i) => i.tipo === "extra")).toHaveLength(1);
    expect(fatura.itens.find((i) => i.tipo === "extra")?.rotulo).toBe("+200 processos vigiados (extra)");
  });

  it("fatura de caller antigo, sem extras, é a de antes", () => {
    const fatura = calcularFatura({
      nomePlano: "Escritório",
      precoPacoteCentavos: 29700,
      avulsos: [],
      atendentesAtivos: 0,
      atendentesInclusos: null,
      precoAtendenteAdicionalCentavos: 0,
      desconto: null,
      agoraMs: 0,
    });
    expect(fatura.subtotalCentavos).toBe(29700);
    expect(fatura.itens.every((i) => i.tipo !== "extra")).toBe(true);
  });

  it("o desconto do escritório incide sobre o extra também", () => {
    const fatura = calcularFatura({
      nomePlano: "Escritório",
      precoPacoteCentavos: 10000,
      avulsos: [],
      extras: [{ chave: "usuarios", rotulo: "+1 usuário", precoCentavos: 2900 }],
      atendentesAtivos: 0,
      atendentesInclusos: null,
      precoAtendenteAdicionalCentavos: 0,
      desconto: { tipo: "percentual", valor: 10, validoAte: null },
      agoraMs: 0,
    });
    expect(fatura.subtotalCentavos).toBe(12900);
    expect(fatura.descontoCentavos).toBe(1290);
  });

  it("a composição do escritório junta extras vigentes e o JurisIA do cartão", () => {
    expect(cobranca).toContain("listarExtrasDoEscritorio");
    expect(cobranca).toContain("e.vigente && e.quantidade > 0");
    expect(cobranca).toContain("const jurisiaAvulso = await avulsoJurisiaCobravel(escritorioId, agoraMs);");
    expect(cobranca).toContain("extras,");
  });
});

describe("JurisIA cobra e libera pelos dois caminhos", () => {
  it("o add-on do cartão passou a entrar na fatura", () => {
    const trecho = cobranca.slice(
      cobranca.indexOf("async function avulsoJurisiaCobravel"),
      cobranca.indexOf("export async function atendentesAtivosDoEscritorio"),
    );
    expect(trecho).toContain("buscarAddon(escritorioId, MODULO_JURISIA)");
    expect(trecho).toContain("avulsoVigente(doCartao, agoraMs)");
    // Concessão de graça não vira linha de R$ 0 na fatura.
    expect(trecho).toContain("doCartao.precoCentavos <= 0");
  });

  it("os dois caminhos juntos NÃO cobram dobrado", () => {
    const trecho = cobranca.slice(
      cobranca.indexOf("async function avulsoJurisiaCobravel"),
      cobranca.indexOf("export async function atendentesAtivosDoEscritorio"),
    );
    expect(trecho).toContain("moduloParaProduto(MODULO_JURISIA)");
    expect(trecho).toMatch(/if \(comoModulo && avulsoVigente\(comoModulo, agoraMs\)\) return null;/);
  });

  it("conceder pelo diálogo de módulos avulsos passou a LIBERAR o acesso", () => {
    // Era o lado pior: cobrava e o cliente batia na tela de bloqueio.
    expect(addonsRepo).toContain("async function addonJurisiaPorQualquerCaminho(");
    expect(addonsRepo).toContain("const addon = await addonJurisiaPorQualquerCaminho(");
    const trecho = addonsRepo.slice(addonsRepo.indexOf("async function addonJurisiaPorQualquerCaminho("));
    expect(trecho).toContain("buscarAddon(escritorioId, MODULO_JURISIA)");
    expect(trecho).toContain("moduloParaProduto(MODULO_JURISIA)");
    // Vencido/suspenso nos dois ainda devolve a linha, pra a decisão pura
    // explicar o motivo certo em vez de "nunca contratou".
    expect(trecho).toContain("return doCartao ?? comoModulo;");
  });
});

describe("o painel vende o extra", () => {
  it("o cartão de cobrança tem o botão, a lista e o diálogo", () => {
    expect(cartao).toContain("Vender um extra");
    expect(cartao).toContain("trpc.admin.salvarExtraAvulso.useMutation");
    expect(cartao).toContain("EXTRAS_AVULSOS.map((e) => (");
    // O botão com RÓTULO, não só o onClick: sem conferir o texto, apagar o
    // label deixava um botão invisível e a amarra passava.
    expect(cartao).toMatch(
      /onClick=\{abrirDialogExtra\}>\s*\n\s*<Plus className="h-3 w-3 mr-1" \/> Extra\s*\n\s*<\/Button>/,
    );
  });

  it("o X do extra cancela zerando a quantidade — teto volta pro do plano", () => {
    const trecho = cartao.slice(cartao.indexOf("aria-label={`Cancelar extra de"));
    expect(cartao).toContain("quantidade: 0,");
    expect(cartao).toContain('status: "cancelado",');
    expect(trecho.length).toBeGreaterThan(0);
  });

  it("a procedure do extra é admin e fica auditada", () => {
    const trecho = admin.slice(
      admin.indexOf("salvarExtraAvulso: adminProcedure"),
      admin.indexOf("salvarModuloAvulso: adminProcedure"),
    );
    expect(trecho.length).toBeGreaterThan(200);
    expect(trecho).toContain('acao: "extra.avulso"');
    expect(trecho).toContain("alvoId: input.escritorioId");
  });
});
