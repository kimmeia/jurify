/**
 * JurisIA (beta) — o painel de perguntas de um processo.
 *
 * O que a tela precisa deixar claro o tempo todo: de onde veio cada frase. Por
 * isso a afirmação carrega as âncoras numeradas, a conclusão aparece separada
 * (é leitura, não está escrito nos autos), e a recusa da trava é mostrada como
 * resposta legítima em vez de erro escondido.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { FileText, Loader2, Send, ShieldCheck, Sparkles, TriangleAlert } from "lucide-react";
import type { RespostaGravada } from "@shared/jurisia-resposta";

type Fonte = { id: number; rotulo: string; data: string };

const SUGESTOES = [
  "O que aconteceu neste processo até agora?",
  "O juiz já decidiu alguma coisa? O quê?",
  "Tem prazo correndo pra mim?",
];

function Ancora({ n }: { n: number }) {
  return (
    <sup className="ml-0.5 rounded border border-violet-200 bg-violet-100 px-1 py-px text-[8.5px] font-extrabold text-violet-700 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-300">
      {n}
    </sup>
  );
}

function Resposta({ resposta, fontes }: { resposta: RespostaGravada; fontes: Fonte[] }) {
  // A numeração da bolha é a ordem de citação, não o id do evento: "fonte 1"
  // é mais legível que "fonte 84213", e a coluna de fontes usa a mesma ordem.
  const ordem = useMemo(() => {
    const m = new Map<number, number>();
    resposta.fontesUsadas.forEach((id, i) => m.set(id, i + 1));
    return m;
  }, [resposta.fontesUsadas]);

  if (!resposta.achou) {
    return (
      <div className="rounded-xl rounded-bl-sm border border-amber-300 bg-amber-50 px-3.5 py-3 dark:bg-amber-950/30">
        <p className="mb-1 flex items-center gap-1.5 text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-amber-700 dark:text-amber-400">
          <TriangleAlert className="h-3.5 w-3.5" />
          Não encontrei nos autos
        </p>
        <p className="text-[12.5px] leading-relaxed text-amber-900 dark:text-amber-200">
          {resposta.conclusao ?? "Não há nas movimentações deste processo o que responder isso."}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl rounded-bl-sm border bg-muted/30 px-3.5 py-3">
      {resposta.afirmacoes.map((a, i) => (
        <p key={i} className={`text-[12.5px] leading-relaxed ${i > 0 ? "mt-2" : ""}`}>
          {a.texto}
          {a.fontes.map((id) => (
            <Ancora key={id} n={ordem.get(id) ?? 0} />
          ))}
        </p>
      ))}

      {resposta.conclusao && (
        <p className="mt-2.5 border-l-2 border-violet-300 pl-2.5 text-[12.5px] leading-relaxed text-foreground/90">
          {resposta.conclusao}
        </p>
      )}

      {fontes.length > 0 && (
        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 dark:border-emerald-900 dark:bg-emerald-950/30">
          <p className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-900 dark:text-emerald-300">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
            {fontes.length === 1
              ? "1 movimentação sustenta esta resposta"
              : `${fontes.length} movimentações sustentam esta resposta`}
          </p>
          <ul className="mt-1.5 space-y-1">
            {fontes.map((f) => (
              <li key={f.id} className="flex gap-2 text-[11px] text-emerald-900/90 dark:text-emerald-200/90">
                <span className="shrink-0 font-extrabold">{ordem.get(f.id)}</span>
                <span className="shrink-0 tabular-nums opacity-70">{f.data}</span>
                <span className="min-w-0 truncate">{f.rotulo}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function JurisIaPainel({ monitoramentoId }: { monitoramentoId: number }) {
  const [pergunta, setPergunta] = useState("");
  const fimRef = useRef<HTMLDivElement | null>(null);

  const utils = trpc.useUtils();
  const { data: estado } = trpc.jurisia.estado.useQuery();
  const { data, isLoading } = trpc.jurisia.conversa.useQuery({ monitoramentoId });

  const perguntarMut = trpc.jurisia.perguntar.useMutation({
    onSuccess: (r) => {
      utils.jurisia.conversa.invalidate({ monitoramentoId });
      utils.jurisia.estado.invalidate();
      utils.jurisia.casosRecentes.invalidate();
      if (!r.ok) {
        // A recusa não é erro de sistema: é a trava funcionando. Some do
        // caminho feliz, mas o advogado precisa saber que não foi resposta.
        toast.warning("A resposta não passou na checagem de fontes", {
          description: "Refaça a pergunta de outro jeito — nada foi afirmado sem documento.",
        });
      }
    },
    onError: (e) => toast.error("JurisIA indisponível", { description: e.message }),
  });

  useEffect(() => {
    fimRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [data?.mensagens.length, perguntarMut.isPending]);

  const cota = estado?.cota;
  const enviar = () => {
    const q = pergunta.trim();
    if (q.length < 3 || perguntarMut.isPending) return;
    setPergunta("");
    perguntarMut.mutate({ monitoramentoId, pergunta: q });
  };

  if (cota?.semPlano) {
    return (
      <div className="rounded-xl border bg-card px-4 py-6 text-center">
        <Sparkles className="mx-auto h-6 w-6 text-violet-500" />
        <p className="mt-2 text-sm font-bold">JurisIA não está no seu plano</p>
        <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
          Pergunte sobre qualquer processo do escritório e receba a resposta com a movimentação
          que a sustenta.
        </p>
      </div>
    );
  }

  const mensagens = data?.mensagens ?? [];

  return (
    <div className="flex flex-col rounded-xl border bg-card overflow-hidden">
      <div className="flex items-center gap-2 border-b px-4 py-2.5">
        <Sparkles className="h-4 w-4 text-violet-600 dark:text-violet-400" />
        <p className="text-[13.5px] font-bold">JurisIA</p>
        <span className="rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[9.5px] font-extrabold uppercase tracking-[0.06em] text-amber-800 dark:bg-amber-950 dark:text-amber-300">
          beta
        </span>
        {cota && (
          <span className="ml-auto text-[10.5px] tabular-nums text-muted-foreground">
            {cota.usadas} de {cota.limite} mensagens no mês
          </span>
        )}
      </div>

      <div className="max-h-[420px] space-y-3.5 overflow-y-auto px-4 py-3.5">
        {isLoading ? (
          <Skeleton className="h-24 w-full rounded-xl" />
        ) : mensagens.length === 0 ? (
          <div className="py-4 text-center">
            <p className="text-[12.5px] text-muted-foreground">
              Pergunte sobre este processo. A resposta vem com a movimentação que a sustenta.
            </p>
            <div className="mt-3 flex flex-wrap justify-center gap-1.5">
              {SUGESTOES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setPergunta(s)}
                  className="rounded-full border bg-card px-2.5 py-1 text-[11.5px] text-muted-foreground hover:bg-muted/50"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          mensagens.map((m) => {
            if (m.papel === "usuario") {
              return (
                <div key={m.id} className="flex justify-end">
                  <p className="max-w-[80%] rounded-xl rounded-br-sm bg-violet-600 px-3.5 py-2.5 text-[12.5px] leading-snug text-white">
                    {m.conteudo}
                  </p>
                </div>
              );
            }
            if (m.recusa) {
              return (
                <div key={m.id} className="rounded-xl rounded-bl-sm border border-dashed px-3.5 py-3">
                  <p className="flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground">
                    <FileText className="h-3.5 w-3.5" />
                    Resposta descartada pela checagem de fontes
                  </p>
                  <p className="mt-1 text-[11.5px] text-muted-foreground">
                    Nada foi afirmado sem documento. Tente perguntar de outro jeito.
                  </p>
                </div>
              );
            }
            return (
              <Resposta
                key={m.id}
                resposta={m.resposta as RespostaGravada}
                fontes={(m.resposta as RespostaGravada).fontesDetalhe ?? []}
              />
            );
          })
        )}

        {perguntarMut.isPending && (
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Lendo as movimentações deste processo…
          </div>
        )}
        <div ref={fimRef} />
      </div>

      <div className="border-t px-4 py-3">
        <div className="flex items-center gap-2">
          <Input
            value={pergunta}
            onChange={(e) => setPergunta(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                enviar();
              }
            }}
            placeholder="Pergunte sobre este processo…"
            className="h-9"
            disabled={!cota?.pode || perguntarMut.isPending}
          />
          <Button
            size="sm"
            className="h-9 shrink-0"
            disabled={!cota?.pode || pergunta.trim().length < 3 || perguntarMut.isPending}
            onClick={enviar}
          >
            {perguntarMut.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
        <p className="mt-1.5 text-[10px] text-muted-foreground">
          {cota && !cota.pode
            ? `Você usou as ${cota.limite} mensagens deste mês.`
            : "Beta — confira as fontes antes de peticionar."}
        </p>
      </div>
    </div>
  );
}
