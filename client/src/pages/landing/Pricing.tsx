/**
 * Pricing — renderiza os planos vindos da tabela `planos` via tRPC.
 * Admin edita em /admin/financeiro?tab=planos e reflete aqui.
 *
 * "Começar grátis" persiste o slug em sessionStorage pra usar no signup.
 */

import { useMemo } from "react";
import { motion } from "framer-motion";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Check, Sparkles } from "lucide-react";
import { Reveal, staggerParent, staggerItem } from "./lpkit";

interface Props {
  onCta: (modo: "login" | "signup") => void;
}

function formatBRL(centavos: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(centavos / 100);
}

export function Pricing({ onCta }: Props) {
  const { data: planos, isLoading } = trpc.subscription.plans.useQuery();
  const { data: contato } = trpc.subscription.contatoComercial.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 5 * 60_000,
  });

  const trialMaiorDias = useMemo(() => {
    if (!planos) return 0;
    return Math.max(0, ...planos.map((p: any) => p.trialDias ?? 0));
  }, [planos]);

  /** A grade acompanha QUANTOS planos estão na vitrine. Travada em 4 colunas,
   *  os 3 planos de hoje deixavam 284px vazios à direita no desktop e, no
   *  tablet, um card órfão na segunda linha com 376px de sobra ao lado. */
  const gradeDosPlanos = useMemo(() => {
    switch (planos?.length ?? 0) {
      case 1:
        return "mx-auto max-w-md";
      case 2:
        return "mx-auto max-w-md sm:max-w-3xl sm:grid-cols-2";
      case 3:
        // pula a etapa de 2 colunas: com 3 cards ela é que deixa o órfão
        return "mx-auto max-w-md lg:max-w-none lg:grid-cols-3";
      default:
        return "sm:grid-cols-2 lg:grid-cols-4";
    }
  }, [planos?.length]);

  function selecionarPlano(slug: string) {
    try {
      sessionStorage.setItem("planoEscolhido", slug);
    } catch {
      // sessionStorage pode estar bloqueado (modo anônimo restrito)
    }
    onCta("signup");
  }

  /** "Falar com a gente": WhatsApp comercial (config do admin) com mensagem
   *  pronta; sem número configurado cai no e-mail de contato. */
  function falarComAGente(nomePlano: string) {
    const texto = `Olá! Tenho interesse no plano ${nomePlano} do JuridFlow.`;
    const url = contato?.whatsapp
      ? `https://wa.me/${contato.whatsapp}?text=${encodeURIComponent(texto)}`
      : `mailto:contato@juridflow.com.br?subject=${encodeURIComponent(`Interesse no plano ${nomePlano}`)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <section id="pricing" className="border-y border-white/[0.06] bg-[#081120]">
      <div className="mx-auto max-w-6xl px-4 py-24">
        <Reveal className="mx-auto mb-12 max-w-2xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-warning/30 bg-warning/10 px-4 py-1.5 text-[11px] font-extrabold uppercase tracking-[0.06em] text-warning-fg">
            🚀 Superlançamento · Monitoramento Processual
          </span>
          <h2 className="font-display mt-4 text-3xl font-extrabold tracking-tight text-white md:text-4xl">
            Nunca mais perca uma <span className="text-info">movimentação</span>.
          </h2>
          <p className="mt-4 text-lg text-info/70">
            O JuridFlow vigia seus processos e clientes nos tribunais e te avisa na hora — com
            resumo em português.
            {trialMaiorDias > 0 ? ` Teste grátis por ${trialMaiorDias} dias, sem cartão.` : ""}
          </p>
        </Reveal>

        {isLoading || !planos ? (
          <div className="mx-auto grid max-w-md gap-5 lg:max-w-none lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-[460px] rounded-2xl bg-white/5" />
            ))}
          </div>
        ) : (
          <motion.div
            variants={staggerParent}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-60px" }}
            className={`grid items-stretch gap-5 ${gradeDosPlanos}`}
          >
            {planos.map((p: any) => {
              const destaque = !!p.popular;
              const sobConsulta = !!p.precoSobConsulta;
              const demonstracao = !!p.ctaDemonstracao;
              const gratis = !sobConsulta && p.precoMensalCentavos === 0;
              const preco = gratis ? "R$ 0" : formatBRL(p.precoMensalCentavos);
              return (
                <motion.div
                  key={p.slug}
                  variants={staggerItem}
                  className={`relative flex flex-col rounded-2xl border p-6 transition-all hover:-translate-y-1 ${
                    destaque
                      ? "border-2 border-info/30 bg-info/15 shadow-[0_40px_80px_-28px_rgba(47,111,189,0.55)]"
                      : "border-white/10 bg-white/[0.04] hover:border-info/30 hover:bg-white/[0.06]"
                  }`}
                >
                  {destaque && (
                    <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 border-0 bg-info text-info-on shadow-[0_8px_22px_-6px_rgba(26,75,134,0.7)]">
                      <Sparkles className="mr-1 h-3 w-3" />
                      Mais popular
                    </Badge>
                  )}

                  {/* As alturas reservadas daqui pra baixo existem pra as listas de itens
                    * começarem na MESMA linha em todos os cards: o preço tem dois
                    * tamanhos ("R$ 5,00" × "Sob consulta") e o CTA tem um ou dois
                    * botões — juntos, desalinhavam os cards em até 50px. São
                    * MÍNIMOS, então nome comprido nem texto maior ficam cortados. */}
                  <h3 className="font-display min-h-[2.4em] text-2xl font-bold leading-[1.2] text-white">
                    {p.nome}
                  </h3>
                  <p className="mb-4 mt-1 min-h-[34px] text-[13px] text-info/55">
                    {p.publicoAlvo ?? p.descricao ?? ""}
                  </p>

                  {sobConsulta ? (
                    <>
                      <div className="flex min-h-[58px] items-baseline gap-1">
                        <span className="font-display text-[30px] font-extrabold tracking-tight text-white">Sob consulta</span>
                      </div>
                      <p className="mb-1 mt-1.5 min-h-[32px] text-xs text-info/55">
                        {demonstracao
                          ? "apresentamos numa demonstração ao vivo"
                          : "preço fechado na conversa, do seu tamanho"}
                      </p>
                      <div className="my-4 flex min-h-[104px] flex-col gap-2">
                        <Button
                          className="cta-marca w-full font-semibold"
                          size="lg"
                          onClick={() =>
                            demonstracao ? falarComAGente(p.nome) : selecionarPlano(p.slug)
                          }
                        >
                          {demonstracao ? "💬 Agendar demonstração" : `Testar grátis ${p.trialDias || 14} dias`}
                        </Button>
                        <Button
                          className="w-full border border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
                          size="lg"
                          variant="outline"
                          onClick={() =>
                            demonstracao ? selecionarPlano(p.slug) : falarComAGente(p.nome)
                          }
                        >
                          {demonstracao ? `Testar grátis ${p.trialDias || 14} dias` : "💬 Falar com a gente"}
                        </Button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex min-h-[58px] items-baseline gap-1">
                        <span className="font-display text-[38px] font-extrabold tracking-tight text-white">{preco}</span>
                        {!gratis && <span className="text-info/55">/mês</span>}
                      </div>

                      <p className="mb-1 mt-1.5 min-h-[32px] text-xs font-semibold text-info">
                        {p.trialDias > 0 ? `Teste ${p.trialDias} dias grátis` : ""}
                      </p>

                      <div className="my-4 flex min-h-[104px] flex-col gap-2">
                        <Button
                          className={`w-full ${
                            destaque
                              ? "cta-marca font-semibold"
                              : "border border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
                          }`}
                          size="lg"
                          variant={destaque ? "default" : "outline"}
                          onClick={() => selecionarPlano(p.slug)}
                        >
                          {gratis ? "Criar conta grátis" : "Começar grátis"}
                        </Button>
                      </div>
                    </>
                  )}

                  <ul className="space-y-2.5 text-sm text-info/80">
                    {(p.features ?? []).map((f: string, idx: number) => (
                      <li key={idx} className="flex items-start gap-2">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                </motion.div>
              );
            })}
          </motion.div>
        )}

        <p className="mt-7 text-center text-[13px] text-info/50">
          Teste com tudo liberado do plano escolhido · sem cartão de crédito · nada é cobrado
          automaticamente no fim do teste. Pagamento via Pix, boleto ou cartão (Asaas).
        </p>
      </div>
    </section>
  );
}
