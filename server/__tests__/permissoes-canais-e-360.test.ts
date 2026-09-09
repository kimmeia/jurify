/**
 * Dois achados da auditoria de permissões de 18/08.
 *
 * CANAIS SEM GATE. Conectar WhatsApp/Instagram/Messenger, refazer o registro
 * do número e reinscrever o webhook eram `protectedProcedure` puro — qualquer
 * colaborador logado podia trocar a infraestrutura de comunicação do
 * escritório inteiro. O serviço vizinho (whatsapp-cloud-services) sempre
 * exigiu gestão pra config; a régua agora é a mesma.
 *
 * 360 ENTREGAVA O FINANCEIRO A QUALQUER UM. O perfil do cliente no
 * Atendimento incluía cobranças e valores sem checar `financeiro.ver` — a
 * permissão do módulo virava enfeite, porque dava pra ver tudo por outra
 * porta. Quem não pode ver recebe o bloco zerado com `oculto: true`, pra UI
 * explicar em vez de fingir que não há cobrança.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

const canais = ler("server/routers/meta-channels.ts");
const c360 = ler("server/routers/customer360.ts");

describe("mexer nos canais exige gestão", () => {
  for (const nome of [
    "connectWhatsApp",
    "connectInstagram",
    "connectMessenger",
    "registerWhatsAppNumber",
    "subscribeWebhooks",
  ]) {
    it(`${nome} passa pelo gate`, () => {
      const i = canais.indexOf(`${nome}: protectedProcedure`);
      expect(i, `${nome} sumiu`).toBeGreaterThan(0);
      expect(canais.slice(i, i + 900)).toContain("exigirGestaoDeCanais(ctx.user.id)");
    });
  }

  it("o gate usa a mesma régua do serviço vizinho", () => {
    expect(canais).toContain('checkPermissionAdminOuMatriz(userId, "configuracoes", "editar")');
  });
});

describe("o 360 respeita a permissão do financeiro", () => {
  it("checa financeiro.ver antes de buscar cobrança", () => {
    expect(c360).toContain('checkPermission(ctx.user.id, "financeiro", "ver")');
    expect(c360).toContain("!podeVerFinanceiro");
  });

  it("quem não pode ver recebe o bloco marcado, não dados", () => {
    // `oculto: true` deixa a UI explicar; omitir em silêncio faria a tela
    // afirmar "sem cobranças" — que é uma informação falsa.
    expect(c360).toContain("oculto: !podeVerFinanceiro");
  });
});
