/**
 * Tabs avançadas de configuração: Permissões e Agentes IA.
 *
 * Extraídas de Configuracoes.tsx para reduzir o tamanho do arquivo principal.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Plus, Trash2, Shield, Bot } from "lucide-react";
import { toast } from "sonner";

// ═══════════════════════════════════════════════════════════════════════════════
// Aba Permissões — Gerenciamento de cargos e permissões customizáveis
// ═══════════════════════════════════════════════════════════════════════════════

const MODULOS_LABELS: Record<string, string> = {
  calculos: "Cálculos", clientes: "Clientes", processos: "Processos", atendimento: "Atendimento",
  pipeline: "Pipeline", agendamento: "Agendamento", relatorios: "Relatórios", configuracoes: "Configurações", equipe: "Equipe",
};
const PERM_LABELS: Record<string, string> = { verTodos: "Ver todos", verProprios: "Ver próprios", criar: "Criar", editar: "Editar", excluir: "Excluir" };
const CORES_CARGO = ["#dc2626", "#2563eb", "#16a34a", "#f59e0b", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"];

export function PermissoesTab() {
  const { data: cargos, refetch } = (trpc as any).permissoes.listarCargos.useQuery();
  const inicializar = (trpc as any).permissoes.inicializarPadrao.useMutation({ onSuccess: () => { refetch(); toast.success("Cargos padrão criados!"); } });
  const criarMut = (trpc as any).permissoes.criarCargo.useMutation({ onSuccess: () => { refetch(); toast.success("Cargo criado!"); setShowNovo(false); } });
  const atualizarMut = (trpc as any).permissoes.atualizarCargo.useMutation({ onSuccess: () => { refetch(); toast.success("Permissões salvas!"); } });
  const excluirMut = (trpc as any).permissoes.excluirCargo.useMutation({ onSuccess: () => { refetch(); toast.success("Cargo excluído."); }, onError: (e: any) => toast.error(e.message) });
  const atribuirMut = (trpc as any).permissoes.atribuirCargo.useMutation({ onSuccess: () => toast.success("Cargo atribuído!") });

  const [showNovo, setShowNovo] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [novoNome, setNovoNome] = useState("");
  const [novoCor, setNovoCor] = useState("#8b5cf6");
  const [novoPerms, setNovoPerms] = useState<Record<string, Record<string, boolean>>>({});

  const modulos = Object.keys(MODULOS_LABELS);
  const perms = Object.keys(PERM_LABELS);

  const initNovoPerms = () => {
    const p: Record<string, Record<string, boolean>> = {};
    modulos.forEach(m => { p[m] = { verTodos: false, verProprios: true, criar: false, editar: false, excluir: false }; });
    return p;
  };

  if (!cargos || cargos.length === 0) {
    return (<Card><CardContent className="pt-6 text-center py-12">
      <Shield className="h-10 w-10 text-muted-foreground/20 mx-auto mb-3" />
      <h3 className="text-lg font-semibold">Sistema de Permissões</h3>
      <p className="text-sm text-muted-foreground mt-1 mb-4">Crie cargos personalizados para controlar o acesso de cada colaborador.</p>
      <Button onClick={() => inicializar.mutate()} disabled={inicializar.isPending}>{inicializar.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Shield className="h-4 w-4 mr-2" />} Criar Cargos Padrão</Button>
    </CardContent></Card>);
  }

  const editCargo = editId ? cargos.find((c: any) => c.id === editId) : null;

  return (<div className="space-y-4">
    <div className="flex items-center justify-between">
      <div><h3 className="text-base font-semibold">Cargos e Permissões</h3><p className="text-xs text-muted-foreground">{cargos.length} cargo(s) configurado(s)</p></div>
      <Button size="sm" onClick={() => { setNovoNome(""); setNovoCor(CORES_CARGO[cargos.length % CORES_CARGO.length]); setNovoPerms(initNovoPerms()); setShowNovo(true); }}><Plus className="h-4 w-4 mr-1" /> Novo Cargo</Button>
    </div>

    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {cargos.map((cargo: any) => (
        <Card key={cargo.id} className="cursor-pointer hover:border-primary/40 transition-colors" onClick={() => setEditId(cargo.id)}>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="h-8 w-8 rounded-lg flex items-center justify-center text-white text-xs font-bold" style={{ background: cargo.cor }}>{cargo.nome[0]}</div>
              <div className="flex-1"><p className="text-sm font-semibold">{cargo.nome}</p><p className="text-[10px] text-muted-foreground">{cargo.totalColaboradores} colaborador(es)</p></div>
              {cargo.isDefault && <Badge variant="outline" className="text-[9px]">Padrão</Badge>}
            </div>
            <div className="flex flex-wrap gap-1">{modulos.filter(m => cargo.permissoes[m]?.verTodos || cargo.permissoes[m]?.verProprios).map(m => (
              <span key={m} className="text-[9px] px-1.5 py-0.5 rounded bg-muted">{MODULOS_LABELS[m]}</span>
            ))}</div>
          </CardContent>
        </Card>
      ))}
    </div>

    {/* Dialog editar cargo */}
    <Dialog open={!!editId} onOpenChange={() => setEditId(null)}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Permissões — {editCargo?.nome}</DialogTitle></DialogHeader>
        {editCargo && <div className="space-y-3">
          <div className="overflow-x-auto"><table className="w-full text-xs">
            <thead><tr className="border-b"><th className="text-left py-2 px-2 font-medium">Módulo</th>{perms.map(p => <th key={p} className="text-center py-2 px-1 font-medium">{PERM_LABELS[p]}</th>)}</tr></thead>
            <tbody>{modulos.map(m => <tr key={m} className="border-b hover:bg-muted/30"><td className="py-2 px-2 font-medium">{MODULOS_LABELS[m]}</td>
              {perms.map(p => <td key={p} className="text-center py-2 px-1"><input type="checkbox" checked={editCargo.permissoes[m]?.[p] || false} onChange={(e) => {
                const updated = { ...editCargo.permissoes, [m]: { ...editCargo.permissoes[m], [p]: e.target.checked } };
                atualizarMut.mutate({ id: editCargo.id, permissoes: updated });
              }} className="h-4 w-4 rounded" /></td>)}
            </tr>)}</tbody>
          </table></div>
          {!editCargo.isDefault && <div className="flex justify-end pt-2"><Button variant="destructive" size="sm" onClick={() => { if (confirm("Excluir cargo?")) { excluirMut.mutate({ id: editCargo.id }); setEditId(null); } }}><Trash2 className="h-3.5 w-3.5 mr-1" /> Excluir Cargo</Button></div>}
        </div>}
      </DialogContent>
    </Dialog>

    {/* Dialog novo cargo */}
    <Dialog open={showNovo} onOpenChange={setShowNovo}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Novo Cargo</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label className="text-xs">Nome do Cargo *</Label><Input value={novoNome} onChange={e => setNovoNome(e.target.value)} placeholder="Ex: Recepcionista" /></div>
            <div className="space-y-1.5"><Label className="text-xs">Cor</Label><div className="flex gap-1.5 flex-wrap">{CORES_CARGO.map(c => <button key={c} className={`h-7 w-7 rounded-lg border-2 ${novoCor === c ? "border-foreground" : "border-transparent"}`} style={{ background: c }} onClick={() => setNovoCor(c)} />)}</div></div>
          </div>
          <div className="overflow-x-auto"><table className="w-full text-xs">
            <thead><tr className="border-b"><th className="text-left py-2 px-2 font-medium">Módulo</th>{perms.map(p => <th key={p} className="text-center py-2 px-1 font-medium">{PERM_LABELS[p]}</th>)}</tr></thead>
            <tbody>{modulos.map(m => <tr key={m} className="border-b hover:bg-muted/30"><td className="py-2 px-2 font-medium">{MODULOS_LABELS[m]}</td>
              {perms.map(p => <td key={p} className="text-center py-2 px-1"><input type="checkbox" checked={novoPerms[m]?.[p] || false} onChange={(e) => setNovoPerms({ ...novoPerms, [m]: { ...novoPerms[m], [p]: e.target.checked } })} className="h-4 w-4 rounded" /></td>)}
            </tr>)}</tbody>
          </table></div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setShowNovo(false)}>Cancelar</Button>
          <Button onClick={() => criarMut.mutate({ nome: novoNome, cor: novoCor, permissoes: novoPerms })} disabled={!novoNome || criarMut.isPending}>{criarMut.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null} Criar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Aba Agentes IA — Gerenciamento de chatbots multi-agente
