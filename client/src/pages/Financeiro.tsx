import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DollarSign, TrendingUp, AlertTriangle, Clock, Plus, ExternalLink, Copy, RefreshCw, Loader2, Settings, CheckCircle2, XCircle, Receipt, CreditCard, QrCode, FileText, Users, UserPlus, Repeat, Trash2, Search, Wallet } from "lucide-react";
import { toast } from "sonner";

function formatBRL(value: number) { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value); }

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    PENDING: { label: "Pendente", cls: "bg-amber-500/15 text-amber-700 border-amber-500/25" },
    RECEIVED: { label: "Recebido", cls: "bg-emerald-500/15 text-emerald-700 border-emerald-500/25" },
    CONFIRMED: { label: "Confirmado", cls: "bg-emerald-500/15 text-emerald-700 border-emerald-500/25" },
    RECEIVED_IN_CASH: { label: "Em dinheiro", cls: "bg-emerald-500/15 text-emerald-700 border-emerald-500/25" },
    OVERDUE: { label: "Vencido", cls: "bg-red-500/15 text-red-700 border-red-500/25" },
    REFUNDED: { label: "Estornado", cls: "bg-gray-500/15 text-gray-600 border-gray-500/25" },
    CANCELLED: { label: "Cancelado", cls: "bg-gray-500/15 text-gray-600 border-gray-500/25" },
    ACTIVE: { label: "Ativa", cls: "bg-emerald-500/15 text-emerald-700 border-emerald-500/25" },
    INACTIVE: { label: "Inativa", cls: "bg-gray-500/15 text-gray-600 border-gray-500/25" },
    EXPIRED: { label: "Expirada", cls: "bg-red-500/15 text-red-700 border-red-500/25" },
  };
  const cfg = map[status] || { label: status, cls: "" };
  return <Badge className={`${cfg.cls} hover:${cfg.cls} text-[10px] font-normal`}>{cfg.label}</Badge>;
}

function FormaBadge({ forma }: { forma: string }) {
  const icons: Record<string, string> = { BOLETO: "B", PIX: "P", CREDIT_CARD: "C", UNDEFINED: "?" };
  const labels: Record<string, string> = { BOLETO: "Boleto", PIX: "Pix", CREDIT_CARD: "Cartao", UNDEFINED: "Indef." };
  return <span className="text-xs text-muted-foreground">{icons[forma] || "?"} {labels[forma] || forma}</span>;
}

const CICLO_LABELS: Record<string, string> = { WEEKLY: "Semanal", BIWEEKLY: "Quinzenal", MONTHLY: "Mensal", BIMONTHLY: "Bimestral", QUARTERLY: "Trimestral", SEMIANNUALLY: "Semestral", YEARLY: "Anual" };

