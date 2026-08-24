/**
 * Acordos — negociações de quitação do escritório numa tela só.
 *
 * O caso normal é quitação: o cliente deve 100 mil e quer quitar por 10. Então
 * a MESA (o que a outra parte aceita hoje) caminha entre o TETO que o cliente
 * aguenta e a META que se quer pagar — e é essa régua que a tela desenha.
 *
 * A pergunta que a tela responde primeiro não é "quanto está em negociação",
 * é "o que travou". Negociação morre de silêncio, e a versão anterior deste
 * módulo mostrava uma parada há 31 dias exatamente igual a uma de ontem.
 */

import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { toast } from "sonner";
import {
  AlertTriangle, Clock, DollarSign, Loader2, Pencil, Phone, Plus, X,
} from "lucide-react";
import {
  AcaoCard,
  BlocoPrincipal,
  COR_SERIE,
  FaixaAcoes,
  LinhaNumero,
  ListaCard,
  PainelTopo,
  Selo,
  SubNumero,
  SubNumeros,
  formatDataCurta,
  formatPercent,
} from "./dashboards/common";
import {
  DIAS_PARADO_ALERTA,
  descontoSobreOrigem,
  diasSemMovimento,
  progressoNegociacao,
} from "../../../shared/acordos";

// ─── moeda em centavos (int no backend) ──────────────────────────────────────
const brl = (cents?: number | null) =>
  cents == null ? "—" : (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
/** "1.800,00" ou "1800.00" → centavos int. */
const paraCentavos = (s: string): number | undefined => {
  const limpo = s.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  const n = parseFloat(limpo);
  return Number.isFinite(n) ? Math.round(n * 100) : undefined;
};
const centsParaInput = (c?: number | null): string => (c == null ? "" : (c / 100).toFixed(2).replace(".", ","));

type StatusAcordo = "negociando" | "proposta_enviada" | "fechado" | "cancelado";
type Grupo = "abertos" | "fechados" | "cancelados";

const ROTULO_STATUS: Record<StatusAcordo, string> = {
  negociando: "negociando",
  proposta_enviada: "proposta",
  fechado: "fechado",
  cancelado: "cancelado",
};

const iniciais = (n?: string | null) =>
  (n || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join("").toUpperCase();

const CORES_AVATAR = ["#7c3aed", "#0891b2", "#eda100", "#1baf7a", "#e87ba4", "#eb6834"];

function Avatar({ nome, indice, grande }: { nome?: string | null; indice: number; grande?: boolean }) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full font-bold text-white ${
        grande ? "h-9 w-9 text-[11px]" : "h-7 w-7 text-[10px]"
      }`}
      style={{ background: CORES_AVATAR[indice % CORES_AVATAR.length] }}
    >
      {iniciais(nome)}
    </span>
  );
}

/** Cor da régua conforme a proposta se aproxima da meta. */
function corProgresso(pct: number | null): string {
  if (pct == null) return "var(--muted)";
  if (pct >= 85) return "var(--viz-3)";
  if (pct >= 40) return "var(--viz-4)";
  return "var(--viz-2)";
}

/**
 * A régua da negociação.
 *
 * O módulo anterior desenhava um gradiente fixo rosa→verde com um marcador
 * deslizando por cima. O gradiente não codificava nada: um acordo ótimo e um
 * péssimo tinham exatamente a mesma barra colorida, e só a bolinha mudava de
 * lugar. Aqui a barra pinta o trecho percorrido e a cor sai da posição.
 */
function Regua({ a, compacta }: { a: any; compacta?: boolean }) {
  const pct = progressoNegociacao(a);
  if (pct == null) return null;
  return (
    <span className="block">
      <span className="block h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <span
          className="block h-full rounded-full"
          style={{ width: `${Math.max(3, pct)}%`, background: corProgresso(pct) }}
        />
      </span>
      {!compacta && (
        <span className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
          <span className="tabular-nums">{brl(a.valorProposta)}</span>
          <span className="tabular-nums">meta {brl(a.valorPretendido)}</span>
        </span>
      )}
    </span>
  );
}

function rotuloVez(vezDe: "nos" | "eles" | null): string {
  if (vezDe === "nos") return "Esperando nós";
  if (vezDe === "eles") return "Esperando eles";
  return "Sem proposta na mesa";
}

function rotuloParada(a: any): string {
  const d = diasSemMovimento(a.ultimaMovimentacaoEm);
  if (d == null) return "sem movimentação";
  if (d === 0) return "movimentou hoje";
  if (d === 1) return "ontem";
  return `${d} dias sem movimento`;
}

// ─── Página ──────────────────────────────────────────────────────────────────

export default function Acordos() {
  const [grupo, setGrupo] = useState<Grupo>("abertos");
  const [busca, setBusca] = useState("");
  const [buscaAplicada, setBuscaAplicada] = useState("");
  const [responsavelId, setResponsavelId] = useState<string>("todos");
  const [apenasParados, setApenasParados] = useState(false);
  const [detalheId, setDetalheId] = useState<number | null>(null);
  const [novoAberto, setNovoAberto] = useState(false);

  const { data: lista, isLoading, refetch } = trpc.acordos.listar.useQuery({
    grupo,
    busca: buscaAplicada || undefined,
    responsavelId: responsavelId !== "todos" ? Number(responsavelId) : undefined,
    apenasParados: apenasParados || undefined,
  });
  const { data: resumo, refetch: refetchResumo } = trpc.acordos.resumo.useQuery();
  const { data: colabData } = trpc.configuracoes.listarColaboradoresParaFiltro.useQuery({ modulo: "clientes" });
  const colaboradores = (colabData as any)?.colaboradores ?? [];

  const itens = (lista as any)?.itens ?? [];
  const atualizar = () => { refetch(); refetchResumo(); };

  const [emNegociacao, valorEmNegociacao] = [resumo?.emNegociacao ?? 0, resumo?.valorEmNegociacao ?? 0];
  const fatiaEsperandoEles = emNegociacao > 0 ? ((resumo?.esperandoEles ?? 0) / emNegociacao) * 100 : 0;
  const fatiaEsperandoNos = emNegociacao > 0 ? ((resumo?.esperandoNos ?? 0) / emNegociacao) * 100 : 0;

  const somaVisivel = useMemo(
    () => itens.reduce((s: number, a: any) => s + Number(a.valorProposta || 0), 0),
    [itens],
  );

  return (
    <div className="space-y-3.5 p-4 md:p-6">
      <PainelTopo
        titulo="Acordos"
        subtitulo={
          resumo?.periodo?.dataInicio ? (
            <span className="tabular-nums">
              Negociações do escritório · {formatDataCurta(resumo.periodo.dataInicio)} a{" "}
              {formatDataCurta(resumo.periodo.dataFim)}
            </span>
          ) : (
            "Negociações do escritório"
          )
        }
        acao={
          <Button size="sm" className="h-8 bg-violet-600 text-[12px] hover:bg-violet-700" onClick={() => setNovoAberto(true)}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            Novo acordo
          </Button>
        }
      />

      {/* O que travou vem antes de quanto vale — negociação morre de silêncio. */}
      {resumo && (resumo.parados > 0 || resumo.esperandoNos > 0 || resumo.fechadosSemCobranca > 0) && (
        <FaixaAcoes>
          {resumo.parados > 0 && (
            <AcaoCard
              icone={AlertTriangle}
              valor={resumo.parados}
              label={`parados há mais de ${DIAS_PARADO_ALERTA} dias`}
              critico
              onClick={() => { setGrupo("abertos"); setApenasParados(true); }}
            />
          )}
          {resumo.esperandoNos > 0 && (
            <AcaoCard
              icone={Clock}
              valor={resumo.esperandoNos}
              label="esperando resposta nossa"
              onClick={() => { setGrupo("abertos"); setApenasParados(false); }}
            />
          )}
          {resumo.fechadosSemCobranca > 0 && (
            <AcaoCard
              icone={DollarSign}
              valor={resumo.fechadosSemCobranca}
              label="fechados sem cobrança gerada"
              onClick={() => { setGrupo("fechados"); setApenasParados(false); }}
            />
          )}
        </FaixaAcoes>
      )}

      <div className="grid gap-3.5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <BlocoPrincipal
            rotulo="Em negociação agora"
            valor={brl(valorEmNegociacao)}
            badge={
              <span className="inline-flex items-center gap-1.5 rounded-full border bg-muted px-2.5 py-1 text-[11.5px] font-bold text-muted-foreground">
                {emNegociacao} {emNegociacao === 1 ? "acordo aberto" : "acordos abertos"}
              </span>
            }
            grafico={
              emNegociacao > 0 ? (
                <div className="px-4 pb-4 pt-4">
                  <p className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                    De quem é o próximo movimento
                  </p>
                  <span className="flex h-2.5 overflow-hidden rounded-full bg-muted">
                    <span className="block h-full" style={{ width: `${fatiaEsperandoEles}%`, background: COR_SERIE }} />
                    <span className="block h-full" style={{ width: `${fatiaEsperandoNos}%`, background: "var(--viz-2)" }} />
                  </span>
                  <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full" style={{ background: COR_SERIE }} />
                      {resumo?.esperandoEles ?? 0} esperando eles
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full" style={{ background: "var(--viz-2)" }} />
                      {resumo?.esperandoNos ?? 0} esperando nós
                    </span>
                  </div>
                </div>
              ) : (
                <p className="px-4 pb-4 pt-3 text-[11.5px] text-muted-foreground">
                  Nenhuma negociação aberta no momento.
                </p>
              )
            }
          >
            <SubNumeros>
              <SubNumero
                label="Fechado no mês"
                valor={brl(resumo?.valorFechadoMes ?? 0)}
                hint={`${resumo?.fechadosMes ?? 0} ${(resumo?.fechadosMes ?? 0) === 1 ? "acordo" : "acordos"}`}
              />
              <SubNumero
                label="Taxa de fechamento"
                valor={formatPercent(resumo?.taxaFechamentoMes ?? null, 0)}
                hint="dos encerrados no mês"
              />
              <SubNumero
                label="Desconto médio"
                valor={resumo?.descontoMedioMes != null ? formatPercent(resumo.descontoMedioMes, 1) : "—"}
                hint="sobre o valor de origem"
              />
            </SubNumeros>
          </BlocoPrincipal>
        </div>

        <div className="relative min-h-0">
          <div className="lg:absolute lg:inset-0">
            <ListaCard
              titulo="Situação da carteira"
              subtitulo="Onde a negociação está travando"
              esticar
              rodape={
                <>
                  <span>{emNegociacao} abertos</span>
                  {(resumo?.parados ?? 0) > 0 && (
                    <span className="font-semibold text-rose-600 dark:text-rose-400">
                      {resumo!.parados} parados
                    </span>
                  )}
                </>
              }
            >
              <LinhaNumero
                label="Esperando eles"
                valor={resumo?.esperandoEles ?? 0}
                hint="proposta nossa no ar"
              />
              <LinhaNumero
                label="Esperando nós"
                valor={resumo?.esperandoNos ?? 0}
                hint="a bola está com a gente"
                ruim={(resumo?.esperandoNos ?? 0) > 0}
              />
              <LinhaNumero
                label="Sem movimento"
                valor={resumo?.parados ?? 0}
                hint={`nenhuma tratativa há ${DIAS_PARADO_ALERTA}+ dias`}
                ruim={(resumo?.parados ?? 0) > 0}
              />
            </ListaCard>
          </div>
        </div>

        <div className="lg:col-span-3">
          <ListaCard
            titulo={apenasParados ? "Negociações paradas" : "Negociações"}
            subtitulo="Mais paradas primeiro — é o que precisa de ação"
            rodape={
              <>
                <span>
                  {itens.length} de {(lista as any)?.total ?? 0} · {brl(somaVisivel)} na mesa
                </span>
                {(lista as any)?.temMais && <span>Refine a busca para ver o restante</span>}
              </>
            }
          >
            <div className="flex flex-wrap items-center gap-1.5 px-2 pb-2 pt-1">
              {(["abertos", "fechados", "cancelados"] as Grupo[]).map((g) => (
                <button
                  key={g}
                  onClick={() => { setGrupo(g); setApenasParados(false); }}
                  className={`rounded-md px-2.5 py-1 text-[11px] font-semibold capitalize transition-colors ${
                    grupo === g ? "bg-violet-600 text-white" : "border text-muted-foreground hover:bg-accent"
                  }`}
                >
                  {g}
                </button>
              ))}
              {apenasParados && (
                <button
                  onClick={() => setApenasParados(false)}
                  className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300"
                >
                  só parados <X className="h-3 w-3" />
                </button>
              )}
              <form
                className="ml-auto flex items-center gap-1.5"
                onSubmit={(e) => { e.preventDefault(); setBuscaAplicada(busca.trim()); }}
              >
                <Input
                  placeholder="Cliente ou parte contrária…"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  onBlur={() => setBuscaAplicada(busca.trim())}
                  className="h-8 w-[200px] text-[12px]"
                />
                <Select value={responsavelId} onValueChange={setResponsavelId}>
                  <SelectTrigger className="h-8 w-[150px] text-[12px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todo o time</SelectItem>
                    {colaboradores.map((c: any) => (
                      <SelectItem key={c.id} value={String(c.id)}>{c.userName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </form>
            </div>

            <div className="hidden grid-cols-[minmax(0,2.2fr)_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1.1fr)] gap-3 border-b px-2 pb-1.5 text-[10px] font-bold uppercase tracking-[0.06em] text-muted-foreground/70 sm:grid">
              <span>Cliente e parte contrária</span>
              <span>Negociação</span>
              <span>Vez / parada</span>
              <span className="text-right">Responsável</span>
            </div>

            {isLoading ? (
              <p className="flex items-center justify-center gap-2 px-2 py-10 text-xs text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
              </p>
            ) : itens.length === 0 ? (
              <p className="px-2 py-10 text-center text-xs text-muted-foreground">
                {buscaAplicada || apenasParados
                  ? "Nenhum acordo com esses filtros."
                  : "Nenhum acordo aqui ainda."}
              </p>
            ) : (
              itens.map((a: any, i: number) => (
                <LinhaAcordo key={a.id} a={a} indice={i} onAbrir={() => setDetalheId(a.id)} />
              ))
            )}
          </ListaCard>
        </div>
      </div>

      {detalheId != null && (
        <PainelDetalhe id={detalheId} onClose={() => setDetalheId(null)} onUpdate={atualizar} />
      )}
      {novoAberto && <DialogNovo onClose={() => setNovoAberto(false)} onCriado={atualizar} />}
    </div>
  );
}

function LinhaAcordo({ a, indice, onAbrir }: { a: any; indice: number; onAbrir: () => void }) {
  const encerrado = a.status === "fechado" || a.status === "cancelado";
  return (
    <button
      onClick={onAbrir}
      className={`grid w-full grid-cols-1 items-center gap-2 rounded-lg px-2 py-2.5 text-left hover:bg-accent sm:grid-cols-[minmax(0,2.2fr)_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1.1fr)] sm:gap-3 ${
        a.parado ? "bg-rose-50/40 dark:bg-rose-950/10" : ""
      }`}
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <Avatar nome={a.clienteNome} indice={indice} />
        <span className="min-w-0">
          <span className="block truncate text-[12.5px] font-semibold">{a.clienteNome}</span>
          <span className="mt-0.5 block truncate text-[10.5px] text-muted-foreground">
            vs {a.parteContraria}
            {(a.processoApelido || a.processoNumeroCnj) && ` · ${a.processoApelido || a.processoNumeroCnj}`}
          </span>
        </span>
      </span>

      <span className="min-w-0">
        {encerrado ? (
          <span className="block text-[12px] font-semibold tabular-nums">
            {a.valorFechado != null ? brl(a.valorFechado) : brl(a.valorProposta)}
            {a.valorFechado != null && a.valorInicial ? (
              <span className="ml-1.5 text-[10.5px] font-normal text-muted-foreground">
                {formatPercent(descontoSobreOrigem(a.valorInicial, a.valorFechado), 0)} de desconto
              </span>
            ) : null}
          </span>
        ) : (
          <Regua a={a} />
        )}
      </span>

      <span className="min-w-0">
        {encerrado ? (
          <span className="block truncate text-[11.5px] text-muted-foreground">
            {a.status === "cancelado" ? a.motivoCancelamento || "cancelado" : "fechado"}
          </span>
        ) : (
          <>
            <span className="block truncate text-[11.5px] font-semibold">{rotuloVez(a.vezDe)}</span>
            <span
              className={`mt-0.5 block truncate text-[10.5px] ${
                a.parado ? "font-semibold text-rose-600 dark:text-rose-400" : "text-muted-foreground"
              }`}
            >
              {a.proximoPassoEm
                ? `retorno em ${formatDataCurta(a.proximoPassoEm.slice(0, 10))}`
                : rotuloParada(a)}
            </span>
          </>
        )}
      </span>

      <span className="flex min-w-0 items-center justify-start gap-2 sm:justify-end">
        <span className="truncate text-[10.5px] text-muted-foreground">{a.responsavelNome || "—"}</span>
        {a.status === "fechado" && a.cobrancaId == null ? (
          <Selo tom="ruim">sem cobrança</Selo>
        ) : (
          <Selo tom={a.status === "fechado" ? "ok" : a.status === "cancelado" ? "neutro" : "neutro"}>
            {ROTULO_STATUS[a.status as StatusAcordo]}
          </Selo>
        )}
      </span>
    </button>
  );
}

// ─── Painel de detalhe ───────────────────────────────────────────────────────

function PainelDetalhe({ id, onClose, onUpdate }: { id: number; onClose: () => void; onUpdate: () => void }) {
  const { data: a, isLoading, refetch } = trpc.acordos.obter.useQuery({ id });
  const [tratAberto, setTratAberto] = useState(false);
  const [fecharAberto, setFecharAberto] = useState(false);
  const [cancelarAberto, setCancelarAberto] = useState(false);
  const [editarAberto, setEditarAberto] = useState(false);
  const [retornoAberto, setRetornoAberto] = useState(false);
  const [cobrancaAberta, setCobrancaAberta] = useState(false);

  const reabrir = trpc.acordos.reabrir.useMutation({
    onSuccess: () => { toast.success("Acordo reaberto"); refetch(); onUpdate(); },
    onError: (e) => toast.error(e.message),
  });

  const atualizar = () => { refetch(); onUpdate(); };
  const aberto = a?.status === "negociando" || a?.status === "proposta_enviada";
  const pct = a ? progressoNegociacao(a) : null;

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-md [&>button.absolute]:hidden">
        {isLoading || !a ? (
          <div className="flex flex-1 items-center justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (
          <>
            <div className="border-b px-4 py-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <Avatar nome={(a as any).clienteNome} indice={a.id} grande />
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-bold leading-tight">{(a as any).clienteNome}</p>
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      vs {a.parteContraria}
                      {((a as any).processoApelido || (a as any).processoNumeroCnj) &&
                        ` · ${(a as any).processoApelido || (a as any).processoNumeroCnj}`}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {aberto && (
                    <button
                      onClick={() => setEditarAberto(true)}
                      className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11.5px] font-semibold"
                    >
                      <Pencil className="h-3 w-3" /> Editar
                    </button>
                  )}
                  <button
                    onClick={onClose}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                <Selo tom={a.status === "fechado" ? "ok" : a.status === "cancelado" ? "neutro" : "neutro"}>
                  {ROTULO_STATUS[a.status as StatusAcordo]}
                </Selo>
                {(a as any).parado && <Selo tom="ruim">{rotuloParada(a)}</Selo>}
                {(a as any).responsavelNome && (
                  <span className="text-[11px] text-muted-foreground">
                    Responsável: <b className="text-foreground">{(a as any).responsavelNome}</b>
                  </span>
                )}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {/* Valores */}
              <div className="border-b px-4 py-3.5">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-[10.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                    {a.status === "fechado" ? "Fechado em" : "Na mesa agora"}
                  </p>
                  {a.valorInicial ? (
                    <p className="text-[10.5px] text-muted-foreground">
                      origem <b className="tabular-nums text-foreground">{brl(a.valorInicial)}</b>
                    </p>
                  ) : null}
                </div>
                <p className="mt-1 text-[26px] font-bold leading-none tracking-tight tabular-nums">
                  {brl(a.status === "fechado" ? a.valorFechado : a.valorProposta)}
                </p>
                {(() => {
                  const desconto = descontoSobreOrigem(
                    a.valorInicial,
                    a.status === "fechado" ? a.valorFechado : a.valorProposta,
                  );
                  return desconto != null ? (
                    <p className="mt-1 text-[11.5px] text-muted-foreground">
                      <b className="text-foreground">{formatPercent(desconto, 1)}</b> de desconto sobre a origem
                    </p>
                  ) : null;
                })()}

                {pct != null && a.status !== "cancelado" && (
                  <div className="mt-3.5">
                    <span className="block h-2.5 w-full overflow-hidden rounded-full bg-muted">
                      <span
                        className="block h-full rounded-full"
                        style={{ width: `${Math.max(3, pct)}%`, background: corProgresso(pct) }}
                      />
                    </span>
                    <div className="mt-2 flex items-center justify-between text-[10.5px] text-muted-foreground">
                      <span>limite <b className="tabular-nums text-foreground">{brl(a.valorDisponivel)}</b></span>
                      <span>meta <b className="tabular-nums text-foreground">{brl(a.valorPretendido)}</b></span>
                    </div>
                    <p className="mt-2 border-t pt-2 text-[11px] text-muted-foreground">
                      <span className="tabular-nums">{Math.round(pct)}%</span> do caminho entre o limite e a meta
                    </p>
                  </div>
                )}
                {pct == null && aberto && (
                  <p className="mt-2 text-[11.5px] text-muted-foreground">
                    Marcos ainda não definidos. Use <b>Editar</b> para informar origem, meta e limite — a régua
                    aparece em seguida.
                  </p>
                )}
              </div>

              {a.motivoCancelamento && (
                <div className="border-b bg-rose-50 px-4 py-2.5 text-[11.5px] text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">
                  Cancelado: <b>{a.motivoCancelamento}</b>
                </div>
              )}

              {/* Outro lado */}
              <div className="border-b px-4 py-3">
                <p className="text-[10.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                  Quem negocia do outro lado
                </p>
                <div className="mt-1.5 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[12.5px] font-semibold">{a.contatoContrarioNome || "—"}</p>
                    {a.contatoContrarioTelefone && (
                      <p className="text-[11px] tabular-nums text-muted-foreground">{a.contatoContrarioTelefone}</p>
                    )}
                  </div>
                  {a.contatoContrarioTelefone && (
                    <a
                      href={`https://wa.me/${a.contatoContrarioTelefone.replace(/\D/g, "")}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11.5px] font-semibold text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"
                    >
                      <Phone className="h-3.5 w-3.5" /> WhatsApp
                    </a>
                  )}
                </div>
              </div>

              {/* Histórico */}
              <div className="px-4 py-3.5">
                <div className="flex items-center justify-between">
                  <p className="text-[10.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                    Histórico da negociação
                  </p>
                  <span className="text-[10.5px] text-muted-foreground">
                    {(a.tratativas || []).length} registros
                  </span>
                </div>
                <div className="relative mt-3 space-y-3.5 before:absolute before:bottom-1 before:left-[3px] before:top-1 before:w-px before:bg-border">
                  {(a.tratativas || []).map((t: any) => (
                    <div key={t.id} className="relative pl-5">
                      <span
                        className="absolute left-0 top-[6px] h-2 w-2 rounded-full ring-2 ring-background"
                        style={{ background: t.daParteContraria ? "var(--viz-2)" : COR_SERIE }}
                      />
                      <p className="text-[12.5px] leading-snug">
                        {t.conteudo}
                        {t.valor != null && <span className="font-bold tabular-nums"> · {brl(t.valor)}</span>}
                      </p>
                      <p className="mt-0.5 text-[10.5px] text-muted-foreground">
                        {t.autor} ·{" "}
                        {new Date(t.createdAt).toLocaleString("pt-BR", {
                          day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
                        })}
                      </p>
                    </div>
                  ))}
                  {(a.tratativas || []).length === 0 && (
                    <p className="text-[11.5px] text-muted-foreground">Sem tratativas registradas.</p>
                  )}
                </div>
              </div>
            </div>

            <div className="border-t px-4 py-3">
              {aberto && (a as any).parado && !(a as any).proximoPassoEm && (
                <p className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11.5px] text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                  {rotuloParada(a)}. Próximo passo não agendado.
                </p>
              )}
              {(a as any).proximoPassoEm && (
                <p className="mb-2 rounded-md border bg-muted px-2.5 py-2 text-[11.5px] text-muted-foreground">
                  Retorno agendado para{" "}
                  <b className="text-foreground">{formatDataCurta((a as any).proximoPassoEm.slice(0, 10))}</b>.
                </p>
              )}

              {aberto ? (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" className="flex-1 bg-violet-600 text-[12px] hover:bg-violet-700" onClick={() => setTratAberto(true)}>
                    Registrar
                  </Button>
                  <Button size="sm" variant="outline" className="flex-1 text-[12px]" onClick={() => setRetornoAberto(true)}>
                    Agendar retorno
                  </Button>
                  <Button size="sm" className="bg-emerald-600 text-[12px] hover:bg-emerald-700" onClick={() => setFecharAberto(true)}>
                    Fechar
                  </Button>
                  <Button size="sm" variant="outline" className="border-rose-200 dark:border-rose-800/50 text-[12px] text-rose-600 dark:text-rose-400" onClick={() => setCancelarAberto(true)}>
                    Cancelar
                  </Button>
                </div>
              ) : a.status === "fechado" ? (
                <div className="flex flex-wrap items-center gap-2">
                  {a.cobrancaId == null ? (
                    <>
                      <Button size="sm" className="flex-1 bg-violet-600 text-[12px] hover:bg-violet-700" onClick={() => setCobrancaAberta(true)}>
                        Gerar cobrança
                      </Button>
                      <span className="text-[11px] text-muted-foreground">Fechar não cobra sozinho.</span>
                    </>
                  ) : (
                    <p className="text-[11.5px] text-emerald-700 dark:text-emerald-300">
                      Cobrança já gerada a partir deste acordo.
                    </p>
                  )}
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-[12px]"
                    disabled={reabrir.isPending}
                    onClick={() => reabrir.mutate({ acordoId: a.id })}
                  >
                    {reabrir.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                    Reabrir negociação
                  </Button>
                  <span className="text-[11px] text-muted-foreground">O histórico é preservado.</span>
                </div>
              )}
            </div>

            {tratAberto && <DialogTratativa acordoId={a.id} onClose={() => setTratAberto(false)} onFeito={atualizar} />}
            {fecharAberto && <DialogFechar acordoId={a.id} valorAtual={a.valorProposta} onClose={() => setFecharAberto(false)} onFeito={atualizar} />}
            {cancelarAberto && <DialogCancelar acordoId={a.id} onClose={() => setCancelarAberto(false)} onFeito={atualizar} />}
            {editarAberto && <DialogEditar a={a} onClose={() => setEditarAberto(false)} onFeito={atualizar} />}
            {retornoAberto && <DialogRetorno acordoId={a.id} parte={a.parteContraria} onClose={() => setRetornoAberto(false)} onFeito={atualizar} />}
            {cobrancaAberta && (
              <DialogCobranca
                acordoId={a.id}
                contatoId={a.contatoId}
                valorFechado={a.valorFechado}
                onClose={() => setCobrancaAberta(false)}
                onFeito={atualizar}
              />
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ─── Diálogos ────────────────────────────────────────────────────────────────

function CamposValores({
  inicial, setInicial, pretendido, setPretendido, disponivel, setDisponivel,
}: {
  inicial: string; setInicial: (v: string) => void;
  pretendido: string; setPretendido: (v: string) => void;
  disponivel: string; setDisponivel: (v: string) => void;
}) {
  return (
    <div className="border-t pt-3">
      <Label className="text-[12px] font-semibold">Valores da negociação</Label>
      <div className="mt-1.5 grid grid-cols-3 gap-2">
        <div>
          <Label className="text-[11px] text-muted-foreground">Origem <span className="text-muted-foreground/60">dívida</span></Label>
          <Input placeholder="R$ 0,00" value={inicial} onChange={(e) => setInicial(e.target.value)} className="mt-1 tabular-nums" />
        </div>
        <div>
          <Label className="text-[11px] text-emerald-700 dark:text-emerald-400">Meta <span className="text-muted-foreground/60">alvo</span></Label>
          <Input placeholder="R$ 0,00" value={pretendido} onChange={(e) => setPretendido(e.target.value)} className="mt-1 tabular-nums" />
        </div>
        <div>
          <Label className="text-[11px] text-rose-700 dark:text-rose-400">Limite <span className="text-muted-foreground/60">teto</span></Label>
          <Input placeholder="R$ 0,00" value={disponivel} onChange={(e) => setDisponivel(e.target.value)} className="mt-1 tabular-nums" />
        </div>
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
        Numa quitação: <b>origem</b> é o que o cliente deve, <b>meta</b> é quanto se quer pagar e{" "}
        <b>limite</b> é o teto que ele aguenta. O sentido da régua sai sozinho de meta × limite.
      </p>
    </div>
  );
}

function DialogNovo({ onClose, onCriado }: { onClose: () => void; onCriado: () => void }) {
  const [contatoId, setContatoId] = useState<number | null>(null);
  const [nomeSelecionado, setNomeSelecionado] = useState("");
  const [busca, setBusca] = useState("");
  const [parteContraria, setParteContraria] = useState("");
  const [contatoNome, setContatoNome] = useState("");
  const [contatoTel, setContatoTel] = useState("");
  const [valInicial, setValInicial] = useState("");
  const [valPretendido, setValPretendido] = useState("");
  const [valDisponivel, setValDisponivel] = useState("");
  const [processoId, setProcessoId] = useState<string>("nenhum");

  const { data: clientesData } = trpc.clientes.listar.useQuery(
    { busca: busca || undefined, limite: 20, estagio: "todos" },
    { enabled: busca.length >= 2 },
  );
  const clientes = (clientesData as any)?.clientes ?? [];
  const { data: processos = [] } = trpc.clienteProcessos.listar.useQuery(
    { contatoId: contatoId! },
    { enabled: !!contatoId },
  );

  const criar = trpc.acordos.criar.useMutation({
    onSuccess: () => { toast.success("Acordo criado"); onCriado(); onClose(); },
    onError: (e) => toast.error(e.message),
  });

  const submeter = () => {
    if (!contatoId) { toast.error("Selecione o cliente"); return; }
    if (!parteContraria.trim()) { toast.error("Informe a parte contrária"); return; }
    const ini = paraCentavos(valInicial), pre = paraCentavos(valPretendido), dis = paraCentavos(valDisponivel);
    if (ini == null || pre == null || dis == null) { toast.error("Preencha os três valores"); return; }
    criar.mutate({
      contatoId,
      processoId: processoId !== "nenhum" ? Number(processoId) : undefined,
      parteContraria: parteContraria.trim(),
      contatoContrarioNome: contatoNome.trim() || undefined,
      contatoContrarioTelefone: contatoTel.trim() || undefined,
      valorInicial: ini,
      valorPretendido: pre,
      valorDisponivel: dis,
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Novo acordo</DialogTitle></DialogHeader>
        <div className="max-h-[70vh] space-y-3 overflow-y-auto text-[13px]">
          <div>
            <Label className="text-[12px]">Cliente</Label>
            {contatoId ? (
              <div className="mt-1 flex items-center justify-between rounded-md border px-3 py-2">
                <span className="font-medium">{nomeSelecionado}</span>
                <button onClick={() => { setContatoId(null); setProcessoId("nenhum"); }} className="text-muted-foreground">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <>
                <Input placeholder="Buscar cliente do escritório…" value={busca} onChange={(e) => setBusca(e.target.value)} className="mt-1" />
                {clientes.length > 0 && (
                  <div className="mt-1 max-h-40 divide-y overflow-y-auto rounded-md border">
                    {clientes.map((c: any) => (
                      <button
                        key={c.id}
                        onClick={() => { setContatoId(c.id); setNomeSelecionado(c.nome); }}
                        className="w-full px-3 py-2 text-left hover:bg-accent"
                      >
                        <p className="font-medium">{c.nome}</p>
                        {c.telefone && <p className="text-[11px] text-muted-foreground">{c.telefone}</p>}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {contatoId && (processos as any[]).length > 0 && (
            <div>
              <Label className="text-[12px]">Processo vinculado <span className="font-normal text-muted-foreground">(opcional)</span></Label>
              <Select value={processoId} onValueChange={setProcessoId}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="nenhum">— nenhum / extrajudicial puro —</SelectItem>
                  {(processos as any[]).map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.apelido || p.numeroCnj || `Processo #${p.id}`}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div>
            <Label className="text-[12px]">Parte contrária</Label>
            <Input placeholder="Ex.: Banco Crédito S/A" value={parteContraria} onChange={(e) => setParteContraria(e.target.value)} className="mt-1" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-[12px]">Contato (outro lado)</Label>
              <Input placeholder="Ex.: Dr. Ricardo" value={contatoNome} onChange={(e) => setContatoNome(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label className="text-[12px]">Telefone do contato</Label>
              <Input placeholder="(85) 9…" value={contatoTel} onChange={(e) => setContatoTel(e.target.value)} className="mt-1 tabular-nums" />
            </div>
          </div>

          <CamposValores
            inicial={valInicial} setInicial={setValInicial}
            pretendido={valPretendido} setPretendido={setValPretendido}
            disponivel={valDisponivel} setDisponivel={setValDisponivel}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button className="bg-violet-600 hover:bg-violet-700" onClick={submeter} disabled={criar.isPending}>
            {criar.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Criar acordo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DialogEditar({ a, onClose, onFeito }: { a: any; onClose: () => void; onFeito: () => void }) {
  const [parteContraria, setParteContraria] = useState<string>(a.parteContraria ?? "");
  const [contatoNome, setContatoNome] = useState<string>(a.contatoContrarioNome ?? "");
  const [contatoTel, setContatoTel] = useState<string>(a.contatoContrarioTelefone ?? "");
  const [responsavelUserId, setResponsavelUserId] = useState<string | undefined>(undefined);
  const [processoId, setProcessoId] = useState<string>(a.processoId != null ? String(a.processoId) : "nenhum");
  const [valInicial, setValInicial] = useState<string>(centsParaInput(a.valorInicial));
  const [valPretendido, setValPretendido] = useState<string>(centsParaInput(a.valorPretendido));
  const [valDisponivel, setValDisponivel] = useState<string>(centsParaInput(a.valorDisponivel));

  const { data: colabData } = trpc.configuracoes.listarColaboradoresParaFiltro.useQuery({ modulo: "clientes" });
  const colaboradores = (colabData as any)?.colaboradores ?? [];
  const { data: processos = [] } = trpc.clienteProcessos.listar.useQuery({ contatoId: a.contatoId }, { enabled: !!a.contatoId });
  const respAtualUserId = colaboradores.find((c: any) => c.id === a.responsavelId)?.userId;
  const respValue = responsavelUserId ?? (respAtualUserId != null ? String(respAtualUserId) : "");

  const m = trpc.acordos.editar.useMutation({
    onSuccess: () => { toast.success("Acordo atualizado"); onFeito(); onClose(); },
    onError: (e) => toast.error(e.message),
  });

  const salvar = () => {
    if (!parteContraria.trim()) { toast.error("Informe a parte contrária"); return; }
    const ini = paraCentavos(valInicial), pre = paraCentavos(valPretendido), dis = paraCentavos(valDisponivel);
    if (ini == null || pre == null || dis == null) { toast.error("Preencha os três valores"); return; }
    m.mutate({
      id: a.id,
      parteContraria: parteContraria.trim(),
      contatoContrarioNome: contatoNome.trim() || undefined,
      contatoContrarioTelefone: contatoTel.trim() || undefined,
      responsavelUserId: respValue ? Number(respValue) : undefined,
      processoId: processoId !== "nenhum" ? Number(processoId) : null,
      valorInicial: ini,
      valorPretendido: pre,
      valorDisponivel: dis,
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Editar acordo</DialogTitle></DialogHeader>
        <div className="max-h-[70vh] space-y-3 overflow-y-auto text-[13px]">
          <div className="text-[12px] text-muted-foreground">
            Cliente: <b className="text-foreground">{a.clienteNome}</b>{" "}
            <span className="text-muted-foreground/60">(fixo — vinculado ao cadastro)</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-[12px]">Parte contrária</Label>
              <Input value={parteContraria} onChange={(e) => setParteContraria(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label className="text-[12px]">Responsável</Label>
              <Select value={respValue} onValueChange={setResponsavelUserId}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Selecionar…" /></SelectTrigger>
                <SelectContent>
                  {colaboradores.map((c: any) => (
                    <SelectItem key={c.userId} value={String(c.userId)}>{c.userName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-[12px]">Contato (outro lado)</Label>
              <Input value={contatoNome} onChange={(e) => setContatoNome(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label className="text-[12px]">Telefone do contato</Label>
              <Input value={contatoTel} onChange={(e) => setContatoTel(e.target.value)} className="mt-1 tabular-nums" />
            </div>
          </div>
          <div>
            <Label className="text-[12px]">Processo vinculado</Label>
            <Select value={processoId} onValueChange={setProcessoId}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="nenhum">— nenhum / extrajudicial puro —</SelectItem>
                {(processos as any[]).map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>{p.apelido || p.numeroCnj || `Processo #${p.id}`}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <CamposValores
            inicial={valInicial} setInicial={setValInicial}
            pretendido={valPretendido} setPretendido={setValPretendido}
            disponivel={valDisponivel} setDisponivel={setValDisponivel}
          />
          <p className="text-[11px] text-muted-foreground">
            O valor na mesa (R$ {centsParaInput(a.valorProposta) || "0,00"}) vem da última tratativa — muda ao
            registrar proposta ou contraproposta, não aqui.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button className="bg-violet-600 hover:bg-violet-700" onClick={salvar} disabled={m.isPending}>
            {m.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Salvar alterações
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DialogTratativa({ acordoId, onClose, onFeito }: { acordoId: number; onClose: () => void; onFeito: () => void }) {
  const [tipo, setTipo] = useState<"proposta" | "contraproposta" | "nota">("proposta");
  const [valor, setValor] = useState("");
  const [conteudo, setConteudo] = useState("");
  const [daContraria, setDaContraria] = useState(false);
  const m = trpc.acordos.registrarTratativa.useMutation({
    onSuccess: () => { toast.success("Tratativa registrada"); onFeito(); onClose(); },
    onError: (e) => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>Registrar tratativa</DialogTitle></DialogHeader>
        <div className="space-y-3 text-[13px]">
          <div>
            <Label className="text-[12px]">Tipo</Label>
            <Select value={tipo} onValueChange={(v) => setTipo(v as any)}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="proposta">Proposta</SelectItem>
                <SelectItem value="contraproposta">Contraproposta</SelectItem>
                <SelectItem value="nota">Nota / andamento</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {tipo !== "nota" && (
            <div>
              <Label className="text-[12px]">Valor</Label>
              <Input placeholder="R$ 0,00" value={valor} onChange={(e) => setValor(e.target.value)} className="mt-1 tabular-nums" />
            </div>
          )}
          <div>
            <Label className="text-[12px]">Descrição</Label>
            <Textarea placeholder="O que foi tratado…" value={conteudo} onChange={(e) => setConteudo(e.target.value)} className="mt-1 h-20" />
          </div>
          <label className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <input type="checkbox" checked={daContraria} onChange={(e) => setDaContraria(e.target.checked)} />
            Veio da parte contrária
          </label>
          <p className="text-[11px] text-muted-foreground">
            É essa marcação que define de quem passa a ser a vez na lista.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button
            className="bg-violet-600 hover:bg-violet-700"
            disabled={m.isPending || !conteudo.trim()}
            onClick={() =>
              m.mutate({
                acordoId, tipo,
                valor: valor ? paraCentavos(valor) : undefined,
                conteudo: conteudo.trim(),
                daParteContraria: daContraria,
              })
            }
          >
            {m.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Registrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DialogRetorno({ acordoId, parte, onClose, onFeito }: { acordoId: number; parte: string; onClose: () => void; onFeito: () => void }) {
  const emDias = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const [data, setData] = useState(emDias(7));
  const [titulo, setTitulo] = useState(`Retomar acordo com ${parte}`);
  const m = trpc.acordos.agendarRetorno.useMutation({
    onSuccess: () => { toast.success("Retorno agendado — a tarefa está na sua agenda"); onFeito(); onClose(); },
    onError: (e) => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>Agendar retorno</DialogTitle></DialogHeader>
        <div className="space-y-3 text-[13px]">
          <p className="text-[11.5px] leading-relaxed text-muted-foreground">
            Cria uma tarefa de verdade, com responsável e prazo — ela aparece na agenda de hoje e no painel
            Operacional, e some daqui quando for concluída ou quando a negociação andar.
          </p>
          <div>
            <Label className="text-[12px]">Quando retomar</Label>
            <Input type="date" value={data} onChange={(e) => setData(e.target.value)} className="mt-1" />
            <div className="mt-1.5 flex gap-1.5">
              {[3, 7, 15].map((d) => (
                <button
                  key={d}
                  onClick={() => setData(emDias(d))}
                  className="rounded-md border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent"
                >
                  em {d} dias
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label className="text-[12px]">O que fazer</Label>
            <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} className="mt-1" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Voltar</Button>
          <Button
            className="bg-violet-600 hover:bg-violet-700"
            disabled={m.isPending || !data}
            onClick={() => m.mutate({ acordoId, data, titulo: titulo.trim() || undefined })}
          >
            {m.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Agendar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DialogFechar({ acordoId, valorAtual, onClose, onFeito }: { acordoId: number; valorAtual?: number | null; onClose: () => void; onFeito: () => void }) {
  const [valor, setValor] = useState(centsParaInput(valorAtual));
  const m = trpc.acordos.fechar.useMutation({
    onSuccess: () => { toast.success("Acordo fechado"); onFeito(); onClose(); },
    onError: (e) => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>Fechar acordo</DialogTitle></DialogHeader>
        <div className="space-y-3 text-[13px]">
          <div>
            <Label className="text-[12px]">Valor final acordado</Label>
            <Input placeholder="R$ 0,00" value={valor} onChange={(e) => setValor(e.target.value)} className="mt-1 tabular-nums" />
          </div>
          <p className="text-[11.5px] leading-relaxed text-muted-foreground">
            Fechar <b>não</b> emite cobrança. O botão de gerar aparece aqui depois, pra que ninguém receba um
            boleto por causa de uma mudança de status.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Voltar</Button>
          <Button
            className="bg-emerald-600 hover:bg-emerald-700"
            disabled={m.isPending}
            onClick={() => {
              const c = paraCentavos(valor);
              if (c == null) { toast.error("Informe o valor"); return; }
              m.mutate({ acordoId, valorFechado: c });
            }}
          >
            {m.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Confirmar fechamento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Gera a cobrança do acordo fechado.
 *
 * Chama `asaas.criarCobranca` em vez de escrever no Asaas por conta própria:
 * aquela procedure já carrega idempotência, gate do Financeiro e a regra de
 * comissão. A chave de idempotência é derivada do acordo, então reclicar depois
 * de um timeout reencontra a cobrança em vez de emitir uma segunda.
 */
function DialogCobranca({
  acordoId, contatoId, valorFechado, onClose, onFeito,
}: {
  acordoId: number; contatoId: number; valorFechado?: number | null;
  onClose: () => void; onFeito: () => void;
}) {
  const [valor, setValor] = useState(centsParaInput(valorFechado));
  const [vencimento, setVencimento] = useState(new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10));
  const [forma, setForma] = useState<"BOLETO" | "PIX" | "CREDIT_CARD" | "UNDEFINED">("BOLETO");

  const vincular = trpc.acordos.vincularCobranca.useMutation({
    onSuccess: () => { toast.success("Cobrança gerada e vinculada ao acordo"); onFeito(); onClose(); },
    onError: (e) => toast.error(`Cobrança criada, mas não vinculou: ${e.message}`),
  });
  const criar = (trpc as any).asaas.criarCobranca.useMutation({
    onSuccess: (res: any) => {
      const asaasPaymentId = res?.cobranca?.id;
      if (!asaasPaymentId) { toast.error("Cobrança criada sem identificador — vincule pelo Financeiro."); onClose(); return; }
      vincular.mutate({ acordoId, asaasPaymentId: String(asaasPaymentId) });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const ocupado = criar.isPending || vincular.isPending;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>Gerar cobrança do acordo</DialogTitle></DialogHeader>
        <div className="space-y-3 text-[13px]">
          <div>
            <Label className="text-[12px]">Valor</Label>
            <Input value={valor} onChange={(e) => setValor(e.target.value)} className="mt-1 tabular-nums" />
          </div>
          <div>
            <Label className="text-[12px]">Vencimento</Label>
            <Input type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label className="text-[12px]">Forma de pagamento</Label>
            <Select value={forma} onValueChange={(v) => setForma(v as any)}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="BOLETO">Boleto</SelectItem>
                <SelectItem value="PIX">Pix</SelectItem>
                <SelectItem value="CREDIT_CARD">Cartão de crédito</SelectItem>
                <SelectItem value="UNDEFINED">Deixar o cliente escolher</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <p className="text-[11px] text-muted-foreground">
            A cobrança vai para o cliente do acordo, pelo Financeiro, com as mesmas regras de comissão de
            qualquer outra.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Voltar</Button>
          <Button
            className="bg-violet-600 hover:bg-violet-700"
            disabled={ocupado}
            onClick={() => {
              const c = paraCentavos(valor);
              if (c == null || c <= 0) { toast.error("Informe o valor"); return; }
              criar.mutate({
                contatoId,
                valor: c / 100,
                vencimento,
                formaPagamento: forma,
                descricao: `Acordo #${acordoId}`,
                idempotencyKey: `acordo-${acordoId}`,
              });
            }}
          >
            {ocupado && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Gerar cobrança
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const MOTIVOS = [
  "Cliente preferiu prosseguir com a ação",
  "Parte contrária recusou a proposta",
  "Valor fora do que o cliente aguenta",
  "Sem resposta da parte contrária",
  "Outro",
];

function DialogCancelar({ acordoId, onClose, onFeito }: { acordoId: number; onClose: () => void; onFeito: () => void }) {
  const [motivo, setMotivo] = useState(MOTIVOS[0]!);
  const [obs, setObs] = useState("");
  const m = trpc.acordos.cancelar.useMutation({
    onSuccess: () => { toast.success("Acordo cancelado"); onFeito(); onClose(); },
    onError: (e) => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>Cancelar acordo</DialogTitle></DialogHeader>
        <div className="space-y-3 text-[13px]">
          <p className="text-[11.5px] leading-relaxed text-muted-foreground">
            O motivo fica no histórico e aparece na lista. Dá pra reabrir depois — o histórico é preservado.
          </p>
          <div>
            <Label className="text-[12px]">Motivo</Label>
            <Select value={motivo} onValueChange={setMotivo}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>{MOTIVOS.map((mo) => <SelectItem key={mo} value={mo}>{mo}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <Textarea placeholder="Observação (opcional)" value={obs} onChange={(e) => setObs(e.target.value)} className="h-20" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Voltar</Button>
          <Button
            className="bg-rose-600 hover:bg-rose-700"
            disabled={m.isPending}
            onClick={() => m.mutate({ acordoId, motivo, observacao: obs.trim() || undefined })}
          >
            {m.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Confirmar cancelamento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
