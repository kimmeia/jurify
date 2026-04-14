/**
 * Tabs avançadas de configuração: Permissões.
 *
 * Extraídas de Configuracoes.tsx para reduzir o tamanho do arquivo principal.
 */

import { useState, useEffect } from "react";
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
import { Loader2, Plus, Trash2, Shield } from "lucide-react";
import { toast } from "sonner";

// ═══════════════════════════════════════════════════════════════════════════════
// Aba Permissões — Gerenciamento de cargos e permissões customizáveis
// ═══════════════════════════════════════════════════════════════════════════════

// Deve bater com o MODULOS do backend (router-permissoes.ts) e com os
// canSee() do AppLayout.tsx. Ao adicionar módulo novo, incluir aqui.
const MODULOS_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  calculos: "Cálculos",
  clientes: "Clientes",
  processos: "Processos",
  atendimento: "Atendimento",
  kanban: "Kanban",
  agenda: "Agenda",
  smartflow: "SmartFlow",
  agentesIa: "Agentes IA",
  relatorios: "Relatórios",
  financeiro: "Financeiro",
  configuracoes: "Configurações",
  equipe: "Equipe",
};
const PERM_LABELS: Record<string, string> = { verTodos: "Ver todos", verProprios: "Ver próprios", criar: "Criar", editar: "Editar", excluir: "Excluir" };
const CORES_CARGO = ["#dc2626", "#2563eb", "#16a34a", "#f59e0b", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"];

export function PermissoesTab() {
  const { data: cargos, refetch } = (trpc as any).permissoes.listarCargos.useQuery();
  const inicializar = (trpc as any).permissoes.inicializarPadrao.useMutation({ onSuccess: () => { refetch(); toast.success("Cargos padrão criados!"); } });
  const criarMut = (trpc as any).permissoes.criarCargo.useMutation({
    onSuccess: () => { refetch(); toast.success("Cargo criado!"); setShowNovo(false); },
    onError: (e: any) => toast.error("Erro ao criar cargo", { description: e.message }),
  });
  const atualizarMut = (trpc as any).permissoes.atualizarCargo.useMutation({
    onSuccess: () => { refetch(); toast.success("Permissões salvas!"); setEditId(null); },
    onError: (e: any) => toast.error("Erro ao salvar", { description: e.message }),
  });
  const excluirMut = (trpc as any).permissoes.excluirCargo.useMutation({ onSuccess: () => { refetch(); toast.success("Cargo excluído."); }, onError: (e: any) => toast.error(e.message) });
  const atribuirMut = (trpc as any).permissoes.atribuirCargo.useMutation({ onSuccess: () => toast.success("Cargo atribuído!") });

  const [showNovo, setShowNovo] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [novoNome, setNovoNome] = useState("");
  const [novoCor, setNovoCor] = useState("#8b5cf6");
  const [novoPerms, setNovoPerms] = useState<Record<string, Record<string, boolean>>>({});
  // Estado local do dialog de edição — evita round-trip por checkbox e
  // garante que mesmo módulos sem linha no banco tenham as 5 chaves exigidas
  // pelo backend.
  const [editPerms, setEditPerms] = useState<Record<string, Record<string, boolean>>>({});

  const modulos = Object.keys(MODULOS_LABELS);
  const perms = Object.keys(PERM_LABELS);

  const initNovoPerms = () => {
    const p: Record<string, Record<string, boolean>> = {};
    modulos.forEach(m => { p[m] = { verTodos: false, verProprios: true, criar: false, editar: false, excluir: false }; });
    return p;
  };

  /** Completa as permissões vindas do backend com defaults para módulos
   *  que nunca tiveram linha em permissoes_cargo. Sem isso, o spread parcial
   *  no onChange mandava objetos incompletos pro Zod, que rejeitava
   *  silenciosamente o PUT. */
  const normalizarPerms = (raw: any): Record<string, Record<string, boolean>> => {
    const out: Record<string, Record<string, boolean>> = {};
    for (const m of modulos) {
      const base = raw?.[m] || {};
      out[m] = {
        verTodos: !!base.verTodos,
        verProprios: !!base.verProprios,
        criar: !!base.criar,
        editar: !!base.editar,
        excluir: !!base.excluir,
      };
    }
    return out;
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

  // Sincroniza o state local com o cargo sendo editado
  useEffect(() => {
    if (editCargo) {
      setEditPerms(normalizarPerms(editCargo.permissoes));
    } else {
      setEditPerms({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId]);

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
            <tbody>{modulos.map(m => <tr key={m} className="border-b hover:bg-muted/30">
              <td className="py-2 px-2 font-medium">{MODULOS_LABELS[m]}</td>
              {perms.map(p => (
                <td key={p} className="text-center py-2 px-1">
                  <input
                    type="checkbox"
                    checked={editPerms[m]?.[p] || false}
                    onChange={(e) => setEditPerms(prev => ({
                      ...prev,
                      [m]: { ...(prev[m] || { verTodos: false, verProprios: false, criar: false, editar: false, excluir: false }), [p]: e.target.checked },
                    }))}
                    className="h-4 w-4 rounded cursor-pointer"
                  />
                </td>
              ))}
            </tr>)}</tbody>
          </table></div>
          <div className="flex justify-between items-center pt-2 gap-2">
            {!editCargo.isDefault ? (
              <Button variant="destructive" size="sm" onClick={() => { if (confirm("Excluir cargo?")) { excluirMut.mutate({ id: editCargo.id }); setEditId(null); } }}>
                <Trash2 className="h-3.5 w-3.5 mr-1" /> Excluir Cargo
              </Button>
            ) : <div />}
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditId(null)} disabled={atualizarMut.isPending}>
                Cancelar
              </Button>
              <Button
                size="sm"
                disabled={atualizarMut.isPending}
                onClick={() => atualizarMut.mutate({ id: editCargo.id, permissoes: editPerms })}
              >
                {atualizarMut.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                Salvar
              </Button>
            </div>
          </div>
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

