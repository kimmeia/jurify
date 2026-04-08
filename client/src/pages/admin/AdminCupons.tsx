import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import {
  Tag, Plus, Trash2, Loader2, Percent, DollarSign, Copy, CheckCircle2, XCircle, Calendar,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

function formatValor(tipo: string, valor: number) {
  if (tipo === "percentual") return `${valor}% off`;
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(valor / 100) + " off";
}

function CriarCupomDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: () => void;
}) {
  const [codigo, setCodigo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [tipo, setTipo] = useState<"percentual" | "valorFixo">("percentual");
  const [valor, setValor] = useState("");
  const [validoAte, setValidoAte] = useState("");
  const [maxUsos, setMaxUsos] = useState("");

  const { data: planosEditaveis } = trpc.admin.listarPlanosEditaveis.useQuery();
  const [planosSelecionados, setPlanosSelecionados] = useState<string[]>([]);

  const criarMut = trpc.admin.criarCupom.useMutation({
    onSuccess: () => {
      toast.success("Cupom criado!");
      // Reset
      setCodigo("");
      setDescricao("");
      setTipo("percentual");
      setValor("");
      setValidoAte("");
      setMaxUsos("");
      setPlanosSelecionados([]);
      onCreated();
      onOpenChange(false);
    },
    onError: (err) => toast.error("Erro ao criar cupom", { description: err.message }),
  });

  const handleSave = () => {
    const v = parseInt(valor);
    if (!v || v < 1) {
      toast.error("Valor inválido");
      return;
    }
    if (tipo === "percentual" && v > 100) {
      toast.error("Percentual não pode passar de 100%");
      return;
    }
    criarMut.mutate({
      codigo: codigo.trim(),
      descricao: descricao.trim() || undefined,
      tipo,
      // Para valorFixo, convertemos reais para centavos
      valor: tipo === "valorFixo" ? Math.round(parseFloat(valor.replace(",", ".")) * 100) : v,
      validoAte: validoAte ? new Date(validoAte).toISOString() : undefined,
      maxUsos: maxUsos ? parseInt(maxUsos) : undefined,
      planosIds: planosSelecionados.length > 0 ? planosSelecionados : undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Novo cupom de desconto</DialogTitle>
          <DialogDescription>
            Cria um código promocional que clientes podem usar no checkout.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Código *</Label>
            <Input
              placeholder="BLACKFRIDAY2025"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.toUpperCase())}
              maxLength={64}
              className="font-mono uppercase"
            />
            <p className="text-[10px] text-muted-foreground">
              Letras, números, _ e -. Case-insensitive.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Descrição interna</Label>
            <Textarea
              placeholder="Campanha Black Friday 2025"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              rows={2}
              maxLength={255}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Tipo *</Label>
              <Select value={tipo} onValueChange={(v) => setTipo(v as any)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="percentual">
                    <Percent className="h-3 w-3 inline mr-1" /> Percentual
                  </SelectItem>
                  <SelectItem value="valorFixo">
                    <DollarSign className="h-3 w-3 inline mr-1" /> Valor fixo
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Valor * {tipo === "percentual" ? "(%)" : "(R$)"}</Label>
              <Input
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                placeholder={tipo === "percentual" ? "20" : "49,90"}
                inputMode="decimal"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Válido até</Label>
              <Input
                type="datetime-local"
                value={validoAte}
                onChange={(e) => setValidoAte(e.target.value)}
              />
              <p className="text-[10px] text-muted-foreground">Opcional</p>
            </div>
            <div className="space-y-1.5">
              <Label>Máx. usos</Label>
              <Input
                type="number"
                value={maxUsos}
                onChange={(e) => setMaxUsos(e.target.value)}
                placeholder="100"
                min={1}
              />
              <p className="text-[10px] text-muted-foreground">Opcional (ilimitado)</p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Planos elegíveis</Label>
            <div className="flex flex-wrap gap-2">
              {planosEditaveis?.map((p) => {
                const selected = planosSelecionados.includes(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      if (selected) {
                        setPlanosSelecionados(planosSelecionados.filter((x) => x !== p.id));
                      } else {
                        setPlanosSelecionados([...planosSelecionados, p.id]);
                      }
                    }}
                    className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                      selected
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background text-muted-foreground border-muted hover:border-primary/50"
                    }`}
                  >
                    {p.name}
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-muted-foreground">
              Vazio = válido para todos os planos
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSave} disabled={!codigo || !valor || criarMut.isPending}>
            {criarMut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Criar cupom
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function AdminCupons() {
  const { data: cupons, isLoading, refetch } = trpc.admin.listarCupons.useQuery();
  const [criarOpen, setCriarOpen] = useState(false);

  const alternarMut = trpc.admin.alternarAtivoCupom.useMutation({
    onSuccess: () => {
      toast.success("Status atualizado");
      refetch();
    },
    onError: (err) => toast.error("Erro", { description: err.message }),
  });

  const deletarMut = trpc.admin.deletarCupom.useMutation({
    onSuccess: () => {
      toast.success("Cupom deletado");
      refetch();
    },
    onError: (err) => toast.error("Erro", { description: err.message }),
  });

  const copiarCodigo = (codigo: string) => {
    navigator.clipboard.writeText(codigo);
    toast.success(`Código "${codigo}" copiado`);
  };

  const totalAtivos = cupons?.filter((c) => c.ativo).length ?? 0;
  const totalUsos = cupons?.reduce((sum, c) => sum + c.usos, 0) ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-xl bg-gradient-to-br from-pink-100 to-rose-100 dark:from-pink-900/40 dark:to-rose-900/40">
            <Tag className="h-6 w-6 text-pink-600" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Cupons</h1>
            <p className="text-muted-foreground mt-1">
              Códigos promocionais para aplicar descontos no checkout.
            </p>
          </div>
        </div>
        <Button onClick={() => setCriarOpen(true)}>
          <Plus className="h-4 w-4 mr-1.5" />
          Novo cupom
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Cupons ativos</p>
            <p className="text-3xl font-bold mt-1">{totalAtivos}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Total cadastrados</p>
            <p className="text-3xl font-bold mt-1">{cupons?.length ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Usos totais</p>
            <p className="text-3xl font-bold mt-1">{totalUsos}</p>
          </CardContent>
        </Card>
      </div>

      {/* Lista */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Todos os cupons</CardTitle>
          <CardDescription>Clique no código para copiar</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : !cupons || cupons.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Tag className="h-12 w-12 mb-3 opacity-30" />
              <p className="text-sm">Nenhum cupom criado ainda.</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={() => setCriarOpen(true)}
              >
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                Criar primeiro cupom
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Código</TableHead>
                  <TableHead>Desconto</TableHead>
                  <TableHead>Validade</TableHead>
                  <TableHead>Usos</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cupons.map((c) => {
                  const expirado =
                    c.validoAte && new Date(c.validoAte) < new Date();
                  const esgotado = c.maxUsos && c.usos >= c.maxUsos;
                  return (
                    <TableRow key={c.id}>
                      <TableCell>
                        <button
                          onClick={() => copiarCodigo(c.codigo)}
                          className="font-mono text-sm font-medium hover:text-primary transition-colors flex items-center gap-1.5"
                          title="Copiar código"
                        >
                          {c.codigo}
                          <Copy className="h-3 w-3 opacity-50" />
                        </button>
                        {c.descricao && (
                          <p className="text-[10px] text-muted-foreground truncate max-w-[180px]">
                            {c.descricao}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        <Badge className="bg-pink-500/15 text-pink-700 border-pink-500/30">
                          {formatValor(c.tipo, c.valor)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {c.validoAte ? (
                          <div className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {new Date(c.validoAte).toLocaleDateString("pt-BR")}
                          </div>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {c.usos}
                        {c.maxUsos && <span className="text-muted-foreground">/{c.maxUsos}</span>}
                      </TableCell>
                      <TableCell>
                        {expirado ? (
                          <Badge variant="outline" className="text-[10px]">
                            <XCircle className="h-2.5 w-2.5 mr-1" /> Expirado
                          </Badge>
                        ) : esgotado ? (
                          <Badge variant="outline" className="text-[10px]">
                            Esgotado
                          </Badge>
                        ) : c.ativo ? (
                          <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-500/30 text-[10px]">
                            <CheckCircle2 className="h-2.5 w-2.5 mr-1" /> Ativo
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px]">Inativo</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Switch
                            checked={c.ativo}
                            onCheckedChange={(v) => alternarMut.mutate({ id: c.id, ativo: v })}
                          />
                          {c.usos === 0 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                              onClick={() => {
                                if (confirm(`Deletar cupom ${c.codigo}?`)) {
                                  deletarMut.mutate({ id: c.id });
                                }
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <CriarCupomDialog
        open={criarOpen}
        onOpenChange={setCriarOpen}
        onCreated={refetch}
      />
    </div>
  );
}
