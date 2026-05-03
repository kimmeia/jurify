/**
 * Comparativo — 3 razões pra trocar Astrea/Aurum/Excel pelo Jurify.
 *
 * Sem desmoralizar concorrente diretamente (anti-padrão de marketing
 * jurídico) — fala dos diferenciais técnicos do Jurify que outros
 * não têm.
 */

import { CheckCircle2, Wallet, Bot, Vote } from "lucide-react";

const diffs = [
  {
    icon: Wallet,
    titulo: "Asaas embutido",
    desc: "Não é só geração de boleto: é financeiro completo com Pix nativo, cartão, cobrança recorrente, comissão por atendente e fluxo de caixa.",
    bullets: [
      "Pix instantâneo, sem taxa fixa por boleto",
      "Webhook em tempo real (cliente pagou → comissão lançada)",
      "Cobrança manual offline (dinheiro/transferência)",
    ],
  },
  {
    icon: Bot,
    titulo: "IA nativa, não plugin",
    desc: "Agentes que respondem cliente no WhatsApp, qualificam leads e cobram inadimplentes. Treinados com seus documentos do escritório.",
    bullets: [
      "SmartFlow visual: arrasta passos sem código",
      "Agentes específicos por área (cível, trabalhista...)",
      "Aprende com seus contratos e jurisprudência",
    ],
  },
  {
    icon: Vote,
    titulo: "Roadmap público",
    desc: "Você vota nas próximas features. Sugere o que precisa. Nada de \"está na nossa roadmap\" sem prazo. Transparência total.",
    bullets: [
      "Sugestões com upvote dos usuários",
      "Status visível: análise → planejado → em dev → lançado",
      "Comunidade direta com o time de produto",
    ],
  },
];

export function Comparativo() {
  return (
    <section className="bg-muted/30 border-y">
      <div className="max-w-6xl mx-auto px-4 py-20 lg:py-28">
        <div className="text-center max-w-2xl mx-auto mb-14">
          <p className="text-sm font-semibold text-primary uppercase tracking-wide mb-3">
            Por que sair do que você usa hoje
          </p>
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
            3 coisas que ninguém mais faz
          </h2>
          <p className="text-muted-foreground mt-4 text-lg">
            Software jurídico tradicional foca em CRM ou peticionamento. O
            Jurify foi construído pra ser o sistema operacional inteiro.
          </p>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {diffs.map((d) => (
            <div
              key={d.titulo}
              className="rounded-2xl border bg-card p-7 flex flex-col"
            >
              <div className="h-12 w-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-5">
                <d.icon className="h-6 w-6" />
              </div>
              <h3 className="text-xl font-bold mb-3">{d.titulo}</h3>
              <p className="text-sm text-muted-foreground mb-5 leading-relaxed">
                {d.desc}
              </p>
              <ul className="space-y-2 mt-auto">
                {d.bullets.map((b) => (
                  <li key={b} className="flex items-start gap-2 text-sm">
                    <CheckCircle2 className="h-4 w-4 text-success flex-shrink-0 mt-0.5" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
