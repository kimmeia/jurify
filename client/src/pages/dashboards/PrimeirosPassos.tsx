/**
 * Primeiros passos — o bloco do topo do Dashboard do dono (Central de
 * ajuda, fatia 2; mockup `mockup-central-de-ajuda.html`, aba 4). Cinco
 * passos em ordem, cada um abre o fluxo REAL; a marcação é do servidor
 * (`ajuda.primeirosPassos`), que também decide quem vê: só o dono, e só os
 * passos do que o plano contratou. Some sozinho quando os N estão feitos —
 * a Central continua mostrando o resumo pra quem quiser rever.
 *
 * Mesmo desenho do GuiaProcessual (que segue cobrindo a variante
 * processual): cartão feito em verde, o atual com o botão, o travado com
 * cadeado "depois do passo N".
 */

import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  ArrowRight,
  CheckCircle2,
  KeyRound,
  Lock,
  MessageCircle,
  Radar,
  UserPlus,
  Users,
} from "lucide-react";
import { numeroDoPasso, passoAtual, type PassoId } from "@shared/primeiros-passos";

const ICONE_DO_PASSO: Record<PassoId, typeof KeyRound> = {
  whatsapp: MessageCircle,
  cliente: UserPlus,
  cofre: KeyRound,
  processo: Radar,
  equipe: Users,
};

const QUANTIDADE = ["", "Uma coisa", "Duas coisas", "Três coisas", "Quatro coisas", "Cinco coisas"];

function diaMes(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" }).format(d);
}

function usePrimeirosPassos() {
  return trpc.ajuda.primeirosPassos.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });
}

export default function PrimeirosPassos() {
  const [, setLocation] = useLocation();
  const { data } = usePrimeirosPassos();

  // Some sozinho quando termina; quem não é dono (ou não tem passo nenhum no
  // plano) recebe a lista vazia do servidor e não vê o bloco.
  if (!data || !data.souDono || data.total === 0 || data.feitos === data.total) return null;

  const { passos, feitos, total } = data;
  const atual = passoAtual(passos);
  const pct = Math.round((feitos / total) * 100);

  return (
    <Card className="border-l-4 border-l-primary shadow-none">
      <CardContent className="space-y-3 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-secao font-bold text-foreground">Primeiros passos</p>
          <Badge variant="secondary" className="tabular-nums">
            {feitos} de {total}
          </Badge>
          <div className="ml-auto flex items-center gap-2 text-apoio font-bold text-primary tabular-nums">
            <Progress value={pct} className="h-1.5 w-24" />
            {pct}%
          </div>
        </div>
        <p className="text-corpo text-muted-foreground">
          {QUANTIDADE[total] ?? `${total} coisas`} que fazem o JuridFlow trabalhar por você. Em ordem —
          cada uma abre a tela certa.
        </p>

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-5">
          {passos.map((p, i) => {
            const n = i + 1;
            const ehAtual = p.id === atual;
            const travado = !p.feito && p.travadoPor != null;
            const Icone = ICONE_DO_PASSO[p.id];
            return (
              <div
                key={p.id}
                className={`flex min-w-0 flex-col gap-1.5 rounded-xl border bg-card p-3.5 ${
                  p.feito ? "border-success/30 bg-success-bg" : ""
                } ${ehAtual ? "border-primary ring-2 ring-primary/15" : ""} ${travado ? "opacity-60" : ""}`}
              >
                <div className="flex items-center gap-1.5 text-micro font-extrabold uppercase tracking-wider text-muted-foreground">
                  {p.feito ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-success-fg" />
                  ) : (
                    <span
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-micro font-bold ${
                        ehAtual ? "border-primary text-primary" : "border-border"
                      }`}
                    >
                      {n}
                    </span>
                  )}
                  Passo {n}
                </div>
                <p className="text-corpo font-semibold leading-tight">{p.titulo}</p>
                <p className="text-apoio leading-relaxed text-muted-foreground">{p.descricao}</p>
                <div className="mt-auto pt-1">
                  {p.feito ? (
                    <p className="text-apoio font-semibold text-success-fg">
                      Feito{p.feitoEm ? ` · em ${diaMes(p.feitoEm)}` : ""}
                    </p>
                  ) : travado ? (
                    <p className="flex items-center gap-1 text-apoio font-semibold text-muted-foreground">
                      <Lock className="h-3.5 w-3.5 shrink-0" />
                      depois do passo {numeroDoPasso(passos, p.travadoPor)}
                    </p>
                  ) : (
                    <Button
                      size="sm"
                      className="w-full"
                      variant={ehAtual ? "default" : "outline"}
                      onClick={() => setLocation(p.rota)}
                    >
                      <Icone className="mr-1.5 h-3.5 w-3.5" />
                      {p.rotulo}
                      <ArrowRight className="ml-1 h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <p className="text-apoio text-muted-foreground">
          Este bloco some quando os {total} passos estiverem feitos.
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * A faixa compacta da Central de ajuda (aba 2 do mockup): um quadradinho
 * por passo e o link pro Dashboard. Ao contrário do bloco, NÃO some quando
 * termina — a Central é onde se revê o que foi feito.
 */
export function PrimeirosPassosResumo() {
  const [, setLocation] = useLocation();
  const { data } = usePrimeirosPassos();

  if (!data || !data.souDono || data.total === 0) return null;

  const { passos, feitos, total } = data;
  const atual = passoAtual(passos);

  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <h4 className="text-micro font-extrabold uppercase tracking-wider text-muted-foreground">
          Primeiros passos · {feitos} de {total} feitos
        </h4>
        <button
          type="button"
          className="ml-auto text-apoio font-bold text-primary underline-offset-2 hover:underline"
          onClick={() => setLocation("/dashboard")}
        >
          ver no Dashboard
        </button>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {passos.map((p, i) => {
          const ehAtual = p.id === atual;
          return (
            <div
              key={p.id}
              className={`flex min-w-0 flex-col gap-1 rounded-xl border bg-card px-2.5 py-2 text-apoio leading-snug ${
                p.feito ? "border-success/30 bg-success-bg" : ""
              } ${ehAtual ? "border-primary ring-2 ring-primary/15" : ""}`}
            >
              <span className="text-micro font-extrabold uppercase tracking-wider text-muted-foreground">
                Passo {i + 1}
              </span>
              <b className="text-foreground">{p.titulo}</b>
              <span
                className={`mt-auto text-micro font-bold ${
                  p.feito ? "text-success-fg" : ehAtual ? "text-primary" : "text-muted-foreground"
                }`}
              >
                {p.feito
                  ? `✓ feito${p.feitoEm ? ` em ${diaMes(p.feitoEm)}` : ""}`
                  : ehAtual
                    ? "→ é o próximo"
                    : "depois"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
