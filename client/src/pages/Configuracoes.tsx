import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  Settings, Building2, Users, Loader2, Plus, Trash2, Mail,
  Copy, CheckCircle, AlertTriangle, Shield, UserPlus, Clock, Link2,
  MessageCircle, Instagram, Phone, Facebook, Wifi, WifiOff, Eye, X,
  ChevronDown, ChevronUp, Calendar, Bot, DollarSign, Plug,
} from "lucide-react";
import { toast } from "sonner";
import { CARGO_LABELS, CARGO_DESCRICAO, PLANO_LABELS, CUSTO_COLABORADOR_EXTRA } from "@shared/escritorio-types";
import type { CargoColaborador } from "@shared/escritorio-types";
import { TIPO_CANAL_LABELS, TIPO_CANAL_DESCRICAO, STATUS_CANAL_LABELS, STATUS_CANAL_CORES } from "@shared/canal-types";
import type { TipoCanal, StatusCanal } from "@shared/canal-types";
import CalcomConfig from "@/components/integracoes/CalcomConfig";
import WhatsappQR from "@/components/integracoes/WhatsappQR";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DIAS_SEMANA = [
  { key: "seg", label: "Seg" },
  { key: "ter", label: "Ter" },
  { key: "qua", label: "Qua" },
  { key: "qui", label: "Qui" },
  { key: "sex", label: "Sex" },
  { key: "sab", label: "Sáb" },
  { key: "dom", label: "Dom" },
];

const CARGOS_CONVITE: { value: "gestor" | "atendente" | "estagiario"; label: string }[] = [
  { value: "gestor", label: "Gestor" },
  { value: "atendente", label: "Atendente" },
  { value: "estagiario", label: "Estagiário" },
];

function CargoBadge({ cargo }: { cargo: CargoColaborador }) {
  const colors: Record<CargoColaborador, string> = {
    dono: "bg-purple-100 text-purple-700 border-purple-200",
    gestor: "bg-blue-100 text-blue-700 border-blue-200",
    atendente: "bg-emerald-100 text-emerald-700 border-emerald-200",
    estagiario: "bg-amber-100 text-amber-700 border-amber-200",
  };
  return <Badge variant="outline" className={`text-xs ${colors[cargo]}`}>{CARGO_LABELS[cargo]}</Badge>;
}

// ─── Setup Screen (primeiro acesso) ──────────────────────────────────────────

