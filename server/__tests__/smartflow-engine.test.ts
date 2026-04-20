/**
 * Testes do SmartFlow Engine — motor de execução de cenários.
 *
 * Usa executores mock pra testar a lógica sem I/O real.
 * Cada teste verifica um fluxo específico:
 *   - Classificação de intenção
 *   - Resposta IA
 *   - Busca + agendamento Cal.com
 *   - Fluxo completo atendimento + agendamento
 *   - Condicionais
 *   - Tratamento de erros
 */

import { describe, it, expect, vi } from "vitest";
import {
  executarCenario,
  SmartflowContexto,
  SmartflowExecutores,
  Passo,
} from "../smartflow/engine";

// ─── Mock executores ────────────────────────────────────────────────────────

function criarMockExecutores(overrides?: Partial<SmartflowExecutores>): SmartflowExecutores {
  return {
    chamarIA: vi.fn().mockResolvedValue("duvida"),
    executarAgente: vi.fn().mockResolvedValue("resposta-do-agente"),
    buscarHorarios: vi.fn().mockResolvedValue(["2026-04-15 10:00", "2026-04-15 14:00", "2026-04-16 09:00"]),
    criarAgendamento: vi.fn().mockResolvedValue("booking_123"),
    listarBookings: vi.fn().mockResolvedValue([]),
    cancelarBooking: vi.fn().mockResolvedValue(true),
    reagendarBooking: vi.fn().mockResolvedValue(true),
    enviarWhatsApp: vi.fn().mockResolvedValue(true),
    chamarWebhook: vi.fn().mockResolvedValue({ ok: true }),
    criarCardKanban: vi.fn().mockResolvedValue(42),
    ...overrides,
  };
}

// ─── Testes ─────────────────────────────────────────────────────────────────

