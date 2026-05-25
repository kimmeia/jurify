/**
 * Diferenciais — 3 coisas que software jurídico tradicional não faz.
 * Fala dos diferenciais técnicos do JuridFlow, sem desmoralizar concorrente.
 */

import { CheckCircle2, Wallet, BrainCircuit, FileSearch } from "lucide-react";

const diffs = [
  {
    icon: Wallet,
    titulo: "Asaas embutido",
    desc: "Não é só geração de boleto: é financeiro completo com Pix nativo, cartão, recorrência e comissão por atendente.",
    bullets: [
      "Pix instantâneo, sem taxa fixa por boleto",
      "Webhook: cliente pagou → comissão lançada",
      "Cobrança manual offline (dinheiro/transf.)",
    ],
  },
  {
    icon: BrainCircuit,
    titulo: "IA nativa, não plugin",
    desc: "Agentes que respondem no WhatsApp, qualificam leads e cobram inadimplentes — treinados com os documentos do seu escritório.",
    bullets: [
      "SmartFlow visual: arrasta passos, sem código",
      "Brief instantâneo + resposta sugerida",
      "Compliance Guard contra promessa de resultado",
    ],
  },
  {
    icon: FileSearch,
    titulo: "Motor próprio de processos",
    desc: "Monitora processos por CPF/CNPJ direto nos tribunais, com análise estratégica por IA e mensagem pronta pro cliente.",
    bullets: [
      "Alertas de movimentação por palavra-chave",
      "Cofre de credenciais OAB (segredo de justiça)",
      "Roadmap público: você vota nas próximas features",
    ],
  },
];

export function Comparativo() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-24">
      <div className="mx-auto mb-12 max-w-2xl text-center">
        <p className="text-sm font-bold uppercase tracking-[0.08em] text-violet-600">
          Por que sair do que você usa hoje
        </p>
        <h2 className="font-display mt-3 text-3xl font-extrabold tracking-tight md:text-4xl">
          3 coisas que ninguém mais faz
        </h2>
        <p className="mt-4 text-lg text-muted-foreground">
          Software jurídico tradicional foca em CRM ou peticionamento. O JuridFlow foi
          construído pra ser o sistema operacional inteiro do escritório.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {diffs.map((d) => (
          <div key={d.titulo} className="flex flex-col rounded-2xl border bg-card p-7">
            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-violet-100">
              <d.icon className="h-6 w-6 text-violet-600" />
            </div>
            <h3 className="font-display mb-3 text-xl font-bold">{d.titulo}</h3>
            <p className="mb-5 text-sm leading-relaxed text-muted-foreground">{d.desc}</p>
            <ul className="mt-auto space-y-2.5">
              {d.bullets.map((b) => (
                <li key={b} className="flex items-start gap-2 text-sm">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
