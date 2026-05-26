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
  interpretarSaidaAtendente,
  orquestrarAtendente,
  gerarSlotsLivres,
  formatarISOComOffset,
  SmartflowContexto,
  SmartflowExecutores,
  Passo,
} from "../smartflow/engine";
import { TIPO_PASSO_META } from "../../shared/smartflow-types";

// ─── Mock executores ────────────────────────────────────────────────────────

function criarMockExecutores(overrides?: Partial<SmartflowExecutores>): SmartflowExecutores {
  return {
    chamarIA: vi.fn().mockResolvedValue("duvida"),
    extrairCamposIA: vi.fn().mockResolvedValue({}),
    buscarContatoCrm: vi.fn().mockResolvedValue(null),
    listarAcoesCliente: vi.fn().mockResolvedValue([]),
    buscarMovimentacoesProcesso: vi.fn().mockResolvedValue([]),
    executarAgente: vi.fn().mockResolvedValue("resposta-do-agente"),
    extrairCamposDoAgente: vi.fn().mockResolvedValue({}),
    conversarComAgente: vi.fn().mockResolvedValue({ resposta: "ok", acao: null }),
    resolverResponsavelAgenda: vi.fn().mockResolvedValue(null),
    buscarHorarios: vi.fn().mockResolvedValue(["2026-04-15 10:00", "2026-04-15 14:00", "2026-04-16 09:00"]),
    criarAgendamento: vi.fn().mockResolvedValue("booking_123"),
    criarAgendamentoInterno: vi.fn().mockResolvedValue(555),
    verificarDisponibilidadeAgenda: vi.fn().mockResolvedValue({ disponivel: true, conflitos: 0 }),
    listarAgendaResponsavel: vi.fn().mockResolvedValue([]),
    atualizarTagsContato: vi.fn().mockResolvedValue([]),
    editarAgendamentoInterno: vi.fn().mockResolvedValue(undefined),
    listarBookings: vi.fn().mockResolvedValue([]),
    cancelarBooking: vi.fn().mockResolvedValue(true),
    reagendarBooking: vi.fn().mockResolvedValue(true),
    enviarWhatsApp: vi.fn().mockResolvedValue(true),
    chamarWebhook: vi.fn().mockResolvedValue({ ok: true }),
    criarCardKanban: vi.fn().mockResolvedValue(42),
    moverCardKanban: vi.fn().mockResolvedValue(true),
    atribuirResponsavelKanban: vi.fn().mockResolvedValue(true),
    atualizarTagsCardKanban: vi.fn().mockResolvedValue(true),
    gerarCobrancaAsaas: vi.fn().mockResolvedValue({
      pagamentoId: "pay_abc123",
      link: "https://asaas.com/i/pay_abc123",
    }),
    cancelarCobrancaAsaas: vi.fn().mockResolvedValue(true),
    consultarValorAbertoAsaas: vi.fn().mockResolvedValue({
      total: 5000,
      pendente: 1500,
      vencido: 500,
      qtdAberto: 2,
    }),
    marcarCobrancaRecebidaAsaas: vi.fn().mockResolvedValue(true),
    definirCampoPersonalizadoCliente: vi.fn().mockResolvedValue(true),
    buscarCobrancasAbertas: vi.fn().mockResolvedValue(""),
    ...overrides,
  };
}

// ─── Testes ─────────────────────────────────────────────────────────────────

