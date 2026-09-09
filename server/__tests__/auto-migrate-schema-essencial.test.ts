/**
 * Trava contra banco novo nascer com schema incompleto.
 *
 * `runMigrations` tem um bloco hardcoded que adiciona colunas que nenhuma
 * migration de arquivo cria — o rename `users.stripeCustomerId` →
 * `asaasCustomerId`, os campos de bloqueio, e outros. Ele rodava só ANTES
 * das migrations, e em banco NOVO a tabela `users` só passa a existir
 * durante elas: cada `ensure*` desistia com "Tabela 'users' ainda não
 * existe" e o banco terminava sem as colunas.
 *
 * Produção nunca sentiu — lá a tabela já existia quando o bloco passou a
 * rodar. Quem sentia era ambiente novo: staging recriado, restore de
 * backup, dev clonando o repo. O sintoma é o primeiro INSERT de usuário
 * morrendo com "Unknown column 'asaasCustomerId'".
 *
 * Verificado à mão criando banco vazio e subindo o app: antes da correção
 * `users` ficava sem `asaasCustomerId`, `bloqueado`, `motivoBloqueio` e
 * `bloqueadoEm`; depois, com as quatro.
 *
 * Este teste é de texto porque rodar migrations de verdade exige banco
 * dedicado — o que ele protege é a ORDEM, que foi o defeito.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FONTE = readFileSync(join(__dirname, "..", "_core", "auto-migrate.ts"), "utf8");

describe("garantia de schema essencial", () => {
  it("roda antes e depois das migrations de arquivo", () => {
    const chamadas = FONTE.match(/await garantirSchemaEssencial\(/g) ?? [];

    expect(
      chamadas.length,
      "precisa das DUAS passadas: a de antes serve banco existente, " +
        "a de depois é a única que alcança banco criado do zero",
    ).toBe(2);
  });

  it("a segunda passada vem depois do laço que aplica os arquivos", () => {
    const posLaco = FONTE.indexOf("Migrations concluídas");
    const ultimaChamada = FONTE.lastIndexOf("await garantirSchemaEssencial(");

    expect(posLaco).toBeGreaterThan(0);
    expect(
      ultimaChamada,
      "a segunda chamada precisa estar DEPOIS de aplicar os arquivos — " +
        "antes dele, a tabela `users` ainda não existe em banco novo",
    ).toBeLessThan(posLaco);

    const inicioLaco = FONTE.indexOf("for (const file of pendentes)");
    expect(
      inicioLaco,
      "o laço que aplica os arquivos mudou de forma — reveja esta trava " +
        "antes de ajustar a string, senão ela passa a não guardar nada",
    ).toBeGreaterThan(0);
    expect(
      ultimaChamada,
      "a segunda chamada caiu antes do laço — não é segunda passada",
    ).toBeGreaterThan(inicioLaco);
  });
});

/**
 * Ordem alfabética não é ordem de dependência.
 *
 * `0022_telefones_secundarios` faz `ADD COLUMN ... AFTER
 * telefonesAnteriores`, e quem cria `telefonesAnteriores` roda depois
 * dele. Em banco novo a 0022 falhava, não era marcada como aplicada, e o
 * boot terminava sem `contatos.telefonesSecundarios` — health check
 * verde e todo INSERT de contato morrendo com "Unknown column". Só se
 * resolvia no restart seguinte.
 *
 * Medido em banco criado do zero: 5 migrations falhavam na primeira
 * passada e passavam na segunda.
 */
describe("migrations fora de ordem se resolvem no mesmo boot", () => {
  it("reprocessa o que falhou em vez de aceitar uma passada só", () => {
    expect(
      FONTE,
      "sem repasse, dependência fora de ordem deixa o banco incompleto até " +
        "alguém reiniciar o serviço",
    ).toContain("MAX_PASSADAS_MIGRATION");
  });

  it("para quando não há mais progresso", () => {
    expect(
      FONTE,
      "sem esta saída, arquivo quebrado de verdade seria retentado até o teto " +
        "a cada boot, atrasando a subida do servidor",
    ).toContain("if (aplicadasNaPassada === 0) break;");
  });

  it("só alerta o Sentry depois de esgotar as passadas", () => {
    const laco = FONTE.indexOf("for (const file of pendentes)");
    const alerta = FONTE.indexOf("kind: \"migration-failed\"");
    const fimDoRepasse = FONTE.indexOf("for (const file of pendentes) {\n      log.error(");

    expect(alerta).toBeGreaterThan(laco);
    expect(
      fimDoRepasse,
      "alertar dentro do laço encheria o Sentry de incidente que se resolve " +
        "sozinho na passada seguinte",
    ).toBeGreaterThan(0);
  });
});
