/**
 * CustomerPanel — painel lateral "Customer 360" do Atendimento.
 *
 * Mostra todo o contexto do cliente em cards colapsáveis:
 *   • Resumo (avatar, tags, status financeiro em 1 badge)
 *   • Processos ativos
 *   • Financeiro (saldo devedor, cobranças ativas, nova cobrança)
 *   • Negociações (leads em aberto)
 *   • Tarefas pendentes
 *   • Próximos compromissos
 *   • Anotações
 *   • Assinaturas pendentes
 *
 * Sem NAVEGAÇÃO: todas as ações abrem em side panels/dialogs dentro do
 * próprio atendimento. O atendente nunca sai da conversa.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  User, Star, DollarSign, Gavel, TrendingUp, CheckSquare, Calendar,
  StickyNote, PenLine, Plus, Phone, Mail, Loader2, ChevronDown, ChevronRight,
  AlertTriangle, ExternalLink, Copy,
} from "lucide-react";
import { toast } from "sonner";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatBRL(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

function formatDate(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

function daysFromNow(iso: string | null): number | null {
  if (!iso) return null;
  const diff = new Date(iso).getTime() - Date.now();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

// ─── Componente ──────────────────────────────────────────────────────────────

export function CustomerPanel({
  contatoId,
  onOpenFinanceiro,
  onOpenAgendar,
  onOpenWhatsapp,
}: {
  contatoId: number;
  onOpenFinanceiro?: () => void;
  onOpenAgendar?: () => void;
  onOpenWhatsapp?: (phone: string) => void;
}) {
  const { data, isLoading, refetch } = trpc.customer360.getContext.useQuery(
    { contatoId },
    { refetchInterval: 30_000 }, // refresh a cada 30s
  );

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="h-full flex items-center justify-center py-12 px-4">
        <p className="text-xs text-muted-foreground text-center">
          Não foi possível carregar o contexto do cliente.
        </p>
      </div>
    );
  }

  const { contato, financeiro, leads, tarefas, compromissos, anotacoes, processos, stats } = data;
  const isVip = contato.tags.some((t) => t.toLowerCase() === "vip");

  // Status financeiro (1 badge)
  const statusFin = financeiro.vencido > 0
    ? { label: `${formatBRL(financeiro.vencido)} vencido`, color: "bg-red-50 border-red-200 text-red-700" }
    : financeiro.pendente > 0
      ? { label: `${formatBRL(financeiro.pendente)} a receber`, color: "bg-amber-50 border-amber-200 text-amber-700" }
      : { label: "Em dia", color: "bg-emerald-50 border-emerald-200 text-emerald-700" };

  return (
    <div className="h-full overflow-y-auto space-y-3 pb-4">
      {/* ─── Card 1: Resumo (sempre aberto) ─── */}
      <div className="px-4 pt-4">
        <div className="flex items-start gap-3 mb-3">
          <div className="h-12 w-12 rounded-full bg-gradient-to-br from-violet-200 to-purple-100 flex items-center justify-center text-sm font-bold text-violet-700 shrink-0">
            {contato.nome.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <p className="text-sm font-semibold truncate">{contato.nome}</p>
              {isVip && <Star className="h-3.5 w-3.5 text-amber-500 shrink-0" />}
            </div>
            {contato.telefone && (
              <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                <Phone className="h-2.5 w-2.5" />
                {contato.telefone}
              </p>
            )}
            {contato.email && (
              <p className="text-[11px] text-muted-foreground flex items-center gap-1 truncate">
                <Mail className="h-2.5 w-2.5" />
                {contato.email}
              </p>
            )}
          </div>
        </div>

        {/* Tags + contador resumido */}
        {contato.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {contato.tags.slice(0, 5).map((tag, i) => (
              <Badge key={i} variant="outline" className="text-[9px] font-normal">
                {tag}
              </Badge>
            ))}
          </div>
        )}

        <Badge variant="outline" className={`text-[10px] ${statusFin.color} w-full justify-center py-1`}>
          <DollarSign className="h-3 w-3 mr-1" />
          {statusFin.label}
        </Badge>

        <p className="text-[10px] text-muted-foreground text-center mt-2">
          {stats.totalProcessos} processo(s) · {stats.totalTarefas} tarefa(s) pendente(s) ·{" "}
          {stats.totalLeads} lead(s) ativo(s)
        </p>
      </div>

      <div className="border-t" />

      {/* ─── Card 2: Processos ativos ─── */}
      <Section
        icon={Gavel}
        iconColor="text-indigo-600"
        title={`Processos (${processos.length})`}
        defaultOpen={processos.length > 0}
        headerAction={<AdicionarProcessoInline onSuccess={refetch} />}
      >
        {processos.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">Nenhum processo ativo.</p>
        ) : (
          <div className="space-y-1.5">
            {processos.slice(0, 3).map((p: any) => (
              <div
                key={p.id}
                className="text-[11px] rounded border bg-muted/20 px-2 py-1.5 hover:bg-muted/40 cursor-pointer"
                onClick={() => window.open(`/processos?id=${p.id}`, "_blank")}
              >
                <div className="flex items-center gap-1.5">
                  <p className="font-mono truncate flex-1">{p.numeroCnj}</p>
                  {p.tribunal && (
                    <Badge variant="outline" className="text-[8px] px-1 py-0">
                      {p.tribunal}
                    </Badge>
                  )}
                  {p.fonte === "judit" && (
                    <Badge
                      variant="outline"
                      className="text-[8px] px-1 py-0 bg-violet-50 text-violet-700 border-violet-200"
                    >
                      Judit
                    </Badge>
                  )}
                </div>
                {p.classe && <p className="text-muted-foreground truncate">{p.classe}</p>}
                {p.ultimaMovimentacao && (
                  <p className="text-[10px] text-muted-foreground italic truncate mt-0.5">
                    {p.ultimaMovimentacao}
                  </p>
                )}
              </div>
            ))}
            {processos.length > 3 && (
              <p className="text-[10px] text-muted-foreground text-center">
                + {processos.length - 3} processo(s)
              </p>
            )}
          </div>
        )}
      </Section>

      {/* ─── Card 3: Financeiro ─── */}
      <Section
        icon={DollarSign}
        iconColor="text-emerald-600"
        title="Financeiro"
        defaultOpen={financeiro.vencido > 0 || financeiro.pendente > 0}
      >
        {!financeiro.vinculado ? (
          <div className="space-y-2">
            <p className="text-[11px] text-muted-foreground">
              Cliente ainda não está vinculado ao Asaas. Ao criar a primeira
              cobrança, o vínculo é feito automaticamente.
            </p>
            <CriarCobrancaInline contatoId={contatoId} onSuccess={refetch} fullWidth />
          </div>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-1 text-center">
              <div>
                <p className="text-[10px] text-muted-foreground">Em dia</p>
                <p className="text-xs font-bold text-emerald-600">{formatBRL(financeiro.pago)}</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">A receber</p>
                <p className="text-xs font-bold text-amber-600">{formatBRL(financeiro.pendente)}</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">Vencido</p>
                <p className="text-xs font-bold text-red-600">{formatBRL(financeiro.vencido)}</p>
              </div>
            </div>

            {financeiro.ultimoPagamento && (
              <p className="text-[10px] text-muted-foreground">
                Último pagamento: {formatBRL(financeiro.ultimoPagamento.valor)} em{" "}
                {new Date(financeiro.ultimoPagamento.data).toLocaleDateString("pt-BR")}
              </p>
            )}

            {financeiro.cobrancasAtivas.length > 0 && (
              <div className="space-y-1">
                <p className="text-[10px] font-medium text-muted-foreground">Cobranças ativas:</p>
                {financeiro.cobrancasAtivas.map((c) => (
                  <div
                    key={c.id}
                    className={`text-[10px] rounded px-2 py-1 flex items-center gap-1.5 ${
                      c.status === "OVERDUE" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"
                    }`}
                  >
                    <span className="font-bold">{formatBRL(parseFloat(c.valor))}</span>
                    <span className="text-muted-foreground">· venc. {c.vencimento}</span>
                    {c.invoiceUrl && (
                      <button
                        className="ml-auto"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigator.clipboard.writeText(c.invoiceUrl!);
                          toast.success("Link copiado");
                        }}
                      >
                        <Copy className="h-2.5 w-2.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            <CriarCobrancaInline contatoId={contatoId} onSuccess={refetch} fullWidth />
          </div>
        )}
      </Section>

      {/* ─── Card 4: Pipeline ─── */}
      <Section
        icon={TrendingUp}
        iconColor="text-violet-600"
        title={`Pipeline (${leads.length})`}
        defaultOpen={leads.length > 0}
        headerAction={<CriarLeadInline contatoId={contatoId} onSuccess={refetch} />}
      >
        {leads.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">Nenhum lead no pipeline.</p>
        ) : (
          <div className="space-y-1.5">
            {leads.map((l) => (
              <EditarLeadInline key={l.id} lead={l} onSuccess={refetch} />
            ))}
          </div>
        )}
      </Section>

      {/* ─── Card 5: Tarefas ─── */}
      <Section
        icon={CheckSquare}
        iconColor="text-blue-600"
        title={`Tarefas (${tarefas.length})`}
        defaultOpen={tarefas.length > 0}
        headerAction={<CriarTarefaInline contatoId={contatoId} onSuccess={refetch} />}
      >
        {tarefas.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">Nenhuma tarefa pendente.</p>
        ) : (
          <div className="space-y-1">
            {tarefas.map((t) => {
              const dias = daysFromNow(t.dataVencimento);
              const atrasada = dias !== null && dias < 0;
              return (
                <div
                  key={t.id}
                  className="text-[11px] rounded px-2 py-1.5 hover:bg-muted/40 flex items-start gap-2"
                >
                  <CheckSquare className="h-3 w-3 mt-0.5 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="truncate">{t.titulo}</p>
                    {t.dataVencimento && (
                      <p
                        className={`text-[9px] ${atrasada ? "text-red-600 font-medium" : "text-muted-foreground"}`}
                      >
                        {atrasada ? `⚠ vencida há ${-dias!}d` : `venc. ${formatDate(t.dataVencimento)}`}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {/* ─── Card 6: Próximos compromissos ─── */}
      <Section
        icon={Calendar}
        iconColor="text-amber-600"
        title={`Compromissos (${compromissos.length})`}
        headerAction={
          <CriarCompromissoInline contatoNome={contato.nome} onSuccess={refetch} />
        }
      >
        {compromissos.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">Nenhum compromisso futuro.</p>
        ) : (
          <div className="space-y-1">
            {compromissos.map((a) => (
              <div key={a.id} className="text-[11px] rounded border bg-muted/20 px-2 py-1.5">
                <div className="flex items-center justify-between">
                  <p className="truncate font-medium">{a.titulo}</p>
                  <Badge variant="outline" className="text-[8px] px-1 py-0">
                    {a.tipo}
                  </Badge>
                </div>
                <p className="text-[9px] text-muted-foreground">
                  {new Date(a.dataInicio).toLocaleDateString("pt-BR", {
                    day: "2-digit",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ─── Card 7: Anotações ─── */}
      <Section
        icon={StickyNote}
        iconColor="text-amber-500"
        title="Anotações"
        headerAction={<CriarNotaInline contatoId={contatoId} onSuccess={refetch} />}
      >
        {anotacoes.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">Nenhuma anotação.</p>
        ) : (
          <div className="space-y-1.5">
            {anotacoes.map((n) => (
              <div key={n.id} className="text-[11px] rounded border bg-amber-50/50 px-2 py-1.5">
                {n.titulo && <p className="font-medium">{n.titulo}</p>}
                <p className="text-muted-foreground whitespace-pre-wrap line-clamp-3">
                  {n.conteudo}
                </p>
                <p className="text-[9px] text-muted-foreground/60 mt-0.5">
                  {formatDate(n.createdAt)}
                </p>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

// ─── Sub-componente: Section colapsável ──────────────────────────────────────

function Section({
  icon: Icon,
  iconColor,
  title,
  defaultOpen = false,
  headerAction,
  children,
}: {
  icon: any;
  iconColor: string;
  title: string;
  defaultOpen?: boolean;
  headerAction?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="px-4 space-y-2">
      <div className="flex items-center gap-1">
        <button
          className="flex items-center gap-1.5 flex-1 text-left"
          onClick={() => setOpen(!open)}
        >
          {open ? (
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
          )}
          <Icon className={`h-3.5 w-3.5 ${iconColor}`} />
          <p className="text-xs font-semibold">{title}</p>
        </button>
        {headerAction}
      </div>
      {open && <div className="pl-4">{children}</div>}
    </div>
  );
}

// ─── Criar tarefa inline (popover) ───────────────────────────────────────────

function CriarTarefaInline({ contatoId, onSuccess }: { contatoId: number; onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [titulo, setTitulo] = useState("");
  const [prioridade, setPrioridade] = useState("normal");
  const [dataVencimento, setDataVencimento] = useState("");

  const mut = trpc.customer360.criarTarefaRapida.useMutation({
    onSuccess: () => {
      toast.success("Tarefa criada");
      setTitulo("");
      setDataVencimento("");
      setOpen(false);
      onSuccess();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" className="h-5 w-5 p-0">
          <Plus className="h-3 w-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-2" side="left">
        <p className="text-xs font-semibold">Nova tarefa</p>
        <Input
          placeholder="Título"
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          className="h-8 text-sm"
        />
        <div className="grid grid-cols-2 gap-2">
          <Select value={prioridade} onValueChange={setPrioridade}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="baixa">Baixa</SelectItem>
              <SelectItem value="normal">Normal</SelectItem>
              <SelectItem value="alta">Alta</SelectItem>
              <SelectItem value="urgente">Urgente</SelectItem>
            </SelectContent>
          </Select>
          <Input
            type="date"
            value={dataVencimento}
            onChange={(e) => setDataVencimento(e.target.value)}
            className="h-8 text-xs"
          />
        </div>
        <Button
          size="sm"
          className="w-full h-8 text-xs"
          onClick={() =>
            mut.mutate({
              contatoId,
              titulo,
              prioridade: prioridade as any,
              dataVencimento: dataVencimento
                ? new Date(dataVencimento + "T23:59:59").toISOString()
                : undefined,
            })
          }
          disabled={!titulo || mut.isPending}
        >
          {mut.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
          Criar
        </Button>
      </PopoverContent>
    </Popover>
  );
}

// ─── Criar nota inline (popover) ─────────────────────────────────────────────

function CriarNotaInline({ contatoId, onSuccess }: { contatoId: number; onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [conteudo, setConteudo] = useState("");

  const mut = trpc.customer360.criarNotaRapida.useMutation({
    onSuccess: () => {
      toast.success("Nota salva");
      setConteudo("");
      setOpen(false);
      onSuccess();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" className="h-5 w-5 p-0">
          <Plus className="h-3 w-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-2" side="left">
        <p className="text-xs font-semibold">Nova nota</p>
        <Textarea
          placeholder="Digite sua nota..."
          value={conteudo}
          onChange={(e) => setConteudo(e.target.value)}
          rows={4}
          className="text-xs"
        />
        <Button
          size="sm"
          className="w-full h-8 text-xs"
          onClick={() => mut.mutate({ contatoId, conteudo })}
          disabled={!conteudo || mut.isPending}
        >
          {mut.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
          Salvar
        </Button>
      </PopoverContent>
    </Popover>
  );
}

// ─── Adicionar processo inline (popover) ─────────────────────────────────────
//
// Usa o Judit.IO como provedor (mais rápido, mais confiável e cobre mais
// tribunais que o DataJud). Custa créditos do plano Judit do escritório.

function AdicionarProcessoInline({ onSuccess }: { onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [cnj, setCnj] = useState("");
  const [apelido, setApelido] = useState("");

  const mut = (trpc as any).juditOperacoes.criarMonitoramento.useMutation({
    onSuccess: () => {
      toast.success("Processo monitorado via Judit.IO — atualizações diárias ativadas");
      setCnj("");
      setApelido("");
      setOpen(false);
      onSuccess();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" className="h-5 w-5 p-0">
          <Plus className="h-3 w-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-2" side="left">
        <p className="text-xs font-semibold flex items-center gap-1.5">
          <Gavel className="h-3.5 w-3.5 text-indigo-600" />
          Monitorar processo
        </p>
        <Input
          placeholder="Número CNJ (0000000-00.0000.0.00.0000)"
          value={cnj}
          onChange={(e) => setCnj(e.target.value)}
          className="h-8 text-xs font-mono"
        />
        <Input
          placeholder="Apelido (opcional)"
          value={apelido}
          onChange={(e) => setApelido(e.target.value)}
          className="h-8 text-xs"
        />
        <p className="text-[10px] text-muted-foreground">
          Monitoramento via <strong>Judit.IO</strong> com atualizações diárias.
          Necessário ter plano Judit ativo no escritório.
        </p>
        <Button
          size="sm"
          className="w-full h-8 text-xs"
          onClick={() => mut.mutate({ numeroCnj: cnj.trim(), apelido: apelido || undefined })}
          disabled={cnj.trim().length < 20 || mut.isPending}
        >
          {mut.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
          Monitorar
        </Button>
      </PopoverContent>
    </Popover>
  );
}

// ─── Criar lead inline (popover) ─────────────────────────────────────────────

function CriarLeadInline({ contatoId, onSuccess }: { contatoId: number; onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [valorEstimado, setValorEstimado] = useState("");
  const [origem, setOrigem] = useState("");

  const mut = trpc.crm.criarLead.useMutation({
    onSuccess: () => {
      toast.success("Lead criado");
      setValorEstimado("");
      setOrigem("");
      setOpen(false);
      onSuccess();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" className="h-5 w-5 p-0">
          <Plus className="h-3 w-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-2" side="left">
        <p className="text-xs font-semibold flex items-center gap-1.5">
          <TrendingUp className="h-3.5 w-3.5 text-violet-600" />
          Nova negociação
        </p>
        <div className="space-y-1.5">
          <Label className="text-[10px] text-muted-foreground">Valor estimado (R$)</Label>
          <Input
            type="number"
            step="0.01"
            placeholder="5000.00"
            value={valorEstimado}
            onChange={(e) => setValorEstimado(e.target.value)}
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-[10px] text-muted-foreground">Origem (opcional)</Label>
          <Input
            placeholder="Indicação, Google, etc."
            value={origem}
            onChange={(e) => setOrigem(e.target.value)}
            className="h-8 text-xs"
          />
        </div>
        <Button
          size="sm"
          className="w-full h-8 text-xs"
          onClick={() =>
            mut.mutate({
              contatoId,
              valorEstimado: valorEstimado || undefined,
              origemLead: origem || undefined,
            })
          }
          disabled={mut.isPending}
        >
          {mut.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
          Criar lead
        </Button>
      </PopoverContent>
    </Popover>
  );
}

// ─── Criar compromisso inline (popover) ──────────────────────────────────────

function CriarCompromissoInline({
  contatoNome,
  onSuccess,
}: {
  contatoNome: string;
  onSuccess: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [titulo, setTitulo] = useState("");
  const [tipo, setTipo] = useState<
    "reuniao_comercial" | "audiencia" | "prazo_processual" | "follow_up" | "outro"
  >("reuniao_comercial");
  const [data, setData] = useState("");
  const [hora, setHora] = useState("09:00");
  const [local, setLocal] = useState("");

  const mut = trpc.agendamento.criar.useMutation({
    onSuccess: () => {
      toast.success("Compromisso criado");
      setTitulo("");
      setData("");
      setHora("09:00");
      setLocal("");
      setOpen(false);
      onSuccess();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const handleCriar = () => {
    if (!titulo || !data) return;
    const dataInicio = new Date(`${data}T${hora}:00`).toISOString();
    mut.mutate({
      tipo,
      titulo,
      dataInicio,
      local: local || undefined,
      descricao: `Compromisso com ${contatoNome}`,
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" className="h-5 w-5 p-0">
          <Plus className="h-3 w-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-2" side="left">
        <p className="text-xs font-semibold flex items-center gap-1.5">
          <Calendar className="h-3.5 w-3.5 text-amber-600" />
          Novo compromisso
        </p>
        <Input
          placeholder="Título"
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          className="h-8 text-xs"
        />
        <Select value={tipo} onValueChange={(v) => setTipo(v as typeof tipo)}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="reuniao_comercial">Reunião comercial</SelectItem>
            <SelectItem value="audiencia">Audiência</SelectItem>
            <SelectItem value="prazo_processual">Prazo processual</SelectItem>
            <SelectItem value="follow_up">Follow-up</SelectItem>
            <SelectItem value="outro">Outro</SelectItem>
          </SelectContent>
        </Select>
        <div className="grid grid-cols-2 gap-2">
          <Input
            type="date"
            value={data}
            onChange={(e) => setData(e.target.value)}
            className="h-8 text-xs"
          />
          <Input
            type="time"
            value={hora}
            onChange={(e) => setHora(e.target.value)}
            className="h-8 text-xs"
          />
        </div>
        <Input
          placeholder="Local (opcional)"
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          className="h-8 text-xs"
        />
        <Button
          size="sm"
          className="w-full h-8 text-xs"
          onClick={handleCriar}
          disabled={!titulo || !data || mut.isPending}
        >
          {mut.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
          Criar compromisso
        </Button>
      </PopoverContent>
    </Popover>
  );
}

// ─── Criar cobrança inline (popover) ─────────────────────────────────────────
//
// Substitui o antigo botão "Nova cobrança" que dependia de um callback
// onOpenFinanceiro nunca conectado. Agora cria a cobrança inline via Asaas.

function CriarCobrancaInline({
  contatoId,
  onSuccess,
  fullWidth = false,
}: {
  contatoId: number;
  onSuccess: () => void;
  fullWidth?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [valor, setValor] = useState("");
  const [vencimento, setVencimento] = useState(() => {
    // Default: vencimento em 7 dias
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  });
  const [forma, setForma] = useState<"PIX" | "BOLETO" | "CREDIT_CARD" | "UNDEFINED">("PIX");
  const [descricao, setDescricao] = useState("");

  const mut = trpc.asaas.criarCobranca.useMutation({
    onSuccess: () => {
      toast.success("Cobrança criada no Asaas");
      setValor("");
      setDescricao("");
      setOpen(false);
      onSuccess();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const trigger = fullWidth ? (
    <Button size="sm" variant="outline" className="h-7 text-[11px] w-full">
      <Plus className="h-3 w-3 mr-1" /> Nova cobrança
    </Button>
  ) : (
    <Button size="sm" variant="ghost" className="h-5 w-5 p-0">
      <Plus className="h-3 w-3" />
    </Button>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="w-80 space-y-2" side="left">
        <p className="text-xs font-semibold flex items-center gap-1.5">
          <DollarSign className="h-3.5 w-3.5 text-emerald-600" />
          Nova cobrança
        </p>
        <div className="space-y-1.5">
          <Label className="text-[10px] text-muted-foreground">Valor (R$)</Label>
          <Input
            type="number"
            step="0.01"
            min="0.01"
            placeholder="150.00"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            className="h-8 text-xs"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label className="text-[10px] text-muted-foreground">Vencimento</Label>
            <Input
              type="date"
              value={vencimento}
              onChange={(e) => setVencimento(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] text-muted-foreground">Forma</Label>
            <Select value={forma} onValueChange={(v) => setForma(v as typeof forma)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PIX">Pix</SelectItem>
                <SelectItem value="BOLETO">Boleto</SelectItem>
                <SelectItem value="CREDIT_CARD">Cartão</SelectItem>
                <SelectItem value="UNDEFINED">Cliente escolhe</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-[10px] text-muted-foreground">Descrição (opcional)</Label>
          <Input
            placeholder="Honorários advocatícios..."
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            className="h-8 text-xs"
          />
        </div>
        <Button
          size="sm"
          className="w-full h-8 text-xs"
          onClick={() => {
            const v = parseFloat(valor);
            if (!v || v <= 0) {
              toast.error("Informe um valor válido");
              return;
            }
            if (!vencimento) {
              toast.error("Informe a data de vencimento");
              return;
            }
            mut.mutate({
              contatoId,
              valor: v,
              vencimento,
              formaPagamento: forma,
              descricao: descricao || undefined,
            });
          }}
          disabled={mut.isPending}
        >
          {mut.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
          Criar cobrança
        </Button>
      </PopoverContent>
    </Popover>
  );
}

// ─── Editar lead inline (popover) ────────────────────────────────────────────
//
// Renderiza o card clicável de um lead. Ao clicar, abre popover com os campos
// etapa do funil + valor estimado + observações, permitindo atualizar sem
// criar um novo lead.

const ETAPAS_FUNIL_LABELS: Record<string, string> = {
  novo: "Novo",
  qualificado: "Qualificado",
  proposta: "Proposta",
  negociacao: "Negociação",
  fechado_ganho: "Fechado ✓",
  fechado_perdido: "Perdido ✗",
};

const ETAPAS_FUNIL_COLORS: Record<string, string> = {
  novo: "bg-blue-50 text-blue-700 border-blue-200",
  qualificado: "bg-indigo-50 text-indigo-700 border-indigo-200",
  proposta: "bg-violet-50 text-violet-700 border-violet-200",
  negociacao: "bg-amber-50 text-amber-700 border-amber-200",
  fechado_ganho: "bg-emerald-50 text-emerald-700 border-emerald-200",
  fechado_perdido: "bg-gray-50 text-gray-500 border-gray-200",
};

type EtapaFunil = "novo" | "qualificado" | "proposta" | "negociacao" | "fechado_ganho" | "fechado_perdido";

function EditarLeadInline({
  lead,
  onSuccess,
}: {
  lead: any;
  onSuccess: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [etapa, setEtapa] = useState<EtapaFunil>(lead.etapaFunil);
  const [valor, setValor] = useState(lead.valorEstimado || "");
  const [observacoes, setObservacoes] = useState(lead.observacoes || "");

  const mut = trpc.crm.atualizarLead.useMutation({
    onSuccess: () => {
      toast.success("Lead atualizado");
      setOpen(false);
      onSuccess();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const excluirMut = trpc.crm.excluirLead.useMutation({
    onSuccess: () => {
      toast.success("Lead removido");
      setOpen(false);
      onSuccess();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="w-full text-left text-[11px] rounded border bg-muted/20 px-2 py-1.5 hover:bg-muted/40 transition-colors">
          <div className="flex items-center justify-between gap-2">
            <Badge
              variant="outline"
              className={`text-[9px] ${ETAPAS_FUNIL_COLORS[lead.etapaFunil] || ""}`}
            >
              {ETAPAS_FUNIL_LABELS[lead.etapaFunil] || lead.etapaFunil}
            </Badge>
            {lead.valorEstimado && (
              <span className="font-bold text-emerald-600">
                {formatBRL(parseFloat(lead.valorEstimado))}
              </span>
            )}
          </div>
          {lead.observacoes && (
            <p className="text-muted-foreground text-[10px] truncate mt-0.5">
              {lead.observacoes}
            </p>
          )}
          {lead.probabilidade != null && (
            <p className="text-[9px] text-muted-foreground">
              Probabilidade: {lead.probabilidade}%
            </p>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-2" side="left">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold flex items-center gap-1.5">
            <TrendingUp className="h-3.5 w-3.5 text-violet-600" />
            Editar lead
          </p>
          <button
            className="text-[10px] text-red-600 hover:underline"
            onClick={() => {
              if (confirm("Remover este lead do pipeline?")) {
                excluirMut.mutate({ id: lead.id });
              }
            }}
            disabled={excluirMut.isPending}
          >
            Excluir
          </button>
        </div>
        <div className="space-y-1.5">
          <Label className="text-[10px] text-muted-foreground">Etapa (coluna)</Label>
          <Select value={etapa} onValueChange={(v) => setEtapa(v as EtapaFunil)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="novo">Novo</SelectItem>
              <SelectItem value="qualificado">Qualificado</SelectItem>
              <SelectItem value="proposta">Proposta</SelectItem>
              <SelectItem value="negociacao">Negociação</SelectItem>
              <SelectItem value="fechado_ganho">Fechado ganho ✓</SelectItem>
              <SelectItem value="fechado_perdido">Perdido ✗</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-[10px] text-muted-foreground">Valor estimado (R$)</Label>
          <Input
            type="number"
            step="0.01"
            placeholder="5000.00"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-[10px] text-muted-foreground">Observações</Label>
          <Textarea
            placeholder="Anotações sobre essa negociação..."
            value={observacoes}
            onChange={(e) => setObservacoes(e.target.value)}
            rows={3}
            className="text-xs"
          />
        </div>
        <Button
          size="sm"
          className="w-full h-8 text-xs"
          onClick={() =>
            mut.mutate({
              id: lead.id,
              etapaFunil: etapa,
              valorEstimado: valor || undefined,
              observacoes: observacoes || undefined,
            })
          }
          disabled={mut.isPending}
        >
          {mut.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
          Salvar
        </Button>
      </PopoverContent>
    </Popover>
  );
}
