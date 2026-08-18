/**
 * Restaurar cards que sumiram do quadro.
 *
 * Excluir uma coluna leva os cards junto e não sobra nada no banco além de
 * histórico órfão, que não guarda o nome. O relatório em PDF emitido antes do
 * estrago vira o único lugar onde aqueles nomes ainda existem.
 *
 * A tela mostra o plano antes de escrever qualquer coisa, porque a pergunta
 * que vem antes de qualquer botão é "o que exatamente vai acontecer com os
 * meus cards". Nada aqui altera ou apaga card existente: quem ainda está no
 * quadro é reconhecido e deixado em paz, e quem alguém já refez na mão vem
 * marcado pra pular — senão a restauração viraria duplicata.
 */

import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  FileUp,
  Loader2,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";

type Situacao = "recriar" | "esta_no_quadro" | "refeito" | "sem_coluna";

interface Item {
  indice: number;
  titulo: string;
  cliente: string;
  etapa: string;
  responsavel: string;
  cadastrado: string;
  prazo: string;
  situacao: Situacao;
  refeitoEm: string | null;
  colunaId: number | null;
  colunaNome: string | null;
  responsavelId: number | null;
  clienteId: number | null;
}

const SELO: Record<Situacao, { texto: string; classe: string }> = {
  recriar: { texto: "Recriar", classe: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  refeito: { texto: "Pular", classe: "bg-muted text-muted-foreground border-border" },
  esta_no_quadro: { texto: "Está no quadro", classe: "bg-muted text-muted-foreground border-border" },
  sem_coluna: { texto: "Escolher coluna", classe: "bg-amber-50 text-amber-700 border-amber-200" },
};

export default function RestaurarCards() {
  const [, navegar] = useLocation();
  const [funilId, setFunilId] = useState<number | null>(null);
  const [arquivo, setArquivo] = useState<string | null>(null);
  const [plano, setPlano] = useState<any>(null);
  // Escolhas do usuário sobre as pendências, por índice da linha.
  const [ajustes, setAjustes] = useState<Record<number, { responsavelId?: number | null; colunaId?: number | null }>>({});
  const [lendo, setLendo] = useState(false);

  const { data: funis } = (trpc as any).kanban.listarFunis.useQuery();

  const analisar = (trpc as any).kanbanRestaurar.analisar.useMutation({
    onSuccess: (r: any) => {
      setPlano(r);
      setAjustes({});
      toast.success(`${r.ausentes} cards ausentes do quadro`, {
        description: `Li ${r.totalLido} linhas do relatório.`,
      });
    },
    onError: (e: any) => toast.error("Não deu para ler", { description: e.message }),
    onSettled: () => setLendo(false),
  });

  const restaurar = (trpc as any).kanbanRestaurar.restaurar.useMutation({
    onSuccess: (r: any) => {
      toast.success(`${r.criados} cards de volta no quadro`);
      setPlano(null);
      setArquivo(null);
    },
    onError: (e: any) => toast.error("Não deu para restaurar", { description: e.message }),
  });

  const itens: Item[] = plano?.itens ?? [];

  const comAjuste = useMemo(
    () =>
      itens.map((i) => ({
        ...i,
        responsavelId: ajustes[i.indice]?.responsavelId ?? i.responsavelId,
        colunaId: ajustes[i.indice]?.colunaId ?? i.colunaId,
      })),
    [itens, ajustes],
  );

  const paraCriar = comAjuste.filter((i) => i.situacao === "recriar" && i.colunaId);
  const pendentes = comAjuste.filter((i) => i.situacao === "sem_coluna" && !i.colunaId);
  const pulados = comAjuste.filter((i) => i.situacao === "refeito");
  const noQuadro = comAjuste.filter((i) => i.situacao === "esta_no_quadro");
  const semResponsavel = paraCriar.filter((i) => i.responsavel && i.responsavel !== "—" && !i.responsavelId);

  function aoEscolherArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f || !funilId) return;
    setLendo(true);
    const leitor = new FileReader();
    leitor.onload = () => {
      const base64 = String(leitor.result).split(",")[1] ?? "";
      setArquivo(f.name);
      analisar.mutate({ funilId, pdfBase64: base64 });
    };
    leitor.onerror = () => {
      setLendo(false);
      toast.error("Não consegui abrir o arquivo");
    };
    leitor.readAsDataURL(f);
  }

  const colunas: Array<{ id: number; nome: string }> = plano?.colunas ?? [];
  const time: Array<{ id: number; nome: string }> = plano?.time ?? [];

  return (
    <div className="space-y-5 p-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Button variant="ghost" size="sm" className="mb-1 -ml-2" onClick={() => navegar("/kanban")}>
            <ArrowLeft className="h-4 w-4 mr-1.5" /> Voltar ao quadro
          </Button>
          <h1 className="text-2xl font-bold tracking-tight">Restaurar cards perdidos</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Recria no quadro os cards que sumiram, a partir de um relatório antigo. Só cria — nunca
            apaga nem sobrescreve.
          </p>
        </div>
      </div>

      <Card className="border-violet-200 bg-violet-50/40">
        <CardContent className="pt-5 flex gap-3">
          <ShieldCheck className="h-5 w-5 text-violet-600 shrink-0 mt-0.5" />
          <div className="text-[13px] text-violet-900 leading-relaxed">
            <p>
              Escolha o funil e mande o PDF <b>“Cards do Kanban”</b> exportado antes do sumiço. Eu
              comparo com o quadro de hoje e mostro o que vai acontecer com cada linha, antes de
              gravar qualquer coisa.
            </p>
            <p className="mt-1.5">
              Nada é criado no cadastro de clientes nem no time. Se o nome impresso não bater com
              ninguém, o campo fica vazio e o card entra assim mesmo.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-5 flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Funil
            </p>
            <Select
              value={funilId ? String(funilId) : ""}
              onValueChange={(v) => { setFunilId(Number(v)); setPlano(null); }}
            >
              <SelectTrigger className="w-[280px]">
                <SelectValue placeholder="Escolha o funil" />
              </SelectTrigger>
              <SelectContent>
                {(funis ?? []).map((f: any) => (
                  <SelectItem key={f.id} value={String(f.id)}>{f.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Relatório em PDF
            </p>
            <label>
              <input
                type="file"
                accept="application/pdf"
                className="hidden"
                disabled={!funilId || lendo}
                onChange={aoEscolherArquivo}
              />
              <Button asChild variant="outline" disabled={!funilId || lendo}>
                <span className="cursor-pointer">
                  {lendo ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <FileUp className="h-4 w-4 mr-2" />
                  )}
                  {arquivo ?? "Escolher arquivo"}
                </span>
              </Button>
            </label>
          </div>

          {!funilId && (
            <p className="text-xs text-muted-foreground pb-2">Escolha o funil primeiro.</p>
          )}
        </CardContent>
      </Card>

      {lendo && <Skeleton className="h-40 w-full" />}

      {plano && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card>
              <CardContent className="pt-5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Ausentes hoje
                </p>
                <p className="text-2xl font-bold mt-1 tabular-nums">{plano.ausentes}</p>
                <p className="text-[11px] text-muted-foreground mt-1">
                  de {plano.totalLido} lidos no relatório
                </p>
              </CardContent>
            </Card>
            <Card className="border-emerald-200 bg-emerald-50/50">
              <CardContent className="pt-5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                  Prontos para recriar
                </p>
                <p className="text-2xl font-bold mt-1 tabular-nums text-emerald-700">
                  {paraCriar.length}
                </p>
                <p className="text-[11px] text-emerald-700 mt-1">coluna resolvida</p>
              </CardContent>
            </Card>
            <Card className={pendentes.length ? "border-amber-200 bg-amber-50/50" : ""}>
              <CardContent className="pt-5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-amber-700">
                  Precisam de você
                </p>
                <p className="text-2xl font-bold mt-1 tabular-nums text-amber-700">
                  {pendentes.length}
                </p>
                <p className="text-[11px] text-amber-700 mt-1">a coluna antiga não existe mais</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Serão pulados
                </p>
                <p className="text-2xl font-bold mt-1 tabular-nums text-muted-foreground">
                  {pulados.length}
                </p>
                <p className="text-[11px] text-muted-foreground mt-1">alguém já refez na mão</p>
              </CardContent>
            </Card>
          </div>

          {(semResponsavel.length > 0 || noQuadro.length > 0) && (
            <Card>
              <CardContent className="pt-5 text-[12.5px] space-y-1.5">
                {noQuadro.length > 0 && (
                  <p className="flex items-center gap-2 text-muted-foreground">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                    <span>
                      <b className="text-foreground">{noQuadro.length}</b> cards do relatório ainda
                      estão no quadro — não entram na restauração.
                    </span>
                  </p>
                )}
                {semResponsavel.length > 0 && (
                  <p className="flex items-center gap-2 text-muted-foreground">
                    <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                    <span>
                      <b className="text-foreground">{semResponsavel.length}</b> vão entrar sem
                      responsável: o relatório corta nome longo e não achei quem é.{" "}
                      {plano.responsaveisNaoEncontrados.length > 0 && (
                        <>Não encontrei “{plano.responsaveisNaoEncontrados.join("”, “")}”.</>
                      )}
                    </span>
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="pt-5">
              <p className="text-sm font-bold mb-3">O que vai acontecer com cada um</p>
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead className="text-muted-foreground">
                    <tr className="text-left border-b">
                      <th className="font-semibold pb-2 pr-3">Card</th>
                      <th className="font-semibold pb-2 pr-3">Volta para</th>
                      <th className="font-semibold pb-2 pr-3">Responsável</th>
                      <th className="font-semibold pb-2 pr-3 whitespace-nowrap">Cadastro</th>
                      <th className="font-semibold pb-2">Ação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {comAjuste
                      .filter((i) => i.situacao !== "esta_no_quadro")
                      .map((i) => (
                        <tr key={i.indice} className={i.situacao === "refeito" ? "opacity-55" : ""}>
                          <td className="py-2 pr-3 font-semibold">{i.titulo}</td>
                          <td className="py-2 pr-3">
                            {i.situacao === "sem_coluna" ? (
                              <Select
                                value={i.colunaId ? String(i.colunaId) : ""}
                                onValueChange={(v) =>
                                  setAjustes((a) => ({
                                    ...a,
                                    [i.indice]: { ...a[i.indice], colunaId: Number(v) },
                                  }))
                                }
                              >
                                <SelectTrigger className="h-8 w-[190px] text-[12px]">
                                  <SelectValue placeholder={`“${i.etapa}” não existe mais`} />
                                </SelectTrigger>
                                <SelectContent>
                                  {colunas.map((c) => (
                                    <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              <span className="text-muted-foreground">{i.colunaNome ?? i.etapa}</span>
                            )}
                          </td>
                          <td className="py-2 pr-3">
                            {i.situacao !== "refeito" && !i.responsavelId ? (
                              <Select
                                value=""
                                onValueChange={(v) =>
                                  setAjustes((a) => ({
                                    ...a,
                                    [i.indice]: { ...a[i.indice], responsavelId: Number(v) },
                                  }))
                                }
                              >
                                <SelectTrigger className="h-8 w-[180px] text-[12px] text-amber-700">
                                  <SelectValue placeholder={i.responsavel || "sem responsável"} />
                                </SelectTrigger>
                                <SelectContent>
                                  {time.map((c) => (
                                    <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              <span className="text-muted-foreground">
                                {time.find((t) => t.id === i.responsavelId)?.nome ?? i.responsavel ?? "—"}
                              </span>
                            )}
                          </td>
                          <td className="py-2 pr-3 tabular-nums text-muted-foreground whitespace-nowrap">
                            {i.cadastrado}
                          </td>
                          <td className="py-2">
                            <span
                              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10.5px] font-bold ${SELO[i.situacao].classe}`}
                            >
                              {SELO[i.situacao].texto}
                              {i.refeitoEm ? ` — refeito em ${i.refeitoEm}` : ""}
                            </span>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-5 flex items-center justify-between gap-4 flex-wrap">
              <p className="text-[12.5px] text-muted-foreground">
                <b className="text-foreground">{paraCriar.length}</b> serão recriados ·{" "}
                <b className="text-foreground">{pendentes.length}</b> aguardando coluna ·{" "}
                <b className="text-foreground">{pulados.length}</b> pulados. A data de cadastro
                original é preservada.
              </p>
              <Button
                disabled={paraCriar.length === 0 || restaurar.isPending}
                onClick={() =>
                  restaurar.mutate({
                    funilId,
                    cards: paraCriar.map((i) => ({
                      titulo: i.titulo,
                      colunaId: i.colunaId,
                      responsavelId: i.responsavelId,
                      clienteId: i.clienteId,
                      cadastrado: i.cadastrado,
                      prazo: i.prazo || undefined,
                    })),
                  })
                }
              >
                {restaurar.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <RotateCcw className="h-4 w-4 mr-2" />
                )}
                Recriar {paraCriar.length} cards
              </Button>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
