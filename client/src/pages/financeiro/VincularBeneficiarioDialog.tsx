/**
 * Dialog "Vincular pagamentos de terceiro" (versão multi-select).
 *
 * Caso resolvido: Carlos é cliente, mas R$ 10k caíram no Asaas no CPF da
 * esposa em 4 cobranças diferentes. Antes era 1 dialog por cobrança;
 * agora seleciona todas + clica vincular numa só ação.
 *
 * Recursos:
 *  - Multi-select com checkbox + agrupar por pagador (default ON)
 *  - Filtros: busca, forma de pagamento, origem (Asaas/manual),
 *    valor min/max, período (data pagamento)
 *  - Barra de seleção sempre visível com total
 *  - Checkbox de grupo marca todas as cobranças daquele pagador
 *  - Botão dinâmico "Vincular N cobranças"
 *
 * Procedure: `asaas.vincularPagamentoBeneficiarioEmMassa` aceita até 50
 * cobranças. Retorna { vinculadas, atendentesReatribuidos, erros[] }.
 */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { MultiSelectFilter } from "@/components/MultiSelectFilter";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Link2,
  Loader2,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { formatBRL } from "./helpers";

type Candidato = {
  id: number;
  asaasPaymentId: string | null;
  valor: string;
  status: string;
  dataPagamento: string | null;
  descricao: string | null;
  contatoIdPagador: number | null;
  contatoNomePagador: string | null;
  contatoCpfPagador: string | null;
  origem: string;
  formaPagamento: string | null;
};

const FORMAS_OPTS = [
  { value: "PIX", label: "Pix" },
  { value: "BOLETO", label: "Boleto" },
  { value: "CREDIT_CARD", label: "Cartão" },
  { value: "DINHEIRO", label: "Dinheiro" },
  { value: "TRANSFERENCIA", label: "Transferência" },
  { value: "OUTRO", label: "Outro" },
  { value: "UNDEFINED", label: "Indefinido" },
];

function FormaBadge({ forma }: { forma: string | null }) {
  if (!forma) return <span className="text-slate-400">—</span>;
  const cores: Record<string, string> = {
    PIX: "bg-blue-50 text-blue-700 border-blue-200",
    BOLETO: "bg-orange-50 text-orange-700 border-orange-200",
    CREDIT_CARD: "bg-emerald-50 text-emerald-700 border-emerald-200",
    DINHEIRO: "bg-amber-50 text-amber-700 border-amber-200",
    TRANSFERENCIA: "bg-violet-50 text-violet-700 border-violet-200",
  };
  const label =
    FORMAS_OPTS.find((o) => o.value === forma)?.label ?? forma;
  return (
    <span
      className={
        "inline-block px-1.5 py-0.5 rounded text-[10px] font-medium border " +
        (cores[forma] ?? "bg-slate-50 text-slate-600 border-slate-200")
      }
    >
      {label}
    </span>
  );
}

