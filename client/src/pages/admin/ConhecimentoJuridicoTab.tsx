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
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BookOpen, ClipboardPaste, Database, Download, Loader2, Quote, Scale } from "lucide-react";
import { toast } from "sonner";
import BaseJuridicaTab from "./BaseJuridicaTab";
import AdminJurisIa from "./AdminJurisIa";
import { rotuloCadencia, rotuloSituacao, type TipoMaterial } from "@shared/fontes-oficiais";

const nf = new Intl.NumberFormat("pt-BR");

const SELO: Record<string, { texto: string; cls: string }> = {
  ok: { texto: "em dia", cls: "text-success-fg bg-success/10 border-success/30" },
  coletando: { texto: "coletando", cls: "text-info-fg bg-info/10 border-info/30" },
  nunca: { texto: "nunca coletou", cls: "text-muted-foreground bg-muted-foreground/10 border-border/30" },
  erro: { texto: "erro", cls: "text-danger-fg bg-danger/10 border-danger/30" },
  bloqueada: { texto: "bloqueada", cls: "text-danger-fg bg-danger/10 border-danger/30" },
};

/**
 * O que a fonte entrega, em uma palavra.
 *
 * Súmula fica com o destaque mais forte de propósito: é a citação que não se
 * discute (o número é a prova), o texto é curto e o conjunto é fechado — o
 * material mais barato de manter e o mais seguro de usar numa peça.
 */