function NovaCobrancaDialog({ open, onOpenChange, onSuccess }: { open: boolean; onOpenChange: (o: boolean) => void; onSuccess: () => void }) {
  const [modo, setModo] = useState<"avulsa" | "parcelada" | "recorrente">("avulsa");
  const [contatoId, setContatoId] = useState(""); const [valor, setValor] = useState(""); const [vencimento, setVencimento] = useState(""); const [forma, setForma] = useState("PIX"); const [descricao, setDescricao] = useState(""); const [parcelas, setParcelas] = useState("2"); const [ciclo, setCiclo] = useState("MONTHLY"); const [resultado, setResultado] = useState<any>(null);
  const { data: clientes } = trpc.asaas.listarClientesVinculados.useQuery(undefined, { retry: false });
  const criarAvulsaMut = trpc.asaas.criarCobranca.useMutation({ onSuccess: (data) => { setResultado(data.cobranca); toast.success("Cobranca criada"); onSuccess(); }, onError: (err) => toast.error("Erro", { description: err.message, duration: 8000 }) });
  const criarParcelaMut = trpc.asaas.criarParcelamento.useMutation({ onSuccess: () => { toast.success("Parcelamento criado"); resetForm(); onOpenChange(false); onSuccess(); }, onError: (err) => toast.error("Erro", { description: err.message, duration: 8000 }) });
  const criarAssinaturaMut = trpc.asaas.criarAssinatura.useMutation({ onSuccess: () => { toast.success("Assinatura criada"); resetForm(); onOpenChange(false); onSuccess(); }, onError: (err) => toast.error("Erro", { description: err.message, duration: 8000 }) });
  const isPending = criarAvulsaMut.isPending || criarParcelaMut.isPending || criarAssinaturaMut.isPending;
  const resetForm = () => { setContatoId(""); setValor(""); setVencimento(""); setForma("PIX"); setDescricao(""); setParcelas("2"); setCiclo("MONTHLY"); setResultado(null); setModo("avulsa"); };
  const handleCriar = () => { if (modo === "avulsa") { criarAvulsaMut.mutate({ contatoId: parseInt(contatoId), valor: parseFloat(valor), vencimento, formaPagamento: forma as any, descricao: descricao || undefined }); } else if (modo === "parcelada") { criarParcelaMut.mutate({ contatoId: parseInt(contatoId), valorTotal: parseFloat(valor), parcelas: parseInt(parcelas), vencimento, formaPagamento: forma as any, descricao: descricao || undefined }); } else { criarAssinaturaMut.mutate({ contatoId: parseInt(contatoId), valor: parseFloat(valor), proximoVencimento: vencimento, ciclo: ciclo as any, formaPagamento: forma as any, descricao: descricao || undefined }); } };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) resetForm(); onOpenChange(o); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Nova cobranca</DialogTitle></DialogHeader>
        {resultado ? (
          <div className="space-y-3 py-2">
            <div className="flex items-center gap-2 text-emerald-600"><CheckCircle2 className="h-5 w-5" /><span className="font-medium">Cobranca criada</span></div>
            {resultado.invoiceUrl && (<div><p className="text-xs text-muted-foreground">Link de pagamento:</p><div className="flex items-center gap-2 mt-1"><Input value={resultado.invoiceUrl} readOnly className="text-xs font-mono" /><Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(resultado.invoiceUrl); toast.success("Copiado"); }}><Copy className="h-3.5 w-3.5" /></Button></div></div>)}
            {resultado.pixQrCode && (<div className="text-center"><img src={`data:image/png;base64,${resultado.pixQrCode.image}`} alt="Pix" className="mx-auto w-40 h-40 rounded-lg border" /><Button size="sm" variant="ghost" className="text-xs mt-1" onClick={() => { navigator.clipboard.writeText(resultado.pixQrCode.payload); toast.success("Pix copiado"); }}><Copy className="h-3 w-3 mr-1" /> Copiar Pix</Button></div>)}
            <Button className="w-full" onClick={() => { resetForm(); onOpenChange(false); }}>Fechar</Button>
          </div>
        ) : (
          <><div className="space-y-3 py-1">
            <div className="flex gap-2"><Button variant={modo === "avulsa" ? "default" : "outline"} size="sm" className="flex-1 text-xs" onClick={() => setModo("avulsa")}>Avulsa</Button><Button variant={modo === "parcelada" ? "default" : "outline"} size="sm" className="flex-1 text-xs" onClick={() => setModo("parcelada")}>Parcelada</Button><Button variant={modo === "recorrente" ? "default" : "outline"} size="sm" className="flex-1 text-xs" onClick={() => setModo("recorrente")}><Repeat className="h-3 w-3 mr-1" />Recorrente</Button></div>
            <div><Label className="text-xs">Cliente</Label><Select value={contatoId} onValueChange={setContatoId}><SelectTrigger className="mt-1"><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{clientes?.map((c: any) => (<SelectItem key={c.contatoId} value={c.contatoId.toString()}>{c.contatoNome} ({c.cpfCnpj})</SelectItem>))}</SelectContent></Select></div>
            <div className="grid grid-cols-2 gap-2"><div><Label className="text-xs">{modo === "parcelada" ? "Valor total (R$)" : "Valor (R$)"}</Label><Input type="number" step="0.01" min="0.01" placeholder="150.00" value={valor} onChange={(e) => setValor(e.target.value)} className="mt-1" /></div><div><Label className="text-xs">{modo === "recorrente" ? "Primeiro vencimento" : "Vencimento"}</Label><Input type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} className="mt-1" /></div></div>
            <div className="grid grid-cols-2 gap-2"><div><Label className="text-xs">Forma</Label><Select value={forma} onValueChange={setForma}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="PIX">Pix</SelectItem><SelectItem value="BOLETO">Boleto</SelectItem><SelectItem value="CREDIT_CARD">Cartao</SelectItem><SelectItem value="UNDEFINED">Cliente escolhe</SelectItem></SelectContent></Select></div>{modo === "parcelada" && (<div><Label className="text-xs">Parcelas</Label><Input type="number" min="2" max="24" value={parcelas} onChange={(e) => setParcelas(e.target.value)} className="mt-1" /></div>)}{modo === "recorrente" && (<div><Label className="text-xs">Ciclo</Label><Select value={ciclo} onValueChange={setCiclo}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="WEEKLY">Semanal</SelectItem><SelectItem value="BIWEEKLY">Quinzenal</SelectItem><SelectItem value="MONTHLY">Mensal</SelectItem><SelectItem value="QUARTERLY">Trimestral</SelectItem><SelectItem value="SEMIANNUALLY">Semestral</SelectItem><SelectItem value="YEARLY">Anual</SelectItem></SelectContent></Select></div>)}</div>
            {modo === "parcelada" && valor && parcelas && <p className="text-xs text-muted-foreground">{parseInt(parcelas)}x de {formatBRL(parseFloat(valor) / parseInt(parcelas))}</p>}
            <div><Label className="text-xs">Descricao</Label><Input placeholder="Honorarios" value={descricao} onChange={(e) => setDescricao(e.target.value)} className="mt-1" /></div>
          </div><DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button><Button onClick={handleCriar} disabled={isPending || !contatoId || !valor || !vencimento}>{isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}{modo === "parcelada" ? `Parcelar ${parcelas}x` : modo === "recorrente" ? "Criar assinatura" : "Criar"}</Button></DialogFooter></>
        )}
      </DialogContent>
    </Dialog>
  );
}

