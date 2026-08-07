/**
 * A conversa aberta fica presa no topo — mas só até certo ponto.
 *
 * O bug que originou o módulo: filtrar o Inbox por uma atendente deixava os
 * contadores em zero (certo) e ainda assim mostrava o card de uma conversa de
 * OUTRO atendente, só por estar aberta.
 */

import { describe, it, expect } from "vitest";
import { montarListaInbox } from "../../shared/inbox-lista";

const c = (id: number, status = "em_atendimento") => ({ id, status });
const BASE = { aba: "todos", mostrarArquivadas: false, cache: null, filtrosMudaram: false };

describe("montarListaInbox", () => {
  it("sem conversa aberta, devolve o que o servidor mandou", () => {
    const r = montarListaInbox({ ...BASE, todas: [c(1), c(2)], selId: null });
    expect(r.lista.map((x) => x.id)).toEqual([1, 2]);
    expect(r.cache).toBeNull();
  });

  it("a aberta continua visível ao sair da aba por mudança de status", () => {
    // Caso real: o atendente responde, "aguardando" vira "em atendimento" e a
    // conversa sumiria debaixo do dedo de quem acabou de escrever.
    const r = montarListaInbox({
      ...BASE,
      aba: "aguardando",
      todas: [c(1, "em_atendimento"), c(2, "aguardando")],
      selId: 1,
    });
    expect(r.lista.map((x) => x.id)).toEqual([1, 2]);
  });

  it("a aberta some quando o filtro de atendente muda", () => {
    // O bug: filtro por Liciane, contadores zerados, e o card do Isaac fixado.
    const r = montarListaInbox({
      ...BASE,
      todas: [],
      selId: 7,
      cache: c(7),
      filtrosMudaram: true,
    });
    expect(r.lista).toEqual([]);
    expect(r.cache).toBeNull();
  });

  it("o cache sobrevive enquanto os filtros são os mesmos", () => {
    // É o que segura a conversa aberta entre o refetch e a resposta do servidor.
    const r = montarListaInbox({ ...BASE, todas: [c(9)], selId: 7, cache: c(7) });
    expect(r.lista.map((x) => x.id)).toEqual([7, 9]);
  });

  it("o cache se atualiza com a versão que veio do servidor", () => {
    const r = montarListaInbox({
      ...BASE,
      todas: [c(7, "resolvido")],
      selId: 7,
      cache: c(7, "aguardando"),
    });
    expect(r.cache).toEqual({ id: 7, status: "resolvido" });
  });

  it("trocar de conversa aberta descarta o cache da anterior", () => {
    const r = montarListaInbox({ ...BASE, todas: [], selId: 8, cache: c(7) });
    expect(r.lista).toEqual([]);
    expect(r.cache).toBeNull();
  });

  it("não duplica a aberta quando ela já está na lista", () => {
    const r = montarListaInbox({ ...BASE, todas: [c(1), c(2)], selId: 1 });
    expect(r.lista.map((x) => x.id)).toEqual([1, 2]);
  });

  it("nas arquivadas a aba de status não recorta nada", () => {
    const r = montarListaInbox({
      ...BASE,
      aba: "aguardando",
      mostrarArquivadas: true,
      todas: [c(1, "resolvido"), c(2, "fechado")],
      selId: null,
    });
    expect(r.lista).toHaveLength(2);
  });
});
