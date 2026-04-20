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
    buscarHorarios: vi.fn().mockResolvedValue(["2026-04-15 10:00", "2026-04-15 14:00", "2026-04-16 09:00"]),
    criarAgendamento: vi.fn().mockResolvedValue("booking_123"),
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
