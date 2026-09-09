/**
 * Páginas dedicadas /login e /cadastro — layout split (painel de marca
 * escuro à esquerda + formulário à direita), pra campanhas apontarem
 * direto pra URL de cadastro em vez do modal da landing.
 *
 * A troca login↔cadastro é navegação entre rotas (não tabs) — cada URL
 * é um destino de campanha rastreável. Pós-sucesso navega pra "/" e o
 * Home decide o destino (admin → /admin, com assinatura → /dashboard,
 * sem → /plans) — mesma régua do fluxo via modal.
 */

import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { AuthForms } from "./AuthForms";
import { Logo } from "../landing/Logo";
import { MessageCircle, Scale, CircleDollarSign, Check } from "lucide-react";

interface AuthSplitPageProps {
  modo: "login" | "signup";
}

const FEATURES_LOGIN = [
  {
    icon: MessageCircle,
    titulo: "Atendimento no WhatsApp",
    desc: "API oficial da Meta, com IA que responde a qualquer hora",
  },
  {
    icon: Scale,
    titulo: "Processos sempre monitorados",
    desc: "alerta de movimentação nova com resumo por IA e prazos na agenda",
  },
  {
    icon: CircleDollarSign,
    titulo: "Honorários no controle",
    desc: "Pix, boleto e cartão, com régua de cobrança automática",
  },
];

const PASSOS_CADASTRO = [
  { titulo: "Crie sua conta", desc: "leva menos de 2 minutos, só nome, email e senha" },
  { titulo: "Configure seu escritório", desc: "convide a equipe e importe seus clientes e processos" },
  { titulo: "Teste tudo por 14 dias", desc: "sem cartão e sem cobrança automática no fim do teste" },
];

