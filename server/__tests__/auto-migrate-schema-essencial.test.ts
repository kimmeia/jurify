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

    const primeiraChamada = FONTE.indexOf("await garantirSchemaEssencial(");
    const inicioLaco = FONTE.indexOf("for (const file of files)");
    expect(
      ultimaChamada,
      "a segunda chamada caiu antes do laço — não é segunda passada",
    ).toBeGreaterThan(inicioLaco > 0 ? inicioLaco : primeiraChamada);
  });
});
