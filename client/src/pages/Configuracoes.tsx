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
  ChevronDown, ChevronUp, Calendar, DollarSign, Plug, Tag as TagIcon, Sparkles,
  Database, CreditCard as CreditCardIcon, Megaphone,
} from "lucide-react";
import { BackupDialog } from "./configuracoes/backup-dialog";
import Plans from "./Plans";
import { useAuth } from "@/_core/hooks/useAuth";
import { toast } from "sonner";
import { CARGO_LABELS, CARGO_DESCRICAO, PLANO_LABELS, CUSTO_COLABORADOR_EXTRA, FUSOS_HORARIOS, FUSO_HORARIO_PADRAO } from "@shared/escritorio-types";
import type { CargoColaborador } from "@shared/escritorio-types";
import { TIPO_CANAL_LABELS, TIPO_CANAL_DESCRICAO, STATUS_CANAL_LABELS, STATUS_CANAL_CORES } from "@shared/canal-types";
import type { TipoCanal, StatusCanal } from "@shared/canal-types";
import CalcomConfig from "@/components/integracoes/CalcomConfig";
import WhatsappQR from "@/components/integracoes/WhatsappQR";
import {
  AsaasDialog,
  WhatsAppQRDialog,
  TwilioDialog,
  CalcomDialog,
  ChatGPTDialog,
  ClaudeDialog,
} from "./configuracoes/dialogs";
import { PermissoesTab } from "./configuracoes/tabs";
import { TagsTab } from "./configuracoes/tags-tab";
import { OrigensLeadTab } from "./configuracoes/OrigensLeadTab";
import { CamposClienteTab } from "./configuracoes/campos-cliente-tab";
import { MetaConnectDialog } from "./configuracoes/meta-connect-dialog";
import { FinanceiroTab } from "./configuracoes/financeiro-tab";

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

const CARGOS_CONVITE: { value: "gestor" | "atendente" | "estagiario" | "sdr"; label: string }[] = [
  { value: "gestor", label: "Gestor" },
  { value: "atendente", label: "Atendente" },
  { value: "sdr", label: "SDR (Sales Development Rep)" },
  { value: "estagiario", label: "Estagiário" },
];