export function VincularBeneficiarioDialog({
  open,
  onOpenChange,
  contatoBeneficiarioId,
  contatoBeneficiarioNome,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  contatoBeneficiarioId: number;
  contatoBeneficiarioNome: string;
  onSuccess: () => void;
}) {
  const utils = trpc.useUtils();
  const [busca, setBusca] = useState("");
  const [formaPagamento, setFormaPagamento] = useState<string[]>([]);
  const [origem, setOrigem] = useState<"manual" | "asaas" | "todas">("todas");
  const [valorMin, setValorMin] = useState<string>("");
  const [valorMax, setValorMax] = useState<string>("");
  const [periodoInicio, setPeriodoInicio] = useState<string>("");
  const [periodoFim, setPeriodoFim] = useState<string>("");
  const [agruparPorPagador, setAgruparPorPagador] = useState(true);
  const [selecionadas, setSelecionadas] = useState<Set<number>>(new Set());
  const [reatribuirAtendente, setReatribuirAtendente] = useState(true);
  const [gruposExpandidos, setGruposExpandidos] = useState<Set<string>>(
    new Set(),
  );

  const { data: candidatos = [], isLoading } = (trpc as any).asaas
    .listarCobrancasParaVincularBeneficiario.useQuery(
      {
        contatoBeneficiarioId,
        busca: busca.trim() || undefined,
        formaPagamento: formaPagamento.length > 0 ? formaPagamento : undefined,
        origem: origem === "todas" ? undefined : origem,
        valorMin: valorMin ? parseFloat(valorMin) : undefined,
        valorMax: valorMax ? parseFloat(valorMax) : undefined,
        periodoInicio: periodoInicio || undefined,
        periodoFim: periodoFim || undefined,
        limit: 100,
      },
      { enabled: open, retry: false },
    );

  const vincularMut = (trpc as any).asaas.vincularPagamentoBeneficiarioEmMassa.useMutation({
    onSuccess: (r: {
      vinculadas: number;
      atendentesReatribuidos: number;
      erros: Array<{ cobrancaId: number; mensagem: string }>;
    }) => {
      if (r.vinculadas > 0) {
        toast.success(
          `${r.vinculadas} cobrança${r.vinculadas === 1 ? "" : "s"} vinculada${r.vinculadas === 1 ? "" : "s"}`,
          {
            description:
              r.atendentesReatribuidos > 0
                ? `${r.atendentesReatribuidos} atendente${r.atendentesReatribuidos === 1 ? "" : "s"} reatribuído${r.atendentesReatribuidos === 1 ? "" : "s"}.`
                : "Cobranças contam no caixa do cliente.",
          },
        );
      }
      if (r.erros.length > 0) {
        toast.warning(`${r.erros.length} cobrança(s) ignorada(s)`, {
          description: r.erros.slice(0, 3).map((e) => e.mensagem).join(" · "),
        });
      }
      utils.asaas.resumoContato.invalidate();
      utils.asaas.resumoPorContatos.invalidate();
      utils.asaas.listarCobrancas.invalidate();
      utils.asaas.kpis.invalidate();
      onSuccess();
      if (r.vinculadas > 0 && r.erros.length === 0) {
        onOpenChange(false);
        setSelecionadas(new Set());
        setBusca("");
      }
    },
    onError: (err: any) =>
      toast.error("Erro ao vincular", { description: err.message }),
  });

  // Agrupa candidatos por pagador (contatoIdPagador). "sem contato" vira
  // grupo único de IDs string="null".
  type Grupo = {
    chave: string;
    pagadorId: number | null;
    pagadorNome: string;
    cpf: string | null;
    cobrancas: Candidato[];
    valorTotal: number;
  };
  const grupos = useMemo<Grupo[]>(() => {
    const map = new Map<string, Grupo>();
    for (const c of candidatos as Candidato[]) {
      const chave =
        c.contatoIdPagador !== null ? String(c.contatoIdPagador) : "null";
      const nome = c.contatoNomePagador ?? "(sem contato vinculado)";
      const grupo = map.get(chave);
      if (grupo) {
        grupo.cobrancas.push(c);
        grupo.valorTotal += parseFloat(c.valor) || 0;
      } else {
        map.set(chave, {
          chave,
          pagadorId: c.contatoIdPagador,
          pagadorNome: nome,
          cpf: c.contatoCpfPagador ?? null,
          cobrancas: [c],
          valorTotal: parseFloat(c.valor) || 0,
        });
      }
    }
    return Array.from(map.values()).sort(
      (a, b) => b.valorTotal - a.valorTotal,
    );
  }, [candidatos]);

  const selecionadasResumo = useMemo(() => {
    let total = 0;
    const pagadoresSet = new Set<string>();
    for (const c of candidatos as Candidato[]) {
      if (selecionadas.has(c.id)) {
        total += parseFloat(c.valor) || 0;
        pagadoresSet.add(
          c.contatoIdPagador !== null ? String(c.contatoIdPagador) : "null",
        );
      }
    }
    return { total, pagadores: pagadoresSet.size };
  }, [candidatos, selecionadas]);

  function toggleId(id: number) {
    const next = new Set(selecionadas);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelecionadas(next);
  }
  function toggleGrupo(grupo: Grupo) {
    const idsGrupo = grupo.cobrancas.map((c) => c.id);
    const todasMarcadas = idsGrupo.every((id) => selecionadas.has(id));
    const next = new Set(selecionadas);
    if (todasMarcadas) {
      idsGrupo.forEach((id) => next.delete(id));
    } else {
      idsGrupo.forEach((id) => next.add(id));
    }
    setSelecionadas(next);
  }
  function toggleTodos() {
    const totalSelecionavel = (candidatos as Candidato[]).length;
    if (selecionadas.size === totalSelecionavel) {
      setSelecionadas(new Set());
    } else {
      setSelecionadas(new Set((candidatos as Candidato[]).map((c) => c.id)));
    }
  }
  function toggleExpansaoGrupo(chave: string) {
    const next = new Set(gruposExpandidos);
    if (next.has(chave)) next.delete(chave);
    else next.add(chave);
    setGruposExpandidos(next);
  }
  function limparFiltros() {
    setBusca("");
    setFormaPagamento([]);
    setOrigem("todas");
    setValorMin("");
    setValorMax("");
    setPeriodoInicio("");
    setPeriodoFim("");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>
            Vincular pagamentos de terceiro a {contatoBeneficiarioNome}
          </DialogTitle>
          <DialogDescription>
            Pagamentos que entraram no Asaas no CPF de terceiros (cônjuge,
            familiar, sócio) mas são dívida deste cliente. Selecione todos
            os relacionados e clique em "Vincular".
          </DialogDescription>
        </DialogHeader>

        {/* Filtros */}
        <div className="space-y-2 rounded-md border bg-muted/30 p-3">
          <div className="flex gap-2 flex-wrap items-center">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar pagador ou descrição..."
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                className="pl-9 h-8 text-xs"
              />
            </div>
            <MultiSelectFilter
              placeholder="Forma: todas"
              value={formaPagamento}
              onChange={setFormaPagamento}
              options={FORMAS_OPTS}
              className="w-36"
            />
            <select
              className="h-8 text-xs px-2 border border-input rounded bg-background"
              value={origem}
              onChange={(e) =>
                setOrigem(e.target.value as "manual" | "asaas" | "todas")
              }
            >
              <option value="todas">Origem: todas</option>
              <option value="asaas">Asaas</option>
              <option value="manual">Manual</option>
            </select>
            <div className="flex items-center gap-1 text-xs">
              <span className="text-muted-foreground">R$</span>
              <Input
                type="number"
                step="0.01"
                placeholder="Mín"
                value={valorMin}
                onChange={(e) => setValorMin(e.target.value)}
                className="h-8 w-20 text-xs"
              />
              <span className="text-muted-foreground">até</span>
              <Input
                type="number"
                step="0.01"
                placeholder="Máx"
                value={valorMax}
                onChange={(e) => setValorMax(e.target.value)}
                className="h-8 w-20 text-xs"
              />
            </div>
            <Input
              type="date"
              value={periodoInicio}
              onChange={(e) => setPeriodoInicio(e.target.value)}
              className="h-8 w-36 text-xs"
              title="Pago a partir de"
            />
            <Input
              type="date"
              value={periodoFim}
              onChange={(e) => setPeriodoFim(e.target.value)}
              className="h-8 w-36 text-xs"
              title="Pago até"
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={limparFiltros}
              className="h-8 text-xs"
            >
              Limpar
            </Button>
          </div>
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <Checkbox
              checked={agruparPorPagador}
              onCheckedChange={(v) => setAgruparPorPagador(!!v)}
            />
            <span>Agrupar por pagador</span>
            <span className="text-muted-foreground">
              (reduz ruído quando um pagador tem várias cobranças)
            </span>
          </label>
        </div>

        {/* Lista */}
        <div className="flex-1 overflow-y-auto rounded border min-h-[200px]">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (candidatos as Candidato[]).length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-center">
              <AlertCircle className="h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm font-medium">Nenhum pagamento encontrado</p>
              <p className="text-xs text-muted-foreground max-w-md">
                Mostra cobranças <b>pagas</b> de <b>outros clientes</b> ainda
                não atribuídas. Tente filtros diferentes ou registre uma cobrança
                manual.
              </p>
            </div>
          ) : agruparPorPagador ? (
            <ListaAgrupada
              grupos={grupos}
              selecionadas={selecionadas}
              gruposExpandidos={gruposExpandidos}
              onToggleId={toggleId}
              onToggleGrupo={toggleGrupo}
              onToggleExpansao={toggleExpansaoGrupo}
            />
          ) : (
            <ListaFlat
              candidatos={candidatos as Candidato[]}
              selecionadas={selecionadas}
              onToggleId={toggleId}
              onToggleTodos={toggleTodos}
            />
          )}
        </div>

        {/* Rodapé com seleção */}
        <div className="rounded border bg-emerald-50/40 p-3 space-y-2">
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <b className="text-emerald-900">
              {selecionadas.size} cobrança{selecionadas.size === 1 ? "" : "s"} selecionada{selecionadas.size === 1 ? "" : "s"}
            </b>
            {selecionadas.size > 0 && (
              <>
                <span className="text-muted-foreground">·</span>
                <span className="text-emerald-700 font-bold tabular-nums">
                  {formatBRL(selecionadasResumo.total)}
                </span>
                {selecionadasResumo.pagadores > 1 && (
                  <>
                    <span className="text-muted-foreground">·</span>
                    <span className="text-muted-foreground">
                      de {selecionadasResumo.pagadores} pagadores
                    </span>
                  </>
                )}
              </>
            )}
          </div>
          <label className="flex items-start gap-2 cursor-pointer text-xs">
            <Checkbox
              checked={reatribuirAtendente}
              onCheckedChange={(v) => setReatribuirAtendente(!!v)}
              className="mt-0.5"
            />
            <div>
              <span>
                Atribuir a comissão ao responsável de{" "}
                <b>{contatoBeneficiarioNome}</b> (recomendado)
              </span>
              <p className="text-[10px] text-muted-foreground">
                Se desmarcar, a comissão fica com quem cuida do contato pagador
                original.
              </p>
            </div>
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            disabled={selecionadas.size === 0 || vincularMut.isPending}
            onClick={() =>
              vincularMut.mutate({
                cobrancaIds: Array.from(selecionadas),
                contatoBeneficiarioId,
                reatribuirAtendente,
              })
            }
          >
            {vincularMut.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Link2 className="h-4 w-4 mr-2" />
            )}
            Vincular {selecionadas.size > 0 ? `${selecionadas.size} ` : ""}
            cobrança{selecionadas.size === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ListaFlat({
  candidatos,
  selecionadas,
  onToggleId,
  onToggleTodos,
}: {
  candidatos: Candidato[];
  selecionadas: Set<number>;
  onToggleId: (id: number) => void;
  onToggleTodos: () => void;
}) {
  const todasMarcadas =
    candidatos.length > 0 && candidatos.every((c) => selecionadas.has(c.id));
  return (
    <Table>
      <TableHeader className="sticky top-0 bg-background z-10">
        <TableRow>
          <TableHead className="w-10">
            <Checkbox checked={todasMarcadas} onCheckedChange={onToggleTodos} />
          </TableHead>
          <TableHead className="text-xs">Pagador</TableHead>
          <TableHead className="text-xs">Descrição</TableHead>
          <TableHead className="text-xs text-center">Forma</TableHead>
          <TableHead className="text-xs">Pago em</TableHead>
          <TableHead className="text-xs text-right">Valor</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {candidatos.map((c) => (
          <LinhaCandidato
            key={c.id}
            cobranca={c}
            marcada={selecionadas.has(c.id)}
            onToggle={() => onToggleId(c.id)}
          />
        ))}
      </TableBody>
    </Table>
  );
}

function ListaAgrupada({
  grupos,
  selecionadas,
  gruposExpandidos,
  onToggleId,
  onToggleGrupo,
  onToggleExpansao,
}: {
  grupos: Array<{
    chave: string;
    pagadorId: number | null;
    pagadorNome: string;
    cpf: string | null;
    cobrancas: Candidato[];
    valorTotal: number;
  }>;
  selecionadas: Set<number>;
  gruposExpandidos: Set<string>;
  onToggleId: (id: number) => void;
  onToggleGrupo: (grupo: any) => void;
  onToggleExpansao: (chave: string) => void;
}) {
  return (
    <Table>
      <TableHeader className="sticky top-0 bg-background z-10">
        <TableRow>
          <TableHead className="w-10"></TableHead>
          <TableHead className="text-xs">Pagador</TableHead>
          <TableHead className="text-xs">Descrição</TableHead>
          <TableHead className="text-xs text-center">Forma</TableHead>
          <TableHead className="text-xs">Pago em</TableHead>
          <TableHead className="text-xs text-right">Valor</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {grupos.map((g) => {
          const idsGrupo = g.cobrancas.map((c) => c.id);
          const todasMarcadas = idsGrupo.every((id) => selecionadas.has(id));
          const algumaMarcada = idsGrupo.some((id) => selecionadas.has(id));
          const expandido =
            gruposExpandidos.has(g.chave) || g.cobrancas.length <= 3;
          return (
            <>
              <TableRow
                key={`grp-${g.chave}`}
                className="bg-blue-50/40 cursor-pointer hover:bg-blue-50/70"
                onClick={() => onToggleExpansao(g.chave)}
              >
                <TableCell className="px-2">
                  <Checkbox
                    checked={todasMarcadas}
                    onCheckedChange={() => onToggleGrupo(g)}
                    onClick={(e) => e.stopPropagation()}
                    className={
                      !todasMarcadas && algumaMarcada
                        ? "data-[state=unchecked]:bg-blue-200 data-[state=unchecked]:border-blue-400"
                        : ""
                    }
                  />
                </TableCell>
                <TableCell className="font-semibold text-blue-900 text-xs">
                  <div className="flex items-center gap-1.5">
                    {expandido ? (
                      <ChevronDown className="h-3 w-3" />
                    ) : (
                      <ChevronRight className="h-3 w-3" />
                    )}
                    {g.pagadorNome}
                  </div>
                  <div className="text-[10px] text-blue-700 font-normal pl-4">
                    {g.cobrancas.length} cobrança
                    {g.cobrancas.length === 1 ? "" : "s"}
                    {g.cpf && ` · ${g.cpf}`}
                  </div>
                </TableCell>
                <TableCell colSpan={3} className="text-[11px] text-blue-700 italic">
                  {todasMarcadas
                    ? "Todas do grupo selecionadas"
                    : algumaMarcada
                      ? `${idsGrupo.filter((id) => selecionadas.has(id)).length} de ${idsGrupo.length} selecionada${idsGrupo.length === 1 ? "" : "s"}`
                      : g.cobrancas.length > 3
                        ? "(clique pra expandir)"
                        : ""}
                </TableCell>
                <TableCell className="text-right font-bold text-blue-900 text-xs tabular-nums">
                  {formatBRL(g.valorTotal)}
                </TableCell>
              </TableRow>
              {expandido &&
                g.cobrancas.map((c) => (
                  <LinhaCandidato
                    key={c.id}
                    cobranca={c}
                    marcada={selecionadas.has(c.id)}
                    onToggle={() => onToggleId(c.id)}
                    indented
                  />
                ))}
            </>
          );
        })}
      </TableBody>
    </Table>
  );
}

function LinhaCandidato({
  cobranca,
  marcada,
  onToggle,
  indented,
}: {
  cobranca: Candidato;
  marcada: boolean;
  onToggle: () => void;
  indented?: boolean;
}) {
  return (
    <TableRow
      data-state={marcada ? "selected" : undefined}
      className="cursor-pointer"
      onClick={onToggle}
    >
      <TableCell className={indented ? "px-2 pl-8" : "px-2"}>
        <Checkbox
          checked={marcada}
          onCheckedChange={onToggle}
          onClick={(e) => e.stopPropagation()}
        />
      </TableCell>
      <TableCell className="text-xs">
        {indented ? (
          <span className="text-muted-foreground italic">— mesmo pagador —</span>
        ) : (
          cobranca.contatoNomePagador ?? (
            <span className="text-muted-foreground italic">sem contato</span>
          )
        )}
        {cobranca.origem === "manual" && (
          <span className="ml-1.5 text-[9px] text-amber-700">(manual)</span>
        )}
      </TableCell>
      <TableCell className="text-xs max-w-[260px] truncate">
        {cobranca.descricao || "—"}
      </TableCell>
      <TableCell className="text-xs text-center">
        <FormaBadge forma={cobranca.formaPagamento} />
      </TableCell>
      <TableCell className="text-xs">
        {cobranca.dataPagamento
          ? cobranca.dataPagamento.split("-").reverse().join("/")
          : "—"}
      </TableCell>
      <TableCell className="text-xs text-right tabular-nums font-medium">
        {formatBRL(parseFloat(cobranca.valor))}
      </TableCell>
    </TableRow>
  );
}
