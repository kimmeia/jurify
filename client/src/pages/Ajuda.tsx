import { useMemo, useState } from "react";
import { Link } from "wouter";
import { CircleHelp, MessageCircle, Search, ArrowRight } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GRUPOS_AJUDA, buscarTarefas, tarefaCompleta, type TarefaAjuda } from "@/pages/ajuda/tarefas";

/**
 * Link "Falar com a gente" da Central: o MESMO WhatsApp comercial que a LP e
 * o Meu plano usam (`subscription.contatoComercial`, editável em
 * /admin/settings) — nunca um número escrito aqui. Sem número cadastrado,
 * cai no e-mail, como o Plans.tsx faz.
 */
export function linkFalarComAGente(whatsapp: string | null | undefined, duvida: string): string {
  const texto = duvida.trim()
    ? `Olá! Estou na Central de ajuda do JuridFlow e não achei como fazer: ${duvida.trim()}`
    : "Olá! Estou na Central de ajuda do JuridFlow e tenho uma dúvida.";
  return whatsapp
    ? `https://wa.me/${whatsapp}?text=${encodeURIComponent(texto)}`
    : `mailto:contato@juridflow.com.br?subject=${encodeURIComponent("Dúvida na Central de ajuda")}&body=${encodeURIComponent(texto)}`;
}

function LinhaTarefa({ tarefa }: { tarefa: TarefaAjuda }) {
  if (!tarefaCompleta(tarefa)) {
    return (
      <li className="flex items-center justify-between gap-2 px-3 py-2 text-corpo text-muted-foreground">
        <span className="min-w-0 truncate">{tarefa.titulo}</span>
        <Badge variant="secondary" className="shrink-0 text-micro font-semibold uppercase tracking-wider text-muted-foreground">
          em breve
        </Badge>
      </li>
    );
  }
  return (
    <li>
      <Link
        href={`/ajuda/${tarefa.id}`}
        className="group flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-corpo font-medium text-foreground transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
      >
        <span className="min-w-0 truncate">{tarefa.titulo}</span>
        <span className="flex shrink-0 items-center gap-2 text-apoio text-muted-foreground">
          <span className="hidden sm:inline">{tarefa.tempo}</span>
          <ArrowRight className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
        </span>
      </Link>
    </li>
  );
}

export default function Ajuda() {
  const [busca, setBusca] = useState("");
  const { data: contatoComercial } = trpc.subscription.contatoComercial.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  const encontradas = useMemo(() => buscarTarefas(busca), [busca]);
  const buscando = busca.trim().length > 0;
  const linkConversa = linkFalarComAGente(contatoComercial?.whatsapp, busca);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-pagina font-bold tracking-tight leading-none flex items-center gap-2">
            <CircleHelp className="h-6 w-6 text-primary" />
            Central de ajuda
          </h1>
          <p className="text-corpo text-muted-foreground mt-1.5">
            Escolha o que você quer fazer. Cada tarefa mostra a tela real, o passo a passo e um botão que leva até lá.
          </p>
        </div>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="O que você quer fazer? ex.: vigiar um processo, conectar WhatsApp, cobrar cliente"
          aria-label="Buscar tarefa"
          className="h-11 pl-9 text-corpo"
        />
      </div>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-secao font-bold tracking-tight">
            {buscando ? `Resultados para “${busca.trim()}”` : "Por tarefa"}
          </h2>
          {buscando && (
            <span className="text-apoio text-muted-foreground">
              {encontradas.length === 1 ? "1 tarefa" : `${encontradas.length} tarefas`}
            </span>
          )}
        </div>

        {encontradas.length === 0 ? (
          <div className="bg-card border border-border rounded-[14px] p-6 text-center">
            <p className="text-corpo font-medium">Nenhuma tarefa com esse nome ainda.</p>
            <p className="text-apoio text-muted-foreground mt-1">
              Manda a dúvida pra gente — ela vira uma tarefa aqui.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {GRUPOS_AJUDA.map((grupo) => {
              const doGrupo = encontradas.filter((t) => t.grupo === grupo);
              if (doGrupo.length === 0) return null;
              return (
                <div key={grupo} className="bg-card border border-border rounded-[14px] p-3 min-w-0">
                  <h3 className="px-3 pb-1.5 pt-1 text-micro font-bold uppercase tracking-wider text-muted-foreground">
                    {grupo}
                  </h3>
                  <ul className="space-y-0.5">
                    {doGrupo.map((t) => (
                      <LinhaTarefa key={t.id} tarefa={t} />
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div className="bg-card border border-border rounded-[14px] p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-corpo font-semibold">Não achou?</p>
          <p className="text-apoio text-muted-foreground">
            Manda a dúvida que a gente responde — e ela vira uma tarefa aqui.
          </p>
        </div>
        <Button asChild size="sm">
          <a href={linkConversa} target="_blank" rel="noopener noreferrer">
            <MessageCircle className="h-4 w-4 mr-1.5" />
            Falar com a gente
          </a>
        </Button>
      </div>
    </div>
  );
}
