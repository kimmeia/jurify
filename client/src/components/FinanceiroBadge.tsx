/**
 * FinanceiroBadge — Badge de status financeiro do contato.
 * Mostra se está em dia, devendo, ou não vinculado ao Asaas.
 * Usado no Atendimento (header da conversa) e no CRM (ficha do contato).
 */

import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  DollarSign, AlertTriangle, CheckCircle2, Loader2, Plus, Link, Copy, ExternalLink,
  QrCode,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

function formatBRL(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

// ═══════════════════════════════════════════════════════════════════════════════
// BADGE INLINE (para o header da conversa)
// ═══════════════════════════════════════════════════════════════════════════════

export function FinanceiroBadge({ contatoId }: { contatoId: number }) {
  const { data: asaasStatus } = trpc.asaas.status.useQuery(undefined, { retry: false });
  const { data: resumo } = trpc.asaas.resumoContato.useQuery(
    { contatoId },
    { retry: false, enabled: !!asaasStatus?.conectado && !!contatoId }
  );

  // Asaas não conectado — não mostrar nada
  if (!asaasStatus?.conectado) return null;

  // Não vinculado
  if (!resumo?.vinculado) return null;

  const devendo = (resumo.vencido || 0) + (resumo.pendente || 0);

  if (resumo.vencido > 0) {
    return (
      <Badge className="bg-red-500/15 text-red-700 border-red-500/25 hover:bg-red-500/15 text-[9px] font-normal gap-1">
        <AlertTriangle className="h-2.5 w-2.5" />
        Deve {formatBRL(devendo)}
      </Badge>
    );
  }

  if (resumo.pendente > 0) {
    return (
      <Badge className="bg-amber-500/15 text-amber-700 border-amber-500/25 hover:bg-amber-500/15 text-[9px] font-normal gap-1">
        <DollarSign className="h-2.5 w-2.5" />
        Pendente {formatBRL(resumo.pendente)}
      </Badge>
    );
  }

  if (resumo.pago > 0) {
    return (
      <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-500/25 hover:bg-emerald-500/15 text-[9px] font-normal gap-1">
        <CheckCircle2 className="h-2.5 w-2.5" />
        Em dia
      </Badge>
    );
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// POPOVER COM DETALHES (para CRM / Clientes)
// ═══════════════════════════════════════════════════════════════════════════════

export function FinanceiroPopover({ contatoId }: { contatoId: number }) {
  const { data: asaasStatus } = trpc.asaas.status.useQuery(undefined, { retry: false });
  const { data: resumo, refetch } = trpc.asaas.resumoContato.useQuery(
    { contatoId },
    { retry: false, enabled: !!asaasStatus?.conectado && !!contatoId }
  );
  const [cobrancaOpen, setCobrancaOpen] = useState(false);

  const vincularMut = trpc.asaas.vincularContato.useMutation({
    onSuccess: (data) => {
      toast.success(data.jaExistia ? "Contato já vinculado" : "Contato vinculado ao Asaas");
      refetch();
    },
    onError: (err) => toast.error("Erro", { description: err.message }),
  });

  const syncMut = trpc.asaas.syncCobrancasContato.useMutation({
    onSuccess: (data: any) => {
      const total = (data.total ?? 0);
      if (total === 0) {
        toast.success("Tudo em dia", { description: "Nenhuma mudança encontrada." });
      } else {
        const parts: string[] = [];
        if (data.novas > 0) parts.push(`${data.novas} nova(s)`);
        if (data.atualizadas > 0) parts.push(`${data.atualizadas} atualizada(s)`);
        if (data.removidas > 0) parts.push(`${data.removidas} removida(s)`);
        toast.success("Sincronizado", { description: parts.join(" · ") });
      }
      refetch();
    },
    onError: (err) => toast.error("Erro", { description: err.message }),
  });

  if (!asaasStatus?.conectado) return null;

  return (
    <>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className="h-7 text-[11px] gap-1">
            <DollarSign className="h-3.5 w-3.5" />
            Financeiro
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-3" align="end">
          {!resumo?.vinculado ? (
            <div className="space-y-2 text-center py-2">
              <p className="text-xs text-muted-foreground">Contato não vinculado ao Asaas</p>
              <Button
                size="sm"
                variant="outline"
                className="w-full text-xs"
                onClick={() => vincularMut.mutate({ contatoId })}
                disabled={vincularMut.isPending}
              >
                {vincularMut.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Link className="h-3 w-3 mr-1" />}
                Vincular ao Asaas
              </Button>
              <p className="text-[10px] text-muted-foreground">O contato precisa ter CPF/CNPJ</p>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Resumo */}
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="text-xs text-muted-foreground">Recebido</p>
                  <p className="text-sm font-bold text-emerald-600">{formatBRL(resumo.pago)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Pendente</p>
                  <p className="text-sm font-bold text-amber-600">{formatBRL(resumo.pendente)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Vencido</p>
                  <p className="text-sm font-bold text-red-600">{formatBRL(resumo.vencido)}</p>
                </div>
              </div>

              {/* Últimas cobranças */}
              {resumo.cobrancas.length > 0 && (
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {resumo.cobrancas.slice(0, 5).map((c: any) => (
                    <div key={c.id} className="flex items-center justify-between text-xs py-1 border-b border-dashed last:border-0">
                      <div className="flex items-center gap-1.5">
                        <span className={
                          ["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"].includes(c.status) ? "text-emerald-600" :
                          c.status === "OVERDUE" ? "text-red-600" :
                          c.status === "PENDING" ? "text-amber-600" : "text-muted-foreground"
                        }>
                          {["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"].includes(c.status) ? "✓" : c.status === "OVERDUE" ? "!" : "○"}
                        </span>
                        <span>{formatBRL(parseFloat(c.valor))}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-muted-foreground">
                          {c.vencimento ? new Date(c.vencimento + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) : ""}
                        </span>
                        {c.invoiceUrl && (
                          <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => window.open(c.invoiceUrl, "_blank")}>
                            <ExternalLink className="h-2.5 w-2.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Ações */}
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="flex-1 text-xs h-7" onClick={() => syncMut.mutate({ contatoId })} disabled={syncMut.isPending}>
                  {syncMut.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
                  Sincronizar
                </Button>
                <Button size="sm" className="flex-1 text-xs h-7" onClick={() => setCobrancaOpen(true)}>
                  <Plus className="h-3 w-3 mr-1" />
                  Cobrar
                </Button>
              </div>
            </div>
          )}
        </PopoverContent>
      </Popover>

      {cobrancaOpen && (
        <CobrancaRapidaDialog
          contatoId={contatoId}
          open={cobrancaOpen}
          onOpenChange={setCobrancaOpen}
          onSuccess={() => refetch()}
        />
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// DIALOG: COBRANÇA RÁPIDA (usado no popover e no atendimento)
// ═══════════════════════════════════════════════════════════════════════════════

export function CobrancaRapidaDialog({
  contatoId, open, onOpenChange, onSuccess,
}: {
  contatoId: number; open: boolean; onOpenChange: (o: boolean) => void; onSuccess: () => void;
}) {
  const [valor, setValor] = useState("");
  const [vencimento, setVencimento] = useState("");
  const [forma, setForma] = useState("PIX");
  const [descricao, setDescricao] = useState("");
  const [resultado, setResultado] = useState<any>(null);

  const criarMut = trpc.asaas.criarCobranca.useMutation({
    onSuccess: (data) => {
      setResultado(data.cobranca);
      toast.success("Cobrança criada");
      onSuccess();
    },
    onError: (err) => toast.error("Erro", { description: err.message, duration: 8000 }),
  });

  const reset = () => { setValor(""); setVencimento(""); setForma("PIX"); setDescricao(""); setResultado(null); };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Cobrar</DialogTitle>
          <DialogDescription>Criar cobrança rápida para este contato.</DialogDescription>
        </DialogHeader>

        {resultado ? (
          <div className="space-y-3 py-2">
            <div className="flex items-center gap-2 text-emerald-600">
              <CheckCircle2 className="h-5 w-5" />
              <span className="font-medium text-sm">Cobrança criada</span>
            </div>
            {resultado.invoiceUrl && (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Link de pagamento:</p>
                <div className="flex items-center gap-1">
                  <Input value={resultado.invoiceUrl} readOnly className="text-[10px] font-mono h-8" />
                  <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={() => { navigator.clipboard.writeText(resultado.invoiceUrl); toast.success("Copiado"); }}>
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            )}
            {resultado.pixQrCode && (
              <div className="text-center">
                <img src={`data:image/png;base64,${resultado.pixQrCode.image}`} alt="Pix" className="mx-auto w-32 h-32 rounded-lg border" />
                <Button size="sm" variant="ghost" className="text-xs mt-1" onClick={() => { navigator.clipboard.writeText(resultado.pixQrCode.payload); toast.success("Código Pix copiado"); }}>
                  <Copy className="h-3 w-3 mr-1" /> Copiar código Pix
                </Button>
              </div>
            )}
            <Button className="w-full" onClick={() => { reset(); onOpenChange(false); }}>Fechar</Button>
          </div>
        ) : (
          <>
            <div className="space-y-3 py-1">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-medium">Valor (R$)</label>
                  <Input type="number" step="0.01" min="0.01" placeholder="150.00" value={valor} onChange={(e) => setValor(e.target.value)} className="mt-1 h-8 text-sm" />
                </div>
                <div>
                  <label className="text-xs font-medium">Vencimento</label>
                  <Input type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} className="mt-1 h-8 text-sm" />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium">Forma</label>
                <Select value={forma} onValueChange={setForma}>
                  <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PIX">Pix</SelectItem>
                    <SelectItem value="BOLETO">Boleto</SelectItem>
                    <SelectItem value="CREDIT_CARD">Cartão</SelectItem>
                    <SelectItem value="UNDEFINED">Cliente escolhe</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium">Descrição</label>
                <Input placeholder="Honorários..." value={descricao} onChange={(e) => setDescricao(e.target.value)} className="mt-1 h-8 text-sm" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button size="sm" onClick={() => criarMut.mutate({ contatoId, valor: parseFloat(valor), vencimento, formaPagamento: forma as any, descricao: descricao || undefined })} disabled={criarMut.isPending || !valor || !vencimento}>
                {criarMut.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <DollarSign className="h-3.5 w-3.5 mr-1" />}
                Cobrar
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