const MATERIAL: Record<TipoMaterial, { rotulo: string; cls: string }> = {
  sumula: { rotulo: "súmula", cls: "border-success/30 bg-success/10 text-success-fg" },
  ementa: { rotulo: "ementa", cls: "border-info/30 bg-info/10 text-info-fg" },
  metadado: { rotulo: "só número", cls: "border-border/40 bg-muted text-muted-foreground" },
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

/**
 * O caminho de colar o texto oficial das súmulas.
 *
 * Existe porque "é público" e "o nosso servidor consegue ler" são coisas
 * diferentes: o STJ publica todas as súmulas aberto e barra a faixa de IP do
 * servidor. Súmula muda poucas vezes por ano — colar uma vez resolve o ano, e
 * o texto passa pelo MESMO leitor da coleta automática, então o que entra aqui
 * é idêntico ao que entraria sozinho.
 */
function ColarSumulasDialog({
  fonte,
  onFechar,
}: {
  fonte: { id: string; nome: string } | null;
  onFechar: () => void;
}) {
  const utils = trpc.useUtils();
  const [texto, setTexto] = useState("");

  const importar = trpc.admin.jurisiaImportarSumulas.useMutation({
    onSuccess: (r) => {
      if (r.status === "ok") {
        toast.success(
          r.novas === 1 ? "1 súmula nova no acervo" : `${nf.format(r.novas)} súmulas novas no acervo`,
          {
            description: [
              `Achei ${nf.format(r.buscou)} no texto.`,
              r.canceladas ? `${r.canceladas} vinham marcadas como canceladas e ficaram de fora.` : "",
            ]
              .filter(Boolean)
              .join(" "),
          },
        );
        setTexto("");
        onFechar();
      } else {
        toast.error("Não deu pra importar", { description: r.erro ?? "" });
      }
      utils.admin.jurisiaFontesOficiais.invalidate();
    },
    onError: (e) => toast.error("Não deu pra importar", { description: e.message }),
  });

  return (
    <Dialog open={Boolean(fonte)} onOpenChange={(aberto) => !aberto && onFechar()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Colar as súmulas — {fonte?.nome}</DialogTitle>
          <DialogDescription>
            Abra a lista oficial de súmulas no seu navegador, selecione tudo (Ctrl+A), copie e cole
            aqui. Eu separo uma por uma pelo número. Súmula marcada como cancelada não entra.
          </DialogDescription>
        </DialogHeader>

        <Textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={14}
          className="font-mono text-[12px]"
          placeholder={"Súmula 297 — O Código de Defesa do Consumidor é aplicável às instituições financeiras.\nSúmula 382 — A estipulação de juros remuneratórios superiores a 12% ao ano…"}
        />
        <p className="text-[11px] text-muted-foreground">
          {texto.trim().length > 0
            ? `${nf.format(texto.trim().length)} caracteres colados.`
            : "O texto precisa ter o número junto do enunciado — é pelo número que eu separo."}
        </p>

        <DialogFooter>
          <Button variant="ghost" onClick={onFechar}>
            Cancelar
          </Button>
          <Button
            disabled={texto.trim().length < 30 || importar.isPending}
            onClick={() => fonte && importar.mutate({ fonteId: fonte.id, texto })}
          >
            {importar.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Importar para o acervo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FontesOficiais() {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.admin.jurisiaFontesOficiais.useQuery(undefined, { retry: false });
  const [termo, setTermo] = useState("");
  const [colando, setColando] = useState<{ id: string; nome: string } | null>(null);

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
  const citaveis = fontes.filter((f) => f.material !== "metadado");

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">De onde vem a jurisprudência</CardTitle>
        <CardDescription>
          Ligada, a fonte é visitada sozinha na frequência da coluna e guarda o que for novo. A
          coluna <b>"dá pra ler daqui?"</b> é medida, não palpite: a informação é pública, mas
          isso não garante que o nosso servidor consiga entrar — o STJ publica tudo aberto e
          barra a nossa faixa de internet. Quando a porta está fechada e o material é súmula,
          existe o caminho de <b>colar o texto oficial</b> uma vez.
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
              <TableHead>O que ela traz, e se dá pra ler daqui</TableHead>
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
                {/* Largura declarada: sem teto, o nome do tribunal puxava a
                    coluna pra 404px e a tabela inteira pedia 1.389px numa
                    área de 1.082 — a última coluna, com os botões, ficava
                    fora da tela. */}
                <TableCell className="w-[190px] max-w-[190px] whitespace-normal align-top">
                  <div className="font-semibold leading-tight">{f.nome}</div>
                  <div className="text-[11px] text-muted-foreground">{f.orgao}</div>
                </TableCell>
                {/* A célula da tabela nasce `whitespace-nowrap`: sem soltar a
                    quebra aqui, a frase invade a coluna vizinha. */}
                {/* O que ela traz e se dá pra ler moram na MESMA célula de
                    propósito: em coluna separada, a tabela passou de oito
                    colunas e espremeu a frase num fio de dez caracteres — a
                    largura de um cartão de lista não é a largura da tela. */}
                <TableCell className="min-w-[280px] whitespace-normal align-top">
                  <span
                    className={`mr-1.5 inline-flex rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase ${MATERIAL[f.material].cls}`}
                  >
                    {MATERIAL[f.material].rotulo}
                  </span>
                  <span className="text-[12px] text-muted-foreground">{f.entrega}</span>
                  {/* A situação medida, em português. Sem ela a chave "Ligada"
                      convida a ligar fonte que não tem como responder — foi o
                      que aconteceu com o STJ. */}
                  <p
                    className={`mt-1.5 text-[12px] font-semibold ${
                      f.ligarTemChance ? "text-success-fg" : "text-warning-fg"
                    }`}
                  >
                    {rotuloSituacao(f.situacao).frase}
                    {rotuloSituacao(f.situacao).deQuemE && (
                      <span className="font-normal text-muted-foreground">
                        {" "}
                        — {rotuloSituacao(f.situacao).deQuemE}
                      </span>
                    )}
                  </p>
                  {f.notaDaSondagem && (
                    <p className="text-[11px] text-muted-foreground">{f.notaDaSondagem}</p>
                  )}
                  {f.ultimoErro && (
                    <span className="mt-1 block text-[11px] text-danger-fg">{f.ultimoErro}</span>
                  )}
                </TableCell>
                <TableCell className="w-[86px] text-[12px] text-muted-foreground">
                  {rotuloCadencia(f.cadenciaHoras)}
                </TableCell>
                <TableCell className="w-[74px] text-right font-semibold tabular-nums">
                  {f.material === "metadado" ? "—" : nf.format(f.itens)}
                </TableCell>
                <TableCell className="w-[96px] text-[12px] text-muted-foreground">{quando(f.ultimaColetaEm)}</TableCell>
                <TableCell className="w-[118px]">
                  <Selo estado={f.status} />
                </TableCell>
                <TableCell className="w-[168px] text-right">
                  {f.material !== "metadado" ? (
                    <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
                      {f.material === "sumula" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-[11px]"
                          onClick={() => setColando({ id: f.id, nome: f.nome })}
                        >
                          <ClipboardPaste className="h-3.5 w-3.5" />
                          <span className="ml-1">Colar texto oficial</span>
                        </Button>
                      )}
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
          <b className="font-semibold text-foreground">{nf.format(data?.ementas.total ?? 0)}</b> textos
          citáveis no acervo (súmula e ementa), vindos de {nf.format(data?.ementas.tribunais ?? 0)}{" "}
          tribunais, em {citaveis.length} fontes declaradas. O DataJud entra por fora dessa conta: ele
          não traz texto de decisão, traz o número que vira estatística.
        </p>
      </CardContent>

      <ColarSumulasDialog fonte={colando} onFechar={() => setColando(null)} />
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
          rotulo="Súmulas e ementas"
          valor={nf.format(fontesData?.ementas.total ?? 0)}
          apoio="texto que se cita na peça, com link pro tribunal"
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
