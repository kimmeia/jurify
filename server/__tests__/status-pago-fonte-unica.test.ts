/**
 * Catraca contra a próxima cópia de "o que conta como pago".
 *
 * O conceito "cobrança paga" está escrito à mão em vários pontos do server,
 * e as grafias divergem: umas listam 3 status, outras 4. A que esquece
 * `DUNNING_RECEIVED` (cliente que paga depois de negativado) faz dinheiro
 * real sumir de uma tela e aparecer em outra. Foi assim que o Painel
 * Financeiro passou a discordar de /financeiro, e que a comissão do
 * atendente ficou menor que o caixa do escritório.
 *
 * A fonte única é `server/_core/asaas-status.ts`. Este teste NÃO exige que
 * todo mundo já esteja usando — exige que a dívida não CRESÇA:
 *
 *   - arquivo fora da lista abaixo com lista literal → falha (cópia nova)
 *   - arquivo na lista que já foi corrigido → falha, pedindo pra sair daqui
 *
 * A lista só pode encolher. Quando chegar a zero, este teste vira a regra
 * simples "ninguém escreve status de pagamento à mão" e a catraca some.
 *
 * Por que catraca e não conserto de tudo de uma vez: são 15 pontos, vários
 * em caminho de dinheiro (fechamento de comissão, sync do Asaas, SmartFlow
 * de cobrança). Trocar todos num commit só é diff que ninguém revisa de
 * verdade — mesma razão pela qual o ESLint segue represado no projeto.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const RAIZ_SERVER = join(__dirname, "..");
const RAIZ_REPO = join(__dirname, "..", "..");

/**
 * Lista literal de status pago escrita à mão. Cobre as duas formas usadas
 * no projeto: array TS e `IN (...)` dentro de SQL cru.
 */
const PADRAO_LISTA_LITERAL =
  /\[\s*["']RECEIVED["']\s*,\s*["']CONFIRMED["']|IN\s*\(\s*'RECEIVED'\s*,\s*'CONFIRMED'/;

/**
 * Débito conhecido em 13/08/2026. Cada entrada é um arquivo que ainda
 * escreve a lista à mão. NÃO acrescente linhas aqui — corrija o arquivo e
 * importe de `_core/asaas-status`.
 */
const DIVIDA_CONHECIDA = [
  "server/admin/auditoria/regras.ts",
  "server/escritorio/router-atendimento-ia.ts",
  "server/escritorio/router-financeiro.ts",
  "server/integracoes/asaas-sync.ts",
  "server/integracoes/router-asaas.ts",
  "server/routers/customer360.ts",
  "server/routers/dashboard.ts",
  "server/smartflow/cobrancas-scheduler.ts",
  "server/smartflow/dispatcher.ts",
  "server/smartflow/primeira-cobranca.ts",
];

function arquivosTs(dir: string): string[] {
  const saida: string[] = [];
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) {
      saida.push(...arquivosTs(caminho));
    } else if (nome.endsWith(".ts") && !nome.endsWith(".test.ts")) {
      saida.push(caminho);
    }
  }
  return saida;
}

function arquivosComListaLiteral(): string[] {
  return arquivosTs(RAIZ_SERVER)
    .filter((caminho) => !caminho.endsWith(join("_core", "asaas-status.ts")))
    .filter((caminho) => PADRAO_LISTA_LITERAL.test(readFileSync(caminho, "utf8")))
    .map((caminho) => relative(RAIZ_REPO, caminho).split("\\").join("/"))
    .sort();
}

describe("status de pagamento tem fonte única", () => {
  it("nenhum arquivo novo escreve a lista de status pago à mão", () => {
    const atuais = arquivosComListaLiteral();
    const novos = atuais.filter((a) => !DIVIDA_CONHECIDA.includes(a));

    expect(
      novos,
      `Escreva os status via STATUS_PAGO_ASAAS (server/_core/asaas-status.ts).\n` +
        `Lista literal esquece DUNNING_RECEIVED e some com dinheiro recebido:\n` +
        novos.join("\n"),
    ).toEqual([]);
  });

  it("a dívida conhecida não tem entrada obsoleta", () => {
    const atuais = arquivosComListaLiteral();
    const jaCorrigidos = DIVIDA_CONHECIDA.filter((a) => !atuais.includes(a));

    expect(
      jaCorrigidos,
      `Estes arquivos já não escrevem a lista à mão — remova de DIVIDA_CONHECIDA ` +
        `pra catraca não afrouxar:\n${jaCorrigidos.join("\n")}`,
    ).toEqual([]);
  });

  it("caixa, DRE e comissão partem da mesma definição de pago", () => {
    // Os três respondem "quanto o escritório recebeu?" e discordar entre si
    // é o defeito que mais custa confiança — comissão menor que o caixa.
    for (const arquivo of [
      "server/escritorio/db-comissoes.ts",
      "server/_core/cron-comissoes.ts",
      "server/escritorio/dre.ts",
    ]) {
      const fonte = readFileSync(join(RAIZ_REPO, arquivo), "utf8");
      expect(fonte, `${arquivo} deveria importar STATUS_PAGO_ASAAS`).toContain(
        "STATUS_PAGO_ASAAS",
      );
      expect(PADRAO_LISTA_LITERAL.test(fonte), `${arquivo} ainda tem lista literal`).toBe(
        false,
      );
    }
  });
});
