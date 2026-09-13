import { Link, useLocation, useParams } from "wouter";
import { ArrowRight, ChevronRight, Clapperboard, Clock, ExternalLink, ImageOff, Lock, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useModulosContratados } from "@/components/ModuloGuard";
import { contratoLibera } from "@shared/modulos-contratacao";
import { MODULOS_APP } from "@shared/modulos-app";
import { modulosQueLiberam, tarefaCompleta, tarefaPorId } from "@/pages/ajuda/tarefas";
import { TextoComRotulos } from "@/pages/ajuda/TextoComRotulos";

function Bloco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="bg-card border border-border rounded-[14px] p-4 min-w-0">
      <h3 className="text-micro font-bold uppercase tracking-wider text-muted-foreground mb-2.5">{titulo}</h3>
      {children}
    </section>
  );
}

function Print({ src, alt }: { src?: string; alt: string }) {
  if (!src) {
    return (
      <div className="mt-3 flex items-center gap-2 rounded-lg border border-dashed border-border bg-muted/40 px-3 py-3 text-apoio text-muted-foreground">
        <ImageOff className="h-4 w-4 shrink-0" />
        print em breve
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      className="mt-3 w-full max-w-full rounded-lg border border-border bg-muted/30"
    />
  );
}

function TarefaNaoEncontrada() {
  return (
    <div className="mx-auto mt-16 max-w-md px-4 text-center">
      <h1 className="text-titulo font-bold tracking-tight">Esta tarefa não existe</h1>
      <p className="text-corpo text-muted-foreground mt-2">
        O link pode estar velho ou a tarefa mudou de nome. A Central lista tudo o que existe hoje.
      </p>
      <Button asChild className="mt-5">
        <Link href="/ajuda">Abrir a Central de ajuda</Link>
      </Button>
    </div>
  );
}

function TarefaEmBreveTela({ titulo, grupo }: { titulo: string; grupo: string }) {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-4">
      <nav className="flex flex-wrap items-center gap-1 text-apoio text-muted-foreground" aria-label="Você está em">
        <Link href="/ajuda" className="hover:text-foreground">Ajuda</Link>
        <ChevronRight className="h-3 w-3" />
        <span>{grupo}</span>
        <ChevronRight className="h-3 w-3" />
        <span className="text-foreground">{titulo}</span>
      </nav>
      <div className="bg-card border border-border rounded-[14px] p-6">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-titulo font-bold tracking-tight">{titulo}</h1>
          <Badge variant="secondary" className="text-micro font-semibold uppercase tracking-wider text-muted-foreground">em breve</Badge>
        </div>
        <p className="text-corpo text-muted-foreground mt-2">
          Esta tarefa ainda está sendo escrita. Enquanto isso, a Central tem as que já estão prontas.
        </p>
        <Button asChild variant="outline" size="sm" className="mt-4">
          <Link href="/ajuda">Voltar pra Central</Link>
        </Button>
      </div>
    </div>
  );
}

function AvisoModulo({ modulos }: { modulos: readonly string[] }) {
  const [, setLocation] = useLocation();
  const nome = modulos.map((id) => MODULOS_APP.find((m) => m.id === id)?.nome ?? id).join(" ou ");
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[14px] border border-info/30 bg-info-bg px-4 py-3">
      <Lock className="h-4 w-4 shrink-0 text-info-fg" />
      <p className="min-w-0 flex-1 text-corpo text-info-fg">
        Este recurso depende do módulo <b>{nome}</b>, que não está no plano do escritório. Dá pra ler como
        funciona; a tela em si fica bloqueada.
      </p>
      <Button size="sm" variant="outline" className="border-info/40" onClick={() => setLocation("/configuracoes?tab=meu-plano")}>
        Ver meu plano
      </Button>
    </div>
  );
}

