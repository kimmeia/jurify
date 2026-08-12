/**
 * Controle de ruído da varredura agendada.
 *
 * A parte que decide alertar roda de hora em hora pra sempre. Se ela
 * repetir os mesmos achados a cada ciclo, o painel de erros vira ruído e
 * alguém desliga o robô — que é o pior desfecho possível pra ele.
 */

import { describe, expect, it } from "vitest";
import { contagemPorRegra, regrasQuePioraram } from "./cron-varredura";
import type { ResultadoVarredura } from "./tipos";

describe("regrasQuePioraram", () => {
  it("alerta tudo que está violando na primeira varredura do processo", () => {
    expect(regrasQuePioraram({ "AAA-01": 3, "BBB-02": 0, "CCC-03": 1 }, null)).toEqual([
      "AAA-01",
      "CCC-03",
    ]);
  });

  it("cala quando a contagem se repete", () => {
    const antes = { "AAA-01": 3, "BBB-02": 1 };
    expect(regrasQuePioraram({ "AAA-01": 3, "BBB-02": 1 }, antes)).toEqual([]);
  });

  it("alerta quando a contagem sobe", () => {
    expect(regrasQuePioraram({ "AAA-01": 5 }, { "AAA-01": 3 })).toEqual(["AAA-01"]);
  });

  it("alerta quando uma regra limpa passa a violar", () => {
    expect(regrasQuePioraram({ "AAA-01": 1 }, { "AAA-01": 0 })).toEqual(["AAA-01"]);
  });

  it("cala quando a contagem cai — melhora não é alerta", () => {
    expect(regrasQuePioraram({ "AAA-01": 1 }, { "AAA-01": 4 })).toEqual([]);
  });

  it("cala pra regra que zerou", () => {
    expect(regrasQuePioraram({ "AAA-01": 0 }, { "AAA-01": 4 })).toEqual([]);
  });

  it("alerta regra nova que já nasce violando", () => {
    expect(regrasQuePioraram({ "AAA-01": 2, "ZZZ-09": 1 }, { "AAA-01": 2 })).toEqual(["ZZZ-09"]);
  });
});

describe("contagemPorRegra", () => {
  it("inclui as regras limpas com zero, pra detectar recaída depois", () => {
    const resultado = {
      achados: [
        { regra: { id: "AAA-01" }, total: 2 },
        { regra: { id: "BBB-02" }, total: 0 },
      ],
    } as unknown as ResultadoVarredura;

    expect(contagemPorRegra(resultado)).toEqual({ "AAA-01": 2, "BBB-02": 0 });
  });
});