function NovaAssinaturaDialog({ open, onOpenChange, onSuccess }: { open: boolean; onOpenChange: (o: boolean) => void; onSuccess: () => void }) {
  const [contatoId, setContatoId] = useState(""); const [valor, setValor] = useState(""); const [vencimento, setVencimento] = useState(""); const [ciclo, setCiclo] = useState("MONTHLY"); const [forma, setForma] = useState("PIX"); const [descricao, setDescricao] = useState("");
  const { data: clientes } = trpc.asaas.listarClientesVinculados.useQuery(undefined, { retry: false });
  const criarMut = trpc.asaas.criarAssinatura.useMutation({ onSuccess: () => { toast.success("Assinatura criada"); setContatoId(""); setValor(""); setVencimento(""); setDescricao(""); onOpenChange(false); onSuccess(); }, onError: (err) => toast.error("Erro", { description: err.message }) });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-sm"><DialogHeader><DialogTitle>Nova assinatura</DialogTitle><DialogDescription>Cobranca recorrente automatica.</DialogDescription></DialogHeader>
      <div className="space-y-3 py-1">
        <div><Label className="text-xs">Cliente</Label><Select value={contatoId} onValueChange={setContatoId}><SelectTrigger className="mt-1"><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{clientes?.map((c: any) => (<SelectItem key={c.contatoId} value={c.contatoId.toString()}>{c.contatoNome} ({c.cpfCnpj})</SelectItem>))}</SelectContent></Select></div>
        <div className="grid grid-cols-2 gap-2"><div><Label className="text-xs">Valor (R$)</Label><Input type="number" step="0.01" min="0.01" value={valor} onChange={(e) => setValor(e.target.value)} className="mt-1" /></div><div><Label className="text-xs">Proximo vencimento</Label><Input type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} className="mt-1" /></div></div>
        <div className="grid grid-cols-2 gap-2"><div><Label className="text-xs">Ciclo</Label><Select value={ciclo} onValueChange={setCiclo}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="WEEKLY">Semanal</SelectItem><SelectItem value="BIWEEKLY">Quinzenal</SelectItem><SelectItem value="MONTHLY">Mensal</SelectItem><SelectItem value="QUARTERLY">Trimestral</SelectItem><SelectItem value="SEMIANNUALLY">Semestral</SelectItem><SelectItem value="YEARLY">Anual</SelectItem></SelectContent></Select></div><div><Label className="text-xs">Forma</Label><Select value={forma} onValueChange={setForma}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="PIX">Pix</SelectItem><SelectItem value="BOLETO">Boleto</SelectItem><SelectItem value="CREDIT_CARD">Cartao</SelectItem></SelectContent></Select></div></div>
        <div><Label className="text-xs">Descricao</Label><Input placeholder="Honorarios mensais" value={descricao} onChange={(e) => setDescricao(e.target.value)} className="mt-1" /></div>
      </div>
      <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button><Button onClick={() => criarMut.mutate({ contatoId: parseInt(contatoId), valor: parseFloat(valor), proximoVencimento: vencimento, ciclo: ciclo as any, formaPagamento: forma as any, descricao: descricao || undefined })} disabled={criarMut.isPending || !contatoId || !valor || !vencimento}>{criarMut.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Repeat className="h-4 w-4 mr-2" />}Criar assinatura</Button></DialogFooter>
    </DialogContent></Dialog>
  );
}

