/**
 * Templates de cenários SmartFlow — fluxos pré-montados que o usuário
 * escolhe ao criar um cenário novo, em vez de começar do canvas vazio.
 *
 * Cada template define gatilho + passos prontos (com config preenchida).
 * Passos lineares (sem `proximoSe`) executam por ordem — o editor
 * reconstrói as edges visuais automaticamente. Templates com ramificação
 * declaram `proximoSe` referenciando `clienteId` dos passos.
 *
 * Usado pelo modal de galeria na página SmartFlow + pela procedure
 * `smartflow.criarDeTemplate` que materializa o cenário no banco.
 */

import type { GatilhoSmartflow, TipoPasso } from "./smartflow-types";

export interface PassoTemplate {
  /** UUID estável dentro do template — vira `clienteId` do passo no banco. */
  clienteId: string;
  tipo: TipoPasso;
  config: Record<string, unknown>;
  /** Ramo→clienteId pra fluxos com ramificação. Omitir = linear por ordem. */
  proximoSe?: Record<string, string>;
}

export interface TemplateSmartflow {
  id: string;
  nome: string;
  descricao: string;
  /** Nome do ícone lucide (resolvido no frontend). */
  icone: string;
  /** Gradiente Tailwind do avatar (ex: "from-blue-500 to-cyan-500"). */
  gradiente: string;
  gatilho: GatilhoSmartflow;
  configGatilho?: Record<string, unknown>;
  passos: PassoTemplate[];
  badge?: "popular" | "novo";
  /** Explica em 1 linha o que o usuário deve ajustar depois de criar. */
  dica?: string;
}

