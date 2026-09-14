/**
 * Conhecimento jurídico — a fusão de "Base Jurídica" e "JurisIA" numa tela só.
 *
 * Eram duas abas porque nasceram em datas diferentes, não porque são coisas
 * diferentes: as duas alimentam a MESMA resposta ao advogado (a conversa do
 * JurisIA já lê o acervo, a biblioteca e os autos no mesmo turno). Separadas,
 * ninguém enxergava o buraco do meio — o acervo do DataJud não tem uma linha
 * de texto de decisão, e a biblioteca só cresce quando alguém sobe arquivo
 * à mão.
 *
 * A tela responde, de cima pra baixo, três perguntas na ordem em que o dono
 * faz: de onde vem o material, o que os tribunais daqui decidem, e o que já
 * está guardado.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BookOpen, Database, Download, Loader2, Quote, Scale } from "lucide-react";
import { toast } from "sonner";
import BaseJuridicaTab from "./BaseJuridicaTab";
import AdminJurisIa from "./AdminJurisIa";
import { rotuloCadencia } from "@shared/fontes-oficiais";

const nf = new Intl.NumberFormat("pt-BR");

const SELO: Record<string, { texto: string; cls: string }> = {
  ok: { texto: "em dia", cls: "text-success-fg bg-success/10 border-success/30" },
  coletando: { texto: "coletando", cls: "text-info-fg bg-info/10 border-info/30" },
  nunca: { texto: "nunca coletou", cls: "text-muted-foreground bg-muted-foreground/10 border-border/30" },
  erro: { texto: "erro", cls: "text-danger-fg bg-danger/10 border-danger/30" },
  bloqueada: { texto: "bloqueada", cls: "text-danger-fg bg-danger/10 border-danger/30" },
};

function Selo({ estado }: { estado: string }) {
  const s = SELO[estado] ?? SELO.nunca;
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${s.cls}`}>
      {s.texto}
    </span>
  );
}

function Kpi({ icone, rotulo, valor, apoio }: { icone: React.ReactNode; rotulo: string; valor: string; apoio: string }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <p className="flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground">
          {icone}
          {rotulo}
        </p>
        <p className="mt-1 text-2xl font-bold tabular-nums">{valor}</p>
        <p className="text-[11px] text-muted-foreground">{apoio}</p>
      </CardContent>
    </Card>
  );
}

/** Quanto por cento, já arredondado — a tela nunca mostra decimal aqui. */
function pct(parte: number, total: number): number {
  return total > 0 ? Math.round((parte / total) * 100) : 0;
}

