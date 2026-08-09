import { describe, expect, it } from "vitest";
import {
  MODULO_JURISIA,
  addonVigente,
  diasParaVencer,
  resolverAcessoJurisIA,
  type AddonParaAcesso,
  type PlanoParaAcesso,
} from "../../shared/addon-jurisia";

const AGORA = new Date("2026-08-09T12:00:00.000Z");
const dia = (d: string) => `${d}T12:00:00.000Z`;

const plano = (over: Partial<PlanoParaAcesso> = {}): PlanoParaAcesso => ({
  modulos: [MODULO_JURISIA],
  jurisiaMensagensMes: 300,
  ...over,
});

const addon = (over: Partial<AddonParaAcesso> = {}): AddonParaAcesso => ({
  status: "ativo",
  limiteMensal: 900,
  inicioEm: null,
  expiraEm: null,
  ...over,
});

const resolver = (p: PlanoParaAcesso | null, a: AddonParaAcesso | null, agora = AGORA) =>
  resolverAcessoJurisIA({ plano: p, addon: a, agora });

describe("resolverAcessoJurisIA — pelo plano", () => {
  it("libera quando o plano marca o módulo E tem cota", () => {
    const r = resolver(plano(), null);
    expect(r.liberado).toBe(true);
    expect(r.limite).toBe(300);
    expect(r.origem).toBe("plano");
  });

  // Os dois campos existem e são independentes: marcar o módulo sem dar cota
  // (ou dar cota sem marcar) é meio-caminho, e meio-caminho não libera.
  it("não libera com o módulo marcado e cota zero", () => {
    expect(resolver(plano({ jurisiaMensagensMes: 0 }), null).liberado).toBe(false);
  });

  it("não libera com cota e sem o módulo marcado", () => {
    expect(resolver(plano({ modulos: ["processos", "clientes"] }), null).liberado).toBe(false);
  });

  it("sem assinatura nenhuma, não libera", () => {
    const r = resolver(null, null);
    expect(r.liberado).toBe(false);
    expect(r.limite).toBe(0);
    expect(r.motivo).toBe("nao_contratado");
  });
});

describe("resolverAcessoJurisIA — pelo add-on", () => {
  it("libera mesmo sem plano nenhum — é o caso do piloto e da cortesia", () => {
    const r = resolver(null, addon());
    expect(r.liberado).toBe(true);
    expect(r.limite).toBe(900);
    expect(r.origem).toBe("addon");
  });

  it("libera com plano que não inclui o módulo", () => {
    const r = resolver(plano({ modulos: ["processos"], jurisiaMensagensMes: 0 }), addon());
    expect(r.liberado).toBe(true);
    expect(r.origem).toBe("addon");
  });

  it("suspenso não libera, e o motivo é próprio", () => {
    const r = resolver(null, addon({ status: "suspenso" }));
    expect(r.liberado).toBe(false);
    expect(r.motivo).toBe("suspenso");
  });

  it("cancelado conta como expirado — quem cancelou já teve", () => {
    expect(resolver(null, addon({ status: "cancelado" })).motivo).toBe("expirado");
  });
});

describe("resolverAcessoJurisIA — vigência", () => {
  it("vencido não libera", () => {
    const r = resolver(null, addon({ expiraEm: dia("2026-08-01") }));
    expect(r.liberado).toBe(false);
    expect(r.motivo).toBe("expirado");
  });

  it("dentro do prazo libera e devolve o vencimento", () => {
    const r = resolver(null, addon({ expiraEm: dia("2026-12-31") }));
    expect(r.liberado).toBe(true);
    expect(r.expiraEm).toBe(dia("2026-12-31"));
  });

  // Contrato agendado pra semana que vem não pode entregar o módulo hoje.
  it("início no futuro ainda não libera", () => {
    const r = resolver(null, addon({ inicioEm: dia("2026-09-01") }));
    expect(r.liberado).toBe(false);
    expect(r.motivo).toBe("nao_contratado");
  });

  it("início no passado libera", () => {
    expect(resolver(null, addon({ inicioEm: dia("2026-01-01") })).liberado).toBe(true);
  });

  // Data podre no banco não pode virar contrato eterno.
  it("expiraEm inválido bloqueia em vez de valer pra sempre", () => {
    expect(addonVigente(addon({ expiraEm: "trinta e um de dezembro" }), AGORA)).toBe(false);
  });

  it("sem datas, vale enquanto estiver ativo", () => {
    expect(addonVigente(addon(), AGORA)).toBe(true);
  });

  it("addon ausente nunca é vigente", () => {
    expect(addonVigente(null, AGORA)).toBe(false);
  });
});

describe("resolverAcessoJurisIA — plano e add-on juntos", () => {
  // O add-on existe pra somar. Quem comprou avulso não pode terminar com menos
  // do que o plano já dava.
  it("vale o maior limite quando as duas origens liberam", () => {
    const r = resolver(plano({ jurisiaMensagensMes: 300 }), addon({ limiteMensal: 900 }));
    expect(r.liberado).toBe(true);
    expect(r.limite).toBe(900);
    expect(r.origem).toBe("ambos");
  });

  it("o plano vence quando é ele que dá mais", () => {
    const r = resolver(plano({ jurisiaMensagensMes: 1200 }), addon({ limiteMensal: 400 }));
    expect(r.limite).toBe(1200);
    expect(r.origem).toBe("ambos");
  });

  // Add-on vencido não pode derrubar quem o plano já libera.
  it("add-on vencido não tira o acesso que vem do plano", () => {
    const r = resolver(plano(), addon({ expiraEm: dia("2026-01-01") }));
    expect(r.liberado).toBe(true);
    expect(r.limite).toBe(300);
    expect(r.origem).toBe("plano");
    expect(r.expiraEm).toBeNull();
  });

  it("add-on suspenso não derruba o plano", () => {
    expect(resolver(plano(), addon({ status: "suspenso" })).liberado).toBe(true);
  });
});

describe("resolverAcessoJurisIA — entrada suja", () => {
  it("limite negativo ou não numérico não vira acesso", () => {
    expect(resolver(plano({ jurisiaMensagensMes: -5 }), null).liberado).toBe(false);
    expect(resolver(null, addon({ limiteMensal: -1 })).limite).toBe(0);
    expect(resolver(null, addon({ limiteMensal: Number.NaN })).limite).toBe(0);
  });

  it("limite fracionado é truncado, nunca arredondado pra cima", () => {
    expect(resolver(null, addon({ limiteMensal: 99.9 })).limite).toBe(99);
  });
});

describe("diasParaVencer", () => {
  it("conta os dias que faltam", () => {
    expect(diasParaVencer(dia("2026-08-19"), AGORA)).toBe(10);
  });

  it("não conta prazo que já passou", () => {
    expect(diasParaVencer(dia("2026-08-01"), AGORA)).toBeNull();
  });

  it("sem vencimento, não há contagem", () => {
    expect(diasParaVencer(null, AGORA)).toBeNull();
    expect(diasParaVencer("data ruim", AGORA)).toBeNull();
  });
});