describe("SmartFlow Engine", () => {
  describe("ia_classificar", () => {
    it("classifica intenção corretamente", async () => {
      const exec = criarMockExecutores({ chamarIA: vi.fn().mockResolvedValue("agendar") });
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "ia_classificar", config: { categorias: ["agendar", "duvida", "emergencia"] } },
      ];

      const resultado = await executarCenario(passos, { mensagem: "Quero marcar uma consulta" }, exec);

      expect(resultado.sucesso).toBe(true);
      expect(resultado.contexto.intencao).toBe("agendar");
      expect(resultado.passosExecutados).toBe(1);
    });

    it("fallback pra 'outro' quando IA retorna categoria inválida", async () => {
      const exec = criarMockExecutores({ chamarIA: vi.fn().mockResolvedValue("xyz_invalido") });
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "ia_classificar", config: { categorias: ["agendar", "duvida"] } },
      ];

      const resultado = await executarCenario(passos, { mensagem: "teste" }, exec);

      expect(resultado.sucesso).toBe(true);
      expect(resultado.contexto.intencao).toBe("outro");
    });

    it("falha sem mensagem", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "ia_classificar", config: {} },
      ];

      const resultado = await executarCenario(passos, {}, exec);

      expect(resultado.sucesso).toBe(false);
      expect(resultado.erro).toContain("Sem mensagem");
    });
  });

  describe("ia_responder", () => {
    it("gera resposta e adiciona ao contexto", async () => {
      const exec = criarMockExecutores({
        chamarIA: vi.fn().mockResolvedValue("Claro! Posso ajudar com sua dúvida."),
      });
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "ia_responder", config: { prompt: "Seja gentil" } },
      ];

      const resultado = await executarCenario(passos, { mensagem: "Tenho uma dúvida" }, exec);

      expect(resultado.sucesso).toBe(true);
      expect(resultado.contexto.respostaIA).toBe("Claro! Posso ajudar com sua dúvida.");
      expect(resultado.respostas).toHaveLength(1);
      expect(resultado.respostas[0]).toContain("Posso ajudar");
    });

    it("usa executarAgente quando config.agenteId está presente", async () => {
      const chamarIA = vi.fn().mockResolvedValue("nunca-deve-ser-chamado");
      const executarAgente = vi.fn().mockResolvedValue("resposta do agente 42");
      const exec = criarMockExecutores({ chamarIA, executarAgente });
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "ia_responder", config: { agenteId: 42 } },
      ];

      const resultado = await executarCenario(passos, { mensagem: "oi" }, exec);

      expect(resultado.sucesso).toBe(true);
      expect(executarAgente).toHaveBeenCalledWith(42, "oi");
      expect(chamarIA).not.toHaveBeenCalled();
      expect(resultado.contexto.respostaIA).toBe("resposta do agente 42");
      expect(resultado.respostas[0]).toBe("resposta do agente 42");
    });

    it("cai no fallback chamarIA quando agenteId é 0 ou ausente", async () => {
      const chamarIA = vi.fn().mockResolvedValue("resposta via prompt livre");
      const executarAgente = vi.fn();
      const exec = criarMockExecutores({ chamarIA, executarAgente });
      const passos: Passo[] = [
        // agenteId=0 é tratado como "sem agente" — usa prompt textual
        { id: 1, ordem: 1, tipo: "ia_responder", config: { agenteId: 0, prompt: "Seja direto" } },
      ];

      const resultado = await executarCenario(passos, { mensagem: "oi" }, exec);

      expect(resultado.sucesso).toBe(true);
      expect(executarAgente).not.toHaveBeenCalled();
      expect(chamarIA).toHaveBeenCalled();
      expect(resultado.contexto.respostaIA).toBe("resposta via prompt livre");
    });

    it("propaga erro do executarAgente como falha do passo", async () => {
      const executarAgente = vi.fn().mockRejectedValue(new Error("Agente inativo"));
      const exec = criarMockExecutores({ executarAgente });
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "ia_responder", config: { agenteId: 99 } },
      ];

      const resultado = await executarCenario(passos, { mensagem: "oi" }, exec);

      expect(resultado.sucesso).toBe(false);
      expect(resultado.erro).toContain("Agente inativo");
    });
  });

  describe("calcom_horarios", () => {
    it("retorna horários formatados", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "calcom_horarios", config: { duracao: 30 } },
      ];

      const resultado = await executarCenario(passos, {}, exec);

      expect(resultado.sucesso).toBe(true);
      expect(resultado.contexto.horariosDisponiveis).toHaveLength(3);
      expect(resultado.respostas[0]).toContain("horários disponíveis");
    });

    it("para o fluxo quando não tem horários", async () => {
      const exec = criarMockExecutores({ buscarHorarios: vi.fn().mockResolvedValue([]) });
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "calcom_horarios", config: {} },
        { id: 2, ordem: 2, tipo: "ia_responder", config: {} }, // não deve executar
      ];

      const resultado = await executarCenario(passos, {}, exec);

      expect(resultado.sucesso).toBe(true);
      expect(resultado.passosExecutados).toBe(1); // parou no 1
      expect(resultado.respostas[0]).toContain("não temos horários");
    });
  });

  describe("calcom_agendar", () => {
    it("cria agendamento com sucesso", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "calcom_agendar", config: {} },
      ];

      const resultado = await executarCenario(
        passos,
        { horarioEscolhido: "2026-04-15 10:00", nomeCliente: "João", emailCliente: "joao@email.com" },
        exec,
      );

      expect(resultado.sucesso).toBe(true);
      expect(resultado.contexto.agendamentoId).toBe("booking_123");
      expect(resultado.respostas[0]).toContain("agendada com sucesso");
    });

    it("falha sem horário escolhido", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "calcom_agendar", config: {} },
      ];

      const resultado = await executarCenario(passos, {}, exec);

      expect(resultado.sucesso).toBe(false);
      expect(resultado.erro).toContain("horário");
    });
  });

  describe("calcom_listar", () => {
    it("chama listarBookings com status do config e grava no contexto", async () => {
      const bookings = [
        { id: 1, titulo: "Reunião", startTime: "2026-05-01T10:00:00Z" },
        { id: 2, titulo: "Consulta", startTime: "2026-05-02T14:00:00Z" },
      ];
      const listarBookings = vi.fn().mockResolvedValue(bookings);
      const exec = criarMockExecutores({ listarBookings });
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "calcom_listar", config: { status: "upcoming" } },
      ];

      const resultado = await executarCenario(passos, {}, exec);

      expect(resultado.sucesso).toBe(true);
      expect(listarBookings).toHaveBeenCalledWith({ status: "upcoming" });
      expect(resultado.contexto.bookings).toEqual(bookings);
      expect(resultado.contexto.bookingsQuantidade).toBe(2);
    });

    it("usa 'upcoming' como status padrão quando config está vazia", async () => {
      const listarBookings = vi.fn().mockResolvedValue([]);
      const exec = criarMockExecutores({ listarBookings });
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "calcom_listar", config: {} },
      ];

      await executarCenario(passos, {}, exec);

      expect(listarBookings).toHaveBeenCalledWith({ status: "upcoming" });
    });
  });

  describe("calcom_cancelar", () => {
    it("usa bookingId do config quando presente", async () => {
      const cancelarBooking = vi.fn().mockResolvedValue(true);
      const exec = criarMockExecutores({ cancelarBooking });
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "calcom_cancelar", config: { bookingId: "999", motivo: "teste" } },
      ];

      const resultado = await executarCenario(passos, { agendamentoId: "ignorar_esse" }, exec);

      expect(resultado.sucesso).toBe(true);
      expect(cancelarBooking).toHaveBeenCalledWith("999", "teste");
      expect(resultado.contexto.bookingCancelado).toBe("999");
    });

    it("cai no ctx.agendamentoId quando bookingId não está no config", async () => {
      const cancelarBooking = vi.fn().mockResolvedValue(true);
      const exec = criarMockExecutores({ cancelarBooking });
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "calcom_cancelar", config: {} },
      ];

      await executarCenario(passos, { agendamentoId: "456" }, exec);

      expect(cancelarBooking).toHaveBeenCalledWith("456", undefined);
    });

    it("falha quando não tem bookingId em lugar nenhum", async () => {
      const cancelarBooking = vi.fn();
      const exec = criarMockExecutores({ cancelarBooking });
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "calcom_cancelar", config: {} },
      ];

      const resultado = await executarCenario(passos, {}, exec);

      expect(resultado.sucesso).toBe(false);
      expect(cancelarBooking).not.toHaveBeenCalled();
    });

    it("falha quando o Cal.com retorna false", async () => {
      const cancelarBooking = vi.fn().mockResolvedValue(false);
      const exec = criarMockExecutores({ cancelarBooking });
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "calcom_cancelar", config: { bookingId: "1" } },
      ];

      const resultado = await executarCenario(passos, {}, exec);

      expect(resultado.sucesso).toBe(false);
      expect(resultado.erro).toContain("recusou");
    });
  });

  describe("calcom_remarcar", () => {
    it("usa bookingId e novoHorario do config", async () => {
      const reagendarBooking = vi.fn().mockResolvedValue(true);
      const exec = criarMockExecutores({ reagendarBooking });
      const passos: Passo[] = [
        {
          id: 1,
          ordem: 1,
          tipo: "calcom_remarcar",
          config: { bookingId: "42", novoHorario: "2026-06-01T10:00:00Z" },
        },
      ];

      const resultado = await executarCenario(passos, {}, exec);

      expect(resultado.sucesso).toBe(true);
      expect(reagendarBooking).toHaveBeenCalledWith("42", "2026-06-01T10:00:00Z", undefined);
      expect(resultado.contexto.horarioEscolhido).toBe("2026-06-01T10:00:00Z");
    });

    it("fallback pro contexto quando config está vazia", async () => {
      const reagendarBooking = vi.fn().mockResolvedValue(true);
      const exec = criarMockExecutores({ reagendarBooking });
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "calcom_remarcar", config: {} },
      ];

      await executarCenario(
        passos,
        { agendamentoId: "777", horarioEscolhido: "2026-07-01T14:00:00Z" },
        exec,
      );

      expect(reagendarBooking).toHaveBeenCalledWith("777", "2026-07-01T14:00:00Z", undefined);
    });

    it("falha sem novo horário", async () => {
      const reagendarBooking = vi.fn();
      const exec = criarMockExecutores({ reagendarBooking });
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "calcom_remarcar", config: { bookingId: "42" } },
      ];

      const resultado = await executarCenario(passos, {}, exec);

      expect(resultado.sucesso).toBe(false);
      expect(reagendarBooking).not.toHaveBeenCalled();
    });
  });

  describe("transferir", () => {
    it("marca transferir e para o fluxo", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "transferir", config: {} },
        { id: 2, ordem: 2, tipo: "ia_responder", config: {} }, // não deve executar
      ];

      const resultado = await executarCenario(passos, {}, exec);

      expect(resultado.sucesso).toBe(true);
      expect(resultado.contexto.transferir).toBe(true);
      expect(resultado.passosExecutados).toBe(1);
      expect(resultado.respostas[0]).toContain("transferir");
    });
  });

  describe("whatsapp_enviar", () => {
    it("substitui variáveis no template", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "whatsapp_enviar", config: { template: "Olá {nome}, sua consulta será às {horario}." } },
      ];

      const resultado = await executarCenario(
        passos,
        { nomeCliente: "Maria", horarioEscolhido: "15/04 às 10h" },
        exec,
      );

      expect(resultado.sucesso).toBe(true);
      expect(resultado.respostas[0]).toBe("Olá Maria, sua consulta será às 15/04 às 10h.");
    });
  });

  describe("condicional", () => {
    it("continua quando condição é atendida", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "condicional", config: { campo: "intencao", valor: "agendar" } },
        { id: 2, ordem: 2, tipo: "calcom_horarios", config: {} },
      ];

      const resultado = await executarCenario(passos, { intencao: "agendar" }, exec);

      expect(resultado.passosExecutados).toBe(2);
      expect(resultado.contexto.horariosDisponiveis).toBeDefined();
    });
  });

  describe("esperar", () => {
    it("para o fluxo com delay", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "esperar", config: { delayMinutos: 30 } },
        { id: 2, ordem: 2, tipo: "ia_responder", config: {} },
      ];

      const resultado = await executarCenario(passos, {}, exec);

      expect(resultado.sucesso).toBe(true);
      expect(resultado.passosExecutados).toBe(1);
      expect(resultado.contexto.esperando).toBe(true);
      expect(resultado.contexto.delayMinutos).toBe(30);
    });
  });

  describe("branching multi-saída (condicional com proximoSe)", () => {
    it("segue o ramo da primeira condição que bate", async () => {
      // intencao=agendar → ramo A (resposta1)
      // intencao=duvida → ramo B (resposta2)
      // else → fallback (resposta3)
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        {
          id: 1,
          ordem: 1,
          tipo: "condicional",
          clienteId: "cond-node",
          proximoSe: {
            cond_a: "ramo-a",
            cond_b: "ramo-b",
            fallback: "ramo-c",
          },
          config: {
            condicoes: [
              { id: "a", campo: "intencao", operador: "igual", valor: "agendar" },
              { id: "b", campo: "intencao", operador: "igual", valor: "duvida" },
            ],
          },
        },
        {
          id: 2, ordem: 2, tipo: "whatsapp_enviar", clienteId: "ramo-a",
          config: { template: "caminho-A" },
        },
        {
          id: 3, ordem: 3, tipo: "whatsapp_enviar", clienteId: "ramo-b",
          config: { template: "caminho-B" },
        },
        {
          id: 4, ordem: 4, tipo: "whatsapp_enviar", clienteId: "ramo-c",
          config: { template: "caminho-C" },
        },
      ];

      const rA = await executarCenario(passos, { intencao: "agendar" }, exec);
      expect(rA.respostas.join("|")).toBe("caminho-A");

      const rB = await executarCenario(passos, { intencao: "duvida" }, exec);
      expect(rB.respostas.join("|")).toBe("caminho-B");

      const rC = await executarCenario(passos, { intencao: "xxx" }, exec);
      expect(rC.respostas.join("|")).toBe("caminho-C");
    });

    it("ramo sem target termina o fluxo sem erro", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        {
          id: 1, ordem: 1, tipo: "condicional", clienteId: "c1",
          proximoSe: { cond_a: "alvo-inexistente" },
          config: {
            condicoes: [{ id: "a", campo: "x", operador: "igual", valor: "y" }],
          },
        },
        { id: 2, ordem: 2, tipo: "whatsapp_enviar", clienteId: "outro", config: { template: "NAO-DEVE" } },
      ];

      const r = await executarCenario(passos, { x: "y" }, exec);
      expect(r.sucesso).toBe(true);
      // O ramo `cond_a` aponta pra alvo inexistente — walker encerra.
      expect(r.respostas).toHaveLength(0);
    });

    it("condicional aninhada: ramo leva a outra condicional", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        {
          id: 1, ordem: 1, tipo: "condicional", clienteId: "c1",
          proximoSe: { cond_pagou: "c2", fallback: "fim-sem-pagar" },
          config: {
            condicoes: [{ id: "pagou", campo: "pago", operador: "verdadeiro" }],
          },
        },
        {
          id: 2, ordem: 2, tipo: "condicional", clienteId: "c2",
          proximoSe: { cond_vip: "vip", fallback: "comum" },
          config: {
            condicoes: [{ id: "vip", campo: "valorTotalCliente", operador: "maior", valor: "100000" }],
          },
        },
        { id: 3, ordem: 3, tipo: "whatsapp_enviar", clienteId: "vip", config: { template: "VIP" } },
        { id: 4, ordem: 4, tipo: "whatsapp_enviar", clienteId: "comum", config: { template: "COMUM" } },
        { id: 5, ordem: 5, tipo: "whatsapp_enviar", clienteId: "fim-sem-pagar", config: { template: "NAO-PAGOU" } },
      ];

      const rVip = await executarCenario(passos, { pago: true, valorTotalCliente: 200000 }, exec);
      expect(rVip.respostas.join("|")).toBe("VIP");

      const rComum = await executarCenario(passos, { pago: true, valorTotalCliente: 50000 }, exec);
      expect(rComum.respostas.join("|")).toBe("COMUM");

      const rSemPagar = await executarCenario(passos, { pago: false }, exec);
      expect(rSemPagar.respostas.join("|")).toBe("NAO-PAGOU");
    });

    it("operador 'maior' com números", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        {
          id: 1, ordem: 1, tipo: "condicional", clienteId: "c1",
          proximoSe: { cond_a: "alto", fallback: "baixo" },
          config: {
            condicoes: [{ id: "a", campo: "valor", operador: "maior", valor: "1000" }],
          },
        },
        { id: 2, ordem: 2, tipo: "whatsapp_enviar", clienteId: "alto", config: { template: "ACIMA" } },
        { id: 3, ordem: 3, tipo: "whatsapp_enviar", clienteId: "baixo", config: { template: "ABAIXO" } },
      ];

      const r1 = await executarCenario(passos, { valor: 2000 }, exec);
      expect(r1.respostas.join("|")).toBe("ACIMA");

      const r2 = await executarCenario(passos, { valor: 500 }, exec);
      expect(r2.respostas.join("|")).toBe("ABAIXO");
    });

    it("operador 'entre' inclusivo", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        {
          id: 1, ordem: 1, tipo: "condicional", clienteId: "c1",
          proximoSe: { cond_r: "dentro", fallback: "fora" },
          config: {
            condicoes: [{ id: "r", campo: "idade", operador: "entre", valor: "18", valor2: "65" }],
          },
        },
        { id: 2, ordem: 2, tipo: "whatsapp_enviar", clienteId: "dentro", config: { template: "ADULTO" } },
        { id: 3, ordem: 3, tipo: "whatsapp_enviar", clienteId: "fora", config: { template: "FORA" } },
      ];

      expect((await executarCenario(passos, { idade: 30 }, exec)).respostas.join("|")).toBe("ADULTO");
      expect((await executarCenario(passos, { idade: 18 }, exec)).respostas.join("|")).toBe("ADULTO");
      expect((await executarCenario(passos, { idade: 65 }, exec)).respostas.join("|")).toBe("ADULTO");
      expect((await executarCenario(passos, { idade: 17 }, exec)).respostas.join("|")).toBe("FORA");
    });

    it("operador 'contem' case-insensitive", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        {
          id: 1, ordem: 1, tipo: "condicional", clienteId: "c1",
          proximoSe: { cond_c: "achou", fallback: "nao" },
          config: {
            condicoes: [{ id: "c", campo: "mensagem", operador: "contem", valor: "URGENTE" }],
          },
        },
        { id: 2, ordem: 2, tipo: "whatsapp_enviar", clienteId: "achou", config: { template: "ACHOU" } },
        { id: 3, ordem: 3, tipo: "whatsapp_enviar", clienteId: "nao", config: { template: "NAO" } },
      ];

      const r = await executarCenario(passos, { mensagem: "isso aqui é urgente!!" }, exec);
      expect(r.respostas.join("|")).toBe("ACHOU");
    });

    it("guarda contra loop infinito", async () => {
      // Passo aponta pra si mesmo via "default"
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        {
          id: 1, ordem: 1, tipo: "whatsapp_enviar", clienteId: "loop",
          proximoSe: { default: "loop" },
          config: { template: "x" },
        },
      ];

      const r = await executarCenario(passos, {}, exec);
      expect(r.sucesso).toBe(false);
      expect(r.erro).toContain("Limite");
    });

    it("backward compat: cenário sem proximoSe executa linear", async () => {
      // Mesmo cenário com 3 passos sem clienteId nem proximoSe — funciona como antes.
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "whatsapp_enviar", config: { template: "A" } },
        { id: 2, ordem: 2, tipo: "whatsapp_enviar", config: { template: "B" } },
        { id: 3, ordem: 3, tipo: "whatsapp_enviar", config: { template: "C" } },
      ];

      const r = await executarCenario(passos, {}, exec);
      expect(r.sucesso).toBe(true);
      expect(r.respostas).toEqual(["A", "B", "C"]);
      expect(r.passosExecutados).toBe(3);
    });
  });

  describe("fluxo completo: atendimento + agendamento", () => {
    it("classifica → oferece horários → agenda", async () => {
      const exec = criarMockExecutores({
        chamarIA: vi.fn()
          .mockResolvedValueOnce("agendar") // classificação
          .mockResolvedValueOnce("Claro! Vou verificar nossos horários."), // resposta
      });

      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "ia_classificar", config: { categorias: ["agendar", "duvida", "emergencia"] } },
        { id: 2, ordem: 2, tipo: "ia_responder", config: { prompt: "O cliente quer agendar" } },
        { id: 3, ordem: 3, tipo: "calcom_horarios", config: { duracao: 30 } },
      ];

      const resultado = await executarCenario(
        passos,
        { mensagem: "Quero marcar uma consulta com o advogado" },
        exec,
      );

      expect(resultado.sucesso).toBe(true);
      expect(resultado.passosExecutados).toBe(3);
      expect(resultado.contexto.intencao).toBe("agendar");
      expect(resultado.contexto.respostaIA).toContain("horários");
      expect(resultado.contexto.horariosDisponiveis).toHaveLength(3);
      expect(resultado.respostas).toHaveLength(2); // resposta IA + horários
    });
  });

  describe("kanban_criar_card", () => {
    it("cria card no kanban com sucesso", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "kanban_criar_card", config: { prioridade: "alta" } },
      ];

      const resultado = await executarCenario(
        passos,
        { pagamentoDescricao: "Honorários Janeiro", pagamentoValor: 150000, nomeCliente: "João" },
        exec,
      );

      expect(resultado.sucesso).toBe(true);
      expect(resultado.contexto.kanbanCardId).toBe(42);
      expect(exec.criarCardKanban).toHaveBeenCalledTimes(1);
    });
  });

  describe("condicional avançada (operadores)", () => {
    it("nao_existe: para quando campo tem valor", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "condicional", config: { campo: "assinaturaId", operador: "nao_existe" } },
        { id: 2, ordem: 2, tipo: "kanban_criar_card", config: {} },
      ];

      // assinaturaId preenchido = É assinatura → condicional "nao_existe" falha → para
      const resultado = await executarCenario(passos, { assinaturaId: "sub_123" }, exec);
      expect(resultado.passosExecutados).toBe(1); // parou na condicional
      expect(exec.criarCardKanban).not.toHaveBeenCalled();
    });

    it("nao_existe: continua quando campo está vazio", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "condicional", config: { campo: "assinaturaId", operador: "nao_existe" } },
        { id: 2, ordem: 2, tipo: "kanban_criar_card", config: {} },
      ];

      // assinaturaId vazio = NÃO é assinatura → condicional passa
      const resultado = await executarCenario(passos, { assinaturaId: "" }, exec);
      expect(resultado.passosExecutados).toBe(2);
      expect(exec.criarCardKanban).toHaveBeenCalledTimes(1);
    });

    it("verdadeiro: continua quando campo é true", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "condicional", config: { campo: "primeiraCobranca", operador: "verdadeiro" } },
        { id: 2, ordem: 2, tipo: "kanban_criar_card", config: {} },
      ];

      const resultado = await executarCenario(passos, { primeiraCobranca: true }, exec);
      expect(resultado.passosExecutados).toBe(2);
    });

    it("verdadeiro: para quando campo é false", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "condicional", config: { campo: "primeiraCobranca", operador: "verdadeiro" } },
        { id: 2, ordem: 2, tipo: "kanban_criar_card", config: {} },
      ];

      const resultado = await executarCenario(passos, { primeiraCobranca: false }, exec);
      expect(resultado.passosExecutados).toBe(1); // parou
    });
  });

  describe("fluxo completo: pagamento → kanban", () => {
    it("primeira cobrança sem assinatura → cria card", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "condicional", config: { campo: "assinaturaId", operador: "nao_existe" } },
        { id: 2, ordem: 2, tipo: "condicional", config: { campo: "primeiraCobranca", operador: "verdadeiro" } },
        { id: 3, ordem: 3, tipo: "kanban_criar_card", config: { prioridade: "media" } },
      ];

      const resultado = await executarCenario(passos, {
        assinaturaId: "", primeiraCobranca: true,
        pagamentoDescricao: "Honorários", pagamentoValor: 200000,
      }, exec);

      expect(resultado.sucesso).toBe(true);
      expect(resultado.passosExecutados).toBe(3);
      expect(resultado.contexto.kanbanCardId).toBe(42);
    });

    it("assinatura → NÃO cria card (para no passo 1)", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "condicional", config: { campo: "assinaturaId", operador: "nao_existe" } },
        { id: 2, ordem: 2, tipo: "condicional", config: { campo: "primeiraCobranca", operador: "verdadeiro" } },
        { id: 3, ordem: 3, tipo: "kanban_criar_card", config: {} },
      ];

      const resultado = await executarCenario(passos, {
        assinaturaId: "sub_abc", primeiraCobranca: true,
      }, exec);

      expect(resultado.passosExecutados).toBe(1);
      expect(exec.criarCardKanban).not.toHaveBeenCalled();
    });

    it("segunda cobrança → NÃO cria card (para no passo 2)", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "condicional", config: { campo: "assinaturaId", operador: "nao_existe" } },
        { id: 2, ordem: 2, tipo: "condicional", config: { campo: "primeiraCobranca", operador: "verdadeiro" } },
        { id: 3, ordem: 3, tipo: "kanban_criar_card", config: {} },
      ];

      const resultado = await executarCenario(passos, {
        assinaturaId: "", primeiraCobranca: false, // já tem card
      }, exec);

      expect(resultado.passosExecutados).toBe(2);
      expect(exec.criarCardKanban).not.toHaveBeenCalled();
    });
  });

  describe("tratamento de erros", () => {
    it("para no primeiro erro e reporta", async () => {
      const exec = criarMockExecutores({
        chamarIA: vi.fn().mockRejectedValue(new Error("API timeout")),
      });

      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "ia_classificar", config: {} },
        { id: 2, ordem: 2, tipo: "ia_responder", config: {} },
      ];

      const resultado = await executarCenario(passos, { mensagem: "teste" }, exec);

      expect(resultado.sucesso).toBe(false);
      expect(resultado.passosExecutados).toBe(1);
      expect(resultado.erro).toContain("API timeout");
    });

    it("rejeita tipo de passo desconhecido", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "tipo_invalido", config: {} },
      ];

      const resultado = await executarCenario(passos, {}, exec);

      expect(resultado.sucesso).toBe(false);
      expect(resultado.erro).toContain("desconhecido");
    });

    it("executa passos na ordem correta (ignora id)", async () => {
      const exec = criarMockExecutores({
        chamarIA: vi.fn()
          .mockResolvedValueOnce("primeiro")
          .mockResolvedValueOnce("segundo"),
      });

      const passos: Passo[] = [
        { id: 99, ordem: 2, tipo: "ia_responder", config: {} },
        { id: 1, ordem: 1, tipo: "ia_classificar", config: { categorias: ["primeiro"] } },
      ];

      const resultado = await executarCenario(passos, { mensagem: "teste" }, exec);

      expect(resultado.sucesso).toBe(true);
      expect(resultado.passosExecutados).toBe(2);
      // classificar (ordem 1) roda antes de responder (ordem 2)
      expect(resultado.contexto.intencao).toBeDefined();
    });
  });

  describe("pausa e retomada (esperar)", () => {
    it("passo esperar marca contexto com flags de retomada e não executa passos seguintes", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "ia_responder", config: {} },
        { id: 2, ordem: 2, tipo: "esperar", config: { delayMinutos: 15 } },
        { id: 3, ordem: 3, tipo: "whatsapp_enviar", config: { template: "olá {nome}" } },
      ];

      const resultado = await executarCenario(passos, { mensagem: "oi" }, exec);

      expect(resultado.sucesso).toBe(true);
      expect(resultado.passosExecutados).toBe(2); // parou no esperar
      expect(resultado.contexto.esperando).toBe(true);
      expect(resultado.contexto.delayMinutos).toBe(15);
    });

    it("retomada com passos restantes executa a partir do próximo sem re-rodar anteriores", async () => {
      // Simula o caminho do scheduler: carrega os passos restantes e roda
      // o engine com o contexto que veio do banco (sem flags de espera).
      const exec = criarMockExecutores();
      const todosPassos: Passo[] = [
        { id: 1, ordem: 1, tipo: "ia_responder", config: {} },
        { id: 2, ordem: 2, tipo: "esperar", config: { delayMinutos: 15 } },
        { id: 3, ordem: 3, tipo: "whatsapp_enviar", config: { template: "oi {nome}" } },
      ];
      const passoAtual = 2; // dois passos já rodaram
      const restantes = todosPassos.slice().sort((a, b) => a.ordem - b.ordem).slice(passoAtual);
      expect(restantes).toHaveLength(1);

      const contextoSalvo = { mensagem: "oi", respostaIA: "ok", nomeCliente: "Maria" };

      const resultado = await executarCenario(restantes, contextoSalvo, exec);

      expect(resultado.sucesso).toBe(true);
      expect(resultado.passosExecutados).toBe(1);
      expect(resultado.respostas[0]).toContain("Maria");
    });

    it("esperar sem delayMinutos configurado usa default 5", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "esperar", config: {} },
      ];
      const resultado = await executarCenario(passos, {}, exec);
      expect(resultado.contexto.delayMinutos).toBe(5);
      expect(resultado.contexto.esperando).toBe(true);
    });
  });
});
