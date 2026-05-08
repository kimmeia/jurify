/**
 * Pilares — 8 features-core do produto, em grid 4x2.
 *
 * Cada card tem ícone, título curto e 1 frase. Nada longo: o
 * objetivo é o visitante varrer o grid e perceber a amplitude do
 * produto sem ler tudo. Para detalhes, próxima seção (Demo).
 */

import {
  Users,
  MessageCircle,
  Wallet,
  TrendingUp,
  FileText,
  Calculator,
  Bot,
  FileSearch,
} from "lucide-react";

const pilares = [
  {
    icon: Users,
    titulo: "CRM jurídico",
    desc: "Cadastro completo de cliente: CPF, profissão, estado civil, endereço estruturado — pronto pra contrato.",
    tom: "info",
  },
  {
    icon: MessageCircle,
    titulo: "Atendimento centralizado",
    desc: "WhatsApp, Instagram e e-mail num inbox único. Conversa cai no atendente certo, automaticamente.",
    tom: "accent",
  },
  {
    icon: Wallet,
    titulo: "Financeiro com Asaas",
    desc: "Pix, boleto, cartão — emissão direto na plataforma. + Cobrança manual offline pra dinheiro/transferência.",
    tom: "success",
  },
  {
    icon: TrendingUp,
    titulo: "Comissões automáticas",
    desc: "Atendente fechou? Sistema calcula a comissão e gera despesa pendente. Sem planilha, sem briga no fim do mês.",
    tom: "success",
  },
  {
    icon: FileText,
    titulo: "Modelos de contrato",
    desc: "DOCX com placeholders {{1}}, {{2}}... mapeia pra dados do cliente ou pra preenchimento manual na hora.",
    tom: "warning",
  },
  {
    icon: Calculator,
    titulo: "Cálculos jurídicos",
    desc: "Bancário, trabalhista, tributário, previdenciário, monetário, imobiliário. Resultado em PDF, pronto pra petição.",
    tom: "info",
  },
  {
    icon: Bot,
    titulo: "SmartFlow + Agentes IA",
    desc: "Cobra inadimplente sozinho, qualifica lead novo, responde dúvida técnica. Trabalho 24h.",
    tom: "accent",
  },
  {
    icon: FileSearch,
    titulo: "Processos & Kanban",
    desc: "Monitoramento por CPF/CNPJ via motor próprio, kanban de prazos, alertas de movimentação. Não perde audiência.",
    tom: "warning",
  },
] as const;

const TOM_CLS: Record<string, { bg: string; fg: string }> = {
  info: { bg: "bg-info-bg", fg: "text-info-fg" },
  success: { bg: "bg-success-bg", fg: "text-success-fg" },
  warning: { bg: "bg-warning-bg", fg: "text-warning-fg" },
  accent: { bg: "bg-accent-purple-bg", fg: "text-accent-purple-fg" },
};

export function Pilares() {
  return (
    <section className="bg-muted/30 border-y">
      <div className="max-w-6xl mx-auto px-4 py-20 lg:py-28">
        <div className="text-center max-w-2xl mx-auto mb-14">
          <p className="text-sm font-semibold text-primary uppercase tracking-wide mb-3">
            Tudo num só lugar
          </p>
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
            8 módulos que conversam entre si
          </h2>
          <p className="text-muted-foreground mt-4 text-lg">
            Sem integração frágil entre 5 ferramentas. Cliente cadastrado aqui
            já aparece na cobrança, no contrato e no SmartFlow.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {pilares.map((p) => {
            const cls = TOM_CLS[p.tom];
            return (
              <div
                key={p.titulo}
                className="group rounded-xl border bg-card p-5 hover:shadow-md hover:border-foreground/20 transition-all"
              >
                <div
                  className={`h-11 w-11 rounded-lg ${cls.bg} ${cls.fg} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}
                >
                  <p.icon className="h-5 w-5" />
                </div>
                <h3 className="font-semibold mb-1.5">{p.titulo}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{p.desc}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