function CargoBadge({ cargo }: { cargo: CargoColaborador }) {
  const colors: Record<CargoColaborador, string> = {
    dono: "bg-purple-100 text-purple-700 border-purple-200",
    gestor: "bg-blue-100 text-blue-700 border-blue-200",
    atendente: "bg-emerald-100 text-emerald-700 border-emerald-200",
    estagiario: "bg-amber-100 text-amber-700 border-amber-200",
    sdr: "bg-orange-100 text-orange-700 border-orange-200",
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

/**
 * Lê `?tab=` da URL pra abrir uma aba específica via deep-link. Usado
 * no redirect de /plans → /configuracoes?tab=meu-plano (preserva o
 * link antigo que aparece em Termos.tsx, e-mails de billing, etc).
 */
function getTabFromQueryString(): string {
  if (typeof window === "undefined") return "perfil";
  const params = new URLSearchParams(window.location.search);
  const t = params.get("tab");
  return t || "perfil";
}

export default function Configuracoes() {
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const [tabAtiva, setTabAtiva] = useState(getTabFromQueryString());
  const [backupDialogOpen, setBackupDialogOpen] = useState(false);

  const { data, isLoading, refetch } = trpc.configuracoes.meuEscritorio.useQuery();
  const { data: equipeData, refetch: refetchEquipe } = trpc.configuracoes.listarColaboradores.useQuery(undefined, { enabled: !!data });
  const { data: convites, refetch: refetchConvites } = trpc.configuracoes.listarConvites.useQuery(undefined, { enabled: !!data });
  // Cargos personalizados criados pelo admin em /configuracoes (aba
  // Permissões). O select de "Cargo" do convite mostra os 3 default +
  // todos os custom (excluindo "Dono", "Gestor", "Atendente", "Estagiário"
  // que são os defaults canônicos auto-criados pelo sistema).
  const { data: cargosCustom } = (trpc as any).permissoes?.listarCargos?.useQuery?.(
    undefined,
    { enabled: !!data, retry: false, refetchOnWindowFocus: false },
  ) || { data: null };

  // ─── Perfil form state ───
  const [editMode, setEditMode] = useState(false);
  const [formPerfil, setFormPerfil] = useState<Record<string, any>>({});

  // ─── Convite form state ───
  const [conviteEmail, setConviteEmail] = useState("");
  // Cargo do convite — pode ser default ("gestor"|"atendente"|"estagiario")
  // ou nome de um cargo personalizado criado em Permissões (ex: "advogados").
  const [conviteCargo, setConviteCargo] = useState<string>("atendente");
  const [conviteDepto, setConviteDepto] = useState("");
  const [lastToken, setLastToken] = useState("");

  const atualizarMut = trpc.configuracoes.atualizarEscritorio.useMutation({
    onSuccess: () => { toast.success("Escritório atualizado!"); setEditMode(false); refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const enviarConviteMut = trpc.configuracoes.enviarConvite.useMutation({
    onSuccess: (res: any) => {
      // Auto-copia o link para clipboard + toast claro com próximos passos.
      const link = `${window.location.origin}/convite/${res.token}`;
      navigator.clipboard?.writeText(link).catch(() => {});
      if (res.emailEnviado) {
        toast.success("Convite enviado", {
          description: `Email enviado para ${conviteEmail}. Link também copiado.`,
        });
      } else {
        // Mostra o motivo REAL retornado pelo backend (vem de getResendApiKey
        // diagnostico ou da resposta do Resend). Fallback se não vier.
        const motivo =
          res.emailErro ||
          "Servidor de email indisponível. Copie o link e envie manualmente.";
        toast.warning("Convite criado — email NÃO enviado", {
          description: motivo,
          duration: 12000,
        });
      }
      setConviteEmail("");
      setConviteDepto("");
      setLastToken(res.token);
      refetchConvites();
    },
    onError: (e) => toast.error("Não foi possível criar o convite", { description: e.message }),
  });

  const cancelarConviteMut = trpc.configuracoes.cancelarConvite.useMutation({
    onSuccess: () => { toast.success("Convite cancelado."); refetchConvites(); },
  });

  // Reenviar email de convite pendente — quando primeiro envio falhou
  // (Resend rejeitado, domínio não verificado, etc).
  const reenviarConviteMut = (trpc.configuracoes as any).reenviarConvite?.useMutation({
    onSuccess: (res: any) => {
      if (res.emailEnviado) {
        toast.success("Email reenviado com sucesso");
      } else {
        toast.warning("Reenvio falhou", {
          description: res.emailErro || "Servidor de email indisponível.",
          duration: 10000,
        });
      }
      refetchConvites();
    },
    onError: (e: any) => toast.error("Erro ao reenviar", { description: e.message }),
  }) ?? { mutate: () => {}, isPending: false };

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
  const podeVerMeuPlano = isDono || user?.role === "admin";
  // Espelha `exigirDonoOuAdmin` do servidor (router-backup.ts). Frontend
  // gating tem que aceitar os mesmos 4 caminhos pra não esconder o botão
  // de quem o backend deixaria passar — admin Jurify, admin impersonando,
  // dono via FK ownerId (mesmo com cargo customizado) ou cargo canônico.
  const podeFazerBackup =
    user?.role === "admin" ||
    !!(user as any)?.impersonatedBy ||
    (escritorio as any).ownerId === user?.id ||
    colaborador.cargo === "dono";

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

      <Tabs value={tabAtiva} onValueChange={setTabAtiva}>
        <TabsList className={`grid w-full ${podeVerMeuPlano ? "grid-cols-9" : "grid-cols-8"} h-10`}>
          <TabsTrigger value="perfil" className="gap-1.5 text-xs"><Building2 className="h-3.5 w-3.5" /> Escritório</TabsTrigger>
          <TabsTrigger value="equipe" className="gap-1.5 text-xs"><Users className="h-3.5 w-3.5" /> Equipe</TabsTrigger>
          <TabsTrigger value="permissoes" className="gap-1.5 text-xs"><Shield className="h-3.5 w-3.5" /> Permissões</TabsTrigger>
          <TabsTrigger value="tags" className="gap-1.5 text-xs"><TagIcon className="h-3.5 w-3.5" /> Tags</TabsTrigger>
          <TabsTrigger value="origens" className="gap-1.5 text-xs"><Megaphone className="h-3.5 w-3.5" /> Origens</TabsTrigger>
          <TabsTrigger value="campos" className="gap-1.5 text-xs"><Sparkles className="h-3.5 w-3.5" /> Campos</TabsTrigger>
          <TabsTrigger value="canais" className="gap-1.5 text-xs"><MessageCircle className="h-3.5 w-3.5" /> Canais</TabsTrigger>
          <TabsTrigger value="financeiro" className="gap-1.5 text-xs"><DollarSign className="h-3.5 w-3.5" /> Financeiro</TabsTrigger>
          <TabsTrigger value="integracoes" className="gap-1.5 text-xs"><Link2 className="h-3.5 w-3.5" /> Integrações</TabsTrigger>
          {podeVerMeuPlano && (
            <TabsTrigger value="meu-plano" className="gap-1.5 text-xs"><CreditCardIcon className="h-3.5 w-3.5" /> Meu Plano</TabsTrigger>
          )}
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
                  <div className="space-y-1.5">
                    <Label>Fuso horário</Label>
                    <Select
                      value={formPerfil.fusoHorario || FUSO_HORARIO_PADRAO}
                      onValueChange={(v) => setFormPerfil({ ...formPerfil, fusoHorario: v })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {FUSOS_HORARIOS.map((f) => (
                          <SelectItem key={f.valor} value={f.valor}>
                            <span className="font-medium">{f.utc}</span>
                            <span className="text-muted-foreground"> — {f.label}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-[11px] text-muted-foreground">
                      Usado nos gatilhos com horário (SmartFlow Asaas, lembretes Cal.com).
                    </p>
                  </div>
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

                  {podeFazerBackup && (
                    <>
                      <Separator />
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className="text-sm font-medium flex items-center gap-1.5">
                            <Database className="h-4 w-4" /> Backup e import
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Exporta ou restaura todos os dados do escritório.
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setBackupDialogOpen(true)}
                        >
                          Abrir
                        </Button>
                      </div>
                    </>
                  )}
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
                    <Select value={conviteCargo} onValueChange={(v) => setConviteCargo(v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {/* Defaults — nomes técnicos (gestor/atendente/estagiario)
                            consumidos pelo backend. Labels amigáveis aqui no UI. */}
                        {CARGOS_CONVITE.map((c) => (
                          <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                        ))}
                        {/* Cargos personalizados criados em Permissões.
                            Filtra os defaults canônicos pra não duplicar. */}
                        {(cargosCustom || [])
                          .filter((c: any) => !["Dono", "Gestor", "Atendente", "Estagiário"].includes(c.nome))
                          .map((c: any) => (
                            <SelectItem key={c.id} value={c.nome}>{c.nome}</SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Departamento</Label>
                    <Input placeholder="Ex: Comercial" value={conviteDepto} onChange={(e) => setConviteDepto(e.target.value)} />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  {(CARGO_DESCRICAO as Record<string, string>)[conviteCargo]
                    || "Cargo personalizado — permissões definidas em Permissões > Cargos."}
                </p>
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
                      {conv.status === "pendente" && (conv as any).emailEnviado === false && (
                        <Badge
                          variant="outline"
                          className="text-[10px] bg-red-50 text-red-700 border-red-200 shrink-0"
                          title={(conv as any).ultimoErroEmail || "Email não enviado"}
                        >
                          email falhou
                        </Badge>
                      )}
                      {conv.status === "pendente" && (conv as any).emailEnviado === false && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="shrink-0 text-blue-600"
                          title={(conv as any).ultimoErroEmail || "Reenviar email"}
                          onClick={() => reenviarConviteMut.mutate({ conviteId: conv.id })}
                          disabled={reenviarConviteMut.isPending}
                        >
                          <Mail className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {conv.status === "pendente" && conv.token && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="shrink-0"
                          title="Copiar link do convite"
                          onClick={() => {
                            const link = `${window.location.origin}/convite/${conv.token}`;
                            navigator.clipboard.writeText(link);
                            toast.success("Link copiado", { description: link });
                          }}
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                      )}
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

        <TabsContent value="origens" className="space-y-4">
          <OrigensLeadTab />
        </TabsContent>

        <TabsContent value="permissoes" className="space-y-4">
          {isDono ? <PermissoesTab /> : <Card><CardContent className="pt-6 text-center py-12"><Shield className="h-10 w-10 text-muted-foreground/20 mx-auto mb-3" /><p className="text-sm text-muted-foreground">Apenas o dono do escritório pode gerenciar permissões.</p></CardContent></Card>}
        </TabsContent>

        <TabsContent value="financeiro" className="space-y-4">
          <FinanceiroTab canEdit={isDono || colaborador.cargo === "gestor"} />
        </TabsContent>

        <TabsContent value="tags" className="space-y-4">
          <TagsTab canEdit={canEdit} />
        </TabsContent>

        <TabsContent value="campos" className="space-y-4">
          <CamposClienteTab canEdit={canEdit} />
        </TabsContent>

        {podeVerMeuPlano && (
          <TabsContent value="meu-plano" className="space-y-4">
            {/* `Plans` é a página antiga `/plans` reaproveitada como aba.
                Tem layout próprio (max-w + padding) — fica OK aqui. */}
            <Plans />
          </TabsContent>
        )}

      </Tabs>

      <BackupDialog open={backupDialogOpen} onOpenChange={setBackupDialogOpen} />
    </div>
  );
}

// ─── Canais de Comunicação Tab ──────────────────────────────────────────────

function CanaisTab({ canEdit, isDono }: { canEdit: boolean; isDono: boolean }) {
  const [metaDialog, setMetaDialog] = useState<"whatsapp" | "instagram" | "messenger" | null>(null);
  const [legacyDialog, setLegacyDialog] = useState<string | null>(null);
  const [showAvancado, setShowAvancado] = useState(false);
  const { data: canaisData, refetch } = trpc.configuracoes.listarCanais.useQuery();

  const canais = canaisData?.canais || [];
  // Canal "moderno" WhatsApp = whatsapp_api (excluindo integrações internas)
  const whatsappCanal = canais.find((c: any) => c.tipo === "whatsapp_api");
  const whatsappQrCanal = canais.find(c => c.tipo === "whatsapp_qr");
  const instagramCanal = canais.find(c => c.tipo === "instagram");
  const facebookCanal = canais.find(c => c.tipo === "facebook");

  // Guarda: WhatsApp API só é considerado conectado se TIVER telefone
  // verificado. Dados antigos com status=conectado mas sem telefone eram
  // conexões abortadas no meio do Embedded Signup. O backend agora faz
  // cleanup desses órfãos no listarCanais, mas mantemos a guarda aqui
  // como segunda camada — se escapar algum, exibimos "Não conectado"
  // em vez de "Erro" (não foi erro real, foi tentativa abortada).
  const whatsappValido =
    whatsappCanal && whatsappCanal.status === "conectado" && !!whatsappCanal.telefone;
  const whatsappComErroReal =
    whatsappCanal?.status === "erro" && !!whatsappCanal?.mensagemErro;

  // Cards principais: Embedded Signup (fluxo moderno)
  const canaisPrincipais = [
    {
      id: "whatsapp" as const,
      nome: "WhatsApp Business",
      descricao: "Conecte seu WhatsApp com 1 clique via Facebook. API oficial, sem risco de banimento.",
      logo: "💬",
      cor: "from-emerald-500 to-green-600",
      canal: whatsappValido ? whatsappCanal : undefined,
      conectado: !!whatsappValido,
      // "Erro" só aparece se o backend marcou explicitamente erro com
      // mensagem. Órfãos sem telefone passam como "Não conectado".
      comErro: whatsappComErroReal,
    },
    {
      id: "instagram" as const,
      nome: "Instagram Business",
      descricao: "DMs do Instagram Business no Inbox. Conecte via Facebook Login.",
      logo: "📸",
      cor: "from-pink-500 to-rose-600",
      canal: instagramCanal,
      conectado: instagramCanal?.status === "conectado",
      comErro: instagramCanal?.status === "erro",
    },
    {
      id: "messenger" as const,
      nome: "Facebook Messenger",
      descricao: "Mensagens da sua página do Facebook direto no Inbox.",
      logo: "💙",
      cor: "from-blue-500 to-indigo-600",
      canal: facebookCanal,
      conectado: facebookCanal?.status === "conectado",
      comErro: facebookCanal?.status === "erro",
    },
  ];

  return (
    <>
      {/* Banner explicativo */}
      <div className="rounded-lg border border-blue-200 bg-blue-50 dark:bg-blue-950/20 p-4 mb-4">
        <div className="flex items-start gap-3">
          <div className="h-8 w-8 rounded-lg bg-[#1877F2] flex items-center justify-center text-white shrink-0">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-blue-900 dark:text-blue-100">
              Conexão simplificada via Facebook
            </p>
            <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
              WhatsApp, Instagram e Messenger agora se conectam com 1 clique. Sem precisar copiar
              tokens ou IDs manualmente — basta autorizar pelo Facebook Login.
            </p>
          </div>
        </div>
      </div>

      {/* Cards principais */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {canaisPrincipais.map((canal) => (
          <Card
            key={canal.id}
            className={`overflow-hidden cursor-pointer hover:shadow-lg transition-all border-2 ${
              canal.conectado
                ? "border-emerald-300"
                : canal.comErro
                  ? "border-red-300"
                  : "border-transparent hover:border-primary/20"
            }`}
            onClick={() => setMetaDialog(canal.id)}
          >
            <CardContent className="p-5">
              <div className="flex items-start gap-4">
                <div
                  className={`h-14 w-14 rounded-2xl bg-gradient-to-br ${canal.cor} flex items-center justify-center text-2xl shadow-md shrink-0`}
                >
                  {canal.logo}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <h3 className="font-semibold text-sm">{canal.nome}</h3>
                    {canal.conectado && (
                      <Badge
                        variant="outline"
                        className="text-[10px] text-emerald-600 bg-emerald-50 border-emerald-200"
                      >
                        <Wifi className="h-3 w-3 mr-1" />
                        Conectado
                      </Badge>
                    )}
                    {canal.comErro && (
                      <Badge
                        variant="outline"
                        className="text-[10px] text-red-600 bg-red-50 border-red-200"
                      >
                        <AlertTriangle className="h-3 w-3 mr-1" />
                        Erro
                      </Badge>
                    )}
                    {!canal.conectado && !canal.comErro && (
                      <Badge
                        variant="outline"
                        className="text-[10px] text-gray-500 bg-gray-50 border-gray-200"
                      >
                        Não conectado
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{canal.descricao}</p>
                </div>
              </div>
              <div className="mt-4 flex justify-end">
                <Button
                  variant={canal.conectado ? "outline" : "default"}
                  size="sm"
                  className="text-xs"
                >
                  {canal.conectado ? "Gerenciar" : canal.comErro ? "Reconectar" : "Conectar"}
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Opções avançadas (escondidas por padrão) */}
      <div className="mt-6">
        <button
          onClick={() => setShowAvancado(!showAvancado)}
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
        >
          {showAvancado ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          Opções avançadas (QR Code, configuração manual)
        </button>

        {showAvancado && (
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Card
              className="cursor-pointer hover:border-primary/40 transition-colors"
              onClick={() => setLegacyDialog("whatsapp_qr")}
            >
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-gray-500 to-slate-600 flex items-center justify-center text-lg shrink-0">
                    📱
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-semibold">WhatsApp QR Code</h4>
                      {whatsappQrCanal?.status === "conectado" && (
                        <Badge
                          variant="outline"
                          className="text-[9px] text-emerald-600 bg-emerald-50"
                        >
                          <Wifi className="h-2.5 w-2.5 mr-0.5" />
                          Conectado
                        </Badge>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Conexão via QR code (alternativa para quem não tem conta Business).
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {/* Dialog unificado para WhatsApp/Instagram/Messenger */}
      {metaDialog && (
        <MetaConnectDialog
          open={!!metaDialog}
          onClose={() => setMetaDialog(null)}
          channel={metaDialog}
          canal={
            metaDialog === "whatsapp"
              ? whatsappCanal
              : metaDialog === "instagram"
                ? instagramCanal
                : facebookCanal
          }
          onRefresh={refetch}
        />
      )}

      {/* Dialog legacy para QR Code (avançado) */}
      <WhatsAppQRDialog
        open={legacyDialog === "whatsapp_qr"}
        onClose={() => setLegacyDialog(null)}
        canal={whatsappQrCanal}
        canEdit={canEdit}
        isDono={isDono}
        onRefresh={refetch}
      />
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
  const twilioCanal = canais.find((c: any) => c.tipo === "telefone_voip");
  const chatgptCanal = canais.find((c: any) => c.tipo === "chatgpt" || (c.tipo === "whatsapp_api" && (c.nome || "").includes("ChatGPT")));
  const claudeCanal = canais.find((c: any) => c.tipo === "claude" || (c.nome || "").includes("Claude"));
  const calcomCanal = canais.find((c: any) => c.tipo === "calcom" || (c.nome || "").includes("Cal.com"));

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
      conectado: calcomCanal?.status === "conectado",
    },
    {
      id: "chatgpt",
      nome: "ChatGPT",
      descricao: "OpenAI para agentes de IA. Modelos: GPT-4o, GPT-4o-mini.",
      logo: "🤖",
      cor: "from-green-500 to-teal-600",
      conectado: chatgptCanal?.status === "conectado",
    },
    {
      id: "claude",
      nome: "Claude",
      descricao: "Anthropic para agentes de IA. Modelos: Claude Sonnet, Claude Haiku.",
      logo: "🧠",
      cor: "from-amber-500 to-orange-600",
      conectado: claudeCanal?.status === "conectado",
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
      <ClaudeDialog open={openDialog === "claude"} onClose={() => setOpenDialog(null)} canEdit={canEdit} />

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