// ═══════════════════════════════════════════════════════════════════════════════

export function AgentesIaTab() {
  const { data: agentes, refetch } = (trpc as any).agentesIa.listar.useQuery();
  const { data: canaisData } = trpc.configuracoes.listarCanais.useQuery();
  const criarMut = (trpc as any).agentesIa.criar.useMutation({ onSuccess: () => { refetch(); toast.success("Agente criado!"); setShowNovo(false); } });
  const atualizarMut = (trpc as any).agentesIa.atualizar.useMutation({ onSuccess: () => { refetch(); toast.success("Agente atualizado!"); setEditId(null); } });
  const excluirMut = (trpc as any).agentesIa.excluir.useMutation({ onSuccess: () => { refetch(); toast.success("Excluído."); } });
  const toggleMut = (trpc as any).agentesIa.toggleAtivo.useMutation({ onSuccess: () => refetch() });

  const [showNovo, setShowNovo] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<any>({});

  const canais = canaisData?.canais || [];

  const initForm = (a?: any) => ({
    nome: a?.nome || "", descricao: a?.descricao || "", modelo: a?.modelo || "gpt-4o-mini",
    prompt: a?.prompt || "Você é um assistente jurídico educado. Responda dúvidas de forma clara e concisa. Se o cliente pedir para falar com um advogado, diga que vai transferir.",
    canalId: a?.canalId || "", openaiApiKey: "", maxTokens: a?.maxTokens || 500, temperatura: a?.temperatura || "0.70",
  });

  const editAgente = editId ? (agentes || []).find((a: any) => a.id === editId) : null;

  return (<div className="space-y-4">
    <div className="flex items-center justify-between">
      <div><h3 className="text-base font-semibold">Agentes de IA</h3><p className="text-xs text-muted-foreground">Chatbots que respondem automaticamente em cada canal</p></div>
      <Button size="sm" onClick={() => { setForm(initForm()); setShowNovo(true); }}><Plus className="h-4 w-4 mr-1" /> Novo Agente</Button>
    </div>

    {!(agentes || []).length ? (
      <Card><CardContent className="pt-6 text-center py-12">
        <Bot className="h-10 w-10 text-muted-foreground/20 mx-auto mb-3" />
        <h3 className="text-lg font-semibold">Nenhum agente criado</h3>
        <p className="text-sm text-muted-foreground mt-1">Crie agentes para responder automaticamente no WhatsApp e outros canais.</p>
      </CardContent></Card>
    ) : (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {(agentes || []).map((a: any) => {
          const canal = canais.find((c: any) => c.id === a.canalId);
          return (
            <Card key={a.id} className="hover:border-primary/40 transition-colors">
              <CardContent className="pt-4">
                <div className="flex items-center gap-3 mb-2">
                  <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white"><Bot className="h-5 w-5" /></div>
                  <div className="flex-1 min-w-0"><p className="text-sm font-semibold truncate">{a.nome}</p><p className="text-[10px] text-muted-foreground">{a.modelo} · {canal?.nome || (a.canalId ? `Canal #${a.canalId}` : "Global")}</p></div>
                  <Switch checked={a.ativo} onCheckedChange={(v: boolean) => toggleMut.mutate({ id: a.id, ativo: v })} />
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{a.prompt.slice(0, 120)}...</p>
                <div className="flex items-center gap-2">
                  {a.temApiKey ? <Badge className="text-[9px] bg-emerald-100 text-emerald-700 border-emerald-200">API Key ✓</Badge> : <Badge variant="outline" className="text-[9px] text-amber-600">Sem API Key</Badge>}
                  <div className="flex-1" />
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setForm(initForm(a)); setEditId(a.id); }}>Editar</Button>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={() => { if (confirm("Excluir agente?")) excluirMut.mutate({ id: a.id }); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    )}

    {/* Dialog novo/editar agente */}
    <Dialog open={showNovo || !!editId} onOpenChange={() => { setShowNovo(false); setEditId(null); }}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{editId ? "Editar Agente" : "Novo Agente"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label className="text-xs">Nome *</Label><Input value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} placeholder="Ex: Recepcionista Virtual" /></div>
            <div className="space-y-1.5"><Label className="text-xs">Modelo</Label><Select value={form.modelo} onValueChange={v => setForm({ ...form, modelo: v })}><SelectTrigger className="h-9"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="gpt-4o-mini">GPT-4o Mini (rápido)</SelectItem><SelectItem value="gpt-4o">GPT-4o (avançado)</SelectItem><SelectItem value="gpt-3.5-turbo">GPT-3.5 Turbo</SelectItem></SelectContent></Select></div>
          </div>
          <div className="space-y-1.5"><Label className="text-xs">Canal vinculado</Label><Select value={String(form.canalId || "global")} onValueChange={v => setForm({ ...form, canalId: v === "global" ? "" : Number(v) })}><SelectTrigger className="h-9"><SelectValue placeholder="Global (todos os canais)" /></SelectTrigger><SelectContent><SelectItem value="global">Global (todos)</SelectItem>{canais.map((c: any) => <SelectItem key={c.id} value={String(c.id)}>{c.nome || c.tipo} {c.status === "conectado" ? "✓" : ""}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1.5"><Label className="text-xs">Prompt do Agente *</Label><Textarea value={form.prompt} onChange={e => setForm({ ...form, prompt: e.target.value })} rows={5} placeholder="Você é um assistente jurídico..." /></div>
          <div className="space-y-1.5"><Label className="text-xs">OpenAI API Key {editId ? "(deixe vazio para manter)" : "*"}</Label><Input type="password" value={form.openaiApiKey} onChange={e => setForm({ ...form, openaiApiKey: e.target.value })} placeholder="sk-..." /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label className="text-xs">Max Tokens</Label><Input type="number" value={form.maxTokens} onChange={e => setForm({ ...form, maxTokens: Number(e.target.value) })} /></div>
            <div className="space-y-1.5"><Label className="text-xs">Temperatura</Label><Input value={form.temperatura} onChange={e => setForm({ ...form, temperatura: e.target.value })} placeholder="0.70" /></div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => { setShowNovo(false); setEditId(null); }}>Cancelar</Button>
          <Button onClick={() => {
            const payload: any = { nome: form.nome, modelo: form.modelo, prompt: form.prompt, maxTokens: form.maxTokens, temperatura: form.temperatura, canalId: form.canalId || undefined };
            if (form.openaiApiKey) payload.openaiApiKey = form.openaiApiKey;
            if (editId) atualizarMut.mutate({ id: editId, ...payload });
            else criarMut.mutate(payload);
          }} disabled={!form.nome || !form.prompt || criarMut.isPending || atualizarMut.isPending}>
            {(criarMut.isPending || atualizarMut.isPending) ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null} {editId ? "Salvar" : "Criar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>);
}