export const TEMPLATES_SMARTFLOW: ReadonlyArray<TemplateSmartflow> = [
  {
    id: "atendimento_processo",
    nome: "Atendimento sobre processo",
    descricao:
      "Cliente pergunta sobre a ação dele. A IA identifica o CPF, confere o cadastro, lista as ações e responde com as movimentações.",
    icone: "message-circle-heart",
    gradiente: "from-blue-500 to-cyan-500",
    gatilho: "mensagem_canal",
    badge: "popular",
    dica: "Ajuste o prompt do passo 'Responder com IA' pro tom do seu escritório.",
    passos: [
      {
        clienteId: "tpl-ap-1",
        tipo: "crm_listar_acoes_cliente",
        config: { tipoFiltro: "todos", poloFiltro: "todos", limite: 10 },
      },
      {
        clienteId: "tpl-ap-2",
        tipo: "processo_buscar_movimentacoes",
        config: { processoId: "{{acaoId}}", diasJanela: 30, limite: 5 },
      },
      {
        clienteId: "tpl-ap-3",
        tipo: "ia_responder",
        config: {
          prompt:
            "Você é um atendente jurídico. Responda a dúvida do cliente sobre o andamento do processo dele de forma clara e acolhedora, usando as movimentações disponíveis no contexto. Não invente informação que não esteja nos dados.",
        },
      },
      {
        clienteId: "tpl-ap-4",
        tipo: "whatsapp_enviar",
        config: { template: "{{respostaIA}}" },
      },
    ],
  },
  {
    id: "captacao_dados",
    nome: "Captação de dados do cliente",
    descricao:
      "Quando o cliente manda mensagem, a IA identifica e salva CPF, e-mail e telefone direto no cadastro — sem digitação manual.",
    icone: "user-plus",
    gradiente: "from-fuchsia-500 to-purple-500",
    gatilho: "mensagem_canal",
    badge: "novo",
    dica: "Cadastre os campos personalizados (CPF, etc.) em Configurações antes de usar.",
    passos: [
      {
        clienteId: "tpl-cd-1",
        tipo: "ia_extrair_campos",
        config: {
          fonteMensagem: "mensagem",
          campos: [
            { chave: "cpf", tipo: "cpf", descricao: "CPF do cliente", persistir: true },
            { chave: "email", tipo: "email", descricao: "E-mail do cliente", persistir: true },
          ],
        },
      },
      {
        clienteId: "tpl-cd-2",
        tipo: "whatsapp_enviar",
        config: { template: "Obrigado, {{nomeCliente}}! Já registrei seus dados. 👍" },
      },
    ],
  },
  {
    id: "pagamento_kanban",
    nome: "Pagamento recebido → Kanban",
    descricao:
      "Quando o cliente paga, agradece por WhatsApp e cria um card no Kanban automaticamente.",
    icone: "dollar-sign",
    gradiente: "from-emerald-500 to-teal-600",
    gatilho: "pagamento_recebido",
    dica: "Escolha o funil/coluna do card no passo 'Criar card Kanban'.",
    passos: [
      {
        clienteId: "tpl-pk-1",
        tipo: "whatsapp_enviar",
        config: {
          template:
            "Olá {{nomeCliente}}! Confirmamos o recebimento do seu pagamento de {{pagamentoDescricao}}. Obrigado pela confiança! 🙏",
        },
      },
      {
        clienteId: "tpl-pk-2",
        tipo: "kanban_criar_card",
        config: {
          titulo: "Pagamento — {{nomeCliente}}",
          prioridade: "media",
          responsavelAuto: true,
        },
      },
    ],
  },
  {
    id: "cobranca_atraso",
    nome: "Cobrar quem atrasou",
    descricao:
      "Alguns dias após o vencimento, manda uma mensagem amigável lembrando da cobrança em aberto.",
    icone: "alert-triangle",
    gradiente: "from-amber-500 to-red-500",
    gatilho: "pagamento_vencido",
    configGatilho: { diasAtraso: 3 },
    dica: "Ajuste 'dias de atraso' no gatilho e o tom da mensagem.",
    passos: [
      {
        clienteId: "tpl-ca-1",
        tipo: "whatsapp_enviar",
        config: {
          template:
            "Olá {{nomeCliente}}, tudo bem? Notamos que a cobrança de {{pagamentoDescricao}} (venceu em {{vencimento}}) ainda está em aberto. Qualquer dúvida, estamos à disposição!",
        },
      },
    ],
  },
  {
    id: "lembrete_reuniao",
    nome: "Lembrete antes da reunião",
    descricao:
      "Um dia antes do agendamento no Cal.com, envia um WhatsApp lembrando o cliente da reunião.",
    icone: "calendar-clock",
    gradiente: "from-orange-500 to-amber-500",
    gatilho: "agendamento_lembrete",
    configGatilho: { diasAntes: 1, horario: "18:00" },
    dica: "Ajuste quantos dias antes e o horário do lembrete no gatilho.",
    passos: [
      {
        clienteId: "tpl-lr-1",
        tipo: "whatsapp_enviar",
        config: {
          template:
            "Olá {{nomeCliente}}! Passando pra lembrar da nossa reunião marcada para {{horarioEscolhido}}. Até lá! 📅",
        },
      },
    ],
  },
  {
    id: "boas_vindas_lead",
    nome: "Boas-vindas a novo lead",
    descricao:
      "Quando um contato novo aparece no CRM, manda uma saudação e abre um card de triagem no Kanban.",
    icone: "sparkles",
    gradiente: "from-violet-500 to-pink-500",
    gatilho: "novo_lead",
    dica: "Personalize a mensagem de boas-vindas e o funil de triagem.",
    passos: [
      {
        clienteId: "tpl-bl-1",
        tipo: "whatsapp_enviar",
        config: {
          template:
            "Olá {{nomeCliente}}! Seja bem-vindo(a). Recebemos seu contato e em breve um de nossos especialistas vai falar com você. 😊",
        },
      },
      {
        clienteId: "tpl-bl-2",
        tipo: "kanban_criar_card",
        config: { titulo: "Triagem — {{nomeCliente}}", prioridade: "media", responsavelAuto: true },
      },
    ],
  },
];

export function getTemplate(id: string): TemplateSmartflow | null {
  return TEMPLATES_SMARTFLOW.find((t) => t.id === id) ?? null;
}
