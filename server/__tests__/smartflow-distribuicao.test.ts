/**
 * Testes — selecionarAtendenteRodizio (bloco Distribuir > Setor).
 *
 * Regressão do caso "6 atendentes no setor, tudo ia pro mesmo": o modelo
 * antigo rankeava por menor carga proporcional e o round-robin nunca
 * atuava. O novo: pool online-first (fallback todos), rodízio puro por
 * ultimaDistribuicao, capacidade como trava.
 */

import { describe, it, expect } from "vitest";
import {
  selecionarAtendenteRodizio,
  JANELA_ONLINE_MS,
  type CandidatoDistribuicao,
} from "../smartflow/distribuicao";

const AGORA = new Date("2026-06-12T12:00:00Z");
const ONLINE = new Date(AGORA.getTime() - 5 * 60_000); // 5min atrás
const OFFLINE = new Date(AGORA.getTime() - JANELA_ONLINE_MS - 60_000);

function cand(
  id: number,
  over: Partial<CandidatoDistribuicao> = {},
): CandidatoDistribuicao {
  return {
    id,
    ultimaAtividade: OFFLINE,
    maxSimultaneos: 5,
    ultimaDistribuicao: null,
    ...over,
  };
}

function dist(min: number): Date {
  return new Date(AGORA.getTime() - min * 60_000);
}

describe("selecionarAtendenteRodizio — pool online-first", () => {
  it("havendo online, distribui SÓ entre os online (offline com rodízio vencido é ignorado)", () => {
    const candidatos = [
      cand(1, { ultimaAtividade: OFFLINE, ultimaDistribuicao: dist(600) }), // offline, esperando há mais tempo
      cand(2, { ultimaAtividade: ONLINE, ultimaDistribuicao: dist(10) }),
      cand(3, { ultimaAtividade: ONLINE, ultimaDistribuicao: dist(30) }),
    ];
    // 3 está online e recebeu há mais tempo que 2 → ganha (1 nem entra no pool)
    expect(selecionarAtendenteRodizio(candidatos, new Map(), { agora: AGORA })).toBe(3);
  });

  it("todos offline → rodízio entre todos (um a um)", () => {
    const candidatos = [
      cand(1, { ultimaDistribuicao: dist(10) }),
      cand(2, { ultimaDistribuicao: dist(90) }),
      cand(3, { ultimaDistribuicao: dist(40) }),
    ];
    expect(selecionarAtendenteRodizio(candidatos, new Map(), { agora: AGORA })).toBe(2);
  });

  it("somenteOnline=true e ninguém online → null (saída sem_atendente)", () => {
    const candidatos = [cand(1), cand(2)];
    expect(
      selecionarAtendenteRodizio(candidatos, new Map(), { somenteOnline: true, agora: AGORA }),
    ).toBeNull();
  });

  it("quem nunca recebeu tem prioridade no rodízio", () => {
    const candidatos = [
      cand(1, { ultimaAtividade: ONLINE, ultimaDistribuicao: dist(5) }),
      cand(2, { ultimaAtividade: ONLINE, ultimaDistribuicao: null }), // nunca recebeu
    ];
    expect(selecionarAtendenteRodizio(candidatos, new Map(), { agora: AGORA })).toBe(2);
  });

  it("carga NÃO é ranking: atendente com menos conversas abertas não fura o rodízio", () => {
    // Cenário do bug real: Isaac (id 1) com 0 abertas, colegas com 20+.
    // No modelo antigo, Isaac ganhava SEMPRE. Agora vale o rodízio.
    const candidatos = [
      cand(1, { ultimaAtividade: ONLINE, ultimaDistribuicao: dist(1) }), // acabou de receber
      cand(2, { ultimaAtividade: ONLINE, ultimaDistribuicao: dist(120) }),
    ];
    const carga = new Map([
      [1, 0],
      [2, 4], // tem folga (limite 5)
    ]);
    expect(selecionarAtendenteRodizio(candidatos, carga, { agora: AGORA })).toBe(2);
  });

  it("rodízio alterna um a um conforme ultimaDistribuicao avança", () => {
    const base = [
      cand(1, { ultimaAtividade: ONLINE }),
      cand(2, { ultimaAtividade: ONLINE }),
      cand(3, { ultimaAtividade: ONLINE }),
    ];
    // Rodada 1: ninguém recebeu → menor id (1)
    expect(selecionarAtendenteRodizio(base, new Map(), { agora: AGORA })).toBe(1);
    // Rodada 2: 1 recebeu agora → vai pro 2
    base[0].ultimaDistribuicao = dist(0);
    expect(selecionarAtendenteRodizio(base, new Map(), { agora: AGORA })).toBe(2);
    // Rodada 3: 2 recebeu → vai pro 3
    base[1].ultimaDistribuicao = dist(0);
    expect(selecionarAtendenteRodizio(base, new Map(), { agora: AGORA })).toBe(3);
  });
});