function NovoClienteDialog({ open, onOpenChange, onSuccess }: { open: boolean; onOpenChange: (o: boolean) => void; onSuccess: () => void }) {
  const [nome, setNome] = useState(""); const [cpf, setCpf] = useState(""); const [email, setEmail] = useState(""); const [tel, setTel] = useState(""); const [cep, setCep] = useState(""); const [endereco, setEndereco] = useState(""); const [numero, setNumero] = useState(""); const [bairro, setBairro] = useState("");
  const criarMut = trpc.asaas.criarClienteAsaas.useMutation({ onSuccess: () => { toast.success("Cliente cadastrado"); setNome(""); setCpf(""); setEmail(""); setTel(""); setCep(""); setEndereco(""); setNumero(""); setBairro(""); onOpenChange(false); onSuccess(); }, onError: (err) => toast.error("Erro", { description: err.message }) });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>Novo cliente</DialogTitle><DialogDescription>Cadastra no Asaas e vincula ao CRM.</DialogDescription></DialogHeader>
      <div className="space-y-3 py-1">
        <div className="grid grid-cols-2 gap-2"><div><Label className="text-xs">Nome *</Label><Input placeholder="Joao Silva" value={nome} onChange={(e) => setNome(e.target.value)} className="mt-1" /></div><div><Label className="text-xs">CPF/CNPJ *</Label><Input placeholder="000.000.000-00" value={cpf} onChange={(e) => setCpf(e.target.value)} className="mt-1" /></div></div>
        <div className="grid grid-cols-2 gap-2"><div><Label className="text-xs">Email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1" /></div><div><Label className="text-xs">Telefone</Label><Input value={tel} onChange={(e) => setTel(e.target.value)} className="mt-1" /></div></div>
        <div className="grid grid-cols-3 gap-2"><div><Label className="text-xs">CEP</Label><Input value={cep} onChange={(e) => setCep(e.target.value)} className="mt-1" /></div><div className="col-span-2"><Label className="text-xs">Endereco</Label><Input value={endereco} onChange={(e) => setEndereco(e.target.value)} className="mt-1" /></div></div>
        <div className="grid grid-cols-2 gap-2"><div><Label className="text-xs">Numero</Label><Input value={numero} onChange={(e) => setNumero(e.target.value)} className="mt-1" /></div><div><Label className="text-xs">Bairro</Label><Input value={bairro} onChange={(e) => setBairro(e.target.value)} className="mt-1" /></div></div>
      </div>
      <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button><Button onClick={() => criarMut.mutate({ nome, cpfCnpj: cpf, email: email || undefined, telefone: tel || undefined, cep: cep || undefined, endereco: endereco || undefined, numero: numero || undefined, bairro: bairro || undefined })} disabled={criarMut.isPending || !nome || cpf.replace(/\D/g, "").length < 11}>{criarMut.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <UserPlus className="h-4 w-4 mr-2" />}Cadastrar</Button></DialogFooter>
    </DialogContent></Dialog>
  );
}