describe("SmartFlow Engine", () => {
  describe("sincronização catálogo ↔ engine", () => {
    // Regressão: o editor oferece todo tipo de TIPO_PASSO_META; se algum não
    // tiver tratamento no engine, executar dá "Tipo de passo desconhecido".
    // (Foi o que aconteceu com asaas_consultar_valor_aberto no enum do router.)
    it("todo tipo do catálogo tem tratamento no engine (sem 'tipo desconhecido')", async () => {
      const exec = criarMockExecutores();
      for (const meta of TIPO_PASSO_META) {
        // `para_cada_item` precisa de proximoSe.corpo — testamos só que não é
        // rejeitado como tipo desconhecido (ele falha por outra razão, ok).
        const passos: Passo[] = [
          { id: 1, ordem: 1, tipo: meta.id, config: {}, clienteId: "n1" },
        ];
        const r = await executarCenario(passos, { mensagem: "oi", contatoId: 1 }, exec);
        expect(
          r.erro ?? "",
          `tipo "${meta.id}" deveria ter tratamento no engine`,
        ).not.toContain("Tipo de passo desconhecido");
      }
    });
  });

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

    it("com agente, extrai campos e salva no contexto (cliente.campos)", async () => {
      const executarAgente = vi.fn().mockResolvedValue("Claro!");
      const extrairCamposDoAgente = vi.fn().mockResolvedValue({ cpf: "123", data_agendamento: "2026-06-01" });
      const exec = criarMockExecutores({ executarAgente, extrairCamposDoAgente });
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "ia_responder", config: { agenteId: 7 } },
      ];
      const r = await executarCenario(passos, { mensagem: "meu cpf é 123", contatoId: 5, conversaId: 9 }, exec);
      expect(r.sucesso).toBe(true);
      expect(extrairCamposDoAgente).toHaveBeenCalledWith(7, 5, 9);
      expect((r.contexto.cliente as any).campos).toMatchObject({ cpf: "123", data_agendamento: "2026-06-01" });
    });

    it("não extrai campos quando NÃO há agente (prompt livre)", async () => {
      const extrairCamposDoAgente = vi.fn().mockResolvedValue({ cpf: "x" });
      const exec = criarMockExecutores({ chamarIA: vi.fn().mockResolvedValue("oi"), extrairCamposDoAgente });
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "ia_responder", config: { prompt: "seja gentil" } },
      ];
      await executarCenario(passos, { mensagem: "oi", contatoId: 5, conversaId: 9 }, exec);
      expect(extrairCamposDoAgente).not.toHaveBeenCalled();
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
      // 3º arg = contatoId, 4º = conversaId (ambos undefined: o ctx do teste
      // não tem contato/conversa). Os executores reais usam contatoId pra
      // injetar contexto do cliente e conversaId pra carregar o histórico
      // (memória da IA).
      expect(executarAgente).toHaveBeenCalledWith(42, "oi", undefined, undefined);
      expect(chamarIA).not.toHaveBeenCalled();
      expect(resultado.contexto.respostaIA).toBe("resposta do agente 42");
      expect(resultado.respostas[0]).toBe("resposta do agente 42");
    });

    it("passa contatoId pro executarAgente quando presente no contexto", async () => {
      const executarAgente = vi.fn().mockResolvedValue("resposta com contexto");
      const exec = criarMockExecutores({ executarAgente });
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "ia_responder", config: { agenteId: 42 } },
      ];

      await executarCenario(passos, { mensagem: "oi", contatoId: 777 }, exec);

      expect(executarAgente).toHaveBeenCalledWith(42, "oi", 777, undefined);
    });

    it("passa conversaId pro executarAgente (memória da IA)", async () => {
      const executarAgente = vi.fn().mockResolvedValue("resposta com memória");
      const chamarIA = vi.fn().mockResolvedValue("nunca");
      const exec = criarMockExecutores({ executarAgente, chamarIA });
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "ia_responder", config: { agenteId: 42 } },
      ];

      await executarCenario(passos, { mensagem: "oi", contatoId: 777, conversaId: 555 }, exec);

      expect(executarAgente).toHaveBeenCalledWith(42, "oi", 777, 555);
    });

    it("passa conversaId pro chamarIA no fallback sem agente", async () => {
      const chamarIA = vi.fn().mockResolvedValue("resposta fallback");
      const exec = criarMockExecutores({ chamarIA });
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "ia_responder", config: {} },
      ];

      await executarCenario(passos, { mensagem: "oi", contatoId: 777, conversaId: 555 }, exec);

      // chamarIA(prompt, mensagem, contatoId, conversaId)
      expect(chamarIA).toHaveBeenCalledWith(expect.any(String), "oi", 777, 555);
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

  describe("ia_consultar (consulta interna — NÃO envia ao cliente)", () => {
    it("salva a resposta no campo escolhido e NÃO manda pro cliente", async () => {
      const chamarIA = vi.fn().mockResolvedValue("Sugiro terça 14h, quarta 10h e quinta 16h.");
      const exec = criarMockExecutores({ chamarIA });
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "ia_consultar", config: { prompt: "Escolha 3 horários de {{horariosLivres}}", salvarEm: "sugestao" } },
      ];

      const r = await executarCenario(passos, { mensagem: "oi", horariosLivres: "09:00, 10:00, 14:00" }, exec);

      expect(r.sucesso).toBe(true);
      expect(r.contexto.sugestao).toBe("Sugiro terça 14h, quarta 10h e quinta 16h.");
      expect(r.respostas).toHaveLength(0); // nada enviado ao cliente
      // a pergunta foi interpolada antes de ir pra IA
      expect(chamarIA).toHaveBeenCalledWith(expect.any(String), expect.stringContaining("09:00, 10:00, 14:00"), undefined, undefined);
    });

    it("usa o agente quando agenteId está presente", async () => {
      const chamarIA = vi.fn().mockResolvedValue("nao-deve-chamar");
      const executarAgente = vi.fn().mockResolvedValue("resposta do agente");
      const exec = criarMockExecutores({ chamarIA, executarAgente });
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "ia_consultar", config: { prompt: "analise", agenteId: 7, salvarEm: "analise" } },
      ];
      const r = await executarCenario(passos, { mensagem: "x" }, exec);
      expect(r.sucesso).toBe(true);
      expect(executarAgente).toHaveBeenCalled();
      expect(chamarIA).not.toHaveBeenCalled();
      expect(r.contexto.analise).toBe("resposta do agente");
      expect(r.respostas).toHaveLength(0);
    });

    it("com agente, também extrai campos e salva no contexto", async () => {
      const executarAgente = vi.fn().mockResolvedValue("ok");
      const extrairCamposDoAgente = vi.fn().mockResolvedValue({ agendar_atendimento: "SIM" });
      const exec = criarMockExecutores({ executarAgente, extrairCamposDoAgente });
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "ia_consultar", config: { prompt: "p", agenteId: 7, salvarEm: "r" } },
      ];
      const r = await executarCenario(passos, { mensagem: "sim", contatoId: 5, conversaId: 9 }, exec);
      expect(extrairCamposDoAgente).toHaveBeenCalledWith(7, 5, 9);
      expect((r.contexto.cliente as any).campos).toMatchObject({ agendar_atendimento: "SIM" });
    });

    it("falha se 'Salvar em' não foi configurado", async () => {
      const exec = criarMockExecutores({ chamarIA: vi.fn().mockResolvedValue("x") });
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "ia_consultar", config: { prompt: "algo" } },
      ];
      const r = await executarCenario(passos, { mensagem: "x" }, exec);
      expect(r.sucesso).toBe(false);
      expect(r.erro).toContain("Salvar em");
    });

    it("falha se não houver prompt nem agente", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "ia_consultar", config: { salvarEm: "x" } },
      ];
      const r = await executarCenario(passos, { mensagem: "x" }, exec);
      expect(r.sucesso).toBe(false);
      expect(r.erro).toContain("pergunta");
    });
  });

  describe("ia_extrair_campos", () => {
    it("salva campos extraídos em ctx.extracao", async () => {
      const extrairCamposIA = vi.fn().mockResolvedValue({
        cpf: "123.456.789-00",
        email: "joao@example.com",
      });
      const exec = criarMockExecutores({ extrairCamposIA });
      const passos: Passo[] = [
        {
          id: 1,
          ordem: 1,
          tipo: "ia_extrair_campos",
          config: {
            campos: [
              { chave: "cpf", tipo: "cpf" },
              { chave: "email", tipo: "email" },
            ],
          },
        },
      ];

      const resultado = await executarCenario(
        passos,
        { mensagem: "meu CPF é 123.456.789-00 e email joao@example.com" },
        exec,
      );

      expect(resultado.sucesso).toBe(true);
      expect(resultado.contexto.extracao).toEqual({
        cpf: "123.456.789-00",
        email: "joao@example.com",
      });
      // chamou o extrator com os campos certos
      expect(extrairCamposIA).toHaveBeenCalledWith(
        expect.objectContaining({
          mensagem: "meu CPF é 123.456.789-00 e email joao@example.com",
          campos: [
            expect.objectContaining({ chave: "cpf", tipo: "cpf" }),
            expect.objectContaining({ chave: "email", tipo: "email" }),
          ],
        }),
      );
    });

    it("passa conversaId pro extrator (extrai da conversa toda, não só da última msg)", async () => {
      const extrairCamposIA = vi.fn().mockResolvedValue({ nome: "Ana" });
      const exec = criarMockExecutores({ extrairCamposIA });
      const passos: Passo[] = [
        {
          id: 1,
          ordem: 1,
          tipo: "ia_extrair_campos",
          config: { campos: [{ chave: "nome", tipo: "texto" }] },
        },
      ];

      await executarCenario(passos, { mensagem: "é Ana", contatoId: 7, conversaId: 99 }, exec);

      expect(extrairCamposIA).toHaveBeenCalledWith(
        expect.objectContaining({ conversaId: 99, contatoId: 7 }),
      );
    });

    it("registra aviso visível quando o campo não salva (não engole o erro)", async () => {
      const extrairCamposIA = vi.fn().mockResolvedValue({ nome: "Ana" });
      const definirCampoPersonalizadoCliente = vi
        .fn()
        .mockRejectedValue(new Error('Campo personalizado "nome" não existe no catálogo do escritório'));
      const exec = criarMockExecutores({ extrairCamposIA, definirCampoPersonalizadoCliente });
      const passos: Passo[] = [
        {
          id: 1,
          ordem: 1,
          tipo: "ia_extrair_campos",
          config: { campos: [{ chave: "nome", tipo: "texto", persistir: true }] },
        },
      ];

      const resultado = await executarCenario(passos, { mensagem: "é Ana", contatoId: 7 }, exec);

      // O passo não falha (a extração funcionou), mas o motivo fica visível.
      expect(resultado.sucesso).toBe(true);
      const avisos = (resultado.contexto as any).captacaoAvisos as string[];
      expect(Array.isArray(avisos)).toBe(true);
      expect(avisos[0]).toContain("nome");
      expect(avisos[0]).toContain("catálogo");
    });

    it("falha graciosamente sem campos configurados", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "ia_extrair_campos", config: { campos: [] } },
      ];

      const resultado = await executarCenario(passos, { mensagem: "oi" }, exec);

      expect(resultado.sucesso).toBe(false);
      expect(resultado.erro).toContain("pelo menos 1 campo");
    });

    it("falha quando a mensagem-fonte está vazia", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        {
          id: 1,
          ordem: 1,
          tipo: "ia_extrair_campos",
          config: { campos: [{ chave: "cpf", tipo: "cpf" }] },
        },
      ];

      // sem `mensagem` no contexto
      const resultado = await executarCenario(passos, {}, exec);

      expect(resultado.sucesso).toBe(false);
      expect(resultado.erro).toContain("vazia");
    });

    it("usa fonteMensagem customizada (ex: respostaUsuario)", async () => {
      const extrairCamposIA = vi.fn().mockResolvedValue({ cpf: "999" });
      const exec = criarMockExecutores({ extrairCamposIA });
      const passos: Passo[] = [
        {
          id: 1,
          ordem: 1,
          tipo: "ia_extrair_campos",
          config: {
            fonteMensagem: "respostaUsuario",
            campos: [{ chave: "cpf", tipo: "cpf" }],
          },
        },
      ];

      const resultado = await executarCenario(
        passos,
        { respostaUsuario: "999", mensagem: "outra coisa" },
        exec,
      );

      expect(resultado.sucesso).toBe(true);
      expect(extrairCamposIA).toHaveBeenCalledWith(
        expect.objectContaining({ mensagem: "999" }),
      );
    });

    it("persiste campos com persistir=true quando há contatoId", async () => {
      const extrairCamposIA = vi.fn().mockResolvedValue({
        cpf: "123",
        nomeFantasia: "Joaquim",
      });
      const definirCampoPersonalizadoCliente = vi.fn().mockResolvedValue(true);
      const exec = criarMockExecutores({ extrairCamposIA, definirCampoPersonalizadoCliente });
      const passos: Passo[] = [
        {
          id: 1,
          ordem: 1,
          tipo: "ia_extrair_campos",
          config: {
            campos: [
              { chave: "cpf", tipo: "cpf", persistir: true },
              { chave: "nomeFantasia", tipo: "texto", persistir: false },
            ],
          },
        },
      ];

      const resultado = await executarCenario(
        passos,
        { mensagem: "...", contatoId: 42 },
        exec,
      );

      expect(resultado.sucesso).toBe(true);
      // Só cpf foi persistido (persistir=true); nomeFantasia não.
      expect(definirCampoPersonalizadoCliente).toHaveBeenCalledTimes(1);
      expect(definirCampoPersonalizadoCliente).toHaveBeenCalledWith({
        contatoId: 42,
        chave: "cpf",
        valor: "123",
      });
      // Espelha em cliente.campos
      const cliente = resultado.contexto.cliente as any;
      expect(cliente?.campos?.cpf).toBe("123");
    });

    it("não persiste quando não há contatoId no contexto (não falha, só pula)", async () => {
      const extrairCamposIA = vi.fn().mockResolvedValue({ cpf: "123" });
      const definirCampoPersonalizadoCliente = vi.fn().mockResolvedValue(true);
      const exec = criarMockExecutores({ extrairCamposIA, definirCampoPersonalizadoCliente });
      const passos: Passo[] = [
        {
          id: 1,
          ordem: 1,
          tipo: "ia_extrair_campos",
          config: { campos: [{ chave: "cpf", tipo: "cpf", persistir: true }] },
        },
      ];

      const resultado = await executarCenario(passos, { mensagem: "..." }, exec);

      expect(resultado.sucesso).toBe(true);
      expect(definirCampoPersonalizadoCliente).not.toHaveBeenCalled();
      // Mas ainda salva em ctx.extracao
      expect(resultado.contexto.extracao).toEqual({ cpf: "123" });
    });

    it("não derruba o passo quando persistência falha (catálogo não tem chave)", async () => {
      const extrairCamposIA = vi.fn().mockResolvedValue({ chaveDesconhecida: "valor" });
      const definirCampoPersonalizadoCliente = vi
        .fn()
        .mockRejectedValue(new Error("Campo personalizado \"chaveDesconhecida\" não existe"));
      const exec = criarMockExecutores({ extrairCamposIA, definirCampoPersonalizadoCliente });
      const passos: Passo[] = [
        {
          id: 1,
          ordem: 1,
          tipo: "ia_extrair_campos",
          config: { campos: [{ chave: "chaveDesconhecida", tipo: "texto", persistir: true }] },
        },
      ];

      const resultado = await executarCenario(
        passos,
        { mensagem: "...", contatoId: 42 },
        exec,
      );

      // Extração funcionou — persistência opcional, falha silenciosa.
      expect(resultado.sucesso).toBe(true);
      expect(resultado.contexto.extracao).toEqual({ chaveDesconhecida: "valor" });
    });

    it("mescla com extração anterior (não sobrescreve campos já no contexto)", async () => {
      const extrairCamposIA = vi.fn().mockResolvedValue({ email: "novo@ex.com" });
      const exec = criarMockExecutores({ extrairCamposIA });
      const passos: Passo[] = [
        {
          id: 1,
          ordem: 1,
          tipo: "ia_extrair_campos",
          config: { campos: [{ chave: "email", tipo: "email" }] },
        },
      ];

      const resultado = await executarCenario(
        passos,
        {
          mensagem: "...",
          extracao: { cpf: "123" },
        },
        exec,
      );

      expect(resultado.sucesso).toBe(true);
      // CPF anterior preservado + novo email adicionado
      expect(resultado.contexto.extracao).toEqual({
        cpf: "123",
        email: "novo@ex.com",
      });
    });
  });

  describe("crm_buscar_contato", () => {
    it("popula contexto quando encontra", async () => {
      const buscarContatoCrm = vi.fn().mockResolvedValue({
        contatoId: 99,
        nome: "Joana",
        telefone: "11999",
        email: "joana@ex.com",
        atendenteResponsavelId: 7,
        camposPersonalizados: { cpf: "111" },
      });
      const exec = criarMockExecutores({ buscarContatoCrm });
      const passos: Passo[] = [
        {
          id: 1,
          ordem: 1,
          tipo: "crm_buscar_contato",
          config: { tipoBusca: "cpfCnpj", valor: "{{extracao.cpf}}" },
        },
      ];

      const resultado = await executarCenario(
        passos,
        { extracao: { cpf: "111.222.333-44" } },
        exec,
      );

      expect(resultado.sucesso).toBe(true);
      expect(resultado.contexto.contatoEncontrado).toBe(true);
      expect(resultado.contexto.contatoId).toBe(99);
      expect(resultado.contexto.nomeCliente).toBe("Joana");
      // Interpolação foi feita antes da chamada
      expect(buscarContatoCrm).toHaveBeenCalledWith({
        tipoBusca: "cpfCnpj",
        valor: "111.222.333-44",
      });
      const cliente = resultado.contexto.cliente as any;
      expect(cliente?.campos?.cpf).toBe("111");
    });

    it("marca contatoEncontrado=false sem ramificar erro quando não acha", async () => {
      const buscarContatoCrm = vi.fn().mockResolvedValue(null);
      const exec = criarMockExecutores({ buscarContatoCrm });
      const passos: Passo[] = [
        {
          id: 1,
          ordem: 1,
          tipo: "crm_buscar_contato",
          config: { tipoBusca: "telefone", valor: "11999" },
        },
      ];

      const resultado = await executarCenario(passos, {}, exec);

      expect(resultado.sucesso).toBe(true);
      expect(resultado.contexto.contatoEncontrado).toBe(false);
      expect(resultado.contexto.contatoId).toBeUndefined();
    });

    it("falha quando valor a buscar é vazio (mesmo após interpolação)", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        {
          id: 1,
          ordem: 1,
          tipo: "crm_buscar_contato",
          // Variável inexistente no contexto → string vazia.
          config: { tipoBusca: "telefone", valor: "{{naoExisteNoCtx}}" },
        },
      ];

      const resultado = await executarCenario(passos, {}, exec);

      expect(resultado.sucesso).toBe(false);
      expect(resultado.erro).toContain("valor a buscar");
    });
  });

  describe("crm_listar_acoes_cliente", () => {
    it("popula contexto com acoes + acoesQuantidade", async () => {
      const listarAcoesCliente = vi.fn().mockResolvedValue([
        { id: 1, numeroCnj: "0000001-00.2024.8.05.0001", apelido: "Trabalhista", classe: "Reclamação", tipo: "litigioso", polo: "ativo", valorCausa: 50000, createdAt: new Date() },
        { id: 2, numeroCnj: null, apelido: "Contrato", classe: null, tipo: "extrajudicial", polo: "interessado", valorCausa: null, createdAt: new Date() },
      ]);
      const exec = criarMockExecutores({ listarAcoesCliente });
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "crm_listar_acoes_cliente", config: {} },
      ];

      const resultado = await executarCenario(passos, { contatoId: 42 }, exec);

      expect(resultado.sucesso).toBe(true);
      const acoes = resultado.contexto.acoes as any[];
      expect(acoes).toHaveLength(2);
      expect(resultado.contexto.acoesQuantidade).toBe(2);
      expect(listarAcoesCliente).toHaveBeenCalledWith(
        expect.objectContaining({ contatoId: 42, limite: 10 }),
      );
    });

    it("aplica filtros tipoFiltro e poloFiltro (omite quando 'todos')", async () => {
      const listarAcoesCliente = vi.fn().mockResolvedValue([]);
      const exec = criarMockExecutores({ listarAcoesCliente });
      const passos: Passo[] = [
        {
          id: 1,
          ordem: 1,
          tipo: "crm_listar_acoes_cliente",
          config: { tipoFiltro: "litigioso", poloFiltro: "todos", limite: 5 },
        },
      ];

      await executarCenario(passos, { contatoId: 42 }, exec);

      expect(listarAcoesCliente).toHaveBeenCalledWith({
        contatoId: 42,
        tipoFiltro: "litigioso",
        // poloFiltro 'todos' não é enviado
        poloFiltro: undefined,
        limite: 5,
      });
    });

    it("falha quando contatoId está ausente", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "crm_listar_acoes_cliente", config: {} },
      ];

      const resultado = await executarCenario(passos, {}, exec);

      expect(resultado.sucesso).toBe(false);
      expect(resultado.erro).toContain("contatoId");
    });
  });

  describe("processo_buscar_movimentacoes", () => {
    it("usa acaoId do contexto como default e retorna movimentações", async () => {
      const buscarMovimentacoesProcesso = vi.fn().mockResolvedValue([
        { id: 1, tipo: "sentenca", dataEvento: new Date("2026-04-01"), conteudo: "Procedente", fonte: "judit", cnjAfetado: "X" },
        { id: 2, tipo: "movimentacao", dataEvento: new Date("2026-03-15"), conteudo: "Conclusos", fonte: "judit", cnjAfetado: "X" },
      ]);
      const exec = criarMockExecutores({ buscarMovimentacoesProcesso });
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "processo_buscar_movimentacoes", config: {} },
      ];

      const resultado = await executarCenario(passos, { acaoId: 42 }, exec);

      expect(resultado.sucesso).toBe(true);
      const movs = resultado.contexto.movimentacoes as any[];
      expect(movs).toHaveLength(2);
      expect(resultado.contexto.movimentacoesQuantidade).toBe(2);
      const maisRecente = resultado.contexto.movimentacaoMaisRecente as any;
      expect(maisRecente.tipo).toBe("sentenca");
      // Default: 30 dias, sem filtro de tipo, limite 10
      expect(buscarMovimentacoesProcesso).toHaveBeenCalledWith(
        expect.objectContaining({
          processoRef: 42,
          diasJanela: 30,
          limite: 10,
          tipos: undefined,
        }),
      );
    });

    it("interpola processoId customizado", async () => {
      const buscarMovimentacoesProcesso = vi.fn().mockResolvedValue([]);
      const exec = criarMockExecutores({ buscarMovimentacoesProcesso });
      const passos: Passo[] = [
        {
          id: 1,
          ordem: 1,
          tipo: "processo_buscar_movimentacoes",
          config: { processoId: "{{acaoEscolhida.id}}" },
        },
      ];

      await executarCenario(
        passos,
        { acaoEscolhida: { id: 99 } },
        exec,
      );

      expect(buscarMovimentacoesProcesso).toHaveBeenCalledWith(
        expect.objectContaining({ processoRef: 99 }),
      );
    });

    it("aceita CNJ como string", async () => {
      const buscarMovimentacoesProcesso = vi.fn().mockResolvedValue([]);
      const exec = criarMockExecutores({ buscarMovimentacoesProcesso });
      const passos: Passo[] = [
        {
          id: 1,
          ordem: 1,
          tipo: "processo_buscar_movimentacoes",
          config: { processoId: "0000001-00.2024.8.05.0001" },
        },
      ];

      await executarCenario(passos, {}, exec);

      expect(buscarMovimentacoesProcesso).toHaveBeenCalledWith(
        expect.objectContaining({ processoRef: "0000001-00.2024.8.05.0001" }),
      );
    });

    it("falha quando não há processoId nem acaoId", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "processo_buscar_movimentacoes", config: {} },
      ];

      const resultado = await executarCenario(passos, {}, exec);

      expect(resultado.sucesso).toBe(false);
      expect(resultado.erro).toContain("processo a consultar");
    });

    it("movimentacaoMaisRecente é null quando lista vazia", async () => {
      const buscarMovimentacoesProcesso = vi.fn().mockResolvedValue([]);
      const exec = criarMockExecutores({ buscarMovimentacoesProcesso });
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "processo_buscar_movimentacoes", config: {} },
      ];

      const resultado = await executarCenario(passos, { acaoId: 1 }, exec);

      expect(resultado.sucesso).toBe(true);
      expect(resultado.contexto.movimentacaoMaisRecente).toBeNull();
      expect(resultado.contexto.movimentacoesQuantidade).toBe(0);
    });
  });

  describe("whatsapp_aguardar_resposta", () => {
    it("envia mensagem e pausa fluxo com flags de aguardando", async () => {
      const enviarWhatsApp = vi.fn().mockResolvedValue(true);
      const exec = criarMockExecutores({ enviarWhatsApp });
      const passos: Passo[] = [
        {
          id: 1,
          ordem: 1,
          tipo: "whatsapp_aguardar_resposta",
          config: {
            template: "Sobre qual ação?",
            timeoutMinutos: 60,
          },
        },
        // não deve executar
        { id: 2, ordem: 2, tipo: "ia_responder", config: {} },
      ];

      const resultado = await executarCenario(
        passos,
        { contatoId: 42, telefoneCliente: "11999" },
        exec,
      );

      expect(resultado.sucesso).toBe(true);
      expect(resultado.passosExecutados).toBe(1); // não passou pro ia_responder
      expect(resultado.contexto.aguardandoMensagem).toBe(true);
      expect(resultado.contexto.aguardandoContatoId).toBe(42);
      expect(resultado.contexto.aguardandoTimeoutMinutos).toBe(60);
      expect(enviarWhatsApp).toHaveBeenCalledWith("11999", "Sobre qual ação?");
    });

    it("anexa menu numerado quando há opções", async () => {
      const enviarWhatsApp = vi.fn().mockResolvedValue(true);
      const exec = criarMockExecutores({ enviarWhatsApp });
      const passos: Passo[] = [
        {
          id: 1,
          ordem: 1,
          tipo: "whatsapp_aguardar_resposta",
          config: {
            template: "Escolha:",
            opcoes: ["Agendar consulta", "Tirar dúvida", "Falar com humano"],
          },
        },
      ];

      const resultado = await executarCenario(
        passos,
        { contatoId: 42, telefoneCliente: "11999" },
        exec,
      );

      expect(resultado.sucesso).toBe(true);
      const enviadoTo = (enviarWhatsApp as any).mock.calls[0][1] as string;
      expect(enviadoTo).toContain("Escolha:");
      expect(enviadoTo).toContain("1. Agendar consulta");
      expect(enviadoTo).toContain("2. Tirar dúvida");
      expect(enviadoTo).toContain("3. Falar com humano");
      expect(resultado.contexto.aguardandoOpcoes).toEqual([
        "Agendar consulta",
        "Tirar dúvida",
        "Falar com humano",
      ]);
    });

    it("falha sem contatoId no contexto", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        {
          id: 1,
          ordem: 1,
          tipo: "whatsapp_aguardar_resposta",
          config: { template: "Oi", timeoutMinutos: 60 },
        },
      ];

      const resultado = await executarCenario(passos, {}, exec);

      expect(resultado.sucesso).toBe(false);
      expect(resultado.erro).toContain("contatoId");
    });

    it("não envia direto quando há canalId no contexto (delega ao handler)", async () => {
      const enviarWhatsApp = vi.fn().mockResolvedValue(true);
      const exec = criarMockExecutores({ enviarWhatsApp });
      const passos: Passo[] = [
        {
          id: 1,
          ordem: 1,
          tipo: "whatsapp_aguardar_resposta",
          config: { template: "Oi", timeoutMinutos: 60 },
        },
      ];

      const resultado = await executarCenario(
        passos,
        { contatoId: 42, telefoneCliente: "11999", canalId: 7 },
        exec,
      );

      expect(resultado.sucesso).toBe(true);
      // Quando há canal, executor não envia — a resposta vai pelo retorno
      // pro whatsapp-handler chamar do canal aberto.
      expect(enviarWhatsApp).not.toHaveBeenCalled();
      expect(resultado.respostas).toContain("Oi");
    });
  });

  describe("whatsapp_enviar — template (HSM)", () => {
    it("envia template pela Cloud API com componentes interpolados (não via texto, não duplica em respostas)", async () => {
      const enviarWhatsApp = vi.fn().mockResolvedValue(true);
      const enviarWhatsAppTemplate = vi.fn().mockResolvedValue(true);
      const exec = criarMockExecutores({ enviarWhatsApp, enviarWhatsAppTemplate });
      const passos: Passo[] = [
        {
          id: 1,
          ordem: 1,
          tipo: "whatsapp_enviar",
          clienteId: "n1",
          config: {
            modo: "template",
            templateNome: "lembrete_audiencia",
            templateIdioma: "pt_BR",
            templateHeader: { formato: "IMAGE", valor: "https://x/{{cliente.nome}}.png" },
            templateCorpo: ["{{cliente.nome}}", "amanhã 10h"],
            templateBotoes: [{ index: 0, tipo: "URL", valor: "ver-{{cliente.nome}}" }],
          },
        },
      ];

      const r = await executarCenario(
        passos,
        { telefoneCliente: "5585999990000", cliente: { nome: "Ana" } },
        exec,
      );

      expect(r.sucesso).toBe(true);
      expect(enviarWhatsApp).not.toHaveBeenCalled();
      expect(enviarWhatsAppTemplate).toHaveBeenCalledTimes(1);
      const [tel, tpl] = (enviarWhatsAppTemplate as any).mock.calls[0];
      expect(tel).toBe("5585999990000");
      expect(tpl.nome).toBe("lembrete_audiencia");
      expect(tpl.idioma).toBe("pt_BR");
      expect(tpl.componentes).toEqual([
        { type: "header", parameters: [{ type: "image", image: { link: "https://x/Ana.png" } }] },
        { type: "body", parameters: [{ type: "text", text: "Ana" }, { type: "text", text: "amanhã 10h" }] },
        { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "ver-Ana" }] },
      ]);
      // Template é enviado direto pela API — não volta como texto pro canal.
      expect(r.respostas).toEqual([]);
    });

    it("erro claro quando falta o telefone do contato", async () => {
      const enviarWhatsAppTemplate = vi.fn().mockResolvedValue(true);
      const exec = criarMockExecutores({ enviarWhatsAppTemplate });
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "whatsapp_enviar", clienteId: "n1", config: { modo: "template", templateNome: "x" } },
      ];
      const r = await executarCenario(passos, { canalId: 1 }, exec);
      expect(r.sucesso).toBe(false);
      expect(r.erro || "").toContain("telefone");
      expect(enviarWhatsAppTemplate).not.toHaveBeenCalled();
    });

    it("reporta falha quando o envio do template falha", async () => {
      const enviarWhatsAppTemplate = vi.fn().mockResolvedValue(false);
      const exec = criarMockExecutores({ enviarWhatsAppTemplate });
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "whatsapp_enviar", clienteId: "n1", config: { modo: "template", templateNome: "x" } },
      ];
      const r = await executarCenario(passos, { telefoneCliente: "5585999990000", cliente: {} }, exec);
      expect(r.sucesso).toBe(false);
      expect(enviarWhatsAppTemplate).toHaveBeenCalledTimes(1);
    });

    it("modo texto continua usando enviarWhatsApp (não o template)", async () => {
      const enviarWhatsApp = vi.fn().mockResolvedValue(true);
      const enviarWhatsAppTemplate = vi.fn().mockResolvedValue(true);
      const exec = criarMockExecutores({ enviarWhatsApp, enviarWhatsAppTemplate });
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "whatsapp_enviar", clienteId: "n1", config: { modo: "texto", template: "Oi {{cliente.nome}}" } },
      ];
      const r = await executarCenario(passos, { telefoneCliente: "5585", cliente: { nome: "Ana" } }, exec);
      expect(r.sucesso).toBe(true);
      expect(enviarWhatsAppTemplate).not.toHaveBeenCalled();
      expect(enviarWhatsApp).toHaveBeenCalledWith("5585", "Oi Ana");
    });
  });

  describe("parsearOpcaoResposta", () => {
    it("acha por número", async () => {
      const { parsearOpcaoResposta } = await import("../smartflow/engine");
      const r = parsearOpcaoResposta("2", ["A", "B", "C"]);
      expect(r).toEqual({ indice: 1, texto: "B", numero: "2" });
    });

    it("acha por número em meio de texto", async () => {
      const { parsearOpcaoResposta } = await import("../smartflow/engine");
      const r = parsearOpcaoResposta("a opção 3 pra mim", ["X", "Y", "Z"]);
      expect(r).toEqual({ indice: 2, texto: "Z", numero: "3" });
    });

    it("acha por texto exato case-insensitive", async () => {
      const { parsearOpcaoResposta } = await import("../smartflow/engine");
      const r = parsearOpcaoResposta("agendar", ["Agendar", "Dúvida"]);
      expect(r).toEqual({ indice: 0, texto: "Agendar", numero: "1" });
    });

    it("acha por substring", async () => {
      const { parsearOpcaoResposta } = await import("../smartflow/engine");
      const r = parsearOpcaoResposta("quero agendar uma consulta", ["Agendar", "Dúvida"]);
      expect(r).toEqual({ indice: 0, texto: "Agendar", numero: "1" });
    });

    it("retorna null quando não bate", async () => {
      const { parsearOpcaoResposta } = await import("../smartflow/engine");
      const r = parsearOpcaoResposta("xyz", ["A", "B"]);
      expect(r).toBeNull();
    });

    it("retorna null quando lista vazia", async () => {
      const { parsearOpcaoResposta } = await import("../smartflow/engine");
      const r = parsearOpcaoResposta("qualquer coisa", []);
      expect(r).toBeNull();
    });

    it("ignora número fora do range", async () => {
      const { parsearOpcaoResposta } = await import("../smartflow/engine");
      const r = parsearOpcaoResposta("5", ["A", "B"]);
      // Não há opção 5 — não usa o número, tenta substring (não bate) → null
      expect(r).toBeNull();
    });
  });

  describe("tags do contato (condição + ação)", () => {
    const rota = (operador: string, valor: string): Passo[] => [
      {
        id: 1, ordem: 1, tipo: "condicional", clienteId: "c1",
        proximoSe: { cond_ec: "sim", fallback: "nao" },
        config: { condicoes: [{ id: "ec", campo: "cliente.tags", operador, valor }] },
      },
      { id: 2, ordem: 2, tipo: "whatsapp_enviar", clienteId: "sim", config: { template: "RAMO-SIM" } },
      { id: 3, ordem: 3, tipo: "whatsapp_enviar", clienteId: "nao", config: { template: "RAMO-NAO" } },
    ];
    const ctxCom = (tags: string[]) => ({ canalId: 1, telefoneCliente: "5585", cliente: { tags } });

    it("Decisão 'tem a tag' roteia conforme cliente.tags (case-insensitive)", async () => {
      const exec = criarMockExecutores();
      const sim = await executarCenario(rota("tem_tag", "cliente"), ctxCom(["Cliente"]), exec);
      expect(sim.respostas).toContain("RAMO-SIM");
      const nao = await executarCenario(rota("tem_tag", "cliente"), ctxCom(["lead"]), exec);
      expect(nao.respostas).toContain("RAMO-NAO");
    });

    it("Decisão 'não tem a tag' inverte", async () => {
      const exec = criarMockExecutores();
      const r = await executarCenario(rota("nao_tem_tag", "cliente"), ctxCom(["lead"]), exec);
      expect(r.respostas).toContain("RAMO-SIM"); // não tem "cliente" → condição verdadeira
    });

    it("ação contato_tags chama executor e atualiza cliente.tags no contexto", async () => {
      const atualizarTagsContato = vi.fn().mockResolvedValue(["cliente", "vip"]);
      const exec = criarMockExecutores({ atualizarTagsContato });
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "contato_tags", config: { tags: "vip", modo: "adicionar" } },
      ];
      const r = await executarCenario(passos, { contatoId: 7, cliente: { tags: ["cliente"] } }, exec);
      expect(r.sucesso).toBe(true);
      expect(atualizarTagsContato).toHaveBeenCalledWith({ contatoId: 7, tags: ["vip"], modo: "adicionar" });
      expect((r.contexto.cliente as any).tags).toEqual(["cliente", "vip"]);
    });

    it("ação contato_tags sem contatoId falha", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "contato_tags", config: { tags: "x", modo: "adicionar" } },
      ];
      const r = await executarCenario(passos, {}, exec);
      expect(r.sucesso).toBe(false);
      expect(r.erro).toContain("contatoId");
    });
  });

  describe("é cliente? (campos do cadastro no contexto)", () => {
    const rotaCpf = (): Passo[] => [
      {
        id: 1, ordem: 1, tipo: "condicional", clienteId: "c1",
        proximoSe: { cond_temcpf: "cli", fallback: "lead" },
        config: { condicoes: [{ id: "temcpf", campo: "cliente.cpf", operador: "existe" }] },
      },
      { id: 2, ordem: 2, tipo: "whatsapp_enviar", clienteId: "cli", config: { template: "É CLIENTE" } },
      { id: 3, ordem: 3, tipo: "whatsapp_enviar", clienteId: "lead", config: { template: "É LEAD" } },
    ];

    it("com CPF no cadastro → ramo cliente", async () => {
      const exec = criarMockExecutores();
      const r = await executarCenario(rotaCpf(), { canalId: 1, telefoneCliente: "5", cliente: { cpf: "123.456.789-00" } }, exec);
      expect(r.respostas).toContain("É CLIENTE");
    });

    it("sem CPF → ramo lead", async () => {
      const exec = criarMockExecutores();
      const r = await executarCenario(rotaCpf(), { canalId: 1, telefoneCliente: "5", cliente: { cpf: "" } }, exec);
      expect(r.respostas).toContain("É LEAD");
    });

    it("cliente.ehCliente como booleano direto", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        {
          id: 1, ordem: 1, tipo: "condicional", clienteId: "c1",
          proximoSe: { cond_e: "cli", fallback: "lead" },
          config: { condicoes: [{ id: "e", campo: "cliente.ehCliente", operador: "verdadeiro" }] },
        },
        { id: 2, ordem: 2, tipo: "whatsapp_enviar", clienteId: "cli", config: { template: "É CLIENTE" } },
        { id: 3, ordem: 3, tipo: "whatsapp_enviar", clienteId: "lead", config: { template: "É LEAD" } },
      ];
      const r = await executarCenario(passos, { canalId: 1, telefoneCliente: "5", cliente: { ehCliente: true } }, exec);
      expect(r.respostas).toContain("É CLIENTE");
    });
  });

  describe("gerarSlotsLivres (horários livres pra oferecer)", () => {
    const meiaNoiteBRT = new Date("2026-05-25T03:00:00Z"); // 00:00 BRT, dia 0 todo no futuro

    it("formatarISOComOffset mostra o relógio local com offset -03:00", () => {
      // 12:00 UTC = 09:00 BRT
      const ms = Date.UTC(2026, 4, 26, 12, 0, 0);
      expect(formatarISOComOffset(ms, -3)).toBe("2026-05-26T09:00:00-03:00");
    });

    it("respeita a duração: 9h–18h em blocos de 30 min = 18 slots/dia", () => {
      const slots = gerarSlotsLivres({
        agora: meiaNoiteBRT, dias: 1, incluirFimDeSemana: true,
        duracaoMin: 30, horaInicio: 9, horaFim: 18, ocupados: [], maxSlots: 1000,
      });
      expect(slots).toHaveLength(18);
      expect(slots[0].inicioISO).toBe("2026-05-25T09:00:00-03:00");
    });

    it("fim de semana: 7 dias incluindo = 7×9; sem incluir = 5×9 (2 dias de fds)", () => {
      const base = { agora: meiaNoiteBRT, dias: 7, duracaoMin: 60, horaInicio: 9, horaFim: 18, ocupados: [], maxSlots: 1000 };
      const com = gerarSlotsLivres({ ...base, incluirFimDeSemana: true });
      const sem = gerarSlotsLivres({ ...base, incluirFimDeSemana: false });
      expect(com).toHaveLength(7 * 9);
      expect(sem).toHaveLength(5 * 9);
    });

    it("exclui slot que colide com compromisso ocupado", () => {
      const slots = gerarSlotsLivres({
        agora: meiaNoiteBRT, dias: 1, incluirFimDeSemana: true,
        duracaoMin: 60, horaInicio: 9, horaFim: 18,
        // ocupado 10:00–11:00 BRT (13:00–14:00 UTC)
        ocupados: [{ inicio: "2026-05-25T13:00:00.000Z", fim: "2026-05-25T14:00:00.000Z" }],
        maxSlots: 1000,
      });
      expect(slots).toHaveLength(8); // 9 - 1 ocupado
      expect(slots.some((s) => s.inicioISO === "2026-05-25T10:00:00-03:00")).toBe(false);
      expect(slots.some((s) => s.inicioISO === "2026-05-25T09:00:00-03:00")).toBe(true);
    });

    it("pula slots no passado", () => {
      const slots = gerarSlotsLivres({
        agora: new Date("2026-05-25T17:00:00Z"), // 14:00 BRT
        dias: 1, incluirFimDeSemana: true,
        duracaoMin: 60, horaInicio: 9, horaFim: 18, ocupados: [], maxSlots: 1000,
      });
      // só 14,15,16,17h sobram
      expect(slots).toHaveLength(4);
      expect(slots[0].inicioISO).toBe("2026-05-25T14:00:00-03:00");
    });

    it("respeita maxSlots", () => {
      const slots = gerarSlotsLivres({
        agora: meiaNoiteBRT, dias: 30, incluirFimDeSemana: true,
        duracaoMin: 30, horaInicio: 9, horaFim: 18, ocupados: [], maxSlots: 10,
      });
      expect(slots).toHaveLength(10);
    });
  });

  describe("interpretarSaidaAtendente (parser da decisão do agente)", () => {
    const fer = ["agendar", "transferir"];
    const con = ["ver_horarios"];
    it("JSON válido com ação habilitada", () => {
      expect(interpretarSaidaAtendente('{"resposta":"Vou agendar!","acao":"agendar"}', fer, con))
        .toEqual({ resposta: "Vou agendar!", acao: "agendar", consulta: null, quando: null });
    });
    it("consulta habilitada é reconhecida", () => {
      expect(interpretarSaidaAtendente('{"resposta":"deixa eu ver","consulta":"ver_horarios"}', fer, con))
        .toEqual({ resposta: "deixa eu ver", acao: null, consulta: "ver_horarios", quando: null });
    });
    it("ação/consulta fora da lista são ignoradas", () => {
      expect(interpretarSaidaAtendente('{"resposta":"oi","acao":"deletar","consulta":"hackear"}', fer, con))
        .toEqual({ resposta: "oi", acao: null, consulta: null, quando: null });
    });
    it("tolera cercas markdown ```json", () => {
      expect(interpretarSaidaAtendente('```json\n{"resposta":"oi","acao":"transferir"}\n```', fer, con))
        .toEqual({ resposta: "oi", acao: "transferir", consulta: null, quando: null });
    });
    it("texto não-JSON vira resposta (fallback)", () => {
      expect(interpretarSaidaAtendente("Olá, tudo bem?", fer, con))
        .toEqual({ resposta: "Olá, tudo bem?", acao: null, consulta: null, quando: null });
    });
    it("frase ANTES do JSON: extrai o objeto e a consulta (bug do JSON vazado pro cliente)", () => {
      const raw = 'Claro! Vou verificar os horários disponíveis para você. Um momento, por favor.\n\n{"resposta":"Claro! Vou verificar os horários.","acao":null,"consulta":"ver_horarios"}';
      expect(interpretarSaidaAtendente(raw, fer, con))
        .toEqual({ resposta: "Claro! Vou verificar os horários.", acao: null, consulta: "ver_horarios", quando: null });
    });
    it("cerca markdown com frase antes do bloco json", () => {
      const raw = 'Deixa eu ver os horários:\n```json\n{"resposta":"um momento","consulta":"ver_horarios"}\n```';
      expect(interpretarSaidaAtendente(raw, fer, con))
        .toEqual({ resposta: "um momento", acao: null, consulta: "ver_horarios", quando: null });
    });
    it("não vira falso-positivo: chaves soltas em texto comum continuam fallback", () => {
      expect(interpretarSaidaAtendente("Oi {nome}, tudo bem?", fer, con))
        .toEqual({ resposta: "Oi {nome}, tudo bem?", acao: null, consulta: null, quando: null });
    });
    it("extrai `quando` (ISO do horário escolhido) junto com a ação agendar", () => {
      const raw = '{"resposta":"Agendado!","acao":"agendar","quando":"2026-05-27T14:00:00-03:00"}';
      expect(interpretarSaidaAtendente(raw, fer, con))
        .toEqual({ resposta: "Agendado!", acao: "agendar", consulta: null, quando: "2026-05-27T14:00:00-03:00" });
    });
  });

  describe("orquestrarAtendente (vai-e-volta da consulta)", () => {
    const base = { ferramentas: ["agendar"], consultas: ["ver_horarios"] };

    it("sem consulta → devolve a resposta/ação direto", async () => {
      const chamarLLM = vi.fn().mockResolvedValue('{"resposta":"oi","acao":null}');
      const executarConsulta = vi.fn();
      const r = await orquestrarAtendente({ ...base, chamarLLM, executarConsulta });
      expect(r).toEqual({ resposta: "oi", acao: null, quando: null });
      expect(executarConsulta).not.toHaveBeenCalled();
      expect(chamarLLM).toHaveBeenCalledTimes(1);
    });

    it("consulta → executa, re-chama o agente e então retorna a ação", async () => {
      const chamarLLM = vi.fn()
        .mockResolvedValueOnce('{"resposta":"deixa eu ver os horários","consulta":"ver_horarios"}')
        .mockResolvedValueOnce('{"resposta":"tenho ter 14h e qui 16h, qual prefere?","acao":null}');
      const executarConsulta = vi.fn().mockResolvedValue("ter 14h, qui 16h");
      const r = await orquestrarAtendente({ ...base, chamarLLM, executarConsulta });
      expect(executarConsulta).toHaveBeenCalledWith("ver_horarios");
      expect(chamarLLM).toHaveBeenCalledTimes(2);
      // 2ª chamada recebeu o resultado da consulta no contexto extra
      expect(chamarLLM.mock.calls[1][0]).toContain("ter 14h, qui 16h");
      expect(r).toEqual({ resposta: "tenho ter 14h e qui 16h, qual prefere?", acao: null, quando: null });
    });

    it("propaga `quando` (ISO escolhido) quando o agente dispara agendar", async () => {
      const chamarLLM = vi.fn().mockResolvedValue('{"resposta":"Agendado para qui 16h!","acao":"agendar","quando":"2026-05-28T16:00:00-03:00"}');
      const executarConsulta = vi.fn();
      const r = await orquestrarAtendente({ ...base, chamarLLM, executarConsulta });
      expect(r).toEqual({ resposta: "Agendado para qui 16h!", acao: "agendar", quando: "2026-05-28T16:00:00-03:00" });
    });

    it("respeita maxRodadas (não consulta infinito)", async () => {
      const chamarLLM = vi.fn().mockResolvedValue('{"resposta":"vendo...","consulta":"ver_horarios"}');
      const executarConsulta = vi.fn().mockResolvedValue("x");
      const r = await orquestrarAtendente({ ...base, chamarLLM, executarConsulta, maxRodadas: 2 });
      // 2 rodadas de consulta + 1 chamada final forçada
      expect(executarConsulta).toHaveBeenCalledTimes(2);
      expect(r.acao).toBeNull();
    });
  });

  describe("ia_atendente (Atendente IA com ferramentas)", () => {
    const noAtendente = (ferramentas: string[], proximoSe: Record<string, string> = {}): Passo => ({
      id: 1, ordem: 1, tipo: "ia_atendente", clienteId: "at",
      config: { agenteId: 7, ferramentas }, proximoSe,
    });
    const ctxBase = { mensagem: "oi", contatoId: 5, conversaId: 9, canalId: 1, telefoneCliente: "5585" };

    it("sem ação → envia a resposta e pausa esperando o cliente", async () => {
      const conversarComAgente = vi.fn().mockResolvedValue({ resposta: "Oi! Como posso ajudar?", acao: null });
      const exec = criarMockExecutores({ conversarComAgente });
      const r = await executarCenario([noAtendente(["agendar", "transferir"])], { ...ctxBase }, exec);
      expect(r.respostas).toContain("Oi! Como posso ajudar?");
      expect(r.contexto.aguardandoMensagem).toBe(true);
      expect(r.contexto.aguardandoNodeClienteId).toBe("at");
    });

    it("salva a janela de agrupamento (acumularSegundos) no contexto ao pausar", async () => {
      // O webhook lê `aguardandoAcumularSegundos` do contexto da execução
      // pausada pra decidir se bufferiza as próximas mensagens do cliente.
      const conversarComAgente = vi.fn().mockResolvedValue({ resposta: "Oi!", acao: null });
      const exec = criarMockExecutores({ conversarComAgente });
      const passo: Passo = { id: 1, ordem: 1, tipo: "ia_atendente", clienteId: "at", config: { agenteId: 7, ferramentas: [], acumularSegundos: 8 } };
      const r = await executarCenario([passo], { ...ctxBase }, exec);
      expect(r.contexto.aguardandoMensagem).toBe(true);
      expect(r.contexto.aguardandoAcumularSegundos).toBe(8);
    });

    it("sem acumularSegundos → janela 0 (agrupamento desligado)", async () => {
      const conversarComAgente = vi.fn().mockResolvedValue({ resposta: "Oi!", acao: null });
      const exec = criarMockExecutores({ conversarComAgente });
      const r = await executarCenario([noAtendente(["agendar"])], { ...ctxBase }, exec);
      expect(r.contexto.aguardandoAcumularSegundos).toBe(0);
    });

    it("acumularSegundos negativo/inválido vira 0", async () => {
      const conversarComAgente = vi.fn().mockResolvedValue({ resposta: "Oi!", acao: null });
      const exec = criarMockExecutores({ conversarComAgente });
      const passo: Passo = { id: 1, ordem: 1, tipo: "ia_atendente", clienteId: "at", config: { agenteId: 7, ferramentas: [], acumularSegundos: -5 } };
      const r = await executarCenario([passo], { ...ctxBase }, exec);
      expect(r.contexto.aguardandoAcumularSegundos).toBe(0);
    });

    it("com ação habilitada → envia resposta e roteia pela saída da ferramenta", async () => {
      const conversarComAgente = vi.fn().mockResolvedValue({ resposta: "Vou te agendar!", acao: "agendar" });
      const exec = criarMockExecutores({ conversarComAgente });
      const passos: Passo[] = [
        noAtendente(["agendar", "transferir"], { agendar: "a", transferir: "t" }),
        { id: 2, ordem: 2, tipo: "whatsapp_enviar", clienteId: "a", config: { template: "AGENDOU" } },
        { id: 3, ordem: 3, tipo: "whatsapp_enviar", clienteId: "t", config: { template: "TRANSFERIU" } },
      ];
      const r = await executarCenario(passos, { ...ctxBase, mensagem: "quero agendar" }, exec);
      expect(r.respostas).toContain("Vou te agendar!");
      expect(r.respostas).toContain("AGENDOU");
      expect(r.respostas).not.toContain("TRANSFERIU");
      expect(r.contexto.aguardandoMensagem).toBeFalsy();
    });

    it("ação agendar com `quando` → grava agendamentoQuando (pro bloco de Agendamento usar a data)", async () => {
      const conversarComAgente = vi.fn().mockResolvedValue({ resposta: "Agendado!", acao: "agendar", quando: "2026-05-27T14:00:00-03:00" });
      const exec = criarMockExecutores({ conversarComAgente });
      const passos: Passo[] = [
        noAtendente(["agendar"], { agendar: "a" }),
        { id: 2, ordem: 2, tipo: "whatsapp_enviar", clienteId: "a", config: { template: "OK" } },
      ];
      const r = await executarCenario(passos, { ...ctxBase, mensagem: "pode ser 27 as 14" }, exec);
      expect(r.contexto.agendamentoQuando).toBe("2026-05-27T14:00:00-03:00");
    });

    it("ação NÃO habilitada é ignorada → continua conversando", async () => {
      const conversarComAgente = vi.fn().mockResolvedValue({ resposta: "...", acao: "deletar_tudo" });
      const exec = criarMockExecutores({ conversarComAgente });
      const r = await executarCenario([noAtendente(["agendar"], { agendar: "a" })], { ...ctxBase }, exec);
      expect(r.contexto.aguardandoMensagem).toBe(true);
    });

    it("captura campos e reflete em cliente.campos", async () => {
      const conversarComAgente = vi.fn().mockResolvedValue({ resposta: "ok", acao: null });
      const extrairCamposDoAgente = vi.fn().mockResolvedValue({ banco: "Itaú" });
      const exec = criarMockExecutores({ conversarComAgente, extrairCamposDoAgente });
      const r = await executarCenario([noAtendente([])], { ...ctxBase }, exec);
      expect(extrairCamposDoAgente).toHaveBeenCalledWith(7, 5, 9);
      expect((r.contexto.cliente as any).campos).toMatchObject({ banco: "Itaú" });
    });

    it("sem agente → erro claro", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [{ id: 1, ordem: 1, tipo: "ia_atendente", clienteId: "at", config: {} }];
      const r = await executarCenario(passos, { mensagem: "oi" }, exec);
      expect(r.sucesso).toBe(false);
      expect(r.erro).toContain("agente");
    });

    it("multi-turno: reentra no nó e re-executa o agente a cada mensagem (sem ações ligadas)", async () => {
      // Atendente IA puramente conversacional: 1 nó, sem ferramentas e SEM
      // proximoSe. Era o caso quebrado — a retomada pulava o nó e a conversa
      // morria após a 1ª resposta. Aqui a retomada (como o dispatcher faz)
      // reentra no nó e re-chama o agente.
      const conversarComAgente = vi.fn()
        .mockResolvedValueOnce({ resposta: "Olá! Como ajudo?", acao: null })
        .mockResolvedValueOnce({ resposta: "Entendi sua dúvida, me conta mais.", acao: null });
      const exec = criarMockExecutores({ conversarComAgente });
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "ia_atendente", clienteId: "at", config: { agenteId: 7 } },
      ];

      const t1 = await executarCenario(passos, { mensagem: "oii", contatoId: 5, conversaId: 9 }, exec);
      expect(t1.respostas).toContain("Olá! Como ajudo?");
      expect(t1.contexto.aguardandoMensagem).toBe(true);
      expect(t1.contexto.aguardandoNodeClienteId).toBe("at");

      const t2 = await executarCenario(
        passos,
        { ...t1.contexto, __resumindoWaitClienteId: "at", respostaUsuario: "tenho uma dúvida" },
        exec,
      );
      expect(conversarComAgente).toHaveBeenCalledTimes(2);
      expect(t2.respostas).toContain("Entendi sua dúvida, me conta mais.");
      expect(t2.contexto.aguardandoMensagem).toBe(true); // pausa de novo: segue conversando
    });
  });

  describe("retomada por timeout (ramo 'timeout' do aguardar)", () => {
    const passos = (): Passo[] => [
      { id: 1, ordem: 1, tipo: "whatsapp_aguardar_resposta", clienteId: "wait", config: { template: "Ainda aí?" }, proximoSe: { default: "resp", timeout: "fim" } },
      { id: 2, ordem: 2, tipo: "whatsapp_enviar", clienteId: "resp", config: { template: "RESPONDEU" } },
      { id: 3, ordem: 3, tipo: "whatsapp_enviar", clienteId: "fim", config: { template: "ENCERRADO POR TIMEOUT" } },
    ];
    const base = { canalId: 1, telefoneCliente: "5585", __resumindoWaitClienteId: "wait" };

    it("motivo timeout → segue ramo 'timeout'", async () => {
      const exec = criarMockExecutores();
      const r = await executarCenario(passos(), { ...base, __resumindoWaitMotivo: "timeout" }, exec);
      expect(r.respostas).toContain("ENCERRADO POR TIMEOUT");
      expect(r.respostas).not.toContain("RESPONDEU");
    });

    it("retomada por mensagem (sem motivo) → ramo 'default'", async () => {
      const exec = criarMockExecutores();
      const r = await executarCenario(passos(), { ...base, respostaUsuario: "oi" }, exec);
      expect(r.respostas).toContain("RESPONDEU");
      expect(r.respostas).not.toContain("ENCERRADO POR TIMEOUT");
    });

    it("timeout sem ramo 'timeout' configurado → encerra sem erro", async () => {
      const exec = criarMockExecutores();
      const semTimeout: Passo[] = [
        { id: 1, ordem: 1, tipo: "whatsapp_aguardar_resposta", clienteId: "wait", config: { template: "Ainda aí?" }, proximoSe: { default: "resp" } },
        { id: 2, ordem: 2, tipo: "whatsapp_enviar", clienteId: "resp", config: { template: "RESPONDEU" } },
      ];
      const r = await executarCenario(semTimeout, { ...base, __resumindoWaitMotivo: "timeout" }, exec);
      expect(r.sucesso).toBe(true);
      expect(r.respostas).toHaveLength(0); // não segue default; encerra
    });
  });

  describe("retomada graph-aware (loop conversacional)", () => {
    // Fluxo: IA responde → aguarda resposta → decisão (quer agendar?).
    // Se "sim" → transferir (sai). Senão → volta pra IA (loop até confirmar).
    const passosLoop = (): Passo[] => [
      { id: 1, ordem: 1, tipo: "ia_responder", clienteId: "ia", config: {}, proximoSe: { default: "wait" } },
      { id: 2, ordem: 2, tipo: "whatsapp_aguardar_resposta", clienteId: "wait", config: { template: "Quer agendar?" }, proximoSe: { default: "cond" } },
      {
        id: 3, ordem: 3, tipo: "condicional", clienteId: "cond",
        config: { condicoes: [{ id: "ok", campo: "respostaUsuario", operador: "contem", valor: "sim" }] },
        proximoSe: { cond_ok: "fim", fallback: "ia" },
      },
      { id: 4, ordem: 4, tipo: "transferir", clienteId: "fim", config: { mensagem: "Combinado!" } },
    ];
    const ctxBase = { contatoId: 1, canalId: 9, telefoneCliente: "5585999990000" };

    it("primeira passada para no 'aguardar' e marca o nó", async () => {
      const exec = criarMockExecutores({ chamarIA: vi.fn().mockResolvedValue("Olá! Posso ajudar?") });
      const r = await executarCenario(passosLoop(), { ...ctxBase }, exec);
      expect(r.contexto.aguardandoMensagem).toBe(true);
      expect(r.contexto.aguardandoNodeClienteId).toBe("wait");
    });

    it("resposta que NÃO confirma volta pra IA e pausa de novo (loop)", async () => {
      const chamarIA = vi.fn().mockResolvedValue("Entendi, me conta mais?");
      const exec = criarMockExecutores({ chamarIA });
      // simula o que o dispatcher faz ao retomar: injeta resposta + marca o nó de retomada
      const ctxResume = {
        ...ctxBase,
        respostaUsuario: "ainda estou pensando",
        __resumindoWaitClienteId: "wait",
      };
      const r = await executarCenario(passosLoop(), ctxResume, exec);
      // passou pelo wait → cond → fallback → IA (respondeu de novo) → wait (pausou)
      expect(chamarIA).toHaveBeenCalled();
      expect(r.contexto.aguardandoMensagem).toBe(true);
      expect(r.contexto.aguardandoNodeClienteId).toBe("wait");
      expect(r.contexto.transferir).toBeFalsy();
    });

    it("resposta que confirma sai do loop e transfere", async () => {
      const exec = criarMockExecutores({ chamarIA: vi.fn().mockResolvedValue("x") });
      const ctxResume = {
        ...ctxBase,
        respostaUsuario: "sim, quero agendar",
        __resumindoWaitClienteId: "wait",
      };
      const r = await executarCenario(passosLoop(), ctxResume, exec);
      expect(r.contexto.transferir).toBe(true);
      expect(r.contexto.aguardandoMensagem).toBeFalsy();
    });
  });

  describe("para_cada_item", () => {
    it("itera 0 vezes quando lista está vazia (não falha)", async () => {
      const enviarWhatsApp = vi.fn().mockResolvedValue(true);
      const exec = criarMockExecutores({ enviarWhatsApp });
      const passos: Passo[] = [
        {
          id: 1, ordem: 1, tipo: "para_cada_item",
          clienteId: "loop",
          config: { caminhoLista: "acoes" },
          proximoSe: { corpo: "envia", depois: "fim" },
        },
        {
          id: 2, ordem: 2, tipo: "whatsapp_enviar",
          clienteId: "envia",
          config: { template: "ação {{item.id}}" },
          proximoSe: { default: "loop" },
        },
        {
          id: 3, ordem: 3, tipo: "ia_responder",
          clienteId: "fim",
          config: {},
        },
      ];

      const resultado = await executarCenario(passos, { acoes: [], telefoneCliente: "1199" }, exec);

      expect(resultado.sucesso).toBe(true);
      expect(enviarWhatsApp).not.toHaveBeenCalled();
      // ia_responder NÃO roda porque mensagem não está no ctx (handler falha)
      // mas isso é outra história — o que importa: chegou no fim sem erro.
    });

    it("itera 0 vezes sem erro quando caminhoLista não existe no contexto", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        {
          id: 1, ordem: 1, tipo: "para_cada_item",
          clienteId: "loop",
          config: { caminhoLista: "naoExisteNoCtx" },
          proximoSe: { corpo: "envia" },
        },
        {
          id: 2, ordem: 2, tipo: "whatsapp_enviar",
          clienteId: "envia",
          config: { template: "ola" },
        },
      ];

      const resultado = await executarCenario(passos, {}, exec);

      expect(resultado.sucesso).toBe(true);
    });

    it("falha quando lista existe mas não é array", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        {
          id: 1, ordem: 1, tipo: "para_cada_item",
          clienteId: "loop",
          config: { caminhoLista: "acoes" },
          proximoSe: { corpo: "envia" },
        },
        {
          id: 2, ordem: 2, tipo: "whatsapp_enviar",
          clienteId: "envia",
          config: { template: "ola" },
        },
      ];

      const resultado = await executarCenario(passos, { acoes: "string em vez de lista" }, exec);

      expect(resultado.sucesso).toBe(false);
      expect(resultado.erro).toContain("não é uma lista");
    });

    it("falha quando não tem proximoSe.corpo configurado", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        {
          id: 1, ordem: 1, tipo: "para_cada_item",
          clienteId: "loop",
          config: { caminhoLista: "acoes" },
          proximoSe: {},
        },
      ];

      const resultado = await executarCenario(passos, { acoes: [1, 2, 3] }, exec);

      expect(resultado.sucesso).toBe(false);
      expect(resultado.erro).toContain("corpo conectado");
    });

    it("itera 3 vezes executando 1 passo no corpo a cada", async () => {
      const enviarWhatsApp = vi.fn().mockResolvedValue(true);
      const exec = criarMockExecutores({ enviarWhatsApp });
      const passos: Passo[] = [
        {
          id: 1, ordem: 1, tipo: "para_cada_item",
          clienteId: "loop",
          config: { caminhoLista: "acoes" },
          // corpo aponta pro whatsapp; whatsapp aponta de volta pro loop
          proximoSe: { corpo: "envia" },
        },
        {
          id: 2, ordem: 2, tipo: "whatsapp_enviar",
          clienteId: "envia",
          config: { template: "ação {{item.apelido}}" },
          proximoSe: { default: "loop" },
        },
      ];

      const resultado = await executarCenario(
        passos,
        {
          acoes: [
            { id: 1, apelido: "Trabalhista" },
            { id: 2, apelido: "Cível" },
            { id: 3, apelido: "Família" },
          ],
          telefoneCliente: "1199",
        },
        exec,
      );

      expect(resultado.sucesso).toBe(true);
      expect(enviarWhatsApp).toHaveBeenCalledTimes(3);
      // Cada chamada com o template interpolado pro item da iteração
      expect((enviarWhatsApp as any).mock.calls[0][1]).toBe("ação Trabalhista");
      expect((enviarWhatsApp as any).mock.calls[1][1]).toBe("ação Cível");
      expect((enviarWhatsApp as any).mock.calls[2][1]).toBe("ação Família");
    });

    it("respeita o limite de iterações truncando a lista", async () => {
      const enviarWhatsApp = vi.fn().mockResolvedValue(true);
      const exec = criarMockExecutores({ enviarWhatsApp });
      const lista = Array.from({ length: 50 }, (_, i) => ({ id: i }));
      const passos: Passo[] = [
        {
          id: 1, ordem: 1, tipo: "para_cada_item",
          clienteId: "loop",
          config: { caminhoLista: "itens", limite: 5 },
          proximoSe: { corpo: "envia" },
        },
        {
          id: 2, ordem: 2, tipo: "whatsapp_enviar",
          clienteId: "envia",
          config: { template: "x" },
          proximoSe: { default: "loop" },
        },
      ];

      const resultado = await executarCenario(
        passos,
        { itens: lista, telefoneCliente: "1199" },
        exec,
      );

      expect(resultado.sucesso).toBe(true);
      expect(enviarWhatsApp).toHaveBeenCalledTimes(5);
    });

    it("usa nomeVarItem custom (ex: 'acao' em vez de 'item')", async () => {
      const enviarWhatsApp = vi.fn().mockResolvedValue(true);
      const exec = criarMockExecutores({ enviarWhatsApp });
      const passos: Passo[] = [
        {
          id: 1, ordem: 1, tipo: "para_cada_item",
          clienteId: "loop",
          config: { caminhoLista: "acoes", nomeVarItem: "acao" },
          proximoSe: { corpo: "envia" },
        },
        {
          id: 2, ordem: 2, tipo: "whatsapp_enviar",
          clienteId: "envia",
          config: { template: "Processo {{acao.cnj}}" },
          proximoSe: { default: "loop" },
        },
      ];

      await executarCenario(
        passos,
        {
          acoes: [{ cnj: "111" }, { cnj: "222" }],
          telefoneCliente: "1199",
        },
        exec,
      );

      expect((enviarWhatsApp as any).mock.calls[0][1]).toBe("Processo 111");
      expect((enviarWhatsApp as any).mock.calls[1][1]).toBe("Processo 222");
    });

    it("continua pelo ramo 'depois' após terminar as iterações", async () => {
      const enviarWhatsApp = vi.fn().mockResolvedValue(true);
      const chamarIA = vi.fn().mockResolvedValue("resumo");
      const exec = criarMockExecutores({ enviarWhatsApp, chamarIA });
      const passos: Passo[] = [
        {
          id: 1, ordem: 1, tipo: "para_cada_item",
          clienteId: "loop",
          config: { caminhoLista: "itens" },
          proximoSe: { corpo: "envia", depois: "depoisLoop" },
        },
        {
          id: 2, ordem: 2, tipo: "whatsapp_enviar",
          clienteId: "envia",
          config: { template: "{{item}}" },
          proximoSe: { default: "loop" },
        },
        {
          id: 3, ordem: 3, tipo: "ia_responder",
          clienteId: "depoisLoop",
          config: {},
        },
      ];

      const resultado = await executarCenario(
        passos,
        { itens: ["a", "b"], telefoneCliente: "1199", mensagem: "fim" },
        exec,
      );

      expect(resultado.sucesso).toBe(true);
      expect(enviarWhatsApp).toHaveBeenCalledTimes(2);
      // ia_responder rodou ("depois" do loop)
      expect(chamarIA).toHaveBeenCalled();
      expect(resultado.contexto.respostaIA).toBe("resumo");
    });

    it("limpa item/indice do contexto após o loop terminar", async () => {
      const enviarWhatsApp = vi.fn().mockResolvedValue(true);
      const exec = criarMockExecutores({ enviarWhatsApp });
      const passos: Passo[] = [
        {
          id: 1, ordem: 1, tipo: "para_cada_item",
          clienteId: "loop",
          config: { caminhoLista: "itens" },
          proximoSe: { corpo: "envia" },
        },
        {
          id: 2, ordem: 2, tipo: "whatsapp_enviar",
          clienteId: "envia",
          config: { template: "x" },
          proximoSe: { default: "loop" },
        },
      ];

      const resultado = await executarCenario(
        passos,
        { itens: ["a", "b"], telefoneCliente: "1199" },
        exec,
      );

      expect(resultado.sucesso).toBe(true);
      // Após o loop, item/indice não vazam pro contexto global
      expect(resultado.contexto.item).toBeUndefined();
      expect(resultado.contexto.indice).toBeUndefined();
    });

    it("aborta com erro quando excede MAX_PASSOS_EXECUCAO no corpo", async () => {
      const enviarWhatsApp = vi.fn().mockResolvedValue(true);
      const exec = criarMockExecutores({ enviarWhatsApp });
      // 60 itens × 1 passo/item = 60 — passa do limite de 50
      const lista = Array.from({ length: 60 }, (_, i) => i);
      const passos: Passo[] = [
        {
          id: 1, ordem: 1, tipo: "para_cada_item",
          clienteId: "loop",
          config: { caminhoLista: "itens", limite: 60 },
          proximoSe: { corpo: "envia" },
        },
        {
          id: 2, ordem: 2, tipo: "whatsapp_enviar",
          clienteId: "envia",
          config: { template: "x" },
          proximoSe: { default: "loop" },
        },
      ];

      const resultado = await executarCenario(
        passos,
        { itens: lista, telefoneCliente: "1199" },
        exec,
      );

      expect(resultado.sucesso).toBe(false);
      expect(resultado.erro).toMatch(/Limite de \d+ passos/);
    });

    it("erros dentro do corpo abortam o loop inteiro", async () => {
      // Mock que falha na 2ª chamada
      const enviarWhatsApp = vi.fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);
      const exec = criarMockExecutores({ enviarWhatsApp });
      const passos: Passo[] = [
        {
          id: 1, ordem: 1, tipo: "para_cada_item",
          clienteId: "loop",
          config: { caminhoLista: "itens" },
          proximoSe: { corpo: "envia" },
        },
        {
          id: 2, ordem: 2, tipo: "whatsapp_enviar",
          clienteId: "envia",
          config: { template: "x" },
          proximoSe: { default: "loop" },
        },
      ];

      const resultado = await executarCenario(
        passos,
        { itens: ["a", "b", "c"], telefoneCliente: "1199" },
        exec,
      );

      expect(resultado.sucesso).toBe(false);
      expect(resultado.erro).toContain("WhatsApp");
      // Só rodou 2x (a 2ª falhou e abortou; 3ª não rodou)
      expect(enviarWhatsApp).toHaveBeenCalledTimes(2);
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

    it("usa mensagem customizada interpolando variáveis", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "transferir", config: { mensagem: "Até já, {{nomeCliente}}!" } },
      ];

      const resultado = await executarCenario(passos, { nomeCliente: "Ana" }, exec);

      expect(resultado.sucesso).toBe(true);
      expect(resultado.contexto.transferir).toBe(true);
      expect(resultado.respostas[0]).toBe("Até já, Ana!");
    });

    it("mensagem vazia pausa o bot em silêncio (sem resposta)", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "transferir", config: { mensagem: "   " } },
      ];

      const resultado = await executarCenario(passos, {}, exec);

      expect(resultado.sucesso).toBe(true);
      expect(resultado.contexto.transferir).toBe(true);
      expect(resultado.respostas).toEqual([]);
    });
  });

  describe("agenda_criar", () => {
    it("usa o horário escolhido pelo cliente (agendamentoQuando) como data — não 'agora'", async () => {
      // Regressão: o horário que o cliente escolheu no Atendente IA não chegava
      // ao bloco de Agendamento, que então marcava em new Date() (agora). Agora
      // o Atendente IA grava `agendamentoQuando` (ISO) e o agenda_criar usa.
      const criarAgendamentoInterno = vi.fn().mockResolvedValue(38);
      const exec = criarMockExecutores({ criarAgendamentoInterno });
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "agenda_criar", config: { responsavelId: 9, duracaoMinutos: 60 } },
      ];
      const r = await executarCenario(
        passos,
        { nomeCliente: "Rafael", contatoId: 3224, agendamentoQuando: "2026-05-27T14:00:00-03:00" },
        exec,
      );
      expect(r.sucesso).toBe(true);
      expect(criarAgendamentoInterno).toHaveBeenCalledWith(
        expect.objectContaining({ dataInicio: "2026-05-27T17:00:00.000Z", dataFim: "2026-05-27T18:00:00.000Z" }),
      );
    });

    it("cfg.dataInicio (override do usuário) tem prioridade sobre agendamentoQuando", async () => {
      const criarAgendamentoInterno = vi.fn().mockResolvedValue(1);
      const exec = criarMockExecutores({ criarAgendamentoInterno });
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "agenda_criar", config: { responsavelId: 9, dataInicio: "2026-06-01T10:00:00-03:00", duracaoMinutos: 30 } },
      ];
      await executarCenario(passos, { agendamentoQuando: "2026-05-27T14:00:00-03:00" }, exec);
      expect(criarAgendamentoInterno).toHaveBeenCalledWith(
        expect.objectContaining({ dataInicio: "2026-06-01T13:00:00.000Z" }),
      );
    });

    it("cria compromisso na agenda interna com título interpolado e vincula o contato", async () => {
      const criarAgendamentoInterno = vi.fn().mockResolvedValue(555);
      const exec = criarMockExecutores({ criarAgendamentoInterno });
      const passos: Passo[] = [
        {
          id: 1,
          ordem: 1,
          tipo: "agenda_criar",
          config: { responsavelId: 9, titulo: "Consulta — {{nomeCliente}}", duracaoMinutos: 30 },
        },
      ];

      const resultado = await executarCenario(
        passos,
        { nomeCliente: "Maria", contatoId: 77, telefoneCliente: "5585999990000" },
        exec,
      );

      expect(resultado.sucesso).toBe(true);
      expect(resultado.contexto.agendamentoInternoId).toBe(555);
      expect(criarAgendamentoInterno).toHaveBeenCalledWith(
        expect.objectContaining({
          responsavelId: 9,
          tipo: "reuniao_comercial",
          titulo: "Consulta — Maria",
          contatoId: 77,
          contatoTelefone: "5585999990000",
        }),
      );
    });

    it("falha de forma clara sem responsável configurado", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "agenda_criar", config: {} },
      ];

      const resultado = await executarCenario(passos, { nomeCliente: "Ana" }, exec);

      expect(resultado.sucesso).toBe(false);
      expect(resultado.erro).toContain("responsável");
    });

    it("responsavelAuto usa o atendente do cliente (o que pegou o lead)", async () => {
      const criarAgendamentoInterno = vi.fn().mockResolvedValue(1);
      const exec = criarMockExecutores({ criarAgendamentoInterno });
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "agenda_criar", config: { responsavelAuto: true } },
      ];

      const resultado = await executarCenario(passos, { atendenteResponsavelId: 42 }, exec);

      expect(resultado.sucesso).toBe(true);
      expect(criarAgendamentoInterno).toHaveBeenCalledWith(expect.objectContaining({ responsavelId: 42 }));
    });

    it("responsavelVar resolve o ID a partir de uma variável", async () => {
      const criarAgendamentoInterno = vi.fn().mockResolvedValue(1);
      const exec = criarMockExecutores({ criarAgendamentoInterno });
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "agenda_criar", config: { responsavelVar: "{{atendenteResponsavelId}}" } },
      ];

      const resultado = await executarCenario(passos, { atendenteResponsavelId: 7 }, exec);

      expect(resultado.sucesso).toBe(true);
      expect(criarAgendamentoInterno).toHaveBeenCalledWith(expect.objectContaining({ responsavelId: 7 }));
    });

    it("horário ocupado: não cria e marca agendaDisponivel=false", async () => {
      const criarAgendamentoInterno = vi.fn().mockResolvedValue(1);
      const verificarDisponibilidadeAgenda = vi.fn().mockResolvedValue({ disponivel: false, conflitos: 1 });
      const exec = criarMockExecutores({ criarAgendamentoInterno, verificarDisponibilidadeAgenda });
      const passos: Passo[] = [
        {
          id: 1, ordem: 1, tipo: "agenda_criar",
          config: { responsavelId: 9, dataInicio: "2026-06-01T10:00:00Z", verificarDisponibilidade: true },
        },
      ];

      const resultado = await executarCenario(passos, { nomeCliente: "Ana", contatoId: 5 }, exec);

      expect(resultado.sucesso).toBe(true);
      expect(resultado.contexto.agendaDisponivel).toBe(false);
      expect(criarAgendamentoInterno).not.toHaveBeenCalled();
    });

    it("horário livre: cria e marca agendaDisponivel=true", async () => {
      const criarAgendamentoInterno = vi.fn().mockResolvedValue(99);
      const verificarDisponibilidadeAgenda = vi.fn().mockResolvedValue({ disponivel: true, conflitos: 0 });
      const exec = criarMockExecutores({ criarAgendamentoInterno, verificarDisponibilidadeAgenda });
      const passos: Passo[] = [
        {
          id: 1, ordem: 1, tipo: "agenda_criar",
          config: { responsavelId: 9, dataInicio: "2026-06-01T10:00:00Z", verificarDisponibilidade: true },
        },
      ];

      const resultado = await executarCenario(passos, { nomeCliente: "Ana", contatoId: 5 }, exec);

      expect(resultado.sucesso).toBe(true);
      expect(resultado.contexto.agendaDisponivel).toBe(true);
      expect(resultado.contexto.agendamentoInternoId).toBe(99);
      expect(verificarDisponibilidadeAgenda).toHaveBeenCalledWith(
        expect.objectContaining({ responsavelId: 9 }),
      );
    });

    it("ação verificar_horario só checa, não cria", async () => {
      const criarAgendamentoInterno = vi.fn().mockResolvedValue(1);
      const verificarDisponibilidadeAgenda = vi.fn().mockResolvedValue({ disponivel: true, conflitos: 0 });
      const exec = criarMockExecutores({ criarAgendamentoInterno, verificarDisponibilidadeAgenda });
      const passos: Passo[] = [
        {
          id: 1, ordem: 1, tipo: "agenda_criar",
          config: { acao: "verificar_horario", responsavelId: 9, dataInicio: "2026-06-01T10:00:00Z" },
        },
      ];

      const resultado = await executarCenario(passos, { contatoId: 5 }, exec);

      expect(resultado.sucesso).toBe(true);
      expect(resultado.contexto.agendaDisponivel).toBe(true);
      expect(verificarDisponibilidadeAgenda).toHaveBeenCalled();
      expect(criarAgendamentoInterno).not.toHaveBeenCalled();
    });

    it("ação consultar salva horários LIVRES em ISO no campo escolhido", async () => {
      const listarAgendaResponsavel = vi.fn().mockResolvedValue([]); // agenda vazia → tudo livre
      const criarAgendamentoInterno = vi.fn().mockResolvedValue(1);
      const exec = criarMockExecutores({ listarAgendaResponsavel, criarAgendamentoInterno });
      const passos: Passo[] = [
        {
          id: 1, ordem: 1, tipo: "agenda_criar",
          config: { acao: "consultar", responsavelId: 9, diasParaFrente: 7, duracaoSlotMinutos: 30, salvarEm: "agendaDoDr" },
        },
      ];

      const r = await executarCenario(passos, { contatoId: 5 }, exec);

      expect(r.sucesso).toBe(true);
      expect(criarAgendamentoInterno).not.toHaveBeenCalled();
      expect(listarAgendaResponsavel).toHaveBeenCalledWith(expect.objectContaining({ responsavelId: 9 }));
      const texto = String(r.contexto.agendaDoDr);
      expect(texto).toContain("LIVRES");
      expect(texto).toContain("-03:00"); // ISO com offset Brasília
      expect(Array.isArray(r.contexto.agendaSlotsLivres)).toBe(true);
      expect((r.contexto.agendaSlotsLivres as any[]).length).toBeGreaterThan(0);
    });

    it("ação consultar sem responsável falha com mensagem clara", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "agenda_criar", config: { acao: "consultar", salvarEm: "ag" } },
      ];
      const r = await executarCenario(passos, { contatoId: 5 }, exec);
      expect(r.sucesso).toBe(false);
      expect(r.erro).toContain("responsável");
    });

    it("ação cancelar marca o agendamento como cancelado", async () => {
      const editarAgendamentoInterno = vi.fn().mockResolvedValue(undefined);
      const exec = criarMockExecutores({ editarAgendamentoInterno });
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "agenda_criar", config: { acao: "cancelar" } },
      ];

      // usa o agendamentoInternoId do contexto (de um "agendar" anterior)
      const resultado = await executarCenario(passos, { agendamentoInternoId: 321 }, exec);

      expect(resultado.sucesso).toBe(true);
      expect(editarAgendamentoInterno).toHaveBeenCalledWith({ agendamentoId: 321, status: "cancelado" });
    });

    it("ação editar atualiza o agendamento informado", async () => {
      const editarAgendamentoInterno = vi.fn().mockResolvedValue(undefined);
      const exec = criarMockExecutores({ editarAgendamentoInterno });
      const passos: Passo[] = [
        {
          id: 1, ordem: 1, tipo: "agenda_criar",
          config: { acao: "editar", agendamentoIdVar: "42", dataInicio: "2026-07-01T14:00:00Z" },
        },
      ];

      const resultado = await executarCenario(passos, {}, exec);

      expect(resultado.sucesso).toBe(true);
      expect(editarAgendamentoInterno).toHaveBeenCalledWith(
        expect.objectContaining({ agendamentoId: 42, dataInicio: expect.any(String) }),
      );
    });

    it("editar/cancelar sem ID falha com mensagem clara", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "agenda_criar", config: { acao: "cancelar" } },
      ];

      const resultado = await executarCenario(passos, {}, exec); // sem agendamentoInternoId

      expect(resultado.sucesso).toBe(false);
      expect(resultado.erro).toContain("ID do agendamento");
    });
  });

  describe("responsável da agenda — cascata + consistência", () => {
    it("agenda_criar reaproveita o responsável resolvido pelo Atendente IA (não recalcula)", async () => {
      const criarAgendamentoInterno = vi.fn().mockResolvedValue(1);
      const resolverResponsavelAgenda = vi.fn().mockResolvedValue(70);
      const exec = criarMockExecutores({ criarAgendamentoInterno, resolverResponsavelAgenda });
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "agenda_criar", config: {} },
      ];

      const r = await executarCenario(passos, { contatoId: 5, agendaResponsavelResolvidoId: 88 }, exec);

      expect(r.sucesso).toBe(true);
      expect(criarAgendamentoInterno).toHaveBeenCalledWith(expect.objectContaining({ responsavelId: 88 }));
      // Reaproveita o valor do contexto — não chama a cascata de novo.
      expect(resolverResponsavelAgenda).not.toHaveBeenCalled();
    });

    it("agenda_criar sem nada explícito cai na cascata do escritório (nunca 'sem responsável')", async () => {
      const criarAgendamentoInterno = vi.fn().mockResolvedValue(1);
      const resolverResponsavelAgenda = vi.fn().mockResolvedValue(70);
      const exec = criarMockExecutores({ criarAgendamentoInterno, resolverResponsavelAgenda });
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "agenda_criar", config: {} },
      ];

      const r = await executarCenario(passos, { contatoId: 5, conversaId: 9, atendenteResponsavelId: 42 }, exec);

      expect(r.sucesso).toBe(true);
      expect(criarAgendamentoInterno).toHaveBeenCalledWith(expect.objectContaining({ responsavelId: 70 }));
      expect(resolverResponsavelAgenda).toHaveBeenCalledWith(
        expect.objectContaining({ contatoId: 5, conversaId: 9, atendenteResponsavelId: 42 }),
      );
    });

    it("advogado fixo no agenda_criar ignora a cascata", async () => {
      const criarAgendamentoInterno = vi.fn().mockResolvedValue(1);
      const resolverResponsavelAgenda = vi.fn().mockResolvedValue(70);
      const exec = criarMockExecutores({ criarAgendamentoInterno, resolverResponsavelAgenda });
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "agenda_criar", config: { responsavelId: 9 } },
      ];

      const r = await executarCenario(passos, { contatoId: 5, atendenteResponsavelId: 42 }, exec);

      expect(r.sucesso).toBe(true);
      expect(criarAgendamentoInterno).toHaveBeenCalledWith(expect.objectContaining({ responsavelId: 9 }));
      expect(resolverResponsavelAgenda).not.toHaveBeenCalled();
    });

    it("fluxo Atendente IA → Agendar marca com o MESMO responsável que ofereceu a agenda", async () => {
      const conversarComAgente = vi.fn().mockResolvedValue({ resposta: "Vou agendar!", acao: "agendar" });
      const resolverResponsavelAgenda = vi.fn().mockResolvedValue(55);
      const criarAgendamentoInterno = vi.fn().mockResolvedValue(900);
      const exec = criarMockExecutores({ conversarComAgente, resolverResponsavelAgenda, criarAgendamentoInterno });
      const passos: Passo[] = [
        {
          id: 1, ordem: 1, tipo: "ia_atendente", clienteId: "at",
          config: { agenteId: 7, ferramentas: ["agendar"] }, proximoSe: { agendar: "a" },
        },
        { id: 2, ordem: 2, tipo: "agenda_criar", clienteId: "a", config: {} },
      ];

      const r = await executarCenario(
        passos,
        { mensagem: "quero marcar", contatoId: 5, conversaId: 9 },
        exec,
      );

      expect(r.sucesso).toBe(true);
      expect(criarAgendamentoInterno).toHaveBeenCalledWith(expect.objectContaining({ responsavelId: 55 }));
      // Resolve 1x (no Atendente IA) e o Agendar reaproveita do contexto.
      expect(resolverResponsavelAgenda).toHaveBeenCalledTimes(1);
    });

    it("Atendente IA modo 'auto' resolve a agenda e repassa o responsável pro ver_horarios", async () => {
      const conversarComAgente = vi.fn().mockResolvedValue({ resposta: "ok", acao: null });
      const resolverResponsavelAgenda = vi.fn(async (p: any) => p.responsavelIdPreferido ?? p.atendenteResponsavelId ?? null);
      const exec = criarMockExecutores({ conversarComAgente, resolverResponsavelAgenda });
      const passos: Passo[] = [
        {
          id: 1, ordem: 1, tipo: "ia_atendente", clienteId: "at",
          config: { agenteId: 7, ferramentas: ["agendar"], consultas: ["ver_horarios"] },
        },
      ];

      const r = await executarCenario(passos, { mensagem: "oi", contatoId: 5, conversaId: 9, atendenteResponsavelId: 42 }, exec);

      expect(resolverResponsavelAgenda).toHaveBeenCalledWith(
        expect.objectContaining({ responsavelIdPreferido: null, atendenteResponsavelId: 42 }),
      );
      expect(conversarComAgente).toHaveBeenCalledWith(
        expect.objectContaining({ consultaConfig: expect.objectContaining({ responsavelId: 42 }) }),
      );
      expect(r.contexto.agendaResponsavelResolvidoId).toBe(42);
    });

    it("Atendente IA modo 'fixo' usa o advogado escolhido como preferido da cascata", async () => {
      const conversarComAgente = vi.fn().mockResolvedValue({ resposta: "ok", acao: null });
      const resolverResponsavelAgenda = vi.fn(async (p: any) => p.responsavelIdPreferido ?? null);
      const exec = criarMockExecutores({ conversarComAgente, resolverResponsavelAgenda });
      const passos: Passo[] = [
        {
          id: 1, ordem: 1, tipo: "ia_atendente", clienteId: "at",
          config: { agenteId: 7, consultas: ["ver_horarios"], consultaConfig: { responsavelModo: "fixo", responsavelId: 12 } },
        },
      ];

      const r = await executarCenario(passos, { mensagem: "oi", contatoId: 5, conversaId: 9, atendenteResponsavelId: 42 }, exec);

      expect(resolverResponsavelAgenda).toHaveBeenCalledWith(
        expect.objectContaining({ responsavelIdPreferido: 12 }),
      );
      expect(conversarComAgente).toHaveBeenCalledWith(
        expect.objectContaining({ consultaConfig: expect.objectContaining({ responsavelId: 12 }) }),
      );
      expect(r.contexto.agendaResponsavelResolvidoId).toBe(12);
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

    it("expande {cobrancasAbertas} via executor quando presente no template", async () => {
      const listaFormatada = "• R$ 100,00 — vence 20/04 — https://pay/abc";
      const buscarCobrancasAbertas = vi.fn().mockResolvedValue(listaFormatada);
      const exec = criarMockExecutores({ buscarCobrancasAbertas });
      const passos: Passo[] = [
        {
          id: 1,
          ordem: 1,
          tipo: "whatsapp_enviar",
          config: { template: "Oi {nome}, você tem estas pendências:\n{cobrancasAbertas}" },
        },
      ];

      const resultado = await executarCenario(
        passos,
        { nomeCliente: "João", contatoId: 42 },
        exec,
      );

      expect(resultado.sucesso).toBe(true);
      expect(buscarCobrancasAbertas).toHaveBeenCalledWith({ contatoId: 42, clienteAsaasId: undefined });
      expect(resultado.respostas[0]).toContain("Oi João");
      expect(resultado.respostas[0]).toContain(listaFormatada);
    });

    it("não chama buscarCobrancasAbertas se template não usa a variável", async () => {
      const buscarCobrancasAbertas = vi.fn();
      const exec = criarMockExecutores({ buscarCobrancasAbertas });
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "whatsapp_enviar", config: { template: "Olá {nome}" } },
      ];

      await executarCenario(passos, { nomeCliente: "X" }, exec);
      expect(buscarCobrancasAbertas).not.toHaveBeenCalled();
    });

    it("substitui {cobrancasAbertas} por string vazia se executor falha", async () => {
      const buscarCobrancasAbertas = vi.fn().mockRejectedValue(new Error("DB down"));
      const exec = criarMockExecutores({ buscarCobrancasAbertas });
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "whatsapp_enviar", config: { template: "Pendências:\n{cobrancasAbertas}" } },
      ];

      const resultado = await executarCenario(passos, { contatoId: 1 }, exec);
      expect(resultado.sucesso).toBe(true);
      expect(resultado.respostas[0]).toBe("Pendências:\n");
    });

    it("envia via exec.enviarWhatsApp quando contexto tem telefoneCliente e não tem canalId (gatilho não-mensagem)", async () => {
      const enviarWhatsApp = vi.fn().mockResolvedValue(true);
      const exec = criarMockExecutores({ enviarWhatsApp });
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "whatsapp_enviar", config: { template: "Olá {nome}" } },
      ];

      const r = await executarCenario(passos, { nomeCliente: "João", telefoneCliente: "5511999" }, exec);

      expect(r.sucesso).toBe(true);
      expect(enviarWhatsApp).toHaveBeenCalledWith("5511999", "Olá João");
    });

    it("NÃO chama exec.enviarWhatsApp quando canalId está no contexto (mensagem recebida)", async () => {
      // Nesse caso o whatsapp-handler é quem entrega as respostas via chatId —
      // o engine só coleta `resposta` no resultado.
      const enviarWhatsApp = vi.fn();
      const exec = criarMockExecutores({ enviarWhatsApp });
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "whatsapp_enviar", config: { template: "oi {nome}" } },
      ];

      const r = await executarCenario(
        passos,
        { nomeCliente: "Ana", telefoneCliente: "551122222", canalId: 42 },
        exec,
      );

      expect(r.sucesso).toBe(true);
      expect(enviarWhatsApp).not.toHaveBeenCalled();
      expect(r.respostas[0]).toBe("oi Ana");
    });

    it("falha com mensagem clara quando executor retorna false", async () => {
      const enviarWhatsApp = vi.fn().mockResolvedValue(false);
      const exec = criarMockExecutores({ enviarWhatsApp });
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "whatsapp_enviar", config: { template: "teste" } },
      ];

      const r = await executarCenario(passos, { telefoneCliente: "5511" }, exec);

      expect(r.sucesso).toBe(false);
      expect(r.erro).toContain("Falha ao enviar");
    });

    it("sem telefoneCliente nem canalId: só coleta resposta (comportamento legado)", async () => {
      const enviarWhatsApp = vi.fn();
      const exec = criarMockExecutores({ enviarWhatsApp });
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "whatsapp_enviar", config: { template: "teste" } },
      ];

      const r = await executarCenario(passos, {}, exec);

      expect(r.sucesso).toBe(true);
      expect(enviarWhatsApp).not.toHaveBeenCalled();
      expect(r.respostas[0]).toBe("teste");
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

  describe("definir_variavel", () => {
    it("guarda valor literal no contexto", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "definir_variavel", config: { chave: "etapa", valor: "confirmado" } },
      ];

      const resultado = await executarCenario(passos, {}, exec);

      expect(resultado.sucesso).toBe(true);
      expect(resultado.contexto.etapa).toBe("confirmado");
    });

    it("interpola variáveis no valor", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "definir_variavel", config: { chave: "saudacao", valor: "Olá {{nomeCliente}}" } },
      ];

      const resultado = await executarCenario(passos, { nomeCliente: "João" } as SmartflowContexto, exec);

      expect(resultado.sucesso).toBe(true);
      expect(resultado.contexto.saudacao).toBe("Olá João");
    });

    it("suporta dot-notation pra criar estrutura aninhada", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "definir_variavel", config: { chave: "fluxo.estado", valor: "aprovado" } },
      ];

      const resultado = await executarCenario(passos, {}, exec);

      expect(resultado.sucesso).toBe(true);
      expect((resultado.contexto.fluxo as any)?.estado).toBe("aprovado");
    });

    it("variável definida fica disponível pros passos seguintes", async () => {
      const enviarWhatsApp = vi.fn().mockResolvedValue(true);
      const exec = criarMockExecutores({ enviarWhatsApp });
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "definir_variavel", config: { chave: "saudacao", valor: "Bem-vindo" } },
        { id: 2, ordem: 2, tipo: "whatsapp_enviar", config: { template: "{{saudacao}}!" } },
      ];

      const resultado = await executarCenario(
        passos,
        { telefoneCliente: "5585999990000" } as SmartflowContexto,
        exec,
      );

      expect(resultado.sucesso).toBe(true);
      expect(enviarWhatsApp).toHaveBeenCalledWith("5585999990000", "Bem-vindo!");
    });

    it("falha quando chave está vazia", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "definir_variavel", config: { chave: "", valor: "x" } },
      ];

      const resultado = await executarCenario(passos, {}, exec);

      expect(resultado.sucesso).toBe(false);
      expect(resultado.erro).toMatch(/chave.*vazia/i);
    });

    it("falha quando chave tem caracteres inválidos", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "definir_variavel", config: { chave: "1invalida", valor: "x" } },
      ];

      const resultado = await executarCenario(passos, {}, exec);

      expect(resultado.sucesso).toBe(false);
      expect(resultado.erro).toMatch(/inválida/i);
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

    it("condição composta E: só bate quando TODOS os requisitos batem", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        {
          id: 1, ordem: 1, tipo: "condicional", clienteId: "c1",
          proximoSe: { cond_pronto: "agendar", fallback: "continua" },
          config: {
            condicoes: [
              {
                id: "pronto",
                logica: "E",
                requisitos: [
                  { campo: "confirmacao_agendamento", operador: "igual", valor: "SIM" },
                  { campo: "first_name", operador: "existe" },
                  { campo: "data_agendamento", operador: "existe" },
                ],
              },
            ],
          },
        },
        { id: 2, ordem: 2, tipo: "whatsapp_enviar", clienteId: "agendar", config: { template: "AGENDAR" } },
        { id: 3, ordem: 3, tipo: "whatsapp_enviar", clienteId: "continua", config: { template: "CONTINUA" } },
      ];

      // Falta a data → não bate → fallback
      const rFalta = await executarCenario(
        passos,
        { confirmacao_agendamento: "SIM", first_name: "Ana" },
        exec,
      );
      expect(rFalta.respostas.join("|")).toBe("CONTINUA");

      // Tudo presente → bate
      const rOk = await executarCenario(
        passos,
        { confirmacao_agendamento: "SIM", first_name: "Ana", data_agendamento: "2026-06-01" },
        exec,
      );
      expect(rOk.respostas.join("|")).toBe("AGENDAR");
    });

    it("condição composta OU: basta um requisito bater", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        {
          id: 1, ordem: 1, tipo: "condicional", clienteId: "c1",
          proximoSe: { cond_transf: "transferir", fallback: "segue" },
          config: {
            condicoes: [
              {
                id: "transf",
                logica: "OU",
                requisitos: [
                  { campo: "motivo", operador: "igual", valor: "TRANSFERIR" },
                  { campo: "conteudo_sexual", operador: "igual", valor: "SIM" },
                ],
              },
            ],
          },
        },
        { id: 2, ordem: 2, tipo: "whatsapp_enviar", clienteId: "transferir", config: { template: "TRANSF" } },
        { id: 3, ordem: 3, tipo: "whatsapp_enviar", clienteId: "segue", config: { template: "SEGUE" } },
      ];

      const rUm = await executarCenario(passos, { conteudo_sexual: "SIM" }, exec);
      expect(rUm.respostas.join("|")).toBe("TRANSF");

      const rNenhum = await executarCenario(passos, { motivo: "DUVIDA" }, exec);
      expect(rNenhum.respostas.join("|")).toBe("SEGUE");
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

  describe("kanban_mover_card", () => {
    it("move card pra coluna destino usando ctx.kanbanCardId quando cardId vazio", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "kanban_mover_card", config: { colunaDestinoId: 7 } },
      ];

      const resultado = await executarCenario(passos, { kanbanCardId: 42 }, exec);

      expect(resultado.sucesso).toBe(true);
      expect(exec.moverCardKanban).toHaveBeenCalledWith({ cardId: 42, colunaDestinoId: 7 });
    });

    it("interpola cardId via {{...}}", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "kanban_mover_card", config: { cardId: "{{kanbanCardId}}", colunaDestinoId: 9 } },
      ];

      const resultado = await executarCenario(passos, { kanbanCardId: 88 }, exec);

      expect(resultado.sucesso).toBe(true);
      expect(exec.moverCardKanban).toHaveBeenCalledWith({ cardId: 88, colunaDestinoId: 9 });
    });

    it("falha quando cardId não pode ser resolvido", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "kanban_mover_card", config: { colunaDestinoId: 7 } },
      ];

      const resultado = await executarCenario(passos, {}, exec);

      expect(resultado.sucesso).toBe(false);
      expect(exec.moverCardKanban).not.toHaveBeenCalled();
    });

    it("falha quando colunaDestinoId está ausente", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "kanban_mover_card", config: {} },
      ];

      const resultado = await executarCenario(passos, { kanbanCardId: 5 }, exec);

      expect(resultado.sucesso).toBe(false);
    });
  });

  describe("kanban_atribuir_responsavel", () => {
    it("usa responsavelId explícito quando configurado", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "kanban_atribuir_responsavel", config: { responsavelId: 12 } },
      ];

      const resultado = await executarCenario(passos, { kanbanCardId: 5 }, exec);

      expect(resultado.sucesso).toBe(true);
      expect(exec.atribuirResponsavelKanban).toHaveBeenCalledWith({ cardId: 5, responsavelId: 12 });
    });

    it("usa atendenteResponsavelId quando responsavelAuto não é falso", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "kanban_atribuir_responsavel", config: {} },
      ];

      const resultado = await executarCenario(
        passos,
        { kanbanCardId: 5, atendenteResponsavelId: 99 },
        exec,
      );

      expect(resultado.sucesso).toBe(true);
      expect(exec.atribuirResponsavelKanban).toHaveBeenCalledWith({ cardId: 5, responsavelId: 99 });
    });

    it("falha quando nenhum responsável pode ser resolvido", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "kanban_atribuir_responsavel", config: { responsavelAuto: false } },
      ];

      const resultado = await executarCenario(passos, { kanbanCardId: 5 }, exec);

      expect(resultado.sucesso).toBe(false);
      expect(exec.atribuirResponsavelKanban).not.toHaveBeenCalled();
    });
  });

  describe("kanban_tags", () => {
    it("adiciona tags com modo default", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "kanban_tags", config: { tags: "VIP, urgente" } },
      ];

      const resultado = await executarCenario(passos, { kanbanCardId: 5 }, exec);

      expect(resultado.sucesso).toBe(true);
      expect(exec.atualizarTagsCardKanban).toHaveBeenCalledWith({
        cardId: 5,
        tags: ["VIP", "urgente"],
        modo: "adicionar",
      });
    });

    it("interpola variáveis nas tags", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "kanban_tags", config: { tags: "{{intencao}}, novo", modo: "definir" } },
      ];

      const resultado = await executarCenario(
        passos,
        { kanbanCardId: 5, intencao: "agendar" },
        exec,
      );

      expect(resultado.sucesso).toBe(true);
      expect(exec.atualizarTagsCardKanban).toHaveBeenCalledWith({
        cardId: 5,
        tags: ["agendar", "novo"],
        modo: "definir",
      });
    });

    it("modo definir aceita lista vazia (limpa tags)", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "kanban_tags", config: { tags: "", modo: "definir" } },
      ];

      const resultado = await executarCenario(passos, { kanbanCardId: 5 }, exec);

      expect(resultado.sucesso).toBe(true);
      expect(exec.atualizarTagsCardKanban).toHaveBeenCalledWith({
        cardId: 5,
        tags: [],
        modo: "definir",
      });
    });
  });

  describe("condicional com dot-notation", () => {
    it("resolve campo aninhado via cliente.nome", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        {
          id: 1, ordem: 1, tipo: "condicional",
          config: { campo: "cliente.nome", operador: "igual", valor: "Maria" },
        },
        { id: 2, ordem: 2, tipo: "kanban_criar_card", config: {} },
      ];

      const resultado = await executarCenario(
        passos,
        { cliente: { nome: "Maria" } } as any,
        exec,
      );

      expect(resultado.passosExecutados).toBe(2);
      expect(exec.criarCardKanban).toHaveBeenCalled();
    });

    it("resolve campo personalizado via cliente.campos.oab", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        {
          id: 1, ordem: 1, tipo: "condicional",
          config: { campo: "cliente.campos.oab", operador: "existe" },
        },
        { id: 2, ordem: 2, tipo: "kanban_criar_card", config: {} },
      ];

      const resultado = await executarCenario(
        passos,
        { cliente: { campos: { oab: "12345" } } } as any,
        exec,
      );

      expect(resultado.passosExecutados).toBe(2);
    });

    it("path inexistente não quebra (nao_existe passa)", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        {
          id: 1, ordem: 1, tipo: "condicional",
          config: { campo: "cliente.campos.inexistente", operador: "nao_existe" },
        },
        { id: 2, ordem: 2, tipo: "kanban_criar_card", config: {} },
      ];

      const resultado = await executarCenario(passos, {}, exec);

      expect(resultado.passosExecutados).toBe(2);
    });

    it("operador maior funciona com path aninhado", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        {
          id: 1, ordem: 1, tipo: "condicional",
          config: { campo: "pagamento.valor", operador: "maior", valor: "1000" },
        },
        { id: 2, ordem: 2, tipo: "kanban_criar_card", config: {} },
      ];

      const resultado = await executarCenario(
        passos,
        { pagamento: { valor: 5000 } } as any,
        exec,
      );

      expect(resultado.passosExecutados).toBe(2);
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

  describe("asaas_gerar_cobranca", () => {
    it("gera cobrança e grava pagamentoId no contexto", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        {
          id: 1, ordem: 1, tipo: "asaas_gerar_cobranca",
          config: { valor: "1500.00", descricao: "Honorários", tipoCobranca: "PIX" },
        },
      ];

      const resultado = await executarCenario(passos, { contatoId: 42 }, exec);

      expect(resultado.sucesso).toBe(true);
      expect(resultado.contexto.pagamentoId).toBe("pay_abc123");
      expect(resultado.contexto.pagamentoLink).toBe("https://asaas.com/i/pay_abc123");
      expect(exec.gerarCobrancaAsaas).toHaveBeenCalledWith({
        contatoId: 42,
        valor: 1500,
        descricao: "Honorários",
        vencimentoDias: undefined,
        tipoCobranca: "PIX",
      });
    });

    it("interpola valor a partir do contexto", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        {
          id: 1, ordem: 1, tipo: "asaas_gerar_cobranca",
          config: { valor: "{{pagamentoValor}}" },
        },
      ];
      const resultado = await executarCenario(
        passos,
        { contatoId: 42, pagamentoValor: 250 },
        exec,
      );
      expect(resultado.sucesso).toBe(true);
      expect((exec.gerarCobrancaAsaas as any).mock.calls[0][0].valor).toBe(250);
    });

    it("falha quando valor inválido", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "asaas_gerar_cobranca", config: { valor: "abc" } },
      ];
      const resultado = await executarCenario(passos, { contatoId: 42 }, exec);
      expect(resultado.sucesso).toBe(false);
      expect(exec.gerarCobrancaAsaas).not.toHaveBeenCalled();
    });

    it("falha quando contatoId ausente", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "asaas_gerar_cobranca", config: { valor: "100" } },
      ];
      const resultado = await executarCenario(passos, {}, exec);
      expect(resultado.sucesso).toBe(false);
    });
  });

  describe("asaas_cancelar_cobranca", () => {
    it("cancela usando ctx.pagamentoId quando config vazia", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "asaas_cancelar_cobranca", config: {} },
      ];
      const resultado = await executarCenario(passos, { pagamentoId: "pay_xyz" }, exec);
      expect(resultado.sucesso).toBe(true);
      expect(exec.cancelarCobrancaAsaas).toHaveBeenCalledWith({ pagamentoId: "pay_xyz" });
    });

    it("interpola pagamentoId via {{...}}", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "asaas_cancelar_cobranca",
          config: { pagamentoId: "{{pagamentoId}}" } },
      ];
      const resultado = await executarCenario(passos, { pagamentoId: "pay_999" }, exec);
      expect(resultado.sucesso).toBe(true);
      expect(exec.cancelarCobrancaAsaas).toHaveBeenCalledWith({ pagamentoId: "pay_999" });
    });
  });

  describe("asaas_consultar_valor_aberto", () => {
    it("escreve resumo financeiro no contexto", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "asaas_consultar_valor_aberto", config: {} },
      ];
      const resultado = await executarCenario(passos, { contatoId: 42 }, exec);
      expect(resultado.sucesso).toBe(true);
      expect(resultado.contexto.valorTotalAberto).toBe(2000); // pendente 1500 + vencido 500
      expect(resultado.contexto.valorTotalVencido).toBe(500);
      expect(resultado.contexto.cobrancasAbertasQtd).toBe(2);
    });

    it("falha quando contatoId ausente", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "asaas_consultar_valor_aberto", config: {} },
      ];
      const resultado = await executarCenario(passos, {}, exec);
      expect(resultado.sucesso).toBe(false);
    });
  });

  describe("asaas_marcar_recebida", () => {
    it("marca recebida usando valor opcional", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "asaas_marcar_recebida",
          config: { pagamentoId: "pay_1", valorRecebido: "1500.00" } },
      ];
      const resultado = await executarCenario(passos, {}, exec);
      expect(resultado.sucesso).toBe(true);
      expect(exec.marcarCobrancaRecebidaAsaas).toHaveBeenCalledWith({
        pagamentoId: "pay_1",
        valorRecebido: 1500,
        dataRecebimento: undefined,
      });
    });

    it("aceita pagamentoId via interpolação", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "asaas_marcar_recebida",
          config: { pagamentoId: "{{pagamentoId}}" } },
      ];
      const resultado = await executarCenario(passos, { pagamentoId: "pay_X" }, exec);
      expect(resultado.sucesso).toBe(true);
      expect((exec.marcarCobrancaRecebidaAsaas as any).mock.calls[0][0].pagamentoId).toBe("pay_X");
    });

    it("falha quando pagamentoId ausente", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "asaas_marcar_recebida", config: {} },
      ];
      const resultado = await executarCenario(passos, {}, exec);
      expect(resultado.sucesso).toBe(false);
    });
  });

  describe("definir_campo_personalizado", () => {
    it("persiste o campo + espelha em ctx.cliente.campos", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "definir_campo_personalizado",
          config: { chave: "oab", valor: "12345" } },
      ];
      const resultado = await executarCenario(passos, { contatoId: 7 }, exec);
      expect(resultado.sucesso).toBe(true);
      expect(exec.definirCampoPersonalizadoCliente).toHaveBeenCalledWith({
        contatoId: 7,
        chave: "oab",
        valor: "12345",
      });
      const cliente = resultado.contexto.cliente as any;
      expect(cliente?.campos?.oab).toBe("12345");
    });

    it("interpola valor via {{...}}", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "definir_campo_personalizado",
          config: { chave: "ultimaIntencao", valor: "{{intencao}}" } },
      ];
      const resultado = await executarCenario(
        passos,
        { contatoId: 7, intencao: "agendar" },
        exec,
      );
      expect(resultado.sucesso).toBe(true);
      expect((exec.definirCampoPersonalizadoCliente as any).mock.calls[0][0].valor).toBe("agendar");
    });

    it("falha quando chave vazia", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "definir_campo_personalizado", config: { valor: "x" } },
      ];
      const resultado = await executarCenario(passos, { contatoId: 7 }, exec);
      expect(resultado.sucesso).toBe(false);
      expect(exec.definirCampoPersonalizadoCliente).not.toHaveBeenCalled();
    });

    it("falha quando contatoId ausente", async () => {
      const exec = criarMockExecutores();
      const passos: Passo[] = [
        { id: 1, ordem: 1, tipo: "definir_campo_personalizado",
          config: { chave: "oab", valor: "x" } },
      ];
      const resultado = await executarCenario(passos, {}, exec);
      expect(resultado.sucesso).toBe(false);
    });
  });
});
