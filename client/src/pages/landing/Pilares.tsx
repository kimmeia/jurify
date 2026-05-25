/**
 * Módulos — 8 features-core do produto em grid 4x2.
 * O visitante varre o grid e percebe a amplitude do produto.
 */

import {
  Users,
  Headphones,
  DollarSign,
  TrendingUp,
  FileText,
  Calculator,
  FileSearch,
  Zap,
} from "lucide-react";

const modulos = [
  { icon: Users, titulo: "CRM jurídico", desc: "Cadastro completo: CPF/CNPJ, profissão, estado civil, endereço — pronto pra contrato." },
  { icon: Headphones, titulo: "Atendimento", desc: "WhatsApp, Instagram e e-mail num inbox único, com brief de IA e linha do tempo unificada." },
  { icon: DollarSign, titulo: "Financeiro + Asaas", desc: "Pix, boleto e cartão emitidos na plataforma. Cobrança recorrente e fluxo de caixa." },
  { icon: TrendingUp, titulo: "Comissões", desc: "Atendente fechou? O sistema calcula a comissão e lança a despesa. Sem planilha." },
  { icon: FileText, titulo: "Modelos de contrato", desc: "DOCX com placeholders que mapeiam pro cadastro ou pra preenchimento na hora." },
  { icon: Calculator, titulo: "Cálculos jurídicos", desc: "Bancário, trabalhista, tributário, previdenciário, imobiliário. Resultado em PDF." },
  { icon: FileSearch, titulo: "Processos & Kanban", desc: "Monitoramento por CPF/CNPJ com motor próprio, alertas de movimentação e prazos." },
  { icon: Zap, titulo: "SmartFlow + Agentes IA", desc: "Cobra inadimplente, qualifica lead e responde dúvida técnica. Automação 24h." },
] as const;

export function Pilares() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-24">
      <div className="mx-auto mb-12 max-w-2xl text-center">
        <p className="text-sm font-bold uppercase tracking-[0.08em] text-violet-600">
          Tudo num só lugar
        </p>
        <h2 className="font-display mt-3 text-3xl font-extrabold tracking-tight md:text-4xl">
          Módulos que conversam entre si
        </h2>
        <p className="mt-4 text-lg text-muted-foreground">
          Cliente cadastrado aqui já aparece na cobrança, no contrato, no atendimento e no
          SmartFlow. Sem integração frágil entre sistemas diferentes.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {modulos.map((m) => (
          <div
            key={m.titulo}
            className="group rounded-2xl border bg-card p-5 transition-all hover:border-foreground/20 hover:shadow-md"
          >
            <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-violet-100 transition-transform group-hover:scale-110">
              <m.icon className="h-5 w-5 text-violet-600" />
            </div>
            <h3 className="mb-1.5 font-bold">{m.titulo}</h3>
            <p className="text-sm leading-relaxed text-muted-foreground">{m.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