export default function Financeiro() {
  const [tab, setTab] = useState("cobrancas"); const [novaCobrancaOpen, setNovaCobrancaOpen] = useState(false); const [novaAssinaturaOpen, setNovaAssinaturaOpen] = useState(false); const [novoClienteOpen, setNovoClienteOpen] = useState(false); const [filtroStatus, setFiltroStatus] = useState("todos"); const [buscaClientes, setBuscaClientes] = useState("");

  const { data: statusAsaas, isLoading: loadStatus, refetch: refetchStatus } = trpc.asaas.status.useQuery(undefined, { retry: false });
  const { data: kpis, refetch: refetchKpis } = trpc.asaas.kpis.useQuery(undefined, { retry: false, enabled: statusAsaas?.conectado });
  const { data: saldo } = trpc.asaas.obterSaldo.useQuery(undefined, { retry: false, enabled: statusAsaas?.conectado });
  const { data: cobrancas, isLoading: loadCob, refetch: refetchCob } = trpc.asaas.listarCobrancas.useQuery({ status: filtroStatus !== "todos" ? filtroStatus : undefined, limit: 50 }, { retry: false, enabled: statusAsaas?.conectado });
  const { data: assinaturas, refetch: refetchSubs } = trpc.asaas.listarAssinaturas.useQuery(undefined, { retry: false, enabled: statusAsaas?.conectado });
  const { data: clientesVinculados, refetch: refetchClientes } = trpc.asaas.listarClientesVinculados.useQuery({ busca: buscaClientes || undefined }, { retry: false, enabled: statusAsaas?.conectado });

  const syncMut = trpc.asaas.sincronizarClientes.useMutation({ onSuccess: (data) => { const p = []; if (data.vinculados > 0) p.push(`${data.vinculados} vinculados`); if (data.novos > 0) p.push(`${data.novos} novos`); if (data.cobrancasSincronizadas > 0) p.push(`${data.cobrancasSincronizadas} cobrancas`); toast.success(`Sincronizado: ${p.join(", ") || "tudo em dia"}`); refetchAll(); }, onError: (err) => toast.error("Erro", { description: err.message }) });
  const excluirCobMut = trpc.asaas.excluirCobranca.useMutation({ onSuccess: () => { toast.success("Cobranca cancelada"); refetchCob(); refetchKpis(); }, onError: (err) => toast.error("Erro", { description: err.message }) });
  const cancelarSubMut = trpc.asaas.cancelarAssinatura.useMutation({ onSuccess: () => { toast.success("Assinatura cancelada"); refetchSubs(); }, onError: (err) => toast.error("Erro", { description: err.message }) });
  const refetchAll = () => { refetchStatus(); refetchKpis(); refetchCob(); refetchSubs(); refetchClientes(); };

  if (loadStatus) return <div className="space-y-6"><Skeleton className="h-8 w-48" /><Skeleton className="h-32 w-full" /></div>;

  if (!statusAsaas?.conectado) return (
    <div className="space-y-6"><div><h1 className="text-2xl font-semibold tracking-tight">Financeiro</h1><p className="text-muted-foreground mt-1">Gerencie cobrancas via Asaas.</p></div>
    <Card><CardContent className="flex flex-col items-center justify-center py-16 gap-4"><div className="h-16 w-16 rounded-2xl bg-muted flex items-center justify-center"><DollarSign className="h-8 w-8 text-muted-foreground" /></div><div className="text-center"><p className="font-medium text-lg">Conecte seu Asaas</p><p className="text-sm text-muted-foreground mt-1 max-w-md">Conecte em Configuracoes - Integracoes.</p></div><Button onClick={() => window.location.href = "/configuracoes"}><Settings className="h-4 w-4 mr-2" />Ir para Configuracoes</Button></CardContent></Card></div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between"><div><h1 className="text-2xl font-semibold tracking-tight">Financeiro</h1><div className="flex items-center gap-2 mt-1"><Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-500/25 hover:bg-emerald-500/15 text-[10px] font-normal"><CheckCircle2 className="h-3 w-3 mr-1" />Asaas {statusAsaas.modo === "sandbox" ? "Sandbox" : ""}</Badge>{saldo && <span className="text-xs text-muted-foreground">Saldo: {formatBRL(saldo.balance)}</span>}</div></div><div className="flex items-center gap-2"><Button variant="outline" size="sm" onClick={() => syncMut.mutate()} disabled={syncMut.isPending}>{syncMut.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}Sincronizar</Button><Button size="sm" onClick={() => setNovaCobrancaOpen(true)}><Plus className="h-4 w-4 mr-1.5" />Cobrar</Button></div></div>

      <div className="grid gap-4 sm:grid-cols-4">
        <Card><CardContent className="pt-5 pb-4"><div className="flex items-center gap-3"><div className="h-9 w-9 rounded-lg bg-emerald-500/10 flex items-center justify-center"><TrendingUp className="h-4 w-4 text-emerald-500" /></div><div><p className="text-xs text-muted-foreground">Recebido</p><p className="text-lg font-bold text-emerald-600">{formatBRL(kpis?.recebido ?? 0)}</p></div></div></CardContent></Card>
        <Card><CardContent className="pt-5 pb-4"><div className="flex items-center gap-3"><div className="h-9 w-9 rounded-lg bg-amber-500/10 flex items-center justify-center"><Clock className="h-4 w-4 text-amber-500" /></div><div><p className="text-xs text-muted-foreground">Pendente</p><p className="text-lg font-bold text-amber-600">{formatBRL(kpis?.pendente ?? 0)}</p></div></div></CardContent></Card>
        <Card><CardContent className="pt-5 pb-4"><div className="flex items-center gap-3"><div className="h-9 w-9 rounded-lg bg-red-500/10 flex items-center justify-center"><AlertTriangle className="h-4 w-4 text-red-500" /></div><div><p className="text-xs text-muted-foreground">Vencido</p><p className="text-lg font-bold text-red-600">{formatBRL(kpis?.vencido ?? 0)}</p></div></div></CardContent></Card>
        <Card><CardContent className="pt-5 pb-4"><div className="flex items-center gap-3"><div className="h-9 w-9 rounded-lg bg-blue-500/10 flex items-center justify-center"><Wallet className="h-4 w-4 text-blue-500" /></div><div><p className="text-xs text-muted-foreground">Saldo Asaas</p><p className="text-lg font-bold">{saldo ? formatBRL(saldo.balance) : "\u2014"}</p></div></div></CardContent></Card>
      </div>

      <Tabs value={tab} onValueChange={setTab}><TabsList><TabsTrigger value="cobrancas" className="gap-1.5"><Receipt className="h-3.5 w-3.5" />Cobrancas ({kpis?.totalCobrancas ?? 0})</TabsTrigger><TabsTrigger value="assinaturas" className="gap-1.5"><Repeat className="h-3.5 w-3.5" />Assinaturas ({assinaturas?.length ?? 0})</TabsTrigger><TabsTrigger value="clientes" className="gap-1.5"><Users className="h-3.5 w-3.5" />Clientes ({clientesVinculados?.length ?? 0})</TabsTrigger></TabsList>

        <TabsContent value="cobrancas" className="mt-4 space-y-4">
          <div className="flex items-center justify-between"><Select value={filtroStatus} onValueChange={setFiltroStatus}><SelectTrigger className="w-36 h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="todos">Todos status</SelectItem><SelectItem value="PENDING">Pendente</SelectItem><SelectItem value="RECEIVED">Recebido</SelectItem><SelectItem value="CONFIRMED">Confirmado</SelectItem><SelectItem value="OVERDUE">Vencido</SelectItem><SelectItem value="REFUNDED">Estornado</SelectItem></SelectContent></Select><Button size="sm" variant="outline" onClick={() => setNovaCobrancaOpen(true)}><Plus className="h-3.5 w-3.5 mr-1" />Nova cobranca</Button></div>
          {loadCob ? <div className="space-y-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div> : cobrancas && cobrancas.items.length > 0 ? (
            <Table><TableHeader><TableRow><TableHead>Cliente</TableHead><TableHead>Valor</TableHead><TableHead>Vencimento</TableHead><TableHead>Forma</TableHead><TableHead>Status</TableHead><TableHead>Descricao</TableHead><TableHead className="text-right">Acoes</TableHead></TableRow></TableHeader><TableBody>
              {cobrancas.items.map((c: any) => (<TableRow key={c.id}><TableCell className="font-medium text-sm">{c.nomeContato}</TableCell><TableCell className="font-mono text-sm">{formatBRL(parseFloat(c.valor))}</TableCell><TableCell className="text-sm text-muted-foreground">{c.vencimento ? new Date(c.vencimento + "T12:00:00").toLocaleDateString("pt-BR") : "\u2014"}</TableCell><TableCell><FormaBadge forma={c.formaPagamento} /></TableCell><TableCell><StatusBadge status={c.status} /></TableCell><TableCell className="text-xs text-muted-foreground truncate max-w-[120px]">{c.descricao || "\u2014"}</TableCell><TableCell className="text-right"><div className="flex items-center justify-end gap-1">{c.invoiceUrl && <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => window.open(c.invoiceUrl, "_blank")} title="Link pagamento"><ExternalLink className="h-3.5 w-3.5" /></Button>}{c.invoiceUrl && <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { navigator.clipboard.writeText(c.invoiceUrl); toast.success("Link copiado"); }} title="Copiar"><Copy className="h-3.5 w-3.5" /></Button>}{c.status === "PENDING" && <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={() => { if (confirm("Cancelar?")) excluirCobMut.mutate({ id: c.id }); }}><Trash2 className="h-3.5 w-3.5" /></Button>}</div></TableCell></TableRow>))}
            </TableBody></Table>
          ) : <div className="flex flex-col items-center justify-center py-12 gap-2"><Receipt className="h-8 w-8 text-muted-foreground opacity-30" /><p className="text-sm text-muted-foreground">Nenhuma cobranca.</p></div>}
        </TabsContent>

        <TabsContent value="assinaturas" className="mt-4 space-y-4">
          <div className="flex items-center justify-end"><Button size="sm" variant="outline" onClick={() => setNovaAssinaturaOpen(true)}><Plus className="h-3.5 w-3.5 mr-1" />Nova assinatura</Button></div>
          {assinaturas && assinaturas.length > 0 ? (
            <Table><TableHeader><TableRow><TableHead>Cliente</TableHead><TableHead>Valor</TableHead><TableHead>Ciclo</TableHead><TableHead>Prox. venc.</TableHead><TableHead>Forma</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Acoes</TableHead></TableRow></TableHeader><TableBody>
              {assinaturas.map((s: any) => (<TableRow key={s.id}><TableCell className="font-medium text-sm">{s.contatoNome}</TableCell><TableCell className="font-mono text-sm">{formatBRL(s.value)}</TableCell><TableCell className="text-xs text-muted-foreground">{CICLO_LABELS[s.cycle] || s.cycle}</TableCell><TableCell className="text-sm text-muted-foreground">{s.nextDueDate ? new Date(s.nextDueDate + "T12:00:00").toLocaleDateString("pt-BR") : "\u2014"}</TableCell><TableCell><FormaBadge forma={s.billingType} /></TableCell><TableCell><StatusBadge status={s.status} /></TableCell><TableCell className="text-right">{s.status === "ACTIVE" && <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive" onClick={() => { if (confirm("Cancelar assinatura?")) cancelarSubMut.mutate({ assinaturaId: s.id }); }}><XCircle className="h-3 w-3 mr-1" />Cancelar</Button>}</TableCell></TableRow>))}
            </TableBody></Table>
          ) : <div className="flex flex-col items-center justify-center py-12 gap-2"><Repeat className="h-8 w-8 text-muted-foreground opacity-30" /><p className="text-sm text-muted-foreground">Nenhuma assinatura.</p></div>}
        </TabsContent>

        <TabsContent value="clientes" className="mt-4 space-y-4">
          <div className="flex items-center justify-between gap-3"><div className="relative flex-1 max-w-sm"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><Input placeholder="Buscar..." value={buscaClientes} onChange={(e) => setBuscaClientes(e.target.value)} className="pl-9 h-8 text-sm" /></div><Button size="sm" variant="outline" onClick={() => setNovoClienteOpen(true)}><UserPlus className="h-3.5 w-3.5 mr-1" />Novo cliente</Button></div>
          {clientesVinculados && clientesVinculados.length > 0 ? (
            <Table><TableHeader><TableRow><TableHead>Nome</TableHead><TableHead>CPF/CNPJ</TableHead><TableHead>Contato</TableHead><TableHead>Cobrancas</TableHead><TableHead>Pendente</TableHead><TableHead>Vencido</TableHead><TableHead>Pago</TableHead></TableRow></TableHeader><TableBody>
              {clientesVinculados.map((c: any) => (<TableRow key={c.id}><TableCell className="font-medium text-sm">{c.contatoNome}</TableCell><TableCell className="font-mono text-xs text-muted-foreground">{c.cpfCnpj}</TableCell><TableCell className="text-xs text-muted-foreground">{c.contatoTelefone || c.contatoEmail || "\u2014"}</TableCell><TableCell className="text-sm text-center">{c.totalCobrancas}</TableCell><TableCell className="text-sm text-amber-600">{c.pendente > 0 ? formatBRL(c.pendente) : "\u2014"}</TableCell><TableCell className="text-sm text-red-600">{c.vencido > 0 ? formatBRL(c.vencido) : "\u2014"}</TableCell><TableCell className="text-sm text-emerald-600">{c.pago > 0 ? formatBRL(c.pago) : "\u2014"}</TableCell></TableRow>))}
            </TableBody></Table>
          ) : <div className="flex flex-col items-center justify-center py-12 gap-2"><Users className="h-8 w-8 text-muted-foreground opacity-30" /><p className="text-sm text-muted-foreground">Nenhum cliente vinculado.</p></div>}
        </TabsContent>
      </Tabs>

      <NovaCobrancaDialog open={novaCobrancaOpen} onOpenChange={setNovaCobrancaOpen} onSuccess={() => { refetchCob(); refetchKpis(); refetchSubs(); }} />
      <NovaAssinaturaDialog open={novaAssinaturaOpen} onOpenChange={setNovaAssinaturaOpen} onSuccess={refetchSubs} />
      <NovoClienteDialog open={novoClienteOpen} onOpenChange={setNovoClienteOpen} onSuccess={refetchClientes} />
    </div>
  );
}
