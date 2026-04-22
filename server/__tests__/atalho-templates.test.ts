/**
 * Testes — helpers do autocomplete de Respostas Rápidas.
 *
 * Cobrem o parsing/aplicação do atalho digitado no input de mensagem
 * do Atendimento. Lógica pura em shared/, sem React, sem DOM — só
 * strings + inteiros (posição do cursor).
 */

import { describe, it, expect } from "vitest";
import {
  aplicarAtalho,
  detectarAtalhoAtivo,
  filtrarTemplatesParaAtalho,
} from "../../shared/atalho-templates";

describe("detectarAtalhoAtivo", () => {
  it("ativa quando '/' está no início e cursor está após", () => {
    expect(detectarAtalhoAtivo("/bol", 4)).toEqual({ inicio: 0, filtro: "bol" });
  });

  it("ativa quando '/' vem depois de espaço", () => {
    expect(detectarAtalhoAtivo("olá /bol", 8)).toEqual({ inicio: 4, filtro: "bol" });
  });

  it("NÃO ativa quando '/' está colado em letra (URL, caminho)", () => {
    expect(detectarAtalhoAtivo("http://bol", 10)).toBeNull();
    expect(detectarAtalhoAtivo("abc/bol", 7)).toBeNull();
  });

  it("retorna null quando não tem '/' no input", () => {
    expect(detectarAtalhoAtivo("ola tudo bem", 5)).toBeNull();
  });

  it("filtro vazio quando usuário digitou só '/'", () => {
    expect(detectarAtalhoAtivo("/", 1)).toEqual({ inicio: 0, filtro: "" });
    expect(detectarAtalhoAtivo("olá /", 5)).toEqual({ inicio: 4, filtro: "" });
  });

  it("cursor antes da '/' não dispara", () => {
    expect(detectarAtalhoAtivo("olá /bol", 3)).toBeNull();
    expect(detectarAtalhoAtivo("olá /bol", 4)).toBeNull(); // cursor no "/"
  });

  it("espaço depois do '/bol' cancela (atalho já fechado)", () => {
    expect(detectarAtalhoAtivo("/bol ", 5)).toBeNull();
  });

  it("normaliza filtro pra lowercase", () => {
    expect(detectarAtalhoAtivo("/BOL", 4)).toEqual({ inicio: 0, filtro: "bol" });
  });

  it("lida com cursor fora do range sem quebrar", () => {
    expect(detectarAtalhoAtivo("abc", 0)).toBeNull();
    expect(detectarAtalhoAtivo("abc", 99)).toBeNull();
  });
});

describe("aplicarAtalho", () => {
  it("substitui o segmento e posiciona cursor após o conteúdo", () => {
    const res = aplicarAtalho("/bol", 0, 4, "Boleto em anexo");
    expect(res.valor).toBe("Boleto em anexo");
    expect(res.cursor).toBe("Boleto em anexo".length);
  });

  it("preserva texto antes e depois da região substituída", () => {
    const res = aplicarAtalho("olá /bol agora", 4, 8, "tudo bem?");
    expect(res.valor).toBe("olá tudo bem? agora");
    expect(res.cursor).toBe("olá tudo bem?".length);
  });

  it("conteúdo vazio efetivamente remove o atalho", () => {
    const res = aplicarAtalho("olá /bol", 4, 8, "");
    expect(res.valor).toBe("olá ");
    expect(res.cursor).toBe(4);
  });
});

describe("filtrarTemplatesParaAtalho", () => {
  const tpls = [
    { id: 1, titulo: "Boleto", conteudo: "...", atalho: "/bol" },
    { id: 2, titulo: "Boas-vindas", conteudo: "...", atalho: "/boas" },
    { id: 3, titulo: "Agendamento", conteudo: "...", atalho: "/ag" },
    { id: 4, titulo: "Sem atalho", conteudo: "...", atalho: null },
    { id: 5, titulo: "Espaços", conteudo: "...", atalho: "   " },
  ];

  it("ignora templates sem atalho preenchido", () => {
    const out = filtrarTemplatesParaAtalho(tpls, "");
    expect(out.map((t) => t.id).sort()).toEqual([1, 2, 3]);
  });

  it("faz startsWith case-insensitive (com ou sem '/' no cadastro)", () => {
    expect(filtrarTemplatesParaAtalho(tpls, "bo").map((t) => t.id)).toEqual([2, 1]);
    expect(filtrarTemplatesParaAtalho(tpls, "BOL").map((t) => t.id)).toEqual([1]);
  });

  it("ordena alfabeticamente por atalho", () => {
    const out = filtrarTemplatesParaAtalho(tpls, "");
    expect(out.map((t) => t.atalho)).toEqual(["/ag", "/boas", "/bol"]);
  });

  it("respeita maxItens", () => {
    expect(filtrarTemplatesParaAtalho(tpls, "", 2)).toHaveLength(2);
  });

  it("filtro sem match devolve lista vazia", () => {
    expect(filtrarTemplatesParaAtalho(tpls, "zzz")).toEqual([]);
  });
});