function SetupEscritorio({ onCreated }: { onCreated: () => void }) {
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const criar = trpc.configuracoes.criarEscritorio.useMutation({
    onSuccess: () => { toast.success("Escritório criado!"); onCreated(); },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="max-w-lg mx-auto mt-16 space-y-8">
      <div className="text-center space-y-3">
        <div className="mx-auto h-16 w-16 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center shadow-sm">
          <Building2 className="h-8 w-8 text-primary" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Configure seu escritório</h1>
        <p className="text-muted-foreground text-sm max-w-sm mx-auto">Para usar os módulos de Atendimento e Agendamento, crie seu escritório primeiro.</p>
      </div>
      <Card className="shadow-sm">
        <CardContent className="pt-6 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="nome">Nome do escritório *</Label>
            <Input id="nome" placeholder="Ex: Escritório Silva & Associados" value={nome} onChange={(e) => setNome(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">Email do escritório</Label>
            <Input id="email" type="email" placeholder="contato@escritorio.com.br" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <Button className="w-full" onClick={() => criar.mutate({ nome, email: email || undefined })} disabled={!nome || criar.isPending}>
            {criar.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Criando...</> : "Criar escritório"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Componente Principal ────────────────────────────────────────────────────

export default function Configuracoes() {
  const utils = trpc.useUtils();

  const { data, isLoading, refetch } = trpc.configuracoes.meuEscritorio.useQuery();
  const { data: equipeData, refetch: refetchEquipe } = trpc.configuracoes.listarColaboradores.useQuery(undefined, { enabled: !!data });
  const { data: convites, refetch: refetchConvites } = trpc.configuracoes.listarConvites.useQuery(undefined, { enabled: !!data });

  // ─── Perfil form state ───
  const [editMode, setEditMode] = useState(false);
  const [formPerfil, setFormPerfil] = useState<Record<string, any>>({});

  // ─── Convite form state ───
  const [conviteEmail, setConviteEmail] = useState("");
  const [conviteCargo, setConviteCargo] = useState<"gestor" | "atendente" | "estagiario">("atendente");
  const [conviteDepto, setConviteDepto] = useState("");
  const [lastToken, setLastToken] = useState("");

  const atualizarMut = trpc.configuracoes.atualizarEscritorio.useMutation({
    onSuccess: () => { toast.success("Escritório atualizado!"); setEditMode(false); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const enviarConviteMut = trpc.configuracoes.enviarConvite.useMutation({
    onSuccess: (res) => {
      toast.success("Convite criado!");
      setConviteEmail("");
      setConviteDepto("");
      setLastToken(res.token);
      refetchConvites();
    },
    onError: (e) => toast.error(e.message),
  });

  const cancelarConviteMut = trpc.configuracoes.cancelarConvite.useMutation({
    onSuccess: () => { toast.success("Convite cancelado."); refetchConvites(); },
  });

  const removerColabMut = trpc.configuracoes.removerColaborador.useMutation({
    onSuccess: () => { toast.success("Colaborador removido."); refetchEquipe(); },
    onError: (e) => toast.error(e.message),
  });

  const atualizarColabMut = trpc.configuracoes.atualizarColaborador.useMutation({
    onSuccess: () => { toast.success("Atualizado!"); refetchEquipe(); },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  }

  if (!data) {
    return <SetupEscritorio onCreated={() => refetch()} />;
  }

  const { escritorio, colaborador } = data;
  const isDono = colaborador.cargo === "dono";
  const isGestor = colaborador.cargo === "gestor";
  const canEdit = isDono || isGestor;

  const initPerfilForm = () => {
    setFormPerfil({
      nome: escritorio.nome,
      cnpj: escritorio.cnpj || "",
      telefone: escritorio.telefone || "",
      email: escritorio.email || "",
      endereco: escritorio.endereco || "",
      fusoHorario: escritorio.fusoHorario,
      horarioAbertura: escritorio.horarioAbertura,
      horarioFechamento: escritorio.horarioFechamento,
      diasFuncionamento: escritorio.diasFuncionamento || ["seg", "ter", "qua", "qui", "sex"],
      mensagemAusencia: escritorio.mensagemAusencia || "",
      mensagemBoasVindas: escritorio.mensagemBoasVindas || "",
    });
    setEditMode(true);
  };

  const toggleDia = (dia: string) => {
    const atual = formPerfil.diasFuncionamento || [];
    setFormPerfil({
      ...formPerfil,
      diasFuncionamento: atual.includes(dia) ? atual.filter((d: string) => d !== dia) : [...atual, dia],
    });
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-4">
        <div className="p-3 rounded-xl bg-gradient-to-br from-gray-100 to-slate-200 dark:from-gray-800 dark:to-slate-700 shadow-sm">
          <Settings className="h-6 w-6 text-gray-600 dark:text-gray-300" />
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">Configurações</h1>
          <p className="text-sm text-muted-foreground">{escritorio.nome} · {PLANO_LABELS[escritorio.planoAtendimento as keyof typeof PLANO_LABELS]}</p>
        </div>
        <CargoBadge cargo={colaborador.cargo as CargoColaborador} />
      </div>

      <Tabs defaultValue="perfil">
        <TabsList className="grid w-full grid-cols-6 h-10">
          <TabsTrigger value="perfil" className="gap-1.5 text-xs"><Building2 className="h-3.5 w-3.5" /> Escritório</TabsTrigger>
          <TabsTrigger value="equipe" className="gap-1.5 text-xs"><Users className="h-3.5 w-3.5" /> Equipe</TabsTrigger>
          <TabsTrigger value="permissoes" className="gap-1.5 text-xs"><Shield className="h-3.5 w-3.5" /> Permissões</TabsTrigger>
          <TabsTrigger value="canais" className="gap-1.5 text-xs"><MessageCircle className="h-3.5 w-3.5" /> Canais</TabsTrigger>
          <TabsTrigger value="integracoes" className="gap-1.5 text-xs"><Link2 className="h-3.5 w-3.5" /> Integrações</TabsTrigger>
          <TabsTrigger value="agentes" className="gap-1.5 text-xs"><Bot className="h-3.5 w-3.5" /> Agentes IA</TabsTrigger>
        </TabsList>

        {/* ─── Perfil ────────────────────────────────────────────────── */}
        <TabsContent value="perfil" className="space-y-4">
          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-2"><Building2 className="h-4 w-4" /> Dados do Escritório</CardTitle>
                <CardDescription>Informações básicas da sua empresa</CardDescription>
              </div>
              {canEdit && !editMode && <Button variant="outline" size="sm" onClick={initPerfilForm}>Editar</Button>}
            </CardHeader>
            <CardContent>
              {editMode ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label>Nome *</Label>
                      <Input value={formPerfil.nome} onChange={(e) => setFormPerfil({ ...formPerfil, nome: e.target.value })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>CNPJ</Label>
                      <Input placeholder="00.000.000/0001-00" value={formPerfil.cnpj} onChange={(e) => setFormPerfil({ ...formPerfil, cnpj: e.target.value })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Telefone</Label>
                      <Input placeholder="(85) 99999-0000" value={formPerfil.telefone} onChange={(e) => setFormPerfil({ ...formPerfil, telefone: e.target.value })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Email</Label>
                      <Input type="email" value={formPerfil.email} onChange={(e) => setFormPerfil({ ...formPerfil, email: e.target.value })} />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Endereço</Label>
                    <Input value={formPerfil.endereco} onChange={(e) => setFormPerfil({ ...formPerfil, endereco: e.target.value })} />
                  </div>

                  <Separator />
                  <p className="text-sm font-medium">Horário de Funcionamento</p>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label>Abertura</Label>
                      <Input type="time" value={formPerfil.horarioAbertura} onChange={(e) => setFormPerfil({ ...formPerfil, horarioAbertura: e.target.value })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Fechamento</Label>
                      <Input type="time" value={formPerfil.horarioFechamento} onChange={(e) => setFormPerfil({ ...formPerfil, horarioFechamento: e.target.value })} />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Dias de funcionamento</Label>
                    <div className="flex gap-2">
                      {DIAS_SEMANA.map((d) => (
                        <button key={d.key} onClick={() => toggleDia(d.key)}
                          className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${formPerfil.diasFuncionamento?.includes(d.key) ? "bg-primary text-primary-foreground border-primary" : "bg-muted/50 text-muted-foreground border-border hover:bg-muted"}`}>
                          {d.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <Separator />
                  <p className="text-sm font-medium">Mensagens Automáticas</p>
                  <div className="space-y-1.5">
                    <Label>Mensagem de boas-vindas (primeiro contato)</Label>
                    <Textarea placeholder="Olá! Bem-vindo ao escritório..." rows={3} value={formPerfil.mensagemBoasVindas} onChange={(e) => setFormPerfil({ ...formPerfil, mensagemBoasVindas: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Mensagem de ausência (fora do horário)</Label>
                    <Textarea placeholder="No momento estamos fora do horário..." rows={3} value={formPerfil.mensagemAusencia} onChange={(e) => setFormPerfil({ ...formPerfil, mensagemAusencia: e.target.value })} />
                  </div>

                  <div className="flex gap-2 pt-2">
                    <Button onClick={() => atualizarMut.mutate(formPerfil)} disabled={atualizarMut.isPending}>
                      {atualizarMut.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null} Salvar
                    </Button>
                    <Button variant="ghost" onClick={() => setEditMode(false)}>Cancelar</Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4 text-sm">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="rounded-lg bg-muted/30 p-3 space-y-0.5"><p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Nome</p><p className="font-semibold">{escritorio.nome}</p></div>
                    <div className="rounded-lg bg-muted/30 p-3 space-y-0.5"><p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">CNPJ</p><p>{escritorio.cnpj || "—"}</p></div>
                    <div className="rounded-lg bg-muted/30 p-3 space-y-0.5"><p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Telefone</p><p>{escritorio.telefone || "—"}</p></div>
                    <div className="rounded-lg bg-muted/30 p-3 space-y-0.5"><p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Email</p><p>{escritorio.email || "—"}</p></div>
                  </div>
                  {escritorio.endereco && <div className="rounded-lg bg-muted/30 p-3 space-y-0.5"><p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Endereço</p><p>{escritorio.endereco}</p></div>}
                  <Separator />
                  <div className="grid grid-cols-3 gap-4">
                    <div className="rounded-lg bg-muted/30 p-3 space-y-0.5"><p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Horário</p><p className="font-medium">{escritorio.horarioAbertura} — {escritorio.horarioFechamento}</p></div>
                    <div className="rounded-lg bg-muted/30 p-3 space-y-0.5"><p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Dias</p><p>{(escritorio.diasFuncionamento || []).join(", ")}</p></div>
                    <div className="rounded-lg bg-muted/30 p-3 space-y-0.5"><p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Fuso</p><p>{escritorio.fusoHorario}</p></div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Equipe ───────────────────────────────────────────────── */}
        <TabsContent value="equipe" className="space-y-4">
          {/* Resumo */}
          {equipeData && (
            <Card>
              <CardContent className="pt-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div><p className="text-xs text-muted-foreground">Colaboradores ativos</p><p className="text-2xl font-bold">{equipeData.total}</p></div>
                    <Separator orientation="vertical" className="h-10" />
                    <div><p className="text-xs text-muted-foreground">Limite do plano</p><p className="text-2xl font-bold">{equipeData.limite}</p></div>
                    {equipeData.extras > 0 && (
                      <>
                        <Separator orientation="vertical" className="h-10" />
                        <div><p className="text-xs text-amber-600">Extras</p><p className="text-lg font-bold text-amber-600">{equipeData.extras} × R$ {CUSTO_COLABORADOR_EXTRA.toFixed(2)}</p></div>
                      </>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Lista de colaboradores */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4" /> Membros da Equipe</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {equipeData?.colaboradores.map((c) => (
                  <div key={c.id} className={`flex items-center gap-3 p-3 rounded-xl border transition-colors hover:bg-muted/30 ${!c.ativo ? "opacity-40 bg-muted/20" : ""}`}>
                    <div className="h-10 w-10 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center text-sm font-bold text-primary shrink-0">
                      {(c.userName || "?").charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium truncate">{c.userName || "Sem nome"}</p>
                        <CargoBadge cargo={c.cargo as CargoColaborador} />
                        {!c.ativo && <Badge variant="secondary" className="text-xs">Inativo</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground">{c.userEmail || "—"}{c.departamento ? ` · ${c.departamento}` : ""}</p>
                    </div>
                    <div className="text-xs text-muted-foreground text-right shrink-0">
                      <p>Max: {c.maxAtendimentosSimultaneos} atend.</p>
                      <p>{c.recebeLeadsAutomaticos ? "Recebe leads" : "Sem leads auto"}</p>
                    </div>
                    {isDono && c.cargo !== "dono" && c.ativo && (
                      <Button variant="ghost" size="sm" className="text-destructive shrink-0" onClick={() => {
                        if (confirm(`Remover ${c.userName}?`)) removerColabMut.mutate({ colaboradorId: c.id });
                      }}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
                {(!equipeData?.colaboradores || equipeData.colaboradores.length === 0) && (
                  <p className="text-center text-sm text-muted-foreground py-6">Nenhum colaborador encontrado.</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Convidar */}
          {canEdit && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2"><UserPlus className="h-4 w-4" /> Convidar Colaborador</CardTitle>
                <CardDescription>O convidado receberá um link para entrar no escritório</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label>Email *</Label>
                    <Input type="email" placeholder="colaborador@email.com" value={conviteEmail} onChange={(e) => setConviteEmail(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Cargo *</Label>
                    <Select value={conviteCargo} onValueChange={(v) => setConviteCargo(v as any)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {CARGOS_CONVITE.map((c) => (
                          <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Departamento</Label>
                    <Input placeholder="Ex: Comercial" value={conviteDepto} onChange={(e) => setConviteDepto(e.target.value)} />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">{CARGO_DESCRICAO[conviteCargo]}</p>
                <Button onClick={() => enviarConviteMut.mutate({ email: conviteEmail, cargo: conviteCargo, departamento: conviteDepto || undefined })}
                  disabled={!conviteEmail || enviarConviteMut.isPending}>
                  {enviarConviteMut.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Mail className="h-4 w-4 mr-2" />} Enviar Convite
                </Button>

                {lastToken && (
                  <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 p-3 space-y-2">
                    <p className="text-xs font-medium text-emerald-700 flex items-center gap-1"><CheckCircle className="h-3.5 w-3.5" /> Convite criado! Compartilhe o link:</p>
                    <div className="flex gap-2">
                      <Input readOnly value={`${window.location.origin}/convite/${lastToken}`} className="text-xs font-mono" />
                      <Button variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/convite/${lastToken}`); toast.success("Link copiado!"); }}>
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">Válido por 7 dias. O convidado precisa fazer login para aceitar.</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Convites pendentes */}
          {convites && convites.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2"><Clock className="h-4 w-4" /> Convites Enviados</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {convites.map((conv: any) => (
                    <div key={conv.id} className="flex items-center gap-3 p-2.5 rounded-lg border text-sm">
                      <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{conv.email}</p>
                        <p className="text-xs text-muted-foreground">{CARGO_LABELS[conv.cargo as CargoColaborador] || conv.cargo}</p>
                      </div>
                      <Badge variant={conv.status === "pendente" ? "outline" : conv.status === "aceito" ? "default" : "secondary"} className="text-xs shrink-0">
                        {conv.status === "pendente" ? "Pendente" : conv.status === "aceito" ? "Aceito" : conv.status === "expirado" ? "Expirado" : "Cancelado"}
                      </Badge>
                      {conv.status === "pendente" && (
                        <Button variant="ghost" size="sm" className="text-destructive shrink-0" onClick={() => cancelarConviteMut.mutate({ conviteId: conv.id })}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ─── Canais de Comunicação ──────────────────────────── */}
        <TabsContent value="canais" className="space-y-4">
          <CanaisTab canEdit={canEdit} isDono={isDono} />
          <TemplatesSection canEdit={canEdit} />
        </TabsContent>

        {/* ─── Integrações (APIs) ──────────────────────────────── */}
        <TabsContent value="integracoes" className="space-y-4">
          <IntegracaoTab canEdit={canEdit} isDono={isDono} />
        </TabsContent>

        <TabsContent value="permissoes" className="space-y-4">
          {isDono ? <PermissoesTab /> : <Card><CardContent className="pt-6 text-center py-12"><Shield className="h-10 w-10 text-muted-foreground/20 mx-auto mb-3" /><p className="text-sm text-muted-foreground">Apenas o dono do escritório pode gerenciar permissões.</p></CardContent></Card>}
        </TabsContent>

        <TabsContent value="agentes" className="space-y-4">
          {canEdit ? <AgentesIaTab /> : <Card><CardContent className="pt-6 text-center py-12"><Bot className="h-10 w-10 text-muted-foreground/20 mx-auto mb-3" /><p className="text-sm text-muted-foreground">Sem permissão para gerenciar agentes.</p></CardContent></Card>}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Canais de Comunicação Tab ──────────────────────────────────────────────

function CanaisTab({ canEdit, isDono }: { canEdit: boolean; isDono: boolean }) {
  const [openDialog, setOpenDialog] = useState<string | null>(null);
  const { data: canaisData, refetch } = trpc.configuracoes.listarCanais.useQuery();

  const canais = canaisData?.canais || [];
  const whatsappQrCanal = canais.find(c => c.tipo === "whatsapp_qr");
  const whatsappApiCanal = canais.find(c => c.tipo === "whatsapp_api" && !(c.nome || "").includes("ChatGPT") && !(c.nome || "").includes("CoEx"));
  const whatsappCoexCanal = canais.find(c => c.tipo === "whatsapp_api" && (c.nome || "").includes("CoEx"));
  const instagramCanal = canais.find(c => c.tipo === "instagram");
  const facebookCanal = canais.find(c => c.tipo === "facebook");

  const canaisConfig = [
    {
      id: "whatsapp_qr",
      nome: "WhatsApp QR Code",
      descricao: "Conecte seu WhatsApp pessoal ou business escaneando o QR Code. Mensagens chegam direto no Inbox.",
      logo: "💬",
      cor: "from-emerald-500 to-green-600",
      status: whatsappQrCanal?.status || "desconectado",
      conectado: whatsappQrCanal?.status === "conectado",
    },
    {
      id: "whatsapp_coex",
      nome: "WhatsApp CoEx",
      descricao: "Coexistência: use o WhatsApp Business App e a Cloud API ao mesmo tempo, sem perder histórico. Oficial da Meta.",
      logo: "🔗",
      cor: "from-emerald-600 to-teal-700",
      status: whatsappCoexCanal?.status || "desconectado",
      conectado: whatsappCoexCanal?.status === "conectado",
    },
    {
      id: "whatsapp_api",
      nome: "WhatsApp API Oficial",
      descricao: "Integração via Meta Business API. Ideal para alto volume de mensagens sem risco de banimento.",
      logo: "🟢",
      cor: "from-green-600 to-emerald-700",
      status: whatsappApiCanal?.status || "desconectado",
      conectado: whatsappApiCanal?.status === "conectado",
    },
    {
      id: "instagram",
      nome: "Instagram",
      descricao: "Receba e responda Direct Messages do Instagram Business diretamente pelo Inbox.",
      logo: "📸",
      cor: "from-pink-500 to-rose-600",
      status: instagramCanal?.status || "desconectado",
      conectado: instagramCanal?.status === "conectado",
    },
    {
      id: "facebook",
      nome: "Facebook Messenger",
      descricao: "Conecte sua página do Facebook para atender clientes via Messenger no Inbox.",
      logo: "💙",
      cor: "from-blue-500 to-indigo-600",
      status: facebookCanal?.status || "desconectado",
      conectado: facebookCanal?.status === "conectado",
    },
  ];

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {canaisConfig.map((canal) => (
          <Card key={canal.id} className={`overflow-hidden cursor-pointer hover:shadow-lg transition-all border-2 ${canal.conectado ? "border-emerald-300" : "border-transparent hover:border-primary/20"}`}
            onClick={() => setOpenDialog(canal.id)}>
            <CardContent className="p-5">
              <div className="flex items-start gap-4">
                <div className={`h-14 w-14 rounded-2xl bg-gradient-to-br ${canal.cor} flex items-center justify-center text-2xl shadow-md shrink-0`}>
                  {canal.logo}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-sm">{canal.nome}</h3>
                    <Badge variant="outline" className={`text-[10px] ${canal.conectado ? "text-emerald-600 bg-emerald-50 border-emerald-200" : "text-gray-500 bg-gray-50 border-gray-200"}`}>
                      {canal.conectado ? <><Wifi className="h-3 w-3 mr-1" />Conectado</> : "Não configurado"}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{canal.descricao}</p>
                </div>
              </div>
              <div className="mt-4 flex justify-end">
                <Button variant={canal.conectado ? "outline" : "default"} size="sm" className="text-xs">
                  {canal.conectado ? "Gerenciar" : "Configurar"}
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Dialogs dos Canais */}
      <WhatsAppQRDialog open={openDialog === "whatsapp_qr"} onClose={() => setOpenDialog(null)} canal={whatsappQrCanal} canEdit={canEdit} isDono={isDono} onRefresh={refetch} />
      <WhatsAppCoExDialog open={openDialog === "whatsapp_coex"} onClose={() => setOpenDialog(null)} canal={whatsappCoexCanal} canEdit={canEdit} onRefresh={refetch} />
      <WhatsAppAPIDialog open={openDialog === "whatsapp_api"} onClose={() => setOpenDialog(null)} canal={whatsappApiCanal} canEdit={canEdit} onRefresh={refetch} />
      <InstagramDialog open={openDialog === "instagram"} onClose={() => setOpenDialog(null)} canal={instagramCanal} canEdit={canEdit} onRefresh={refetch} />
      <FacebookDialog open={openDialog === "facebook"} onClose={() => setOpenDialog(null)} canal={facebookCanal} canEdit={canEdit} onRefresh={refetch} />
    </>
  );
}

// ─── Integrações (APIs) Tab ─────────────────────────────────────────────────

function IntegracaoTab({ canEdit, isDono }: { canEdit: boolean; isDono: boolean }) {
  const [openDialog, setOpenDialog] = useState<string | null>(null);
  const { data: canaisData, refetch } = trpc.configuracoes.listarCanais.useQuery();
  const { data: auditLog } = trpc.configuracoes.auditLog.useQuery();
  const { data: asaasStatus, refetch: refetchAsaas } = trpc.asaas.status.useQuery(undefined, { retry: false });

  const canais = canaisData?.canais || [];
  const twilioCanal = canais.find(c => c.tipo === "telefone_voip");
  const chatgptCanal = canais.find(c => c.tipo === "whatsapp_api" && (c.nome || "").includes("ChatGPT"));

  const integracoes = [
    {
      id: "asaas",
      nome: "Asaas",
      descricao: "Cobranças por boleto, Pix e cartão. Veja status financeiro dos clientes no CRM.",
      logo: "💰",
      cor: "from-emerald-500 to-green-600",
      conectado: asaasStatus?.conectado || false,
    },
    {
      id: "calcom",
      nome: "Cal.com",
      descricao: "Agendamento online integrado ao CRM. Permita que clientes marquem reuniões automaticamente.",
      logo: "📅",
      cor: "from-blue-500 to-sky-600",
      conectado: false,
    },
    {
      id: "chatgpt",
      nome: "ChatGPT",
      descricao: "Chatbot com IA para atendimento automático via WhatsApp. Responde clientes 24/7.",
      logo: "🤖",
      cor: "from-green-500 to-teal-600",
      conectado: chatgptCanal?.status === "conectado",
    },
    {
      id: "twilio",
      nome: "Twilio VoIP",
      descricao: "Faça e receba ligações telefônicas diretamente pelo sistema. Ideal para equipe comercial.",
      logo: "📞",
      cor: "from-purple-500 to-violet-600",
      conectado: twilioCanal?.status === "conectado",
    },
  ];

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {integracoes.map((integ) => (
          <Card key={integ.id} className={`overflow-hidden cursor-pointer hover:shadow-lg transition-all border-2 ${integ.conectado ? "border-emerald-300" : "border-transparent hover:border-primary/20"}`}
            onClick={() => setOpenDialog(integ.id)}>
            <CardContent className="p-5">
              <div className="flex flex-col items-center text-center gap-3">
                <div className={`h-16 w-16 rounded-2xl bg-gradient-to-br ${integ.cor} flex items-center justify-center text-3xl shadow-md`}>
                  {integ.logo}
                </div>
                <div>
                  <div className="flex items-center justify-center gap-2 mb-1">
                    <h3 className="font-semibold text-sm">{integ.nome}</h3>
                    {integ.conectado && <Badge variant="outline" className="text-[10px] text-emerald-600 bg-emerald-50 border-emerald-200"><Wifi className="h-3 w-3 mr-1" />Ativo</Badge>}
                  </div>
                  <p className="text-[11px] text-muted-foreground">{integ.descricao}</p>
                </div>
                <Button variant={integ.conectado ? "outline" : "default"} size="sm" className="text-xs w-full">
                  {integ.conectado ? "Gerenciar" : "Configurar"}
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Dialogs das Integrações */}
      <AsaasDialog open={openDialog === "asaas"} onClose={() => setOpenDialog(null)} canEdit={canEdit} asaasStatus={asaasStatus} onRefresh={refetchAsaas} />
      <TwilioDialog open={openDialog === "twilio"} onClose={() => setOpenDialog(null)} canEdit={canEdit} />
      <CalcomDialog open={openDialog === "calcom"} onClose={() => setOpenDialog(null)} canEdit={canEdit} />
      <ChatGPTDialog open={openDialog === "chatgpt"} onClose={() => setOpenDialog(null)} canEdit={canEdit} />

      {/* Audit Log */}
      {auditLog && auditLog.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2"><Clock className="h-4 w-4 text-muted-foreground" /> Histórico de Ações</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {auditLog.slice(0, 10).map((log: any) => (
                <div key={log.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40 shrink-0" />
                  <span className="font-medium text-foreground capitalize">{log.acao?.replace("_", " ")}</span>
                  {log.detalhes && <span>— {log.detalhes}</span>}
                  <span className="ml-auto shrink-0">{log.createdAt ? new Date(log.createdAt).toLocaleDateString("pt-BR") : ""}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}

// ─── Templates de Mensagem ─────────────────────────────────────────────────

const CATEGORIA_LABELS: Record<string, string> = { saudacao: "Saudacao", cobranca: "Cobranca", agendamento: "Agendamento", juridico: "Juridico", encerramento: "Encerramento", outro: "Outro" };
const CATEGORIA_CORES: Record<string, string> = { saudacao: "bg-emerald-100 text-emerald-700", cobranca: "bg-amber-100 text-amber-700", agendamento: "bg-blue-100 text-blue-700", juridico: "bg-purple-100 text-purple-700", encerramento: "bg-gray-100 text-gray-700", outro: "bg-gray-100 text-gray-600" };

function TemplatesSection({ canEdit }: { canEdit: boolean }) {
  const [showNovo, setShowNovo] = useState(false);
  const [titulo, setTitulo] = useState("");
  const [conteudo, setConteudo] = useState("");
  const [categoria, setCategoria] = useState("outro");
  const [atalho, setAtalho] = useState("");

  const { data: templates, refetch } = (trpc as any).templates?.listar?.useQuery?.(undefined, { retry: false }) || { data: [], refetch: () => {} };
  const criarMut = (trpc as any).templates?.criar?.useMutation?.({ onSuccess: () => { toast.success("Template criado"); setTitulo(""); setConteudo(""); setAtalho(""); setShowNovo(false); refetch(); }, onError: (e: any) => toast.error(e.message) }) || {};
  const excluirMut = (trpc as any).templates?.excluir?.useMutation?.({ onSuccess: () => { toast.success("Excluido"); refetch(); }, onError: (e: any) => toast.error(e.message) }) || {};

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <MessageCircle className="h-4 w-4 text-muted-foreground" />
            Respostas Rapidas
          </CardTitle>
          {canEdit && <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowNovo(!showNovo)}><Plus className="h-3 w-3 mr-1" />Novo</Button>}
        </div>
        <CardDescription>Templates de mensagem para o Atendimento.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {showNovo && (
          <div className="rounded-lg border p-3 space-y-2 bg-muted/30">
            <div className="grid grid-cols-2 gap-2">
              <div><Label className="text-xs">Titulo *</Label><Input placeholder="Saudacao inicial" value={titulo} onChange={(e) => setTitulo(e.target.value)} className="mt-1 h-8 text-sm" /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label className="text-xs">Categoria</Label>
                  <Select value={categoria} onValueChange={setCategoria}><SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="saudacao">Saudacao</SelectItem><SelectItem value="cobranca">Cobranca</SelectItem><SelectItem value="agendamento">Agendamento</SelectItem><SelectItem value="juridico">Juridico</SelectItem><SelectItem value="encerramento">Encerramento</SelectItem><SelectItem value="outro">Outro</SelectItem></SelectContent></Select>
                </div>
                <div><Label className="text-xs">Atalho</Label><Input placeholder="/bol" value={atalho} onChange={(e) => setAtalho(e.target.value)} className="mt-1 h-8 text-sm" /></div>
              </div>
            </div>
            <div><Label className="text-xs">Conteudo *</Label><Textarea placeholder="Bom dia! Em que posso ajudar?" value={conteudo} onChange={(e) => setConteudo(e.target.value)} rows={2} className="mt-1 text-sm" /></div>
            <div className="flex justify-end gap-2"><Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowNovo(false)}>Cancelar</Button><Button size="sm" className="h-7 text-xs" onClick={() => criarMut.mutate?.({ titulo, conteudo, categoria, atalho: atalho || undefined })} disabled={!titulo || !conteudo || criarMut.isPending}>{criarMut.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}Salvar</Button></div>
          </div>
        )}

        {templates && templates.length > 0 ? (
          <div className="space-y-2">
            {templates.map((t: any) => (
              <div key={t.id} className="flex items-start gap-3 py-2 px-3 rounded-lg border bg-card">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">{t.titulo}</p>
                    <Badge variant="outline" className={`text-[9px] px-1 py-0 ${CATEGORIA_CORES[t.categoria] || ""}`}>{CATEGORIA_LABELS[t.categoria] || t.categoria}</Badge>
                    {t.atalho && <span className="text-[10px] font-mono text-muted-foreground">{t.atalho}</span>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{t.conteudo}</p>
                </div>
                {canEdit && <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive shrink-0" onClick={() => { if (confirm("Excluir template?")) excluirMut.mutate?.({ id: t.id }); }}><Trash2 className="h-3.5 w-3.5" /></Button>}
              </div>
            ))}
          </div>
        ) : !showNovo && (
          <div className="text-center py-6">
            <MessageCircle className="h-6 w-6 text-muted-foreground/30 mx-auto mb-1" />
            <p className="text-xs text-muted-foreground">Nenhum template ainda.</p>
            <p className="text-[10px] text-muted-foreground">Crie respostas rapidas para agilizar o atendimento.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Asaas Dialog ──────────────────────────────────────────────────────────

function AsaasDialog({ open, onClose, canEdit, asaasStatus, onRefresh }: { open: boolean; onClose: () => void; canEdit: boolean; asaasStatus: any; onRefresh: () => void }) {
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);

  const conectarMut = trpc.asaas.conectar.useMutation({
    onSuccess: (data) => {
      toast.success(data.mensagem);
      setApiKey("");
      onRefresh();
    },
    onError: (err: any) => toast.error("Falha ao conectar", { description: err.message, duration: 10000 }),
  });

  const desconectarMut = trpc.asaas.desconectar.useMutation({
    onSuccess: () => { toast.success("Asaas desconectado"); onRefresh(); },
    onError: (err: any) => toast.error(err.message),
  });

  const syncMut = trpc.asaas.sincronizarClientes.useMutation({
    onSuccess: (data: any) => toast.success(`${data.vinculados} vinculados, ${data.novos} novos, ${data.removidos || 0} removidos`),
    onError: (err: any) => toast.error(err.message),
  });

  const reconfWebhookMut = (trpc as any).asaas?.reconfigurarWebhook?.useMutation?.({
    onSuccess: () => toast.success("Webhook reconfigurado! Eventos do Asaas chegarao em tempo real."),
    onError: (err: any) => toast.error("Falha ao reconfigurar webhook", { description: err.message }),
  }) || {};

  const conectado = asaasStatus?.conectado;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-emerald-500 to-green-600 flex items-center justify-center text-xl shadow-md">💰</div>
            <div>
              <span>Asaas</span>
              {conectado && <Badge variant="outline" className="ml-2 text-[10px] text-emerald-600 bg-emerald-50 border-emerald-200"><Wifi className="h-3 w-3 mr-1" />Conectado</Badge>}
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            Conecte sua conta do Asaas para criar cobranças (boleto, Pix, cartão de crédito) e acompanhar o status financeiro dos seus clientes direto no CRM e Atendimento.
          </p>

          {conectado ? (
            <div className="space-y-3">
              <div className="rounded-lg border p-3 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Status</span>
                  <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-500/25 hover:bg-emerald-500/15 text-[10px]">
                    <CheckCircle className="h-3 w-3 mr-1" />Conectado
                  </Badge>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Modo</span>
                  <span className="text-xs font-medium">{asaasStatus.modo === "sandbox" ? "Sandbox (teste)" : "Produção"}</span>
                </div>
                {asaasStatus.apiKeyPreview && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">API Key</span>
                    <span className="text-xs font-mono">{asaasStatus.apiKeyPreview}</span>
                  </div>
                )}
                {asaasStatus.saldo && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Saldo</span>
                    <span className="text-xs font-medium">R$ {parseFloat(asaasStatus.saldo).toFixed(2)}</span>
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={() => syncMut.mutate()} disabled={syncMut.isPending}>
                  {syncMut.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Link2 className="h-3 w-3 mr-1" />}
                  Sincronizar clientes
                </Button>
                <Button variant="outline" size="sm" className="text-xs text-destructive hover:text-destructive" onClick={() => { if (confirm("Desconectar o Asaas? As cobranças existentes serão mantidas.")) desconectarMut.mutate(); }} disabled={desconectarMut.isPending}>
                  <WifiOff className="h-3 w-3 mr-1" />
                  Desconectar
                </Button>
              </div>
              <Button variant="outline" size="sm" className="w-full text-xs" onClick={() => reconfWebhookMut.mutate?.({ webhookUrl: window.location.origin })} disabled={reconfWebhookMut.isPending}>
                {reconfWebhookMut.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Wifi className="h-3 w-3 mr-1" />}
                Reconfigurar Webhook (sync em tempo real)
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <Label className="text-xs">API Key do Asaas</Label>
                <div className="flex gap-2 mt-1">
                  <Input
                    type={showKey ? "text" : "password"}
                    placeholder="$aact_..."
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    className="font-mono text-sm"
                  />
                  <Button variant="ghost" size="sm" className="h-9 w-9 p-0" onClick={() => setShowKey(!showKey)}>
                    <Eye className="h-4 w-4" />
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Gere sua API key em <strong>Minha Conta → Integrações</strong> no painel do Asaas. A key será criptografada (AES-256).
                </p>
              </div>
              <Button
                className="w-full"
                onClick={() => conectarMut.mutate({ apiKey: apiKey.trim(), webhookUrl: window.location.origin })}
                disabled={conectarMut.isPending || apiKey.trim().length < 10}
              >
                {conectarMut.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plug className="h-4 w-4 mr-2" />}
                Conectar
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── WhatsApp QR Dialog ────────────────────────────────────────────────────

function WhatsAppQRDialog({ open, onClose, canal, canEdit, isDono, onRefresh }: { open: boolean; onClose: () => void; canal?: any; canEdit: boolean; isDono: boolean; onRefresh: () => void }) {
  const [showNewForm, setShowNewForm] = useState(false);
  const [newNome, setNewNome] = useState("");
  const criarMut = trpc.configuracoes.criarCanal.useMutation({
    onSuccess: () => { toast.success("Canal WhatsApp criado!"); setNewNome(""); setShowNewForm(false); onRefresh(); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-emerald-500 to-green-600 flex items-center justify-center text-xl shadow">💬</div>
            WhatsApp — Conexão QR Code
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {canal ? (
            <WhatsappQR canalId={canal.id} canalNome={canal.nome || "WhatsApp"} statusInicial={canal.status} />
          ) : (
            <div className="text-center py-6 space-y-3">
              <MessageCircle className="h-10 w-10 text-muted-foreground/30 mx-auto" />
              <p className="text-sm text-muted-foreground">Nenhum canal WhatsApp QR configurado.</p>
              {canEdit && !showNewForm && (
                <Button size="sm" onClick={() => setShowNewForm(true)}><Plus className="h-4 w-4 mr-1" /> Criar Canal</Button>
              )}
            </div>
          )}
          {showNewForm && (
            <div className="space-y-3 p-4 border rounded-lg bg-muted/20">
              <div className="space-y-1.5">
                <Label>Nome do canal *</Label>
                <Input placeholder="WhatsApp Comercial" value={newNome} onChange={(e) => setNewNome(e.target.value)} />
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => criarMut.mutate({ tipo: "whatsapp_qr", nome: newNome })} disabled={!newNome || criarMut.isPending}>
                  {criarMut.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null} Criar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowNewForm(false)}>Cancelar</Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── WhatsApp CoEx (Coexistence) Dialog ────────────────────────────────────

function WhatsAppCoExDialog({ open, onClose, canal, canEdit, onRefresh }: { open: boolean; onClose: () => void; canal?: any; canEdit: boolean; onRefresh: () => void }) {
  const [conectando, setConectando] = useState(false);
  const [sdkLoaded, setSdkLoaded] = useState(false);

  const { data: waConfig } = (trpc as any).whatsappCoex?.getConfig?.useQuery?.(undefined, { retry: false, enabled: open }) || { data: null };
  const exchangeMut = (trpc as any).whatsappCoex?.exchangeCode?.useMutation?.({
    onSuccess: (data: any) => { toast.success(`WhatsApp CoEx conectado! ${data.nome || ""} ${data.telefone || ""}`); onRefresh(); setConectando(false); },
    onError: (e: any) => { toast.error(e.message); setConectando(false); },
  }) || {};
  const excluirMut = trpc.configuracoes.excluirCanal.useMutation({
    onSuccess: () => { toast.success("Canal desconectado"); onRefresh(); onClose(); },
  });

  // Carregar Facebook SDK
  useEffect(() => {
    if (!waConfig?.appId || sdkLoaded) return;
    if ((window as any).FB) { setSdkLoaded(true); return; }

    (window as any).fbAsyncInit = function () {
      (window as any).FB.init({ appId: waConfig.appId, cookie: true, xfbml: true, version: "v21.0" });
      setSdkLoaded(true);
    };

    if (!document.getElementById("facebook-jssdk")) {
      const js = document.createElement("script");
      js.id = "facebook-jssdk";
      js.src = "https://connect.facebook.net/en_US/sdk.js";
      js.defer = true;
      document.body.appendChild(js);
    }
  }, [waConfig?.appId, sdkLoaded]);

  // Listener para sessionInfo (WABA ID + Phone Number ID)
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.origin !== "https://www.facebook.com" && event.origin !== "https://web.facebook.com") return;
      try {
        const data = JSON.parse(event.data);
        if (data.type === "WA_EMBEDDED_SIGNUP") {
          const wabaId = data.data?.waba_id || "";
          const phoneNumberId = data.data?.phone_number_id || "";
          if (wabaId || phoneNumberId) {
            (window as any).__wa_signup_data = { wabaId, phoneNumberId };
          }
        }
      } catch {}
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  const handleConectar = () => {
    if (!waConfig?.appId) { toast.error("WhatsApp Cloud API nao configurada pelo administrador."); return; }
    const FB = (window as any).FB;
    if (!FB) { toast.error("Facebook SDK nao carregado. Recarregue a pagina."); return; }
    setConectando(true);
    (window as any).__wa_signup_data = null;

    const loginOptions: any = {
      response_type: "code",
      override_default_response_type: true,
      scope: "whatsapp_business_management,whatsapp_business_messaging",
      extras: {
        setup: {},
        featureType: "whatsapp_business_app_onboarding",
        sessionInfoVersion: "3",
      },
    };
    if (waConfig.configId) loginOptions.config_id = waConfig.configId;

    FB.login(function (response: any) {
      if (response.authResponse?.code) {
        const signupData = (window as any).__wa_signup_data || {};
        exchangeMut.mutate?.({
          code: response.authResponse.code,
          wabaId: signupData.wabaId || "",
          phoneNumberId: signupData.phoneNumberId || "",
        });
      } else {
        setConectando(false);
        toast.error("Conexao cancelada ou nao autorizada.");
      }
    }, loginOptions);
  };

  const conectado = canal?.status === "conectado";

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-emerald-600 to-teal-700 flex items-center justify-center text-xl shadow">🔗</div>
            WhatsApp CoEx
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-lg bg-teal-50 border border-teal-200 p-3 space-y-1.5">
            <p className="text-xs font-semibold text-teal-800">Mantenha o WhatsApp no celular + receba mensagens no CRM</p>
            <p className="text-[11px] text-teal-700">Clique em Conectar - o Facebook abrira para voce autorizar. Nao precisa de dados tecnicos.</p>
            <div className="flex flex-wrap gap-1.5 pt-1">
              <Badge variant="outline" className="text-[9px] text-teal-700 border-teal-300">Sem banimento</Badge>
              <Badge variant="outline" className="text-[9px] text-teal-700 border-teal-300">Historico 6 meses</Badge>
              <Badge variant="outline" className="text-[9px] text-teal-700 border-teal-300">Oficial Meta</Badge>
            </div>
          </div>

          {conectado ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 rounded-lg bg-emerald-50 border border-emerald-200">
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-emerald-600" />
                  <div>
                    <p className="text-sm font-medium text-emerald-800">Conectado</p>
                    <p className="text-xs text-emerald-600">{canal.telefone || canal.nome || "WhatsApp CoEx"}</p>
                  </div>
                </div>
              </div>
              <Button variant="outline" size="sm" className="w-full text-xs text-destructive" onClick={() => { if (confirm("Desconectar WhatsApp CoEx?")) excluirMut.mutate({ canalId: canal.id }); }}>Desconectar</Button>
            </div>
          ) : !waConfig?.appId ? (
            <div className="text-center py-6 space-y-2">
              <AlertTriangle className="h-8 w-8 text-amber-400 mx-auto" />
              <p className="text-sm font-medium">WhatsApp nao configurado</p>
              <p className="text-xs text-muted-foreground">O administrador precisa configurar o WhatsApp Cloud API no painel Admin -&gt; Integracoes primeiro.</p>
            </div>
          ) : (
            <div className="space-y-3">
              <Button className="w-full h-12 text-base bg-[#1877F2] hover:bg-[#166FE5]" onClick={handleConectar} disabled={conectando || !sdkLoaded}>
                {conectando ? <Loader2 className="h-5 w-5 mr-2 animate-spin" /> : (
                  <svg className="h-5 w-5 mr-2" viewBox="0 0 24 24" fill="white"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
                )}
                {conectando ? "Conectando..." : "Conectar com Facebook"}
              </Button>
              <p className="text-[10px] text-muted-foreground text-center">Voce sera redirecionado para o Facebook para autorizar a conexao do seu WhatsApp Business.</p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
// ─── WhatsApp API Oficial Dialog ───────────────────────────────────────────

function WhatsAppAPIDialog({ open, onClose, canal, canEdit, onRefresh }: { open: boolean; onClose: () => void; canal?: any; canEdit: boolean; onRefresh: () => void }) {
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [verifyToken, setVerifyToken] = useState("");
  const [businessAccountId, setBusinessAccountId] = useState("");
  const [nome, setNome] = useState("WhatsApp API");

  const criarMut = trpc.configuracoes.criarCanal.useMutation({
    onSuccess: () => { toast.success("WhatsApp API configurado!"); onRefresh(); onClose(); },
    onError: (e: any) => toast.error(e.message),
  });

  const atualizarMut = trpc.configuracoes.atualizarConfigCanal.useMutation({
    onSuccess: () => { toast.success("Configuração atualizada!"); onRefresh(); onClose(); },
    onError: (e: any) => toast.error(e.message),
  });

  const handleSalvar = () => {
    if (!phoneNumberId || !accessToken) { toast.error("Phone Number ID e Access Token são obrigatórios"); return; }
    const config = { phoneNumberId, accessToken, verifyToken, businessAccountId };
    if (canal) {
      atualizarMut.mutate({ canalId: canal.id, config });
    } else {
      criarMut.mutate({ tipo: "whatsapp_api", nome, config });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-green-600 to-emerald-700 flex items-center justify-center text-xl shadow">🟢</div>
            WhatsApp API Oficial
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {!canal && (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Nome do canal</Label>
              <Input placeholder="WhatsApp API" value={nome} onChange={(e) => setNome(e.target.value)} disabled={!canEdit} />
            </div>
          )}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Phone Number ID *</Label>
            <Input type="password" placeholder="123456789..." value={phoneNumberId} onChange={(e) => setPhoneNumberId(e.target.value)} disabled={!canEdit} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Access Token *</Label>
            <Input type="password" placeholder="EAAxxxxxxx..." value={accessToken} onChange={(e) => setAccessToken(e.target.value)} disabled={!canEdit} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Verify Token</Label>
              <Input placeholder="token-verificacao" value={verifyToken} onChange={(e) => setVerifyToken(e.target.value)} disabled={!canEdit} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Business Account ID</Label>
              <Input placeholder="987654321..." value={businessAccountId} onChange={(e) => setBusinessAccountId(e.target.value)} disabled={!canEdit} />
            </div>
          </div>
          <div className="rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-200 p-3">
            <p className="text-xs text-green-700 font-medium">Como configurar</p>
            <p className="text-[11px] text-green-600 mt-1">Acesse <a href="https://developers.facebook.com" target="_blank" rel="noopener noreferrer" className="underline">developers.facebook.com</a> → Seu App → WhatsApp → API Setup. Copie Phone Number ID e Access Token permanente.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSalvar} disabled={!phoneNumberId || !accessToken || criarMut.isPending || atualizarMut.isPending || !canEdit}>
            {(criarMut.isPending || atualizarMut.isPending) ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Shield className="h-4 w-4 mr-2" />}
            {canal ? "Atualizar" : "Conectar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Instagram Dialog ──────────────────────────────────────────────────────

function InstagramDialog({ open, onClose, canal, canEdit, onRefresh }: { open: boolean; onClose: () => void; canal?: any; canEdit: boolean; onRefresh: () => void }) {
  const [pageId, setPageId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [nome, setNome] = useState("Instagram");

  const criarMut = trpc.configuracoes.criarCanal.useMutation({
    onSuccess: () => { toast.success("Instagram conectado!"); onRefresh(); onClose(); },
    onError: (e: any) => toast.error(e.message),
  });

  const atualizarMut = trpc.configuracoes.atualizarConfigCanal.useMutation({
    onSuccess: () => { toast.success("Configuração atualizada!"); onRefresh(); onClose(); },
    onError: (e: any) => toast.error(e.message),
  });

  const handleSalvar = () => {
    if (!pageId || !accessToken) { toast.error("Page ID e Access Token são obrigatórios"); return; }
    const config = { pageId, accessToken };
    if (canal) {
      atualizarMut.mutate({ canalId: canal.id, config });
    } else {
      criarMut.mutate({ tipo: "instagram", nome, config });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-pink-500 to-rose-600 flex items-center justify-center text-xl shadow">📸</div>
            Instagram — Direct Messages
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {!canal && (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Nome do canal</Label>
              <Input placeholder="Instagram" value={nome} onChange={(e) => setNome(e.target.value)} disabled={!canEdit} />
            </div>
          )}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Page ID (Instagram Business) *</Label>
            <Input type="password" placeholder="ID da página do Instagram" value={pageId} onChange={(e) => setPageId(e.target.value)} disabled={!canEdit} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Access Token (Meta) *</Label>
            <Input type="password" placeholder="Token de acesso Meta" value={accessToken} onChange={(e) => setAccessToken(e.target.value)} disabled={!canEdit} />
          </div>
          <div className="rounded-lg bg-pink-50 dark:bg-pink-950/20 border border-pink-200 p-3">
            <p className="text-xs text-pink-700 font-medium">Pré-requisitos</p>
            <p className="text-[11px] text-pink-600 mt-1">Sua conta deve ser Instagram Business conectada a uma página do Facebook. Configure em <a href="https://developers.facebook.com" target="_blank" rel="noopener noreferrer" className="underline">developers.facebook.com</a> → Instagram Messaging API.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSalvar} disabled={!pageId || !accessToken || criarMut.isPending || atualizarMut.isPending || !canEdit}>
            {(criarMut.isPending || atualizarMut.isPending) ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Shield className="h-4 w-4 mr-2" />}
            {canal ? "Atualizar" : "Conectar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Facebook Messenger Dialog ─────────────────────────────────────────────

function FacebookDialog({ open, onClose, canal, canEdit, onRefresh }: { open: boolean; onClose: () => void; canal?: any; canEdit: boolean; onRefresh: () => void }) {
  const [pageId, setPageId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [nome, setNome] = useState("Facebook Messenger");

  const criarMut = trpc.configuracoes.criarCanal.useMutation({
    onSuccess: () => { toast.success("Facebook Messenger conectado!"); onRefresh(); onClose(); },
    onError: (e: any) => toast.error(e.message),
  });

  const atualizarMut = trpc.configuracoes.atualizarConfigCanal.useMutation({
    onSuccess: () => { toast.success("Configuração atualizada!"); onRefresh(); onClose(); },
    onError: (e: any) => toast.error(e.message),
  });

  const handleSalvar = () => {
    if (!pageId || !accessToken) { toast.error("Page ID e Access Token são obrigatórios"); return; }
    const config = { pageId, accessToken };
    if (canal) {
      atualizarMut.mutate({ canalId: canal.id, config });
    } else {
      criarMut.mutate({ tipo: "facebook", nome, config });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-xl shadow">💙</div>
            Facebook Messenger
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {!canal && (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Nome do canal</Label>
              <Input placeholder="Facebook Messenger" value={nome} onChange={(e) => setNome(e.target.value)} disabled={!canEdit} />
            </div>
          )}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Page ID *</Label>
            <Input type="password" placeholder="ID da página do Facebook" value={pageId} onChange={(e) => setPageId(e.target.value)} disabled={!canEdit} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Access Token *</Label>
            <Input type="password" placeholder="Token de acesso da página" value={accessToken} onChange={(e) => setAccessToken(e.target.value)} disabled={!canEdit} />
          </div>
          <div className="rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 p-3">
            <p className="text-xs text-blue-700 font-medium">Como configurar</p>
            <p className="text-[11px] text-blue-600 mt-1">Acesse <a href="https://developers.facebook.com" target="_blank" rel="noopener noreferrer" className="underline">developers.facebook.com</a> → Seu App → Messenger → Settings. Gere um Page Access Token permanente.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSalvar} disabled={!pageId || !accessToken || criarMut.isPending || atualizarMut.isPending || !canEdit}>
            {(criarMut.isPending || atualizarMut.isPending) ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Shield className="h-4 w-4 mr-2" />}
            {canal ? "Atualizar" : "Conectar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Twilio Dialog ──────────────────────────────────────────────────────────

function TwilioDialog({ open, onClose, canEdit }: { open: boolean; onClose: () => void; canEdit: boolean }) {
  const [sid, setSid] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const { data: canaisData, refetch } = trpc.configuracoes.listarCanais.useQuery();
  const twilioCanal = (canaisData?.canais || []).find((c: any) => c.tipo === "telefone_voip");

  const criarMut = trpc.configuracoes.criarCanal.useMutation({
    onSuccess: () => { toast.success("Twilio configurado com sucesso!"); refetch(); onClose(); },
    onError: (e: any) => toast.error(e.message),
  });

  const atualizarMut = trpc.configuracoes.atualizarConfigCanal.useMutation({
    onSuccess: () => { toast.success("Twilio atualizado!"); refetch(); onClose(); },
    onError: (e: any) => toast.error(e.message),
  });

  const handleSalvar = () => {
    if (!sid || !authToken || !phoneNumber) { toast.error("Preencha todos os campos"); return; }
    const config = { twilioSid: sid, twilioAuthToken: authToken, twilioPhoneNumber: phoneNumber };
    if (twilioCanal) {
      atualizarMut.mutate({ canalId: twilioCanal.id, config, telefone: phoneNumber });
    } else {
      criarMut.mutate({ tipo: "telefone_voip", nome: "Twilio VoIP", telefone: phoneNumber, config });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center text-xl shadow">📞</div>
            Twilio VoIP — Ligações
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Account SID *</Label>
            <Input type="password" placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" value={sid} onChange={(e) => setSid(e.target.value)} disabled={!canEdit} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Auth Token *</Label>
            <Input type="password" placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" value={authToken} onChange={(e) => setAuthToken(e.target.value)} disabled={!canEdit} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Número Twilio *</Label>
            <Input placeholder="+5585999990000" value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} disabled={!canEdit} />
            <p className="text-[10px] text-muted-foreground">Número comprado no Twilio Console</p>
          </div>
          <div className="rounded-lg bg-purple-50 dark:bg-purple-950/20 border border-purple-200 p-3">
            <p className="text-xs text-purple-700 font-medium">Como obter credenciais</p>
            <p className="text-[11px] text-purple-600 mt-1">Acesse <a href="https://www.twilio.com/console" target="_blank" rel="noopener noreferrer" className="underline">twilio.com/console</a> → copie Account SID e Auth Token → compre um número em Phone Numbers.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSalvar} disabled={!sid || !authToken || !phoneNumber || criarMut.isPending || atualizarMut.isPending || !canEdit}>
            {(criarMut.isPending || atualizarMut.isPending) ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Shield className="h-4 w-4 mr-2" />}
            {twilioCanal ? "Atualizar" : "Salvar (criptografado)"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Cal.com Dialog ─────────────────────────────────────────────────────────

function CalcomDialog({ open, onClose, canEdit }: { open: boolean; onClose: () => void; canEdit: boolean }) {
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("https://cal.com");
  const [testResult, setTestResult] = useState<{ ok: boolean; user?: string; error?: string } | null>(null);

  const testarMut = trpc.calcom.testarConexaoDireta.useMutation({
    onSuccess: (res: any) => { setTestResult(res); if (res.ok) toast.success(`Conectado como ${res.user}`); else toast.error(res.error); },
    onError: (e: any) => { setTestResult({ ok: false, error: e.message }); toast.error(e.message); },
  });

  const salvarMut = trpc.calcom.salvarConfigDireta.useMutation({
    onSuccess: (res: any) => { toast.success(`Cal.com salvo! Conectado como ${res.user}`); onClose(); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-blue-500 to-sky-600 flex items-center justify-center text-xl shadow">📅</div>
            Cal.com — Agendamento Online
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">API Key do Cal.com *</Label>
            <Input type="password" placeholder="cal_live_xxxxxxxxxxxxxxx" value={apiKey} onChange={(e) => setApiKey(e.target.value)} disabled={!canEdit} />
            <p className="text-[10px] text-muted-foreground">Gere em Cal.com → Settings → Security → API Keys</p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Base URL</Label>
            <Input placeholder="https://cal.com" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} disabled={!canEdit} />
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <Button size="sm" variant="outline" onClick={() => { setTestResult(null); testarMut.mutate({ apiKey, baseUrl }); }} disabled={!apiKey || testarMut.isPending || !canEdit}>
              {testarMut.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <CheckCircle className="h-4 w-4 mr-1" />}
              Testar Conexão
            </Button>
            {testResult && (
              <span className={`text-xs flex items-center gap-1 ${testResult.ok ? "text-emerald-600" : "text-red-600"}`}>
                {testResult.ok ? <><CheckCircle className="h-3 w-3" /> {testResult.user}</> : <><X className="h-3 w-3" /> {testResult.error}</>}
              </span>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => salvarMut.mutate({ apiKey, baseUrl })} disabled={!apiKey || salvarMut.isPending || !canEdit}>
            {salvarMut.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Salvar e Conectar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── ChatGPT Dialog ─────────────────────────────────────────────────────────

function ChatGPTDialog({ open, onClose, canEdit }: { open: boolean; onClose: () => void; canEdit: boolean }) {
  const [apiKey, setApiKey] = useState("");
  const [modelo, setModelo] = useState("gpt-4o-mini");
  const [prompt, setPrompt] = useState("Você é um assistente jurídico prestativo. Responda de forma educada, profissional e concisa às perguntas dos clientes. Se não souber a resposta, sugira que o cliente agende uma consulta.");
  const [ativo, setAtivo] = useState(false);
  const { data: canaisData, refetch } = trpc.configuracoes.listarCanais.useQuery();
  const chatgptCanal = (canaisData?.canais || []).find((c: any) => c.tipo === "whatsapp_api" && (c.nome || "").includes("ChatGPT"));

  const criarMut = trpc.configuracoes.criarCanal.useMutation({
    onSuccess: () => { toast.success("ChatGPT configurado com sucesso!"); refetch(); onClose(); },
    onError: (e: any) => toast.error(e.message),
  });

  const atualizarMut = trpc.configuracoes.atualizarConfigCanal.useMutation({
    onSuccess: () => { toast.success("ChatGPT atualizado!"); refetch(); onClose(); },
    onError: (e: any) => toast.error(e.message),
  });

  const handleSalvar = () => {
    if (!apiKey) { toast.error("Informe a API Key"); return; }
    const config = { openaiApiKey: apiKey, modelo, prompt, ativo: ativo ? "true" : "false" };
    if (chatgptCanal) {
      atualizarMut.mutate({ canalId: chatgptCanal.id, config });
    } else {
      criarMut.mutate({ tipo: "whatsapp_api", nome: "ChatGPT Bot", config });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-green-500 to-teal-600 flex items-center justify-center text-xl shadow">🤖</div>
            ChatGPT — Chatbot Inteligente
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">API Key da OpenAI *</Label>
            <Input type="password" placeholder="sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" value={apiKey} onChange={(e) => setApiKey(e.target.value)} disabled={!canEdit} />
            <p className="text-[10px] text-muted-foreground">Gere em <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="underline">platform.openai.com/api-keys</a></p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Modelo</Label>
            <Select value={modelo} onValueChange={setModelo} disabled={!canEdit}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="gpt-4o-mini">GPT-4o Mini (rápido)</SelectItem>
                <SelectItem value="gpt-4o">GPT-4o (inteligente)</SelectItem>
                <SelectItem value="gpt-3.5-turbo">GPT-3.5 Turbo (barato)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Prompt do Sistema</Label>
            <Textarea rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} disabled={!canEdit} />
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={ativo} onCheckedChange={setAtivo} disabled={!canEdit} />
            <Label className="text-xs">Chatbot ativo (responde automaticamente)</Label>
          </div>
          <div className="rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-200 p-3">
            <p className="text-xs text-green-700 font-medium">Como funciona</p>
            <p className="text-[11px] text-green-600 mt-1">
              Quando ativo, o chatbot responde mensagens do WhatsApp automaticamente. Se o cliente pedir atendente humano, a conversa é transferida.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSalvar} disabled={!apiKey || criarMut.isPending || atualizarMut.isPending || !canEdit}>
            {(criarMut.isPending || atualizarMut.isPending) ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Bot className="h-4 w-4 mr-2" />}
            {chatgptCanal ? "Atualizar" : "Salvar Configuração"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Cal.com Integration (standalone para aba perfil — mantida por compatibilidade) ──

function CalcomIntegration({ canEdit }: { canEdit: boolean }) {
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("https://cal.com");
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; user?: string; error?: string } | null>(null);

  const testarMut = trpc.calcom.testarConexaoDireta.useMutation({
    onSuccess: (res: any) => { setTestResult(res); if (res.ok) toast.success(`Conectado como ${res.user}`); else toast.error(res.error || "Erro"); setTesting(false); },
    onError: (e: any) => { setTestResult({ ok: false, error: e.message }); toast.error(e.message); setTesting(false); },
  });

  const salvarMut = trpc.calcom.salvarConfigDireta.useMutation({
    onSuccess: (res: any) => { toast.success(`Cal.com salvo! Conectado como ${res.user}`); setSaving(false); setApiKey(""); },
    onError: (e: any) => { toast.error(e.message); setSaving(false); },
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">API Key *</Label>
          <Input type="password" placeholder="cal_live_xxxxxxxxxxxxxxx" value={apiKey} onChange={(e) => setApiKey(e.target.value)} disabled={!canEdit} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Base URL</Label>
          <Input placeholder="https://cal.com" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} disabled={!canEdit} />
        </div>
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <Button size="sm" variant="outline" onClick={() => { setTesting(true); setTestResult(null); testarMut.mutate({ apiKey, baseUrl }); }} disabled={!apiKey || testing || !canEdit}>
          {testing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle className="h-4 w-4 mr-2" />} Testar
        </Button>
        {testResult?.ok && <Button size="sm" onClick={() => { setSaving(true); salvarMut.mutate({ apiKey, baseUrl }); }} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null} Salvar</Button>}
        {testResult && <span className={`text-xs ${testResult.ok ? "text-emerald-600" : "text-red-600"}`}>{testResult.ok ? `✓ ${testResult.user}` : testResult.error}</span>}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Aba Permissões — Gerenciamento de cargos e permissões customizáveis
// ═══════════════════════════════════════════════════════════════════════════════

const MODULOS_LABELS: Record<string, string> = {
  calculos: "Cálculos", clientes: "Clientes", processos: "Processos", atendimento: "Atendimento",
  pipeline: "Pipeline", agendamento: "Agendamento", relatorios: "Relatórios", configuracoes: "Configurações", equipe: "Equipe",
};
const PERM_LABELS: Record<string, string> = { verTodos: "Ver todos", verProprios: "Ver próprios", criar: "Criar", editar: "Editar", excluir: "Excluir" };
const CORES_CARGO = ["#dc2626", "#2563eb", "#16a34a", "#f59e0b", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"];

function PermissoesTab() {
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

function AgentesIaTab() {
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