export default function AuthSplitPage({ modo }: AuthSplitPageProps) {
  const { user, loading, refresh } = useAuth();
  const [, setLocation] = useLocation();

  // Já logado → Home decide o destino (dashboard/plans/admin)
  useEffect(() => {
    if (!loading && user) setLocation("/");
  }, [loading, user, setLocation]);

  const isLogin = modo === "login";

  return (
    <div className="min-h-screen flex bg-[#fafafc]">
      {/* ── Painel de marca (desktop) ── */}
      <aside
        className="relative hidden lg:flex lg:w-[46%] flex-col overflow-hidden p-12 text-white"
        style={{ background: "radial-gradient(120% 120% at 100% 0%, #1a1140 0%, #0c0a1c 62%)" }}
      >
        <span className="pointer-events-none absolute -left-28 -top-32 h-96 w-[420px] rounded-full mix-blend-screen blur-[70px]" style={{ background: "radial-gradient(circle, #7c3aed77, transparent 65%)" }} />
        <span className="pointer-events-none absolute -right-24 -top-28 h-96 w-96 rounded-full mix-blend-screen blur-[70px]" style={{ background: "radial-gradient(circle, #c026d344, transparent 65%)" }} />
        <span className="pointer-events-none absolute left-[30%] -bottom-44 h-80 w-[460px] rounded-full mix-blend-screen blur-[70px]" style={{ background: "radial-gradient(circle, #4f46e555, transparent 66%)" }} />
        <span className="pointer-events-none absolute -right-10 -bottom-28 select-none font-display text-[420px] font-extrabold leading-none text-white/[0.03]">
          J
        </span>

        <div className="relative flex h-full flex-col">
          <Logo variant="dark" className="text-4xl" />

          {isLogin ? (
            <>
              <h1 className="font-display mt-24 text-[42px] font-extrabold leading-[1.2] tracking-tight">
                A gestão do seu
                <br />
                escritório, simples
                <br />
                e no seu bolso.
              </h1>
              <p className="mt-4 max-w-md text-lg leading-relaxed text-info/70">
                Atendimento, processos, contratos e honorários num só lugar — do
                primeiro contato no WhatsApp ao recebimento.
              </p>
              <div className="mt-12 flex flex-col gap-6">
                {FEATURES_LOGIN.map((f) => (
                  <div key={f.titulo} className="flex items-start gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-info/30 bg-info/20">
                      <f.icon className="h-6 w-6 text-info" />
                    </div>
                    <div>
                      <p className="font-bold">{f.titulo}</p>
                      <p className="mt-0.5 text-[15px] text-info/60">{f.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <h1 className="font-display mt-24 text-[42px] font-extrabold leading-[1.2] tracking-tight">
                Comece hoje.
                <br />
                <span className="text-info">14 dias grátis</span>,
                <br />
                sem cartão.
              </h1>
              <p className="mt-4 max-w-md text-lg leading-relaxed text-info/70">
                Crie a conta, conecte seu WhatsApp e veja seu escritório inteiro
                num painel só.
              </p>
              <div className="mt-12 flex flex-col gap-6">
                {PASSOS_CADASTRO.map((p, i) => (
                  <div key={p.titulo} className="flex items-start gap-4">
                    <div className="font-display flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-info/30 bg-info/20 text-lg font-bold text-info-fg">
                      {i + 1}
                    </div>
                    <div>
                      <p className="font-bold">{p.titulo}</p>
                      <p className="mt-0.5 text-[15px] text-info/60">{p.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          <p className="mt-auto text-sm text-info/40">app.juridflow.com.br</p>
        </div>
      </aside>

      {/* ── Formulário ── */}
      <main className="flex flex-1 items-center justify-center px-6 py-10">
        <div className="w-full max-w-md">
          <div className="mb-8 flex justify-center lg:hidden">
            <Logo className="text-3xl" />
          </div>

          <h2 className="font-display text-3xl font-bold tracking-tight text-[#171331]">
            {isLogin ? "Bem-vindo de volta" : "Crie sua conta grátis"}
          </h2>
          <p className="mt-2 text-muted-foreground">
            {isLogin ? (
              "Entre para gerenciar seu escritório."
            ) : (
              <>
                Teste completo por 14 dias —{" "}
                <span className="font-semibold text-success-fg">sem cartão de crédito</span>.
              </>
            )}
          </p>

          <div className="mt-8">
            {/* key={modo}: /login e /cadastro montam este componente na MESMA
                posição da árvore, então o React reaproveita a instância e o
                estado interno `tab` fica preso no modo anterior — /cadastro
                mostrava o formulário de LOGIN pra quem navegou do login (e
                com hideTabs não havia como sair). A key força remontagem. */}
            <AuthForms
              key={modo}
              hideTabs
              defaultTab={modo}
              onSuccess={async () => {
                await refresh();
                setLocation("/");
              }}
            />
          </div>

          {!isLogin && (
            <div className="mt-5 flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm font-medium text-muted-foreground">
              <span className="flex items-center gap-1.5"><Check className="h-4 w-4 text-success-fg" /> 14 dias grátis</span>
              <span className="flex items-center gap-1.5"><Check className="h-4 w-4 text-success-fg" /> sem cartão</span>
              <span className="flex items-center gap-1.5"><Check className="h-4 w-4 text-success-fg" /> sem cobrança automática</span>
            </div>
          )}

          <p className="mt-6 text-center text-[15px] text-muted-foreground">
            {isLogin ? (
              <>
                Não tem conta?{" "}
                <Link href="/cadastro" className="font-bold text-info-fg hover:underline">
                  Criar conta grátis
                </Link>
              </>
            ) : (
              <>
                Já tem conta?{" "}
                <Link href="/login" className="font-bold text-info-fg hover:underline">
                  Entrar
                </Link>
              </>
            )}
          </p>

          {isLogin && (
            <p className="mt-4 text-center text-sm text-muted-foreground/70">
              Teste grátis de 14 dias —{" "}
              <span className="font-semibold text-success-fg">sem cartão de crédito</span>.
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