function quando(v: string | Date | null | undefined): string {
  if (!v) return "—";
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function EntendimentosRegionais() {
  const { data, isLoading } = trpc.admin.jurisiaEntendimentosRegionais.useQuery(undefined, { retry: false });
  const linhas = data ?? [];

  if (isLoading) return <Skeleton className="h-40 rounded-xl" />;
  if (linhas.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Entendimentos por região</CardTitle>
        <CardDescription>
          O número nacional não escolhe a tese — o que muda a peça é o que a câmara daquele tribunal
          costuma fazer com aquele pedido. Contado no acervo, por tribunal.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {linhas.map((t) => {
          const favoravel = t.procedente + t.parcial + t.acordo;
          return (
            <div key={t.tribunal} className="rounded-xl border p-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-bold">{t.tribunal}</span>
                <span className="text-[11px] text-muted-foreground">{nf.format(t.total)} decisões</span>
              </div>
              <p className="mt-1 text-[11.5px] text-muted-foreground">{t.assunto ?? "—"}</p>

              <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-muted">
                <div className="bg-success" style={{ width: `${pct(t.procedente, t.total)}%` }} />
                <div className="bg-info" style={{ width: `${pct(t.parcial, t.total)}%` }} />
                <div className="bg-warning" style={{ width: `${pct(t.acordo, t.total)}%` }} />
                <div className="bg-danger" style={{ width: `${pct(t.improcedente, t.total)}%` }} />
              </div>

              <p className="mt-2 text-[12px] leading-relaxed">
                <b className="font-semibold">{pct(favoravel, t.total)}%</b> terminam a favor de quem pediu —{" "}
                {pct(t.parcial, t.total)}% em parte, {pct(t.procedente, t.total)}% no todo.
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {t.ementas > 0
                  ? `${nf.format(t.ementas)} ementa${t.ementas > 1 ? "s" : ""} citáve${t.ementas > 1 ? "is" : "l"} deste tribunal.`
                  : t.acordaos > 0
                    ? `${nf.format(t.acordaos)} ${t.acordaos > 1 ? "são acórdãos" : "é acórdão"}, mas ainda sem ementa coletada.`
                    : "Ainda sem acórdão — só sentença de 1º grau."}
              </p>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function FontesOficiais() {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.admin.jurisiaFontesOficiais.useQuery(undefined, { retry: false });
  const [termo, setTermo] = useState("");

  const ligar = trpc.admin.jurisiaLigarFonte.useMutation({
    onSuccess: () => utils.admin.jurisiaFontesOficiais.invalidate(),
    onError: (e) => toast.error("Não deu pra mudar a fonte", { description: e.message }),
  });
  const coletar = trpc.admin.jurisiaColetarFonte.useMutation({
    onSuccess: (r) => {
      if (r.status === "ok") {
        toast.success("Coleta feita", { description: `${r.novas} nova(s) de ${r.buscou} encontrada(s).` });
      } else {
        toast.error(r.status === "bloqueada" ? "O tribunal recusou" : "A coleta falhou", {
          description: r.erro ?? "",
        });
      }
      utils.admin.jurisiaFontesOficiais.invalidate();
    },
    onError: (e) => toast.error("A coleta falhou", { description: e.message }),
  });

  if (isLoading) return <Skeleton className="h-64 rounded-xl" />;
  const fontes = data?.fontes ?? [];
  const comEmenta = fontes.filter((f) => f.material === "ementa");

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Fontes oficiais</CardTitle>
        <CardDescription>
          Ligada, a fonte é visitada sozinha na frequência da coluna e guarda o que for novo. Antes de
          ligar, <b>rode a sondagem</b> (no fim desta tela): ela confere se a fonte responde{" "}
          <b>do nosso servidor</b> — tribunal que barra a faixa de IP do servidor responde
          normalmente no seu computador, e esse verde é falso.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Input
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            placeholder="Termo da coleta manual (ex.: capitalização de juros)"
            className="h-9 max-w-[360px]"
          />
          <span className="text-[11px] text-muted-foreground">
            em branco, usa os assuntos que os planos vendem
          </span>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fonte</TableHead>
              <TableHead>O que ela traz</TableHead>
              <TableHead>Volta</TableHead>
              <TableHead className="text-right">No acervo</TableHead>
              <TableHead>Última coleta</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Ligada</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {fontes.map((f) => (
              <TableRow key={f.id}>
                <TableCell>
                  <div className="font-semibold">{f.nome}</div>
                  <div className="text-[11px] text-muted-foreground">{f.orgao}</div>
                </TableCell>
                {/* A célula da tabela nasce `whitespace-nowrap`: sem soltar a
                    quebra aqui, a frase invade a coluna vizinha. */}
                <TableCell className="w-[360px] max-w-[360px] whitespace-normal">
                  <span
                    className={`mr-1.5 inline-flex rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                      f.material === "ementa"
                        ? "border-info/30 bg-info/10 text-info-fg"
                        : "border-border/40 bg-muted text-muted-foreground"
                    }`}
                  >
                    {f.material === "ementa" ? "ementa" : "só número"}
                  </span>
                  <span className="text-[12px] text-muted-foreground">{f.entrega}</span>
                  {f.ultimoErro && (
                    <span className="mt-1 block text-[11px] text-danger-fg">{f.ultimoErro}</span>
                  )}
                </TableCell>
                <TableCell className="text-[12px] text-muted-foreground">
                  {rotuloCadencia(f.cadenciaHoras)}
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">
                  {f.material === "ementa" ? nf.format(f.itens) : "—"}
                </TableCell>
                <TableCell className="text-[12px] text-muted-foreground">{quando(f.ultimaColetaEm)}</TableCell>
                <TableCell>
                  <Selo estado={f.status} />
                </TableCell>
                <TableCell className="text-right">
                  {f.material === "ementa" ? (
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-[11px]"
                        disabled={coletar.isPending}
                        onClick={() => coletar.mutate({ fonteId: f.id, termo: termo || undefined })}
                      >
                        {coletar.isPending && coletar.variables?.fonteId === f.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Download className="h-3.5 w-3.5" />
                        )}
                        <span className="ml-1">Coletar</span>
                      </Button>
                      <Switch
                        checked={f.ligada}
                        onCheckedChange={(v) => ligar.mutate({ fonteId: f.id, ligada: v })}
                        aria-label={`Ligar coleta de ${f.nome}`}
                      />
                    </div>
                  ) : (
                    <span className="text-[11px] text-muted-foreground">pelo painel abaixo</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <p className="mt-3 text-[12px] text-muted-foreground">
          <b className="font-semibold text-foreground">{nf.format(data?.ementas.total ?? 0)}</b> ementas no
          acervo, vindas de {nf.format(data?.ementas.tribunais ?? 0)} tribunais, em {comEmenta.length} fontes
          declaradas. O DataJud entra por fora dessa conta: ele não traz texto de decisão, traz o número
          que vira estatística.
        </p>
      </CardContent>
    </Card>
  );
}

export default function ConhecimentoJuridicoTab() {
  const { data: baseStatus } = (trpc as any).juridico.statusBaseGlobal.useQuery(undefined, { retry: false });
  const { data: fontesData } = trpc.admin.jurisiaFontesOficiais.useQuery(undefined, { retry: false });
  const { data: varreduras } = trpc.admin.jurisiaVarreduras.useQuery(undefined, { retry: false });

  const processos = (varreduras ?? []).reduce((s: number, v: any) => s + (v.processos ?? 0), 0);
  const comMaterial = (varreduras ?? []).filter((v: any) => (v.processos ?? 0) > 0).length;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          icone={<Quote className="h-3 w-3" />}
          rotulo="Ementas citáveis"
          valor={nf.format(fontesData?.ementas.total ?? 0)}
          apoio="texto de acórdão, com link pro tribunal"
        />
        <Kpi
          icone={<Database className="h-3 w-3" />}
          rotulo="Processos medidos"
          valor={nf.format(processos)}
          apoio="vira estatística, não citação"
        />
        <Kpi
          icone={<BookOpen className="h-3 w-3" />}
          rotulo="Biblioteca da casa"
          valor={nf.format(baseStatus?.total ?? 0)}
          apoio={`${nf.format(baseStatus?.indexadas ?? 0)} prontas pra busca`}
        />
        <Kpi
          icone={<Scale className="h-3 w-3" />}
          rotulo="Tribunais cobertos"
          valor={String(comMaterial)}
          apoio="com material no acervo"
        />
      </div>

      <FontesOficiais />
      <EntendimentosRegionais />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">A biblioteca da casa</CardTitle>
          <CardDescription>
            Leis, súmulas e decisões que valem pra todos os escritórios. O robô alimenta sozinho; aqui
            é onde se sobe o que ele não achou.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BaseJuridicaTab />
        </CardContent>
      </Card>

      <details className="rounded-xl border bg-card">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">
          Tribunais e varredura do DataJud
          <span className="ml-2 text-[11px] font-normal text-muted-foreground">
            o painel técnico de antes, inteiro — nada foi tirado
          </span>
        </summary>
        <div className="border-t px-4 py-4">
          <AdminJurisIa />
        </div>
      </details>
    </div>
  );
}
