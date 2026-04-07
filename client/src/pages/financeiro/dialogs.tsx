/**
 * Dialogs do módulo Financeiro.
 * Extraídos de Financeiro.tsx para manter a página principal focada em dados/visualização.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Loader2, Copy, CheckCircle2, Repeat, UserPlus } from "lucide-react";
import { toast } from "sonner";

function formatBRL(value: number) { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value); }

export function NovaCobrancaDialog({ open, onOpenChange, onSuccess }: { open: boolean; onOpenChange: (o: boolean) => void; onSuccess: () => void }) {
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

export function NovaAssinaturaDialog({ open, onOpenChange, onSuccess }: { open: boolean; onOpenChange: (o: boolean) => void; onSuccess: () => void }) {
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

export function NovoClienteDialog({ open, onOpenChange, onSuccess }: { open: boolean; onOpenChange: (o: boolean) => void; onSuccess: () => void }) {
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