export default function AjudaTarefa() {
  const params = useParams<{ tarefa: string }>();
  const [, setLocation] = useLocation();
  const contratados = useModulosContratados();
  const tarefa = tarefaPorId(params.tarefa ?? "");

  if (!tarefa) return <TarefaNaoEncontrada />;
  if (!tarefaCompleta(tarefa)) return <TarefaEmBreveTela titulo={tarefa.titulo} grupo={tarefa.grupo} />;

  // A régua do ModuloGuard sobre a rota de «Abrir a tela», não o `modulo`
  // solto — é ela que decide se a tela abre.
  const modulosDaTela = modulosQueLiberam(tarefa);
  const semModulo = modulosDaTela.length > 0 && !contratoLibera(contratados, modulosDaTela);
  const ligadas = tarefa.tarefasLigadas
    .map((id) => tarefaPorId(id))
    .filter((t): t is NonNullable<typeof t> => !!t);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4">
      <nav className="flex flex-wrap items-center gap-1 text-apoio text-muted-foreground" aria-label="Você está em">
        <Link href="/ajuda" className="hover:text-foreground">Ajuda</Link>
        <ChevronRight className="h-3 w-3" />
        <span>{tarefa.grupo}</span>
        <ChevronRight className="h-3 w-3" />
        <span className="text-foreground">{tarefa.titulo}</span>
      </nav>

      <header className="bg-card border border-border rounded-[14px] p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          {/* min-w segura o título: sem ele o bloco encolhia a zero num
              celular e o botão ficava do lado, com o título em três linhas. */}
          <div className="min-w-[220px] flex-1">
            <h1 className="text-pagina font-bold tracking-tight leading-none">{tarefa.titulo}</h1>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-apoio text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" />
                {tarefa.tempo}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <UserRound className="h-3.5 w-3.5" />
                {tarefa.quemPode}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Clapperboard className="h-3.5 w-3.5" />
                vídeo:
                <Badge variant="secondary" className="text-micro font-semibold uppercase tracking-wider text-muted-foreground">em breve</Badge>
              </span>
            </div>
          </div>
          <Button onClick={() => setLocation(tarefa.abrirTela.rota)} className="shrink-0" disabled={semModulo}>
            Abrir a tela
            <ArrowRight className="h-4 w-4 mx-1.5" />
            {tarefa.abrirTela.rotulo}
          </Button>
        </div>
      </header>

      {semModulo && <AvisoModulo modulos={modulosDaTela} />}

      <div className="rounded-[14px] border border-warning/30 bg-warning-bg px-4 py-3">
        <p className="text-micro font-bold uppercase tracking-wider text-warning-fg mb-1">Antes de começar</p>
        <TextoComRotulos texto={tarefa.antesDeComecar} className="text-corpo text-warning-fg leading-relaxed" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <ol className="space-y-3 min-w-0">
          {tarefa.passos.map((passo, i) => (
            <li key={i} className="bg-card border border-border rounded-[14px] p-4 flex gap-3 min-w-0">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-corpo font-bold tabular-nums">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-secao font-bold tracking-tight leading-snug">
                  <TextoComRotulos texto={passo.titulo} />
                </h2>
                <TextoComRotulos texto={passo.texto} className="mt-1 block text-corpo text-muted-foreground leading-relaxed" />
                {(passo.print || i === 0) && <Print src={passo.print} alt={`Tela real: ${passo.titulo}`} />}
              </div>
            </li>
          ))}
        </ol>

        <aside className="space-y-3 min-w-0">
          <Bloco titulo="O que acontece depois">
            <ul className="space-y-2">
              {tarefa.depois.map((d, i) => (
                <li key={i} className="flex gap-2 text-corpo leading-relaxed">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                  <TextoComRotulos texto={d} />
                </li>
              ))}
            </ul>
          </Bloco>

          <Bloco titulo="Se não deu certo">
            <div className="space-y-3">
              {tarefa.seNaoDeuCerto.map((f, i) => (
                <div key={i} className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2">
                  <p className="text-corpo font-semibold text-foreground">
                    <TextoComRotulos texto={f.titulo} />
                  </p>
                  <TextoComRotulos texto={f.texto} className="mt-0.5 block text-apoio text-muted-foreground leading-relaxed" />
                </div>
              ))}
            </div>
          </Bloco>

          {ligadas.length > 0 && (
            <Bloco titulo="Tarefas ligadas">
              <ul className="space-y-1">
                {ligadas.map((t) =>
                  tarefaCompleta(t) ? (
                    <li key={t.id}>
                      <Link
                        href={`/ajuda/${t.id}`}
                        className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-corpo font-medium text-primary hover:bg-muted"
                      >
                        <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                        <span className="min-w-0 truncate">{t.titulo}</span>
                      </Link>
                    </li>
                  ) : (
                    <li key={t.id} className="flex items-center justify-between gap-2 px-1.5 py-1 text-corpo text-muted-foreground">
                      <span className="min-w-0 truncate">{t.titulo}</span>
                      <Badge variant="secondary" className="shrink-0 text-micro font-semibold uppercase tracking-wider text-muted-foreground">
                        em breve
                      </Badge>
                    </li>
                  ),
                )}
              </ul>
            </Bloco>
          )}
        </aside>
      </div>
    </div>
  );
}
