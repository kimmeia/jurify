/**
 * SmartFlow — Automações inteligentes.
 * Fase 2: construtor de cenários + log de execuções.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Zap, Plus, Trash2, Loader2, MessageCircle, Calendar, Brain,
  ArrowRight, Play, Bot, PhoneCall, Clock, GitBranch,
  Webhook, Users, CheckCircle2, Activity, AlertTriangle, XCircle,
} from "lucide-react";
import { toast } from "sonner";

const TIPO_PASSO = [
  { id: "ia_classificar", label: "Classificar intenção (IA)", icon: Brain, cor: "bg-violet-100 text-violet-700" },
  { id: "ia_responder", label: "Responder com IA", icon: Bot, cor: "bg-blue-100 text-blue-700" },
  { id: "calcom_horarios", label: "Buscar horários (Cal.com)", icon: Calendar, cor: "bg-emerald-100 text-emerald-700" },
  { id: "calcom_agendar", label: "Criar agendamento", icon: CheckCircle2, cor: "bg-green-100 text-green-700" },
  { id: "whatsapp_enviar", label: "Enviar mensagem", icon: MessageCircle, cor: "bg-teal-100 text-teal-700" },
  { id: "transferir", label: "Transferir p/ humano", icon: PhoneCall, cor: "bg-amber-100 text-amber-700" },
  { id: "condicional", label: "Condição (if/else)", icon: GitBranch, cor: "bg-orange-100 text-orange-700" },
  { id: "esperar", label: "Esperar (delay)", icon: Clock, cor: "bg-gray-100 text-gray-700" },
  { id: "webhook", label: "Webhook externo", icon: Webhook, cor: "bg-pink-100 text-pink-700" },
];

const GATILHOS = [
  { id: "whatsapp_mensagem", label: "Nova mensagem WhatsApp", icon: MessageCircle },
  { id: "novo_lead", label: "Novo lead no CRM", icon: Users },
  { id: "agendamento_criado", label: "Agendamento criado", icon: Calendar },
  { id: "manual", label: "Acionado manualmente", icon: Play },
];

const STATUS_EXEC: Record<string, { label: string; cor: string; icon: any }> = {
  rodando: { label: "Rodando", cor: "bg-blue-100 text-blue-700", icon: Activity },
  concluido: { label: "Concluído", cor: "bg-emerald-100 text-emerald-700", icon: CheckCircle2 },
  erro: { label: "Erro", cor: "bg-red-100 text-red-700", icon: XCircle },
  cancelado: { label: "Cancelado", cor: "bg-gray-100 text-gray-700", icon: AlertTriangle },
};

function getPassoInfo(tipo: string) {
  return TIPO_PASSO.find((t) => t.id === tipo) || { id: tipo, label: tipo, icon: Zap, cor: "bg-gray-100 text-gray-700" };
}

export default function SmartFlow() {
  const [tab, setTab] = useState("cenarios");
  const [novoOpen, setNovoOpen] = useState(false);
  const [novoNome, setNovoNome] = useState("");
  const [novoDescricao, setNovoDescricao] = useState("");
  const [novoGatilho, setNovoGatilho] = useState("whatsapp_mensagem");
  const [novoPassos, setNovoPassos] = useState<{ tipo: string; config: any }[]>([]);

  const { data: cenarios, isLoading, refetch } = (trpc as any).smartflow.listar.useQuery();
  const { data: execucoes } = (trpc as any).smartflow.execucoes.useQuery({ limite: 50 }, { refetchInterval: 10000 });

  const criarTemplateMut = (trpc as any).smartflow.criarTemplateAtendimento.useMutation({
    onSuccess: () => { toast.success("Cenário de atendimento criado!"); refetch(); },
    onError: (e: any) => toast.error(e.message),
  });
  const criarMut = (trpc as any).smartflow.criar.useMutation({
    onSuccess: () => { toast.success("Cenário criado!"); setNovoOpen(false); resetForm(); refetch(); },
    onError: (e: any) => toast.error(e.message),
  });
  const toggleMut = (trpc as any).smartflow.toggleAtivo.useMutation({ onSuccess: () => refetch() });
  const deletarMut = (trpc as any).smartflow.deletar.useMutation({
    onSuccess: () => { toast.success("Cenário removido"); refetch(); },
    onError: (e: any) => toast.error(e.message),
  });

  const resetForm = () => { setNovoNome(""); setNovoDescricao(""); setNovoGatilho("whatsapp_mensagem"); setNovoPassos([]); };
  const addPasso = (tipo: string) => setNovoPassos([...novoPassos, { tipo, config: {} }]);
  const removePasso = (i: number) => setNovoPassos(novoPassos.filter((_, idx) => idx !== i));

  const lista = cenarios || [];
  const execs = execucoes || [];

  return (
    <div className="space-y-5 max-w-5xl mx-auto">
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-xl bg-gradient-to-br from-amber-100 to-orange-100 dark:from-amber-900/40 dark:to-orange-900/40">
          <Zap className="h-6 w-6 text-amber-600" />
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">SmartFlow</h1>
          <p className="text-sm text-muted-foreground">Automações inteligentes — WhatsApp + IA + Cal.com</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => criarTemplateMut.mutate()} disabled={criarTemplateMut.isPending}>
          {criarTemplateMut.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Zap className="h-3.5 w-3.5 mr-1" />}
          Template rápido
        </Button>
        <Button size="sm" onClick={() => { resetForm(); setNovoOpen(true); }}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Novo cenário
        </Button>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid w-full grid-cols-2 h-9">
          <TabsTrigger value="cenarios" className="text-xs gap-1"><Zap className="h-3 w-3" /> Cenários</TabsTrigger>
          <TabsTrigger value="execucoes" className="text-xs gap-1"><Activity className="h-3 w-3" /> Execuções</TabsTrigger>
        </TabsList>

        <TabsContent value="cenarios" className="mt-4">
          {isLoading ? (
            <div className="space-y-3"><Skeleton className="h-32" /><Skeleton className="h-32" /></div>
          ) : lista.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center py-16 text-center">
                <Zap className="h-12 w-12 text-muted-foreground/20 mb-4" />
                <h3 className="text-lg font-semibold">Nenhum cenário criado</h3>
                <p className="text-sm text-muted-foreground mt-1 max-w-md">
                  Use o "Template rápido" para criar um cenário de atendimento + agendamento, ou crie um do zero.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {lista.map((c: any) => {
                const gatilho = GATILHOS.find((g) => g.id === c.gatilho) || { label: c.gatilho, icon: Play };
                const GIcon = gatilho.icon;
                const passos = c.passos || [];
                return (
                  <Card key={c.id} className="hover:shadow-sm transition-all">
                    <CardContent className="pt-4 pb-4">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-violet-500/10 to-indigo-500/10 flex items-center justify-center shrink-0">
                          <Zap className="h-5 w-5 text-violet-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold">{c.nome}</p>
                            <Badge variant="outline" className="text-[9px] gap-1"><GIcon className="h-2.5 w-2.5" />{gatilho.label}</Badge>
                            {c.ativo ? <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-500/30 text-[9px]">Ativo</Badge> : <Badge variant="outline" className="text-[9px] text-muted-foreground">Inativo</Badge>}
                          </div>
                          {c.descricao && <p className="text-xs text-muted-foreground mt-0.5 truncate">{c.descricao}</p>}
                        </div>
                        <Switch checked={c.ativo} onCheckedChange={(v: boolean) => toggleMut.mutate({ id: c.id, ativo: v })} />
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={() => { if (confirm("Excluir?")) deletarMut.mutate({ id: c.id }); }}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      {passos.length > 0 && (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {passos.map((p: any, i: number) => {
                            const info = getPassoInfo(p.tipo);
                            const Icon = info.icon;
                            return (
                              <div key={p.id} className="flex items-center gap-1.5">
                                <div className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium ${info.cor}`}>
                                  <Icon className="h-3 w-3" />{info.label}
                                </div>
                                {i < passos.length - 1 && <ArrowRight className="h-3 w-3 text-muted-foreground/40" />}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="execucoes" className="mt-4">
          {execs.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center py-12 text-center">
                <Activity className="h-10 w-10 text-muted-foreground/20 mb-3" />
                <p className="text-sm font-medium">Nenhuma execução registrada</p>
                <p className="text-xs text-muted-foreground mt-1">Quando um cenário for acionado, os logs aparecerão aqui.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {execs.map((e: any) => {
                const st = STATUS_EXEC[e.status] || { label: e.status, cor: "bg-gray-100", icon: Clock };
                const StIcon = st.icon;
                return (
                  <Card key={e.id} className="hover:shadow-sm">
                    <CardContent className="pt-3 pb-3">
                      <div className="flex items-center gap-3">
                        <StIcon className="h-4 w-4 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <Badge className={`text-[9px] ${st.cor}`}>{st.label}</Badge>
                            <span className="text-xs text-muted-foreground">Cenário #{e.cenarioId}</span>
                            <span className="text-xs text-muted-foreground">Passo {e.passoAtual}</span>
                          </div>
                          {e.erro && <p className="text-[10px] text-red-600 mt-0.5 truncate">{e.erro}</p>}
                        </div>
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          {new Date(e.createdAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Dialog: novo cenário */}
      <Dialog open={novoOpen} onOpenChange={setNovoOpen}>
        <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Novo cenário</DialogTitle>
            <DialogDescription>Configure o gatilho e adicione passos ao fluxo.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Nome *</Label>
                <Input value={novoNome} onChange={(e) => setNovoNome(e.target.value)} placeholder="Ex: Atendimento WhatsApp" />
              </div>
              <div>
                <Label className="text-xs">Gatilho *</Label>
                <Select value={novoGatilho} onValueChange={setNovoGatilho}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {GATILHOS.map((g) => <SelectItem key={g.id} value={g.id}>{g.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs">Descrição (opcional)</Label>
              <Input value={novoDescricao} onChange={(e) => setNovoDescricao(e.target.value)} placeholder="O que este cenário faz..." />
            </div>

            {/* Passos */}
            <div>
              <Label className="text-xs mb-2 block">Passos do fluxo ({novoPassos.length})</Label>
              {novoPassos.length > 0 && (
                <div className="space-y-2 mb-3">
                  {novoPassos.map((p, i) => {
                    const info = getPassoInfo(p.tipo);
                    const Icon = info.icon;
                    return (
                      <div key={i} className="flex items-center gap-2">
                        <span className="text-[10px] text-muted-foreground w-4 text-center">{i + 1}</span>
                        <div className={`flex-1 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium ${info.cor}`}>
                          <Icon className="h-3.5 w-3.5" />{info.label}
                        </div>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive" onClick={() => removePasso(i)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="flex flex-wrap gap-1.5">
                {TIPO_PASSO.map((t) => {
                  const Icon = t.icon;
                  return (
                    <button
                      key={t.id}
                      onClick={() => addPasso(t.id)}
                      className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium border border-dashed hover:border-solid transition-colors ${t.cor}`}
                    >
                      <Icon className="h-3 w-3" />
                      <Plus className="h-2.5 w-2.5" />
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setNovoOpen(false)}>Cancelar</Button>
            <Button
              onClick={() => criarMut.mutate({ nome: novoNome, descricao: novoDescricao || undefined, gatilho: novoGatilho, passos: novoPassos })}
              disabled={!novoNome || novoPassos.length === 0 || criarMut.isPending}
            >
              {criarMut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Criar cenário
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
