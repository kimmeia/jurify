/**
 * Hero da Landing Page — primeira coisa que o visitante vê.
 *
 * Estratégia: headline forte focada em dor (5 sistemas → 1) +
 * sub-headline com 4 capacidades-chave + 2 CTAs + mockup do
 * Financeiro (gancho mais sentido por dono de escritório).
 */

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, ArrowRight, TrendingUp, Wallet, Clock, AlertCircle } from "lucide-react";

interface Props {
  onCta: (modo: "login" | "signup") => void;
}

export function Hero({ onCta }: Props) {
  return (
    <section className="relative overflow-hidden">
      {/* Gradiente sutil de fundo (usa primary do tema OKLCH) */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-info/5" />
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent" />

      <div className="relative max-w-6xl mx-auto px-4 pt-16 pb-20 lg:pt-24 lg:pb-28">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          {/* Coluna esquerda: copy */}
          <div className="text-center lg:text-left">
            <Badge className="mb-6 bg-primary/10 text-primary border-0 hover:bg-primary/15 gap-1.5">
              <Sparkles className="h-3.5 w-3.5" />
              Sistema completo do escritório moderno
            </Badge>

            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.05]">
              Pare de pular entre <span className="text-primary">5 sistemas</span>.
              <br className="hidden md:block" />
              Tudo que seu escritório precisa,
              <br className="hidden md:block" />
              <span className="text-primary">num só lugar.</span>
            </h1>

            <p className="text-lg md:text-xl text-muted-foreground mt-6 max-w-xl lg:max-w-none">
              Atendimento por WhatsApp, contratos automáticos, financeiro com
              Asaas, comissões sem Excel.{" "}
              <strong className="text-foreground">Tudo integrado.</strong>
            </p>

            <div className="flex flex-col sm:flex-row gap-3 mt-10 justify-center lg:justify-start">
              <Button
                size="lg"
                className="text-base px-8 shadow-lg hover:shadow-xl transition-all"
                onClick={() => onCta("signup")}
              >
                Começar grátis (7 dias)
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="text-base px-8"
                onClick={() => {
                  document.getElementById("demo")?.scrollIntoView({ behavior: "smooth" });
                }}
              >
                Ver demonstração
              </Button>
            </div>

            <p className="text-xs text-muted-foreground mt-4 lg:text-left text-center">
              Sem cartão de crédito • Configura em 5 minutos
            </p>
          </div>

          {/* Coluna direita: mockup do Financeiro */}
          <div className="hidden lg:block">
            <FinanceiroMockup />
          </div>
        </div>
      </div>

      {/* Mockup mobile (centralizado abaixo, sem coluna) */}
      <div className="lg:hidden max-w-md mx-auto px-4 pb-16">
        <FinanceiroMockup />
      </div>
    </section>
  );
}

/** Mockup estilizado do Financeiro pra usar no hero. Dados fictícios. */
function FinanceiroMockup() {
  return (
    <div className="relative">
      {/* Glow sutil atrás */}
      <div className="absolute -inset-4 bg-gradient-to-br from-primary/20 to-info/20 blur-2xl rounded-3xl opacity-50" />
      <div className="relative rounded-2xl border bg-card shadow-2xl overflow-hidden">
        {/* Topbar */}
        <div className="bg-muted/30 border-b px-4 py-3 flex items-center gap-2">
          <div className="flex gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-red-400/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/70" />
          </div>
          <div className="flex-1 text-center text-[10px] text-muted-foreground font-mono">
            jurify.com.br/financeiro
          </div>
        </div>

        <div className="p-5 space-y-4">
          {/* Header com nome + saldo */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Financeiro</p>
              <h3 className="text-lg font-semibold">Outubro 2026</h3>
            </div>
            <Badge className="bg-success-bg text-success-fg border-0 text-[10px]">
              ● Asaas conectado
            </Badge>
          </div>

          {/* Linha de KPIs */}
          <div className="grid grid-cols-3 gap-2">
            <MockKpi label="Recebido" valor="R$ 47.350" Icon={TrendingUp} accent="emerald" />
            <MockKpi label="A receber" valor="R$ 12.100" Icon={Clock} accent="amber" />
            <MockKpi label="Vencido" valor="R$ 1.800" Icon={AlertCircle} accent="red" />
          </div>

          {/* "Gráfico" estilizado */}
          <div className="rounded-lg border bg-card p-3">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[11px] font-medium">Fluxo de caixa</p>
              <div className="flex gap-1">
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted">3m</span>
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-primary text-primary-foreground">6m</span>
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted">12m</span>
              </div>
            </div>
            <div className="h-20 flex items-end gap-1.5">
              {[40, 55, 30, 70, 85, 65, 95, 100, 90, 60, 75, 85].map((h, i) => (
                <div
                  key={i}
                  className="flex-1 bg-gradient-to-t from-primary/40 to-primary/20 rounded-sm"
                  style={{ height: `${h}%` }}
                />
              ))}
            </div>
          </div>

          {/* Tabela mock de cobranças */}
          <div className="space-y-1.5">
            {[
              { cli: "Maria S.", val: "R$ 1.500", st: "Pago", cor: "success" },
              { cli: "Carlos M.", val: "R$ 3.200", st: "Pendente", cor: "warning" },
              { cli: "Ana P.", val: "R$ 850", st: "Pago", cor: "success" },
            ].map((c, i) => (
              <div
                key={i}
                className="flex items-center justify-between px-3 py-2 rounded-md border bg-card text-xs"
              >
                <span className="font-medium">{c.cli}</span>
                <span className="text-muted-foreground tabular-nums">{c.val}</span>
                <Badge
                  variant="outline"
                  className={
                    c.cor === "success"
                      ? "bg-success-bg text-success-fg border-0 text-[10px]"
                      : "bg-warning-bg text-warning-fg border-0 text-[10px]"
                  }
                >
                  {c.st}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function MockKpi({
  label,
  valor,
  Icon,
  accent,
}: {
  label: string;
  valor: string;
  Icon: React.ComponentType<{ className?: string }>;
  accent: "emerald" | "amber" | "red";
}) {
  const cores = {
    emerald: "text-emerald-600 bg-emerald-500/10",
    amber: "text-amber-600 bg-amber-500/10",
    red: "text-red-600 bg-red-500/10",
  };
  return (
    <div className="rounded-lg border bg-card p-2.5">
      <div className="flex items-center gap-2 mb-1">
        <div className={`h-6 w-6 rounded ${cores[accent]} flex items-center justify-center`}>
          <Icon className="h-3 w-3" />
        </div>
      </div>
      <p className="text-[9px] text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className="text-sm font-bold tabular-nums">{valor}</p>
    </div>
  );
}
