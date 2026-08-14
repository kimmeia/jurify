/**
 * A régua do episódio.
 *
 * O caso que trouxe isto: Raimundo falou com um SDR em março, virou cliente, e
 * voltou em agosto pra falar de verificação processual com outra pessoa. São
 * dois atendimentos. O sistema via uma conversa só — criada em março, com um
 * campo de atendente que a segunda pessoa sobrescreveu.
 *
 * Consequências que estes testes travam: o segundo atendimento tem que contar
 * em AGOSTO, e o primeiro tem que continuar em março no nome de quem o abriu.
 */

import { describe, expect, it } from "vitest";
import {
  abreNovoEpisodio,
  fechamentoPorSilencio,
  SILENCIO_DIAS,
  SILENCIO_MS,
  TRANSFERENCIA_ABRE_EPISODIO,
  venceuPorSilencio,
  type EpisodioParaRegra,
} from "../../shared/atendimento-episodio";

const dia = (s: string) => new Date(s);
const ep = (over: Partial<EpisodioParaRegra> = {}): EpisodioParaRegra => ({
  id: 1,
  abertoEm: dia("2026-03-12T09:14:00Z"),
  fechadoEm: null,
  ultimaMensagemEm: dia("2026-03-18T16:20:00Z"),
  ...over,
});

describe("quando abre um episódio novo", () => {
  it("primeira mensagem da vida abre", () => {
    expect(abreNovoEpisodio(null, dia("2026-03-12T09:14:00Z"))).toBe(true);
    expect(abreNovoEpisodio(undefined, dia("2026-03-12T09:14:00Z"))).toBe(true);
  });

  it("o caso do Raimundo: voltou 5 meses depois, é atendimento novo", () => {
    const marco = ep({ fechadoEm: dia("2026-03-18T16:20:00Z") });
    expect(abreNovoEpisodio(marco, dia("2026-08-12T10:02:00Z"))).toBe(true);
  });

  it("episódio resolvido não é reaberto por mensagem nova", () => {
    // Resolver é decisão explícita de que aquele trabalho acabou. Reabrir por
    // cima dela apagaria a decisão — mesmo que a resposta venha no dia
    // seguinte.
    const resolvido = ep({ fechadoEm: dia("2026-03-18T16:20:00Z") });
    expect(abreNovoEpisodio(resolvido, dia("2026-03-19T08:00:00Z"))).toBe(true);
  });

  it("vai-e-vem normal do caso continua no mesmo atendimento", () => {
    // Cliente que some numa sexta e volta na outra segunda não abriu demanda
    // nova. É o erro que um limite curto demais cometeria.
    const aberto = ep({ ultimaMensagemEm: dia("2026-03-18T16:20:00Z") });
    expect(abreNovoEpisodio(aberto, dia("2026-03-28T09:00:00Z"))).toBe(false);
  });

  it("o silêncio conta da ÚLTIMA MENSAGEM, não da abertura", () => {
    // Um atendimento que se arrasta um mês em conversa ativa não pode ser
    // partido no meio só por ser longo.
    const longo = ep({
      abertoEm: dia("2026-03-01T09:00:00Z"),
      ultimaMensagemEm: dia("2026-04-10T09:00:00Z"),
    });
    expect(abreNovoEpisodio(longo, dia("2026-04-15T09:00:00Z"))).toBe(false);
  });

  it("a fronteira é exatamente o limite", () => {
    const base = dia("2026-03-18T16:20:00Z");
    const aberto = ep({ ultimaMensagemEm: base });
    expect(abreNovoEpisodio(aberto, new Date(base.getTime() + SILENCIO_MS))).toBe(false);
    expect(abreNovoEpisodio(aberto, new Date(base.getTime() + SILENCIO_MS + 1))).toBe(true);
  });

  it("mensagem com data pra trás não abre nada", () => {
    // Reprocessamento de webhook e fuso torto acontecem. Só o tempo PARA
    // FRENTE encerra alguma coisa.
    const aberto = ep({ ultimaMensagemEm: dia("2026-03-18T16:20:00Z") });
    expect(abreNovoEpisodio(aberto, dia("2026-02-01T09:00:00Z"))).toBe(false);
  });

  it("aceita data em texto, como vem do banco", () => {
    const aberto = ep({ ultimaMensagemEm: "2026-03-18T16:20:00.000Z" });
    expect(abreNovoEpisodio(aberto, dia("2026-08-12T10:02:00Z"))).toBe(true);
  });
});

describe("fechamento por silêncio", () => {
  it("vence quem passou do limite sem mensagem", () => {
    const parado = ep({ ultimaMensagemEm: dia("2026-03-18T16:20:00Z") });
    expect(venceuPorSilencio(parado, dia("2026-08-01T00:00:00Z"))).toBe(true);
  });

  it("não vence quem ainda está dentro do limite", () => {
    const recente = ep({ ultimaMensagemEm: dia("2026-03-18T16:20:00Z") });
    expect(venceuPorSilencio(recente, dia("2026-03-25T00:00:00Z"))).toBe(false);
  });

  it("episódio já fechado não vence de novo", () => {
    const fechado = ep({ fechadoEm: dia("2026-03-18T16:20:00Z") });
    expect(venceuPorSilencio(fechado, dia("2026-08-01T00:00:00Z"))).toBe(false);
  });

  it("carimba a última mensagem, não a hora da varredura", () => {
    // Se o cron ficar parado dois meses, um episódio de março não pode
    // aparecer encerrado em agosto: a duração do atendimento passaria a
    // depender de quando a máquina passou por ali.
    const parado = ep({ ultimaMensagemEm: dia("2026-03-18T16:20:00Z") });
    expect(fechamentoPorSilencio(parado)?.toISOString()).toBe("2026-03-18T16:20:00.000Z");
  });

  it("sem mensagem nenhuma, cai na abertura", () => {
    const vazio = ep({ ultimaMensagemEm: null, abertoEm: dia("2026-03-12T09:14:00Z") });
    expect(fechamentoPorSilencio(vazio)?.toISOString()).toBe("2026-03-12T09:14:00.000Z");
    expect(venceuPorSilencio(vazio, dia("2026-08-01T00:00:00Z"))).toBe(true);
  });
});

describe("transferência", () => {
  it("não abre episódio novo", () => {
    // É a mesma demanda trocando de mão. Abrir episódio a cada repasse
    // contaria uma demanda como dois atendimentos e inflaria o número de quem
    // recebe transferência.
    expect(TRANSFERENCIA_ABRE_EPISODIO).toBe(false);
  });
});

describe("o limite", () => {
  it("é de duas semanas, em dias e em milissegundos coerentes", () => {
    expect(SILENCIO_DIAS).toBe(15);
    expect(SILENCIO_MS).toBe(15 * 24 * 60 * 60 * 1000);
  });
});