describe("selecionarAtendenteRodizio — capacidade como trava", () => {
  it("pula quem está no limite de atendimentos simultâneos", () => {
    const candidatos = [
      cand(1, { ultimaAtividade: ONLINE, ultimaDistribuicao: dist(120), maxSimultaneos: 5 }),
      cand(2, { ultimaAtividade: ONLINE, ultimaDistribuicao: dist(10), maxSimultaneos: 5 }),
    ];
    const carga = new Map([
      [1, 5], // no limite → pulado mesmo sendo o próximo do rodízio
      [2, 1],
    ]);
    expect(selecionarAtendenteRodizio(candidatos, carga, { agora: AGORA })).toBe(2);
  });

  it("todos no limite → rodízio mesmo assim (não trava a fila)", () => {
    const candidatos = [
      cand(1, { ultimaAtividade: ONLINE, ultimaDistribuicao: dist(10), maxSimultaneos: 3 }),
      cand(2, { ultimaAtividade: ONLINE, ultimaDistribuicao: dist(60), maxSimultaneos: 3 }),
    ];
    const carga = new Map([
      [1, 3],
      [2, 3],
    ]);
    expect(selecionarAtendenteRodizio(candidatos, carga, { agora: AGORA })).toBe(2);
  });

  it("maxSimultaneos null/0 = SEM LIMITE (nunca trava a vaga)", () => {
    const candidatos = [
      cand(1, { ultimaAtividade: ONLINE, ultimaDistribuicao: dist(60), maxSimultaneos: null }),
      cand(2, { ultimaAtividade: ONLINE, ultimaDistribuicao: dist(10), maxSimultaneos: 5 }),
    ];
    const carga = new Map([[1, 50], [2, 1]]); // id 1 com 50 abertas, mas sem limite
    // id 1 esperou mais (60>10) e tem folga (∞) → ganha mesmo lotado
    expect(selecionarAtendenteRodizio(candidatos, carga, { agora: AGORA })).toBe(1);
  });

  it("lista vazia → null", () => {
    expect(selecionarAtendenteRodizio([], new Map(), { agora: AGORA })).toBeNull();
  });
});

describe("selecionarAtendenteRodizio — modo 'todos' (ignora online)", () => {
  it("distribui entre TODOS do setor mesmo havendo gente online", () => {
    const candidatos = [
      cand(1, { ultimaAtividade: OFFLINE, ultimaDistribuicao: dist(120) }), // offline, esperou mais
      cand(2, { ultimaAtividade: ONLINE, ultimaDistribuicao: dist(10) }),
    ];
    // modo "todos": offline entra no rodízio; id 1 esperou mais → ganha
    expect(selecionarAtendenteRodizio(candidatos, new Map(), { modoOnline: "todos", agora: AGORA })).toBe(1);
    // contraste: "online primeiro" escolheria o online (id 2)
    expect(selecionarAtendenteRodizio(candidatos, new Map(), { modoOnline: "online_primeiro", agora: AGORA })).toBe(2);
  });

  it("modo 'todos' ainda respeita capacidade quando há limite", () => {
    const candidatos = [
      cand(1, { ultimaAtividade: OFFLINE, ultimaDistribuicao: dist(120), maxSimultaneos: 3 }),
      cand(2, { ultimaAtividade: OFFLINE, ultimaDistribuicao: dist(10), maxSimultaneos: 3 }),
    ];
    const carga = new Map([[1, 3]]); // id 1 no limite → pulado, vai pro 2
    expect(selecionarAtendenteRodizio(candidatos, carga, { modoOnline: "todos", agora: AGORA })).toBe(2);
  });
});
