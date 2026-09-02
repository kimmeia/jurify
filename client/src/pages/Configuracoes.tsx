import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useModulosContratados } from "@/components/ModuloGuard";
import { contratoLibera } from "@shared/modulos-contratacao";
import { EditorJornada } from "./configuracoes/editor-jornada";
import { normalizarJornada, type JornadaSemanal } from "@shared/jornada";
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
  MessageCircle, Instagram, Phone, Facebook, Wifi, WifiOff, Eye, X, Send,
  ChevronDown, ChevronUp, Calendar, DollarSign, Plug, Tag as TagIcon, Sparkles,
  Database, CreditCard as CreditCardIcon, Megaphone, Pencil, Stethoscope, MessageSquare,
} from "lucide-react";
import { BackupDialog } from "./configuracoes/backup-dialog";
import Plans from "./Plans";
import { useAuth } from "@/_core/hooks/useAuth";
import { toast } from "sonner";
import { CARGO_LABELS, CARGO_DESCRICAO, CUSTO_COLABORADOR_EXTRA, FUSOS_HORARIOS, FUSO_HORARIO_PADRAO } from "@shared/escritorio-types";
import type { CargoColaborador } from "@shared/escritorio-types";
import { TIPO_CANAL_LABELS, TIPO_CANAL_DESCRICAO, STATUS_CANAL_LABELS, STATUS_CANAL_CORES } from "@shared/canal-types";
import type { TipoCanal, StatusCanal } from "@shared/canal-types";
import {
  AsaasDialog,
  TwilioDialog,
  ChatGPTDialog,
  ClaudeDialog,
} from "./configuracoes/dialogs";
import { PermissoesTab } from "./configuracoes/tabs";
import { TagsTab } from "./configuracoes/tags-tab";
import { TemplatesTab } from "./configuracoes/templates-tab";
import { gradientAvatar, gerarIniciais } from "./dashboards/common";
import { Search as SearchIcon } from "lucide-react";
import { OrigensLeadTab } from "./configuracoes/OrigensLeadTab";
import { CamposClienteTab } from "./configuracoes/campos-cliente-tab";
import { MetaConnectDialog } from "./configuracoes/meta-connect-dialog";
import { WhatsappManualDialog } from "./configuracoes/whatsapp-manual-dialog";
import { FinanceiroTab } from "./configuracoes/financeiro-tab";
import { LigacaoConfigCard } from "./atendimento/ligacao-config-card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

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

/**
 * Badge do cargo. Prioriza o cargo personalizado (nome + cor escolhida em
 * Permissões) quando o colaborador tem `cargoPersonalizadoNome` definido —
 * caso contrário cai no enum legado (`cargo`) com cores padronizadas. Sem
 * isso, cargos customizados apareciam com fallback "atendente" do enum.
 */
function CargoBadge({
  cargo,
  nomePersonalizado,
  cor,
}: {
  cargo: CargoColaborador;
  nomePersonalizado?: string | null;
  cor?: string | null;
}) {
  const colors: Record<CargoColaborador, string> = {
    dono: "bg-info-bg text-info-fg border-info/30",
    gestor: "bg-info-bg text-info-fg border-info/30",
    atendente: "bg-success-bg text-success-fg border-success/30",
    estagiario: "bg-warning-bg text-warning-fg border-warning/30",
    sdr: "bg-warning-bg text-warning-fg border-warning/30",
  };

  if (nomePersonalizado) {
    const cssVar = cor || "#6366f1";
    return (
      <Badge
        variant="outline"
        className="text-xs"
        style={{
          color: cssVar,
          borderColor: cssVar,
          backgroundColor: `${cssVar}15`,
        }}
      >
        {nomePersonalizado}
      </Badge>
    );
  }

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

  // Abas de módulo não contratado somem (Fase 2 da modularização): campo de
  // configuração de coisa que o plano não tem é convite pra suporte.
  const modulosContratados = useModulosContratados();
  const libera = (mods: string[]) => contratoLibera(modulosContratados, mods);
  const abaTags = libera(["clientes"]);
  const abaOrigens = libera(["clientes", "kanban"]);
  const abaCampos = libera(["clientes"]);
  const abaTemplates = libera(["atendimento"]);
  const abaCanais = libera(["atendimento"]);
  const abaFinanceiro = libera(["financeiro"]);
  const temCadastros = abaTags || abaOrigens || abaCampos || abaTemplates;
  const abaEstaVisivel: Record<string, boolean> = {
    tags: abaTags, origens: abaOrigens, campos: abaCampos, templates: abaTemplates,
    canais: abaCanais, financeiro: abaFinanceiro,
  };
  useEffect(() => {
    if (abaEstaVisivel[tabAtiva] === false) setTabAtiva("perfil");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabAtiva, modulosContratados]);

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
  const [editandoColab, setEditandoColab] = useState<any | null>(null);
  const [editColabNome, setEditColabNome] = useState("");
  const [editColabCargoPersonalizadoId, setEditColabCargoPersonalizadoId] = useState<number | null>(null);
  const [editColabSetorId, setEditColabSetorId] = useState<number | null>(null);
  const [editColabMaxAtend, setEditColabMaxAtend] = useState<number | null>(5); // null = sem limite
  const [editColabRecebeLeads, setEditColabRecebeLeads] = useState<boolean>(false);
  const [editColabMetaMensal, setEditColabMetaMensal] = useState<string>("");
  const [editColabJornada, setEditColabJornada] = useState<JornadaSemanal | null>(null);
  const [diagColabId, setDiagColabId] = useState<number | null>(null);
  const { data: diagData, isFetching: diagLoading } = trpc.permissoes.diagnosticarColaborador.useQuery(
    diagColabId ? { colaboradorId: diagColabId } : (undefined as any),
    { enabled: !!diagColabId, retry: false },
  );

  const { data: cargosList } = trpc.permissoes.listarCargos.useQuery(undefined, { retry: false });
  const { data: setoresList, refetch: refetchSetores } = trpc.configuracoes.listarSetores.useQuery(undefined, { retry: false });

  // Busca + filtro pra aba Equipe
  const [buscaEquipe, setBuscaEquipe] = useState("");
  const [filtroEquipe, setFiltroEquipe] = useState<"todos" | "ativos" | "convites" | "inativos">("todos");

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
    onSuccess: () => { toast.success("Colaborador removido."); refetchEquipe(); refetchRemovidos(); },
    onError: (e) => toast.error(e.message),
  });

  // Lista colaboradores removidos (soft delete). Pra dono/gestor poder
  // restaurar quem foi excluído por engano.
  const { data: removidosData, refetch: refetchRemovidos } =
    (trpc as any).configuracoes.listarRemovidos.useQuery(undefined, { enabled: !!data, retry: false });
  const removidos: any[] = removidosData ?? [];
  const restaurarColabMut = (trpc as any).configuracoes.restaurarColaborador.useMutation({
    onSuccess: () => {
      toast.success("Colaborador restaurado!");
      refetchEquipe();
      refetchRemovidos();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const atualizarColabMut = trpc.configuracoes.atualizarColaborador.useMutation({
    onSuccess: () => {
      toast.success("Atualizado!");
      setEditandoColab(null);
      refetchEquipe();
    },
    onError: (e) => toast.error(e.message),
  });

  // Setores (departamentos) — gestão CRUD
  const [setorDialog, setSetorDialog] = useState<null | {
    id?: number;
    nome: string;
    descricao: string;
    cor: string;
    tipo: "comercial" | "operacional" | "suporte" | "financeiro" | "outro";
  }>(null);
  const criarSetorMut = trpc.configuracoes.criarSetor.useMutation({
    onSuccess: () => { toast.success("Setor criado"); setSetorDialog(null); refetchSetores(); refetchEquipe(); },
    onError: (e) => toast.error(e.message),
  });
  const atualizarSetorMut = trpc.configuracoes.atualizarSetor.useMutation({
    onSuccess: () => { toast.success("Setor atualizado"); setSetorDialog(null); refetchSetores(); refetchEquipe(); },
    onError: (e) => toast.error(e.message),
  });
  const excluirSetorMut = trpc.configuracoes.excluirSetor.useMutation({
    onSuccess: () => { toast.success("Setor excluído"); refetchSetores(); refetchEquipe(); },
    onError: (e) => toast.error(e.message),
  });

  function abrirEditColab(c: any) {
    setEditandoColab(c);
    setEditColabNome(c.userName ?? "");
    setEditColabCargoPersonalizadoId(c.cargoPersonalizadoId ?? null);
    setEditColabSetorId(c.setorId ?? null);
    setEditColabMaxAtend(c.maxAtendimentosSimultaneos ?? null);
    setEditColabRecebeLeads(!!c.recebeLeadsAutomaticos);
    setEditColabMetaMensal(c.metaMensal != null ? String(c.metaMensal) : "");
    setEditColabJornada(normalizarJornada(c.jornadaSemanal));
  }

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
  // de quem o backend deixaria passar — admin JuridFlow, admin impersonando,
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
      oab: (escritorio as any).oab || "",
      telefone: escritorio.telefone || "",
      email: escritorio.email || "",
      endereco: escritorio.endereco || "",
      fusoHorario: escritorio.fusoHorario,
      horarioAbertura: escritorio.horarioAbertura,
      horarioFechamento: escritorio.horarioFechamento,
      diasFuncionamento: escritorio.diasFuncionamento || ["seg", "ter", "qua", "qui", "sex"],
      mensagemAusencia: escritorio.mensagemAusencia || "",
      mensagemBoasVindas: escritorio.mensagemBoasVindas || "",
      agendaResponsavelPadraoId: (escritorio as any).agendaResponsavelPadraoId ?? null,
      msgDividirRespostas: (escritorio as any).msgDividirRespostas ?? true,
      msgDividirMax: (escritorio as any).msgDividirMax ?? 4,
      msgDividirRitmo: (escritorio as any).msgDividirRitmo ?? "natural",
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
    <div className="space-y-5">
      {/* ─── HERO ─────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-2xl p-6 text-white shadow-lg"
           style={{ background: "linear-gradient(135deg, var(--hero) 0%, var(--hero-2) 100%)" }}>
        <div className="absolute -top-10 -right-10 h-40 w-40 rounded-full bg-white/10 blur-3xl pointer-events-none" />
        <div className="relative flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full rounded-full bg-success opacity-70 animate-ping" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
              </span>
              <p className="text-[11px] font-semibold tracking-[0.18em] text-white/85 uppercase">Configurações</p>
            </div>
            <h1 className="text-xl font-bold tracking-tight">{escritorio.nome}</h1>
            <p className="text-[11px] text-white/80 mt-1">
              {escritorio.cnpj && <>CNPJ {escritorio.cnpj} · </>}
              {escritorio.endereco && <>{escritorio.endereco.split(",")[0]} · </>}
              Fuso {escritorio.fusoHorario}
            </p>
          </div>
          <CargoBadge
            cargo={colaborador.cargo as CargoColaborador}
            nomePersonalizado={(colaborador as any).cargoPersonalizadoNome}
            cor={(colaborador as any).cargoPersonalizadoCor}
          />
        </div>
      </div>

      <Tabs value={tabAtiva} onValueChange={setTabAtiva}>
        <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-5">

          {/* ─── SIDEBAR LATERAL VERTICAL ─────────────────────────────── */}
          <aside className="lg:sticky lg:top-4 lg:self-start">
            <div className="rounded-2xl bg-card border border-border shadow-[0_1px_2px_0_rgb(0,0,0,0.04)] p-2">
              <TabsList className="!flex !flex-col !gap-0.5 !h-auto !bg-transparent !p-0 !w-full">
                <p className="text-[9.5px] uppercase tracking-wider font-bold text-muted-foreground/70 px-3 py-2 self-start">Geral</p>
                <TabsTrigger
                  value="perfil"
                  className="w-full !justify-start gap-2.5 text-[12.5px] px-3 py-2 rounded-lg !text-muted-foreground hover:bg-muted data-[state=active]:!bg-gradient-to-r data-[state=active]:!from-info-bg data-[state=active]:!to-info-bg data-[state=active]:!text-info-fg data-[state=active]:font-semibold data-[state=active]:!shadow-none data-[state=active]:border-l-[3px] data-[state=active]:border-l-info data-[state=active]:pl-[9px]"
                >
                  <Building2 className="h-4 w-4" /> <span className="flex-1 text-left">Escritório</span>
                </TabsTrigger>
                <TabsTrigger
                  value="equipe"
                  className="w-full !justify-start gap-2.5 text-[12.5px] px-3 py-2 rounded-lg !text-muted-foreground hover:bg-muted data-[state=active]:!bg-gradient-to-r data-[state=active]:!from-info-bg data-[state=active]:!to-info-bg data-[state=active]:!text-info-fg data-[state=active]:font-semibold data-[state=active]:!shadow-none data-[state=active]:border-l-[3px] data-[state=active]:border-l-info data-[state=active]:pl-[9px]"
                >
                  <Users className="h-4 w-4" /> <span className="flex-1 text-left">Equipe</span>
                </TabsTrigger>
                <TabsTrigger
                  value="permissoes"
                  className="w-full !justify-start gap-2.5 text-[12.5px] px-3 py-2 rounded-lg !text-muted-foreground hover:bg-muted data-[state=active]:!bg-gradient-to-r data-[state=active]:!from-info-bg data-[state=active]:!to-info-bg data-[state=active]:!text-info-fg data-[state=active]:font-semibold data-[state=active]:!shadow-none data-[state=active]:border-l-[3px] data-[state=active]:border-l-info data-[state=active]:pl-[9px]"
                >
                  <Shield className="h-4 w-4" /> <span className="flex-1 text-left">Permissões</span>
                </TabsTrigger>

                {temCadastros && (
                  <p className="text-[9.5px] uppercase tracking-wider font-bold text-muted-foreground/70 px-3 py-2 mt-2 self-start">Cadastros</p>
                )}
                {abaTags && (
                <TabsTrigger
                  value="tags"
                  className="w-full !justify-start gap-2.5 text-[12.5px] px-3 py-2 rounded-lg !text-muted-foreground hover:bg-muted data-[state=active]:!bg-gradient-to-r data-[state=active]:!from-info-bg data-[state=active]:!to-info-bg data-[state=active]:!text-info-fg data-[state=active]:font-semibold data-[state=active]:!shadow-none data-[state=active]:border-l-[3px] data-[state=active]:border-l-info data-[state=active]:pl-[9px]"
                >
                  <TagIcon className="h-4 w-4" /> <span className="flex-1 text-left">Tags</span>
                </TabsTrigger>
                )}
                {abaOrigens && (
                <TabsTrigger
                  value="origens"
                  className="w-full !justify-start gap-2.5 text-[12.5px] px-3 py-2 rounded-lg !text-muted-foreground hover:bg-muted data-[state=active]:!bg-gradient-to-r data-[state=active]:!from-info-bg data-[state=active]:!to-info-bg data-[state=active]:!text-info-fg data-[state=active]:font-semibold data-[state=active]:!shadow-none data-[state=active]:border-l-[3px] data-[state=active]:border-l-info data-[state=active]:pl-[9px]"
                >
                  <Megaphone className="h-4 w-4" /> <span className="flex-1 text-left">Origens de leads</span>
                </TabsTrigger>
                )}
                {abaCampos && (
                <TabsTrigger
                  value="campos"
                  className="w-full !justify-start gap-2.5 text-[12.5px] px-3 py-2 rounded-lg !text-muted-foreground hover:bg-muted data-[state=active]:!bg-gradient-to-r data-[state=active]:!from-info-bg data-[state=active]:!to-info-bg data-[state=active]:!text-info-fg data-[state=active]:font-semibold data-[state=active]:!shadow-none data-[state=active]:border-l-[3px] data-[state=active]:border-l-info data-[state=active]:pl-[9px]"
                >
                  <Sparkles className="h-4 w-4" /> <span className="flex-1 text-left">Campos de cliente</span>
                </TabsTrigger>
                )}
                {abaTemplates && (
                <TabsTrigger
                  value="templates"
                  className="w-full !justify-start gap-2.5 text-[12.5px] px-3 py-2 rounded-lg !text-muted-foreground hover:bg-muted data-[state=active]:!bg-gradient-to-r data-[state=active]:!from-info-bg data-[state=active]:!to-info-bg data-[state=active]:!text-info-fg data-[state=active]:font-semibold data-[state=active]:!shadow-none data-[state=active]:border-l-[3px] data-[state=active]:border-l-info data-[state=active]:pl-[9px]"
                >
                  <MessageSquare className="h-4 w-4" /> <span className="flex-1 text-left">Templates</span>
                </TabsTrigger>
                )}

                <p className="text-[9.5px] uppercase tracking-wider font-bold text-muted-foreground/70 px-3 py-2 mt-2 self-start">Integrações</p>
                {abaCanais && (
                <TabsTrigger
                  value="canais"
                  className="w-full !justify-start gap-2.5 text-[12.5px] px-3 py-2 rounded-lg !text-muted-foreground hover:bg-muted data-[state=active]:!bg-gradient-to-r data-[state=active]:!from-info-bg data-[state=active]:!to-info-bg data-[state=active]:!text-info-fg data-[state=active]:font-semibold data-[state=active]:!shadow-none data-[state=active]:border-l-[3px] data-[state=active]:border-l-info data-[state=active]:pl-[9px]"
                >
                  <MessageCircle className="h-4 w-4" /> <span className="flex-1 text-left">Canais</span>
                </TabsTrigger>
                )}
                <TabsTrigger
                  value="integracoes"
                  className="w-full !justify-start gap-2.5 text-[12.5px] px-3 py-2 rounded-lg !text-muted-foreground hover:bg-muted data-[state=active]:!bg-gradient-to-r data-[state=active]:!from-info-bg data-[state=active]:!to-info-bg data-[state=active]:!text-info-fg data-[state=active]:font-semibold data-[state=active]:!shadow-none data-[state=active]:border-l-[3px] data-[state=active]:border-l-info data-[state=active]:pl-[9px]"
                >
                  <Plug className="h-4 w-4" /> <span className="flex-1 text-left">Apps externos</span>
                </TabsTrigger>

                <p className="text-[9.5px] uppercase tracking-wider font-bold text-muted-foreground/70 px-3 py-2 mt-2 self-start">Operação</p>
                {abaFinanceiro && (
                <TabsTrigger
                  value="financeiro"
                  className="w-full !justify-start gap-2.5 text-[12.5px] px-3 py-2 rounded-lg !text-muted-foreground hover:bg-muted data-[state=active]:!bg-gradient-to-r data-[state=active]:!from-info-bg data-[state=active]:!to-info-bg data-[state=active]:!text-info-fg data-[state=active]:font-semibold data-[state=active]:!shadow-none data-[state=active]:border-l-[3px] data-[state=active]:border-l-info data-[state=active]:pl-[9px]"
                >
                  <DollarSign className="h-4 w-4" /> <span className="flex-1 text-left">Financeiro</span>
                </TabsTrigger>
                )}
                {podeVerMeuPlano && (
                  <TabsTrigger
                    value="meu-plano"
                    className="w-full !justify-start gap-2.5 text-[12.5px] px-3 py-2 rounded-lg !text-muted-foreground hover:bg-muted data-[state=active]:!bg-gradient-to-r data-[state=active]:!from-info-bg data-[state=active]:!to-info-bg data-[state=active]:!text-info-fg data-[state=active]:font-semibold data-[state=active]:!shadow-none data-[state=active]:border-l-[3px] data-[state=active]:border-l-info data-[state=active]:pl-[9px]"
                  >
                    <CreditCardIcon className="h-4 w-4" /> <span className="flex-1 text-left">Meu plano</span>
                  </TabsTrigger>
                )}
              </TabsList>
            </div>
          </aside>

          {/* ─── CONTEÚDO DAS ABAS ────────────────────────────────────── */}
          <div className="min-w-0">
        {/* ─── Perfil — sections collapsibles ───────────────────────── */}
        <TabsContent value="perfil" className="space-y-3">
          {canEdit && !editMode && (
            <div className="flex justify-end">
              <Button variant="outline" size="sm" onClick={initPerfilForm}>
                <Pencil className="h-3.5 w-3.5 mr-1.5" /> Editar dados
              </Button>
            </div>
          )}

          {/* Section 1: Dados básicos */}
          <details open className="card group rounded-2xl bg-card border border-border overflow-hidden">
            <summary className="px-5 py-3.5 border-b border-border flex items-center justify-between cursor-pointer list-none">
              <div className="flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-lg bg-info-bg text-info-fg flex items-center justify-center"><Building2 className="h-4 w-4" /></span>
                <div>
                  <p className="text-sm font-bold tracking-tight">Dados básicos</p>
                  <p className="text-[10.5px] text-muted-foreground">Nome, CNPJ, telefone, email, endereço</p>
                </div>
              </div>
              <ChevronDown className="h-4 w-4 text-muted-foreground/70 group-open:rotate-180 transition-transform" />
            </summary>
            <div className="p-5">
              {editMode ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5"><Label className="text-[11px]">Nome *</Label><Input value={formPerfil.nome} onChange={(e) => setFormPerfil({ ...formPerfil, nome: e.target.value })} /></div>
                  <div className="space-y-1.5"><Label className="text-[11px]">CNPJ</Label><Input placeholder="00.000.000/0001-00" value={formPerfil.cnpj} onChange={(e) => setFormPerfil({ ...formPerfil, cnpj: e.target.value })} /></div>
                  <div className="space-y-1.5"><Label className="text-[11px]">OAB do responsável</Label><Input placeholder="OAB/CE 12.345" value={formPerfil.oab} onChange={(e) => setFormPerfil({ ...formPerfil, oab: e.target.value })} /></div>
                  <div className="space-y-1.5"><Label className="text-[11px]">Telefone</Label><Input placeholder="(85) 99999-0000" value={formPerfil.telefone} onChange={(e) => setFormPerfil({ ...formPerfil, telefone: e.target.value })} /></div>
                  <div className="space-y-1.5"><Label className="text-[11px]">Email</Label><Input type="email" value={formPerfil.email} onChange={(e) => setFormPerfil({ ...formPerfil, email: e.target.value })} /></div>
                  <div className="space-y-1.5 sm:col-span-2"><Label className="text-[11px]">Endereço</Label><Input value={formPerfil.endereco} onChange={(e) => setFormPerfil({ ...formPerfil, endereco: e.target.value })} /></div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-lg bg-muted p-3"><p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Nome</p><p className="font-semibold mt-0.5">{escritorio.nome}</p></div>
                  <div className="rounded-lg bg-muted p-3"><p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">CNPJ</p><p className="font-mono mt-0.5">{escritorio.cnpj || "—"}</p></div>
                  <div className="rounded-lg bg-muted p-3"><p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Telefone</p><p className="font-mono mt-0.5">{escritorio.telefone || "—"}</p></div>
                  <div className="rounded-lg bg-muted p-3"><p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Email</p><p className="mt-0.5">{escritorio.email || "—"}</p></div>
                  {escritorio.endereco && <div className="rounded-lg bg-muted p-3 col-span-2"><p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Endereço</p><p className="mt-0.5">{escritorio.endereco}</p></div>}
                </div>
              )}
            </div>
          </details>

          {/* Section 2: Horários */}
          <details open className="card group rounded-2xl bg-card border border-border overflow-hidden">
            <summary className="px-5 py-3.5 border-b border-border flex items-center justify-between cursor-pointer list-none">
              <div className="flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-lg bg-warning-bg text-warning-fg flex items-center justify-center"><Clock className="h-4 w-4" /></span>
                <div>
                  <p className="text-sm font-bold tracking-tight">Horários de atendimento</p>
                  <p className="text-[10.5px] text-muted-foreground">
                    {escritorio.horarioAbertura}–{escritorio.horarioFechamento} · {(escritorio.diasFuncionamento || []).length} dias/sem · {escritorio.fusoHorario}
                  </p>
                </div>
              </div>
              <ChevronDown className="h-4 w-4 text-muted-foreground/70 group-open:rotate-180 transition-transform" />
            </summary>
            <div className="p-5 space-y-4">
              {editMode ? (
                <>
                  <div className="space-y-1.5">
                    <Label className="text-[11px]">Fuso horário</Label>
                    <Select value={formPerfil.fusoHorario || FUSO_HORARIO_PADRAO} onValueChange={(v) => setFormPerfil({ ...formPerfil, fusoHorario: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {FUSOS_HORARIOS.map((f) => (<SelectItem key={f.valor} value={f.valor}><span className="font-medium">{f.utc}</span><span className="text-muted-foreground"> — {f.label}</span></SelectItem>))}
                      </SelectContent>
                    </Select>
                    <p className="text-[10.5px] text-muted-foreground">Usado nos gatilhos e condições com horário (SmartFlow).</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5"><Label className="text-[11px]">Abertura</Label><Input type="time" value={formPerfil.horarioAbertura} onChange={(e) => setFormPerfil({ ...formPerfil, horarioAbertura: e.target.value })} /></div>
                    <div className="space-y-1.5"><Label className="text-[11px]">Fechamento</Label><Input type="time" value={formPerfil.horarioFechamento} onChange={(e) => setFormPerfil({ ...formPerfil, horarioFechamento: e.target.value })} /></div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[11px]">Dias de funcionamento</Label>
                    <div className="flex gap-1.5 flex-wrap">
                      {DIAS_SEMANA.map((d) => (
                        <button key={d.key} type="button" onClick={() => toggleDia(d.key)} className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${formPerfil.diasFuncionamento?.includes(d.key) ? "bg-info text-info-on border-info/30" : "bg-card text-muted-foreground border-border hover:border-border"}`}>{d.label}</button>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <div className="grid grid-cols-7 gap-1.5">
                  {DIAS_SEMANA.map((d) => {
                    const ativo = (escritorio.diasFuncionamento || []).includes(d.key);
                    return (
                      <div key={d.key} className="text-center">
                        <p className="text-[10px] font-bold text-muted-foreground mb-1 uppercase">{d.label}</p>
                        <div className={`rounded-lg p-2 ${ativo ? "bg-success-bg border border-success/30" : "bg-muted border border-border"}`}>
                          {ativo ? (
                            <>
                              <p className="text-[11px] font-bold tabular-nums">{escritorio.horarioAbertura}</p>
                              <p className="text-[9px] text-muted-foreground/70">–</p>
                              <p className="text-[11px] font-bold tabular-nums">{escritorio.horarioFechamento}</p>
                            </>
                          ) : (
                            <p className="text-[10px] text-muted-foreground/70 py-1">Fechado</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </details>

          {/* Section 2.5: Agenda automática */}
          <details className="card group rounded-2xl bg-card border border-border overflow-hidden">
            <summary className="px-5 py-3.5 border-b border-border flex items-center justify-between cursor-pointer list-none">
              <div className="flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-lg bg-warning-bg text-warning-fg flex items-center justify-center"><Calendar className="h-4 w-4" /></span>
                <div>
                  <p className="text-sm font-bold tracking-tight">Agenda automática</p>
                  <p className="text-[10.5px] text-muted-foreground">Quem fica com os agendamentos do atendente IA quando não há responsável</p>
                </div>
              </div>
              <ChevronDown className="h-4 w-4 text-muted-foreground/70 group-open:rotate-180 transition-transform" />
            </summary>
            <div className="p-5 space-y-2">
              {(() => {
                const colabs = (equipeData?.colaboradores || []).filter((c: any) => c.ativo);
                const padraoId = (escritorio as any).agendaResponsavelPadraoId ?? null;
                const padraoColab = padraoId ? colabs.find((c: any) => c.id === padraoId) : null;
                const nomePadrao = padraoColab?.userName || "Dono do escritório (padrão)";
                return editMode ? (
                  <div className="space-y-1.5">
                    <Label className="text-[11px]">Responsável padrão da agenda</Label>
                    <Select
                      value={formPerfil.agendaResponsavelPadraoId ? String(formPerfil.agendaResponsavelPadraoId) : "_dono"}
                      onValueChange={(v) => setFormPerfil({ ...formPerfil, agendaResponsavelPadraoId: v === "_dono" ? null : Number(v) })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_dono">Dono do escritório (padrão)</SelectItem>
                        {colabs.map((c: any) => (
                          <SelectItem key={c.id} value={String(c.id)}>{c.userName ?? "—"} <span className="text-muted-foreground text-[10px]">({c.cargo})</span></SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-[10.5px] text-muted-foreground">Usado quando o Atendente IA está em modo automático e a conversa não tem atendente nem o contato tem responsável. Vazio = dono do escritório.</p>
                  </div>
                ) : (
                  <div className="rounded-lg bg-muted p-3">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">🗓 Responsável padrão</p>
                    <p className="text-[12px] font-medium text-foreground">{nomePadrao}</p>
                  </div>
                );
              })()}
            </div>
          </details>

          {/* Section 3: Mensagens automáticas */}
          <details className="card group rounded-2xl bg-card border border-border overflow-hidden">
            <summary className="px-5 py-3.5 border-b border-border flex items-center justify-between cursor-pointer list-none">
              <div className="flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-lg bg-info-bg text-info-fg flex items-center justify-center"><MessageCircle className="h-4 w-4" /></span>
                <div>
                  <p className="text-sm font-bold tracking-tight">Mensagens automáticas</p>
                  <p className="text-[10.5px] text-muted-foreground">Boas-vindas e fora do horário</p>
                </div>
              </div>
              <ChevronDown className="h-4 w-4 text-muted-foreground/70 group-open:rotate-180 transition-transform" />
            </summary>
            <div className="p-5 space-y-3">
              {editMode ? (
                <>
                  <div className="space-y-1.5"><Label className="text-[11px]">Mensagem de boas-vindas (primeiro contato)</Label><Textarea placeholder="Olá! Bem-vindo ao escritório..." rows={3} value={formPerfil.mensagemBoasVindas} onChange={(e) => setFormPerfil({ ...formPerfil, mensagemBoasVindas: e.target.value })} /></div>
                  <div className="space-y-1.5"><Label className="text-[11px]">Mensagem de ausência (fora do horário)</Label><Textarea placeholder="No momento estamos fora do horário..." rows={3} value={formPerfil.mensagemAusencia} onChange={(e) => setFormPerfil({ ...formPerfil, mensagemAusencia: e.target.value })} /></div>
                  <div className="rounded-lg border border-border p-3 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[12px] font-semibold">Dividir respostas longas do robô</p>
                        <p className="text-[10.5px] text-muted-foreground">Envia a resposta da IA/SmartFlow em mensagens menores, com pausa e "digitando…" entre elas — como um atendente humano. O envio manual nunca é dividido.</p>
                      </div>
                      <Switch checked={!!formPerfil.msgDividirRespostas} onCheckedChange={(v) => setFormPerfil({ ...formPerfil, msgDividirRespostas: v })} />
                    </div>
                    {formPerfil.msgDividirRespostas && (
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label className="text-[11px]">Máximo de mensagens</Label>
                          <Select value={String(formPerfil.msgDividirMax ?? 4)} onValueChange={(v) => setFormPerfil({ ...formPerfil, msgDividirMax: Number(v) })}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="2">2 mensagens</SelectItem>
                              <SelectItem value="3">3 mensagens</SelectItem>
                              <SelectItem value="4">4 mensagens</SelectItem>
                              <SelectItem value="5">5 mensagens</SelectItem>
                              <SelectItem value="6">6 mensagens</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[11px]">Ritmo</Label>
                          <Select value={formPerfil.msgDividirRitmo ?? "natural"} onValueChange={(v) => setFormPerfil({ ...formPerfil, msgDividirRitmo: v })}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="rapido">Rápido (0,5–1,5s)</SelectItem>
                              <SelectItem value="natural">Natural (1–3s)</SelectItem>
                              <SelectItem value="calmo">Calmo (2–5s)</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div className="rounded-lg bg-muted p-3">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">📨 Boas-vindas</p>
                    <p className="text-[11.5px] text-foreground italic">"{escritorio.mensagemBoasVindas || "Sem mensagem configurada"}"</p>
                  </div>
                  <div className="rounded-lg bg-muted p-3">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">🌙 Fora do horário</p>
                    <p className="text-[11.5px] text-foreground italic">"{escritorio.mensagemAusencia || "Sem mensagem configurada"}"</p>
                  </div>
                  <div className="rounded-lg bg-muted p-3">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">💬 Divisão de respostas do robô</p>
                    <p className="text-[11.5px] text-foreground">
                      {(escritorio as any).msgDividirRespostas ?? true
                        ? `Ativada · máx. ${(escritorio as any).msgDividirMax ?? 4} mensagens · ritmo ${
                            ({ rapido: "rápido", natural: "natural", calmo: "calmo" } as any)[(escritorio as any).msgDividirRitmo ?? "natural"]
                          }`
                        : "Desativada — respostas saem num bloco único"}
                    </p>
                  </div>
                </>
              )}
            </div>
          </details>

          {/* Section 4: Backup */}
          {podeFazerBackup && (
            <details className="card group rounded-2xl bg-card border border-border overflow-hidden">
              <summary className="px-5 py-3.5 border-b border-border flex items-center justify-between cursor-pointer list-none">
                <div className="flex items-center gap-2.5">
                  <span className="w-8 h-8 rounded-lg bg-info-bg text-info-fg flex items-center justify-center"><Database className="h-4 w-4" /></span>
                  <div>
                    <p className="text-sm font-bold tracking-tight">Backup e importação</p>
                    <p className="text-[10.5px] text-muted-foreground">Exporte ou restaure todos os dados do escritório</p>
                  </div>
                </div>
                <ChevronDown className="h-4 w-4 text-muted-foreground/70 group-open:rotate-180 transition-transform" />
              </summary>
              <div className="p-5">
                <Button variant="outline" onClick={() => setBackupDialogOpen(true)}>
                  <Database className="h-3.5 w-3.5 mr-1.5" /> Abrir backup
                </Button>
              </div>
            </details>
          )}

          {/* Save/cancel sticky em edit mode */}
          {editMode && (
            <div className="flex gap-2 sticky bottom-4 bg-card p-3 rounded-xl border border-border shadow-md">
              <Button onClick={() => atualizarMut.mutate(formPerfil)} disabled={atualizarMut.isPending}>
                {atualizarMut.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle className="h-4 w-4 mr-2" />} Salvar alterações
              </Button>
              <Button variant="ghost" onClick={() => setEditMode(false)}>Cancelar</Button>
            </div>
          )}
        </TabsContent>

        {/* ─── Equipe — busca + chips + cards ricos ─────────────────── */}
        <TabsContent value="equipe" className="space-y-4">
          {(() => {
            const colaboradoresAtivos = equipeData?.colaboradores || [];
            const inativos = removidos.length;
            const todos = colaboradoresAtivos.length + inativos;
            // Filtro client-side (a lista cabe inteira) + busca normalizada
            const normalizar = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
            const buscaN = normalizar(buscaEquipe);
            const listaFiltrada = colaboradoresAtivos.filter((c: any) => {
              if (filtroEquipe === "inativos") return false; // inativos só aparecem na seção separada
              if (filtroEquipe === "convites") return false; // convites são outra seção
              if (filtroEquipe === "ativos" && !c.ativo) return false;
              if (!buscaN) return true;
              return [c.userName, c.userEmail, c.cargo, c.setorNome, c.departamento].some(
                (v) => v && normalizar(String(v)).includes(buscaN),
              );
            });
            return (
              <>
                {/* Header: contagem + botão Convidar */}
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <h3 className="text-base font-bold tracking-tight">Equipe</h3>
                    <p className="text-[11px] text-muted-foreground">
                      <b className="text-foreground">{equipeData?.total ?? 0}</b> ativos · limite plano {equipeData?.limite ?? 0}
                      {(equipeData?.extras ?? 0) > 0 && (
                        <> · <b className="text-warning-fg">{equipeData?.extras}</b> extras × R$ {CUSTO_COLABORADOR_EXTRA.toFixed(2)}</>
                      )}
                      {inativos > 0 && <> · <b className="text-muted-foreground">{inativos}</b> removidos</>}
                    </p>
                  </div>
                  {canEdit && (
                    <Button
                      size="sm"
                      className="bg-info shadow-sm"
                      onClick={() => {
                        // foca o input do email — já tem form de convite mais abaixo
                        const el = document.getElementById("convite-email-input");
                        el?.scrollIntoView({ behavior: "smooth", block: "center" });
                        (el as HTMLInputElement | null)?.focus();
                      }}
                    >
                      <UserPlus className="h-3.5 w-3.5 mr-1.5" /> Convidar colaborador
                    </Button>
                  )}
                </div>

                {/* Busca + chips */}
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="relative flex-1 min-w-[240px] max-w-md">
                    <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/70" />
                    <Input
                      placeholder="Buscar por nome, email, cargo…"
                      value={buscaEquipe}
                      onChange={(e) => setBuscaEquipe(e.target.value)}
                      className="pl-9 h-9 bg-card"
                    />
                  </div>
                  <div className="flex gap-1.5 flex-wrap">
                    {[
                      { id: "todos", label: "Todos", count: todos },
                      { id: "ativos", label: "Ativos", count: colaboradoresAtivos.filter((c: any) => c.ativo).length },
                      { id: "convites", label: "Convites", count: 0, color: "amber" },
                      { id: "inativos", label: "Removidos", count: inativos },
                    ].map((chip) => {
                      const active = filtroEquipe === chip.id;
                      const isAmber = (chip as any).color === "amber";
                      return (
                        <button
                          key={chip.id}
                          type="button"
                          onClick={() => setFiltroEquipe(chip.id as any)}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all ${
                            active
                              ? isAmber
                                ? "bg-warning text-warning-on border-warning/30 shadow-sm"
                                : "bg-foreground/80 text-background border-border shadow-sm"
                              : isAmber
                                ? "bg-warning-bg text-warning-fg border-warning/30 hover:bg-warning-bg"
                                : "bg-card text-muted-foreground border-border hover:border-border"
                          }`}
                        >
                          {chip.label}
                          <span className={`tabular-nums ${active ? "text-white/85" : "text-muted-foreground/70"}`}>
                            {chip.count}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Grid de cards */}
                {filtroEquipe === "inativos" ? null : (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {listaFiltrada.length === 0 ? (
                      <p className="col-span-full text-center text-[12px] text-muted-foreground/70 italic py-6">
                        Nenhum colaborador bate com a busca.
                      </p>
                    ) : (
                      listaFiltrada.map((c: any) => {
                        const nome = c.userName || c.userEmail || "Colaborador";
                        const isDono2 = c.cargo === "dono";
                        const corBorda = isDono2
                          ? "border-l-info"
                          : c.cargo === "gestor"
                            ? "border-l-info"
                            : c.cargo === "atendente"
                              ? "border-l-info"
                              : c.cargo === "sdr"
                                ? "border-l-warning"
                                : "border-l-muted-foreground/40";
                        return (
                          <div
                            key={c.id}
                            className={`rounded-xl bg-card border border-border border-l-[3px] ${corBorda} hover:shadow-[0_4px_12px_-2px_rgb(0,0,0,0.06)] transition-all ${!c.ativo ? "opacity-65" : ""}`}
                          >
                            <div className="p-3">
                              <div className="flex items-start gap-2.5">
                                <span className={`w-11 h-11 rounded-full flex items-center justify-center text-[12px] font-bold text-white shrink-0 bg-gradient-to-br ${gradientAvatar(nome)}`}>
                                  {gerarIniciais(nome)}
                                </span>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    <p className="text-xs font-bold truncate" title={nome}>{nome}</p>
                                    {c.ativo && <span className="w-1.5 h-1.5 rounded-full bg-success" title="Ativo" />}
                                  </div>
                                  <p className="text-[10px] text-muted-foreground truncate" title={c.userEmail}>{c.userEmail || "—"}</p>
                                  <div className="mt-1.5">
                                    <CargoBadge
                                      cargo={c.cargo as CargoColaborador}
                                      nomePersonalizado={(c as any).cargoPersonalizadoNome}
                                      cor={(c as any).cargoPersonalizadoCor}
                                    />
                                  </div>
                                </div>
                              </div>

                              {/* Métricas inline */}
                              <div className="grid grid-cols-3 gap-1 mt-3 pt-3 border-t border-border text-[10px]">
                                <div>
                                  <p className="text-muted-foreground/70 uppercase tracking-wider text-[9px]">Setor</p>
                                  <p className="font-semibold truncate" title={c.setorNome || c.departamento || "Todos"}>{c.setorNome || c.departamento || "—"}</p>
                                </div>
                                <div>
                                  <p className="text-muted-foreground/70 uppercase tracking-wider text-[9px]">Max atend.</p>
                                  <p className="font-semibold tabular-nums">{c.maxAtendimentosSimultaneos == null ? "Sem limite" : c.maxAtendimentosSimultaneos}</p>
                                </div>
                                <div>
                                  <p className="text-muted-foreground/70 uppercase tracking-wider text-[9px]">Leads auto</p>
                                  <p className={`font-semibold ${c.recebeLeadsAutomaticos ? "text-success-fg" : "text-muted-foreground/70"}`}>
                                    {c.recebeLeadsAutomaticos ? "Sim" : "Não"}
                                  </p>
                                </div>
                              </div>

                              {/* Ações */}
                              {(canEdit || isDono) && c.ativo && (
                                <div className="flex items-center justify-end gap-1 mt-2 pt-2 border-t border-border">
                                  {canEdit && c.cargo !== "dono" && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-7 text-[10px] rounded-md text-info-fg hover:bg-info-bg px-2"
                                      title="Editar cargo, setor e atendimento"
                                      onClick={() => abrirEditColab(c)}
                                    >
                                      <Pencil className="h-3 w-3 mr-1" />Editar
                                    </Button>
                                  )}
                                  {isDono && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-7 text-[10px] rounded-md text-info-fg hover:bg-info-bg px-2"
                                      title="Diagnóstico de permissões"
                                      onClick={() => setDiagColabId(c.id)}
                                    >
                                      <Stethoscope className="h-3 w-3 mr-1" />Permissões
                                    </Button>
                                  )}
                                  {isDono && c.cargo !== "dono" && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-7 text-[10px] rounded-md text-danger-fg hover:bg-danger-bg px-2"
                                      onClick={() => {
                                        if (confirm(`Remover ${nome}?`)) removerColabMut.mutate({ colaboradorId: c.id });
                                      }}
                                    >
                                      <Trash2 className="h-3 w-3 mr-1" />Remover
                                    </Button>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}

                {filtroEquipe === "convites" && (
                  <div className="rounded-xl border border-dashed border-warning/30 bg-warning-bg/40 p-6 text-center">
                    <p className="text-[12px] text-warning-fg font-semibold">📨 Convites pendentes</p>
                    <p className="text-[10.5px] text-warning-fg/85 mt-1">
                      Use o formulário abaixo pra convidar. Convites enviados via link ficam ativos até serem aceitos.
                    </p>
                  </div>
                )}
              </>
            );
          })()}

          {/* Colaboradores removidos — soft delete reversível */}
          {removidos.length > 0 && isDono && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <span className="text-warning-fg">🗑</span>
                  Removidos ({removidos.length})
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  Colaboradores excluídos por engano podem ser restaurados aqui.
                  O histórico (cards, comentários, atribuições) é preservado.
                </p>
              </CardHeader>
              <CardContent className="space-y-2">
                {removidos.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between gap-3 p-3 rounded-lg border bg-muted/30"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {r.userName || r.userEmail || `#${r.id}`}
                      </p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {r.userEmail} · cargo: {r.cargo} ·{" "}
                        Removido em{" "}
                        {r.removidoEm
                          ? new Date(r.removidoEm).toLocaleDateString("pt-BR", {
                              day: "2-digit",
                              month: "2-digit",
                              year: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "—"}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => restaurarColabMut.mutate({ colaboradorId: r.id })}
                      disabled={restaurarColabMut.isPending}
                    >
                      Restaurar
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

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
                    <Input id="convite-email-input" type="email" placeholder="colaborador@email.com" value={conviteEmail} onChange={(e) => setConviteEmail(e.target.value)} />
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
                  <div className="rounded-lg bg-success-bg border border-success/30 p-3 space-y-2">
                    <p className="text-xs font-medium text-success-fg flex items-center gap-1"><CheckCircle className="h-3.5 w-3.5" /> Convite criado! Compartilhe o link:</p>
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
                          className="text-[10px] bg-danger-bg text-danger-fg border-danger/30 shrink-0"
                          title={(conv as any).ultimoErroEmail || "Email não enviado"}
                        >
                          email falhou
                        </Badge>
                      )}
                      {conv.status === "pendente" && (conv as any).emailEnviado === false && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="shrink-0 text-info-fg"
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

          {/* Setores (departamentos) */}
          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Building2 className="h-4 w-4" /> Setores
              </CardTitle>
              {canEdit && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setSetorDialog({ nome: "", descricao: "", cor: "#6366f1", tipo: "outro" })}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Novo setor
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {setoresList && setoresList.length > 0 ? (
                <div className="space-y-2">
                  {setoresList.map((s) => (
                    <div key={s.id} className="flex items-center gap-3 p-3 rounded-lg border">
                      <div className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: s.cor }} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium">{s.nome}</p>
                          {(s as any).tipo && (s as any).tipo !== "outro" && (
                            <Badge variant="outline" className="text-[9px] uppercase">
                              {(s as any).tipo}
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {s.totalColaboradores} colaborador(es)
                          {s.descricao ? ` · ${s.descricao}` : ""}
                        </p>
                      </div>
                      {canEdit && (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setSetorDialog({
                              id: s.id,
                              nome: s.nome,
                              descricao: s.descricao || "",
                              cor: s.cor || "#6366f1",
                              tipo: (s as any).tipo || "outro",
                            })}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive"
                            onClick={() => {
                              if (confirm(`Excluir o setor "${s.nome}"? Colaboradores ficarão sem setor.`)) {
                                excluirSetorMut.mutate({ setorId: s.id });
                              }
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-center text-sm text-muted-foreground py-4">
                  Nenhum setor cadastrado. Crie setores pra agrupar colaboradores em relatórios.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Canais de Comunicação ──────────────────────────── */}
        <TabsContent value="canais" className="space-y-4">
          <CanaisTab canEdit={canEdit} isDono={isDono} />
          <LigacaoConfigCard canEdit={canEdit} />
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

        <TabsContent value="templates" className="space-y-4">
          <TemplatesTab />
        </TabsContent>

        {podeVerMeuPlano && (
          <TabsContent value="meu-plano" className="space-y-4">
            {/* `Plans` é a página antiga `/plans` reaproveitada como aba.
                Tem layout próprio (max-w + padding) — fica OK aqui. */}
            <Plans />
          </TabsContent>
        )}

          </div>{/* fim do conteúdo das abas */}
        </div>{/* fim do grid sidebar+content */}
      </Tabs>

      <BackupDialog open={backupDialogOpen} onOpenChange={setBackupDialogOpen} />

      <Dialog open={!!editandoColab} onOpenChange={(o) => { if (!o) setEditandoColab(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Editar colaborador</DialogTitle>
          </DialogHeader>
          {editandoColab && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Nome completo</Label>
                <Input
                  value={editColabNome}
                  onChange={(e) => setEditColabNome(e.target.value)}
                  maxLength={255}
                  placeholder="Nome do colaborador"
                />
                <p className="text-[10px] text-muted-foreground">
                  Aparece na equipe, nos relatórios e nas atribuições. A pessoa também pode mudar no próprio perfil.
                </p>
                <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2">
                  <span className="text-xs text-muted-foreground">{editandoColab.userEmail || "—"}</span>
                  <Badge variant="outline" className="text-[9px] text-muted-foreground">login · não muda aqui</Badge>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Cargo (função)</Label>
                <Select
                  value={editColabCargoPersonalizadoId ? String(editColabCargoPersonalizadoId) : ""}
                  onValueChange={(v) => setEditColabCargoPersonalizadoId(v ? parseInt(v, 10) : null)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione um cargo" />
                  </SelectTrigger>
                  <SelectContent>
                    {(cargosList || [])
                      .filter((c) => c.nome !== "Dono")
                      .map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground">
                  Inclui cargos personalizados criados em Permissões.
                </p>
              </div>

              <div className="space-y-2">
                <Label>Setor / departamento</Label>
                <Select
                  value={editColabSetorId ? String(editColabSetorId) : "__none__"}
                  onValueChange={(v) => setEditColabSetorId(v === "__none__" ? null : parseInt(v, 10))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Sem setor" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Sem setor</SelectItem>
                    {(setoresList || []).map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>
                        {s.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground">
                  Gerencie setores na seção "Setores" abaixo. Usado pra relatórios.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Atendimentos simultâneos</Label>
                  <Input
                    type="number"
                    min={1}
                    max={50}
                    value={editColabMaxAtend ?? ""}
                    disabled={editColabMaxAtend === null}
                    placeholder={editColabMaxAtend === null ? "Sem limite" : undefined}
                    onChange={(e) => setEditColabMaxAtend(parseInt(e.target.value, 10) || 1)}
                  />
                  <label className="flex items-center gap-2 text-[11px] text-muted-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editColabMaxAtend === null}
                      onChange={(e) => setEditColabMaxAtend(e.target.checked ? null : 5)}
                    />
                    Sem limite (recebe sempre no rodízio)
                  </label>
                </div>
                <div className="space-y-2">
                  <Label className="block">Recebe leads auto?</Label>
                  <div className="flex items-center gap-2 h-9">
                    <Switch
                      checked={editColabRecebeLeads}
                      onCheckedChange={setEditColabRecebeLeads}
                    />
                    <span className="text-xs text-muted-foreground">
                      {editColabRecebeLeads ? "Sim" : "Não"}
                    </span>
                  </div>
                </div>
              </div>

              {(() => {
                const setorSelecionado = (setoresList || []).find((s) => s.id === editColabSetorId);
                const ehComercial = (setorSelecionado as any)?.tipo === "comercial";
                if (!ehComercial) return null;
                return (
                  <div className="space-y-2">
                    <Label>Meta mensal de faturamento (R$)</Label>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      placeholder="Ex: 30000"
                      value={editColabMetaMensal}
                      onChange={(e) => setEditColabMetaMensal(e.target.value)}
                    />
                    <p className="text-[10px] text-muted-foreground">
                      Aparece no dashboard Comercial (barra de progresso). Vazio = sem meta.
                    </p>
                  </div>
                );
              })()}

              <div className="border-t pt-3">
                <EditorJornada valor={editColabJornada} onChange={setEditColabJornada} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditandoColab(null)} disabled={atualizarColabMut.isPending}>
              Cancelar
            </Button>
            <Button
              onClick={() => {
                if (!editandoColab) return;
                const metaParsed = editColabMetaMensal.trim() === ""
                  ? null
                  : parseFloat(editColabMetaMensal.replace(",", "."));
                const nomeNovo = editColabNome.trim();
                atualizarColabMut.mutate({
                  colaboradorId: editandoColab.id,
                  ...(nomeNovo && nomeNovo !== (editandoColab.userName ?? "") ? { nome: nomeNovo } : {}),
                  cargoPersonalizadoId: editColabCargoPersonalizadoId,
                  setorId: editColabSetorId,
                  maxAtendimentosSimultaneos: editColabMaxAtend,
                  recebeLeadsAutomaticos: editColabRecebeLeads,
                  metaMensal: metaParsed != null && Number.isFinite(metaParsed) ? metaParsed : null,
                  jornadaSemanal: editColabJornada,
                });
              }}
              disabled={atualizarColabMut.isPending}
            >
              {atualizarColabMut.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!setorDialog} onOpenChange={(o) => { if (!o) setSetorDialog(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{setorDialog?.id ? "Editar setor" : "Novo setor"}</DialogTitle>
          </DialogHeader>
          {setorDialog && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Nome *</Label>
                <Input
                  value={setorDialog.nome}
                  onChange={(e) => setSetorDialog({ ...setorDialog, nome: e.target.value })}
                  placeholder="Ex: Comercial, Jurídico, Atendimento..."
                  maxLength={64}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Descrição (opcional)</Label>
                <Input
                  value={setorDialog.descricao}
                  onChange={(e) => setSetorDialog({ ...setorDialog, descricao: e.target.value })}
                  placeholder="O que esse setor faz?"
                  maxLength={255}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Tipo</Label>
                <Select
                  value={setorDialog.tipo}
                  onValueChange={(v) => setSetorDialog({ ...setorDialog, tipo: v as any })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="comercial">Comercial (vendas/fechamento)</SelectItem>
                    <SelectItem value="operacional">Operacional (produção/tarefas)</SelectItem>
                    <SelectItem value="suporte">Suporte</SelectItem>
                    <SelectItem value="financeiro">Financeiro</SelectItem>
                    <SelectItem value="outro">Outro</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground">
                  Determina em quais dashboards de Relatórios o setor aparece (Comercial, Produção).
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>Cor</Label>
                <Input
                  type="color"
                  value={setorDialog.cor}
                  onChange={(e) => setSetorDialog({ ...setorDialog, cor: e.target.value })}
                  className="h-10 w-20 p-1 cursor-pointer"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSetorDialog(null)}
              disabled={criarSetorMut.isPending || atualizarSetorMut.isPending}
            >
              Cancelar
            </Button>
            <Button
              onClick={() => {
                if (!setorDialog) return;
                const nome = setorDialog.nome.trim();
                if (nome.length < 2) {
                  toast.error("Nome muito curto (mín. 2 chars)");
                  return;
                }
                if (setorDialog.id) {
                  atualizarSetorMut.mutate({
                    setorId: setorDialog.id,
                    nome,
                    descricao: setorDialog.descricao.trim() || null,
                    cor: setorDialog.cor,
                    tipo: setorDialog.tipo,
                  });
                } else {
                  criarSetorMut.mutate({
                    nome,
                    descricao: setorDialog.descricao.trim() || undefined,
                    cor: setorDialog.cor,
                    tipo: setorDialog.tipo,
                  });
                }
              }}
              disabled={criarSetorMut.isPending || atualizarSetorMut.isPending}
            >
              {(criarSetorMut.isPending || atualizarSetorMut.isPending) && (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              )}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Diagnóstico de permissões efetivas ─────────────────────────── */}
      <Dialog open={!!diagColabId} onOpenChange={(open) => !open && setDiagColabId(null)}>
        <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Stethoscope className="h-5 w-5" />
              Permissões efetivas
            </DialogTitle>
            <p className="text-xs text-muted-foreground">
              O que o backend realmente enxerga pra este colaborador. Útil
              quando "está marcado mas não funciona".
            </p>
          </DialogHeader>
          {diagLoading && (
            <div className="flex items-center gap-2 py-8 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Carregando...</span>
            </div>
          )}
          {!diagLoading && diagData && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm border rounded-lg p-3 bg-muted/30">
                <div>
                  <p className="text-[11px] text-muted-foreground uppercase">Cargo (enum)</p>
                  <p className="font-medium">{diagData.colaborador.cargo}</p>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground uppercase">cargoPersonalizadoId</p>
                  <p className="font-mono text-xs">{diagData.colaborador.cargoPersonalizadoId ?? "null"}</p>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground uppercase">Cargo resolvido</p>
                  <p className="font-medium">{diagData.cargo?.nome ?? "—"} {diagData.cargo?.isDefault ? "(default)" : diagData.cargo ? "(custom)" : ""}</p>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground uppercase">Resolvido via</p>
                  <p className="font-mono text-xs">{diagData.cargoResolvidoVia}</p>
                </div>
              </div>

              {diagData.cargoResolvidoVia === "nome-fallback" && (
                <div className="border border-warning/30 bg-warning/10 rounded-lg p-3 text-xs">
                  <p className="font-medium text-warning-fg">⚠ Vínculo fraco</p>
                  <p className="text-muted-foreground">
                    O <code>cargoPersonalizadoId</code> está null no colaborador. O cargo está sendo resolvido pelo nome
                    (lookup em <code>cargosPersonalizados</code>). Se houver mais de um cargo com mesmo nome, pode pegar o "errado".
                    Pra corrigir, edite o colaborador e atribua o cargo explicitamente.
                  </p>
                </div>
              )}

              <div>
                <h4 className="text-sm font-semibold mb-2">Matriz efetiva por módulo</h4>
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left px-2 py-1.5 font-medium">Módulo</th>
                        <th className="px-2 py-1.5 font-medium">Ver Todos</th>
                        <th className="px-2 py-1.5 font-medium">Ver Próprios</th>
                        <th className="px-2 py-1.5 font-medium">Criar</th>
                        <th className="px-2 py-1.5 font-medium">Editar</th>
                        <th className="px-2 py-1.5 font-medium">Excluir</th>
                        <th className="px-2 py-1.5 font-medium">DB</th>
                      </tr>
                    </thead>
                    <tbody>
                      {diagData.modulos.map((m) => {
                        const ef = (diagData.efetiva as any)[m];
                        const db = (diagData.permissoesDB as any)[m];
                        const divergencia = db && (
                          ef.verTodos !== db.verTodos ||
                          ef.verProprios !== db.verProprios ||
                          ef.criar !== db.criar ||
                          ef.editar !== db.editar ||
                          ef.excluir !== db.excluir
                        );
                        const cell = (v: boolean) => (
                          <span className={v ? "text-success-fg font-bold" : "text-muted-foreground"}>
                            {v ? "✓" : "—"}
                          </span>
                        );
                        return (
                          <tr key={m} className={`border-t ${divergencia ? "bg-warning/5" : ""}`}>
                            <td className="px-2 py-1.5 font-medium">{m}</td>
                            <td className="text-center">{cell(ef.verTodos)}</td>
                            <td className="text-center">{cell(ef.verProprios)}</td>
                            <td className="text-center">{cell(ef.criar)}</td>
                            <td className="text-center">{cell(ef.editar)}</td>
                            <td className="text-center">{cell(ef.excluir)}</td>
                            <td className="text-center text-[10px] text-muted-foreground">
                              {db ? "ok" : <span className="text-warning-fg">sem row</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="text-[10px] text-muted-foreground mt-2">
                  Linhas com fundo âmbar indicam divergência entre matriz DB e a permissão efetiva.
                  Coluna "DB" = "sem row" indica que o cargo não tem entry pra esse módulo (cargo criado antes do módulo existir).
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDiagColabId(null)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Canais de Comunicação Tab ──────────────────────────────────────────────

function CanaisTab({ canEdit, isDono }: { canEdit: boolean; isDono: boolean }) {
  // Estado do dialog Meta: além do tipo de canal, guarda canalId opcional.
  // canalId definido → editando canal específico (entre os múltiplos).
  // canalId undefined → conectando NOVO canal (caso de "+ Adicionar outro").
  const [metaDialog, setMetaDialog] = useState<{
    type: "whatsapp" | "instagram" | "messenger";
    canalId?: number;
  } | null>(null);
  // Dialog separado: cadastro manual de WhatsApp Cloud API. Bypassa o
  // Embedded Signup (usado quando OAuth tá bloqueado — App Review pendente,
  // BM dona do app coincide com a dos números, etc).
  const [manualWhatsappOpen, setManualWhatsappOpen] = useState(false);
  // Confirmação de exclusão de canal direto do card (sem precisar abrir o
  // dialog grande pra clicar em Desconectar — caso clássico do canal com
  // erro que o usuário só quer apagar e refazer).
  const [excluirCanalInfo, setExcluirCanalInfo] = useState<{ id: number; nome: string } | null>(null);
  const excluirCanalMut = trpc.configuracoes.excluirCanal.useMutation({
    onSuccess: () => { toast.success("Canal excluído."); refetch(); setExcluirCanalInfo(null); },
    onError: (e: any) => toast.error(e.message),
  });
  const definirPadraoEnvioMut = trpc.configuracoes.definirCanalPadraoEnvio.useMutation({
    onSuccess: () => { toast.success("Número de envio atualizado."); refetch(); },
    onError: (e: any) => toast.error(e.message),
  });
  const { data: canaisData, refetch } = trpc.configuracoes.listarCanais.useQuery();

  const canais = canaisData?.canais || [];
  // WhatsApp API agora suporta MÚLTIPLOS canais (escritório pode conectar
  // vários números). Filtramos só os válidos (status conectado + telefone),
  // os órfãos do Embedded Signup ficam de fora.
  const whatsappCanais = canais.filter(
    (c: any) => c.tipo === "whatsapp_api" && c.status === "conectado" && !!c.telefone,
  );
  const whatsappComErro = canais.filter(
    (c: any) => c.tipo === "whatsapp_api" && c.status === "erro" && !!c.mensagemErro,
  );
  const instagramCanal = canais.find(c => c.tipo === "instagram");
  const facebookCanal = canais.find(c => c.tipo === "facebook");

  // Cards principais: Embedded Signup (fluxo moderno).
  // WhatsApp expande em N cards (1 por número conectado) + 1 card "Adicionar".
  // Instagram/Messenger continuam single (Meta permite só 1 página por app).
  type CardCanal = {
    key: string;
    dialog: { type: "whatsapp" | "instagram" | "messenger"; canalId?: number };
    nome: string;
    descricao: string;
    logo: string;
    cor: string;
    canal: any;
    conectado: boolean;
    comErro: boolean;
    /** Card de "+ Adicionar outro" — renderiza estilo tracejado. */
    isAdicionar?: boolean;
  };

  const cardsWhatsApp: CardCanal[] = whatsappCanais.map((c: any) => ({
    key: `whatsapp-${c.id}`,
    dialog: { type: "whatsapp", canalId: c.id },
    nome: "WhatsApp Business",
    descricao: c.telefone ? `Número: ${c.telefone}` : "Conectado",
    logo: "💬",
    cor: "from-success to-success",
    canal: c,
    conectado: true,
    comErro: false,
  }));

  // Card de erro: se existir canal com erro real, mostra acima do "+ Adicionar"
  for (const e of whatsappComErro) {
    cardsWhatsApp.push({
      key: `whatsapp-err-${e.id}`,
      dialog: { type: "whatsapp", canalId: e.id },
      nome: "WhatsApp Business",
      descricao: e.telefone || "Sem número",
      logo: "💬",
      cor: "from-success to-success",
      canal: e,
      conectado: false,
      comErro: true,
    });
  }

  // Card "Adicionar outro WhatsApp" sempre presente — clicar abre dialog
  // sem canalId, o que dispara fluxo de conexão de número novo.
  cardsWhatsApp.push({
    key: "whatsapp-novo",
    dialog: { type: "whatsapp" },
    nome: whatsappCanais.length === 0 ? "WhatsApp Business" : "Adicionar outro WhatsApp",
    descricao:
      whatsappCanais.length === 0
        ? "Conecte seu WhatsApp com 1 clique via Facebook. API oficial, sem risco de banimento."
        : "Conecte mais um número WhatsApp Business neste escritório.",
    logo: "💬",
    cor: "from-success to-success",
    canal: undefined,
    conectado: false,
    comErro: false,
    isAdicionar: whatsappCanais.length > 0,
  });

  const canaisPrincipais: CardCanal[] = [
    ...cardsWhatsApp,
    {
      key: "instagram",
      dialog: { type: "instagram" },
      nome: "Instagram Business",
      descricao: "DMs do Instagram Business no Inbox. Conecte via Facebook Login.",
      logo: "📸",
      cor: "from-danger to-danger",
      canal: instagramCanal,
      conectado: instagramCanal?.status === "conectado",
      comErro: instagramCanal?.status === "erro",
    },
    {
      key: "messenger",
      dialog: { type: "messenger" },
      nome: "Facebook Messenger",
      descricao: "Mensagens da sua página do Facebook direto no Inbox.",
      logo: "💙",
      cor: "from-info to-info",
      canal: facebookCanal,
      conectado: facebookCanal?.status === "conectado",
      comErro: facebookCanal?.status === "erro",
    },
  ];

  const totalCanaisConectados = canaisPrincipais.filter((c) => c.conectado).length;
  const totalCanaisErro = canaisPrincipais.filter((c) => c.comErro).length;

  return (
    <>
      {/* Header da aba */}
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <div>
          <h3 className="text-base font-bold tracking-tight">Canais de comunicação</h3>
          <p className="text-[11px] text-muted-foreground">
            {canaisPrincipais.length} canais disponíveis ·
            <b className="text-success-fg ml-1">{totalCanaisConectados} conectados</b>
            {totalCanaisErro > 0 && <> · <b className="text-danger-fg">{totalCanaisErro} com erro</b></>}
          </p>
        </div>
      </div>

      {/* Banner explicativo */}
      <div className="rounded-xl border border-info/30 bg-gradient-to-r from-info-bg to-info-bg/50 p-4 mb-4">
        <div className="flex items-start gap-3">
          <div className="h-8 w-8 rounded-lg bg-[#1877F2] flex items-center justify-center text-white shrink-0">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-info-fg">
              Conexão simplificada via Facebook
            </p>
            <p className="text-xs text-info-fg mt-1">
              WhatsApp, Instagram e Messenger se conectam com 1 clique. Sem precisar copiar
              tokens ou IDs manualmente — basta autorizar pelo Facebook Login.
            </p>
            {/* Fallback pra quando OAuth não roda (App Review pendente,
                Tech Provider não aprovado, BM dona do app = dos números).
                Pequeno e discreto pra não competir com o caminho padrão. */}
            <button
              onClick={() => setManualWhatsappOpen(true)}
              className="text-[11px] text-info-fg hover:text-info-fg hover:underline mt-2 inline-flex items-center gap-1"
            >
              <span>📥</span> Ou cadastrar WhatsApp Cloud manualmente (avançado)
            </button>
          </div>
        </div>
      </div>

      {/* Cards principais */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {canaisPrincipais.map((canal) => (
          <Card
            key={canal.key}
            className={`overflow-hidden cursor-pointer hover:shadow-lg transition-all border-2 ${
              canal.isAdicionar
                ? "border-dashed border-success/30 bg-success-bg/30 hover:bg-success-bg/50"
                : canal.conectado
                  ? "border-success/30"
                  : canal.comErro
                    ? "border-danger/30"
                    : "border-transparent hover:border-primary/20"
            }`}
            onClick={() => setMetaDialog(canal.dialog)}
          >
            <CardContent className="p-5">
              <div className="flex items-start gap-4">
                <div
                  className={`h-14 w-14 rounded-2xl bg-gradient-to-br ${canal.cor} flex items-center justify-center text-2xl shadow-md shrink-0 ${
                    canal.isAdicionar ? "opacity-60" : ""
                  }`}
                >
                  {canal.isAdicionar ? "+" : canal.logo}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <h3 className="font-semibold text-sm">{canal.nome}</h3>
                    {!canal.isAdicionar && canal.conectado && (
                      <Badge
                        variant="outline"
                        className="text-[10px] text-success-fg bg-success-bg border-success/30"
                      >
                        <Wifi className="h-3 w-3 mr-1" />
                        Conectado
                      </Badge>
                    )}
                    {!canal.isAdicionar && canal.comErro && (
                      <Badge
                        variant="outline"
                        className="text-[10px] text-danger-fg bg-danger-bg border-danger/30"
                      >
                        <AlertTriangle className="h-3 w-3 mr-1" />
                        Erro
                      </Badge>
                    )}
                    {!canal.isAdicionar && !canal.conectado && !canal.comErro && (
                      <Badge
                        variant="outline"
                        className="text-[10px] text-muted-foreground bg-muted border-border"
                      >
                        Não conectado
                      </Badge>
                    )}
                    {/* Qualidade do número reportada pela Meta (health-check).
                        GREEN some (sem ruído); YELLOW/RED avisa ANTES do ban. */}
                    {!canal.isAdicionar && canal.conectado && canal.canal?.tipo === "whatsapp_api" &&
                      (canal.canal as any)?.qualidadeMeta &&
                      (canal.canal as any).qualidadeMeta !== "GREEN" && (
                      <Badge
                        variant="outline"
                        className={`text-[10px] ${
                          (canal.canal as any).qualidadeMeta === "RED"
                            ? "text-danger-fg bg-danger-bg border-danger/30"
                            : "text-warning-fg bg-warning-bg border-warning/30"
                        }`}
                      >
                        <AlertTriangle className="h-3 w-3 mr-1" />
                        Qualidade {(canal.canal as any).qualidadeMeta === "RED" ? "baixa" : "média"} na Meta
                      </Badge>
                    )}
                    {/* Número de envio (Cloud API): mostra qual número dispara e
                        deixa trocar quando há mais de um oficial conectado. */}
                    {!canal.isAdicionar && canal.conectado && canal.canal?.tipo === "whatsapp_api" && (
                      canal.canal?.padraoEnvio ? (
                        <Badge
                          variant="outline"
                          className="text-[10px] text-info-fg bg-info-bg border-info/30"
                        >
                          <Send className="h-3 w-3 mr-1" />
                          Número de envio
                        </Badge>
                      ) : whatsappCanais.length > 1 && canEdit ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            definirPadraoEnvioMut.mutate({ canalId: canal.canal!.id });
                          }}
                          disabled={definirPadraoEnvioMut.isPending}
                          className="text-[10px] text-info-fg hover:underline disabled:opacity-50"
                        >
                          Usar p/ envio
                        </button>
                      ) : null
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{canal.descricao}</p>
                </div>
              </div>
              <div className={`mt-4 flex items-center ${canal.comErro && canal.canal?.id ? "justify-between" : "justify-end"}`}>
                {/* Excluir direto do card — só pra cards em ERRO. Pro fluxo
                    normal (canal OK) o usuário usa "Desconectar" dentro do
                    dialog, que é mais explícito sobre as consequências. */}
                {canal.comErro && canal.canal?.id && canEdit && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs text-danger-fg hover:text-danger-fg hover:bg-danger-bg h-7 px-2"
                    onClick={(e) => {
                      e.stopPropagation();
                      setExcluirCanalInfo({ id: canal.canal!.id, nome: canal.nome });
                    }}
                  >
                    <Trash2 className="h-3 w-3 mr-1" /> Excluir
                  </Button>
                )}
                <Button
                  variant={canal.conectado || canal.isAdicionar ? "outline" : "default"}
                  size="sm"
                  className="text-xs"
                >
                  {canal.isAdicionar
                    ? "Conectar novo"
                    : canal.conectado
                      ? "Gerenciar"
                      : canal.comErro
                        ? "Reconectar"
                        : "Conectar"}
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Dialog unificado para WhatsApp/Instagram/Messenger */}
      {metaDialog && (
        <MetaConnectDialog
          open={!!metaDialog}
          onClose={() => setMetaDialog(null)}
          channel={metaDialog.type}
          canal={
            metaDialog.canalId
              ? canais.find((c: any) => c.id === metaDialog.canalId)
              : metaDialog.type === "instagram"
                ? instagramCanal
                : metaDialog.type === "messenger"
                  ? facebookCanal
                  : undefined
          }
          onRefresh={refetch}
          canEdit={canEdit}
        />
      )}

      {/* Dialog: cadastro manual de WhatsApp Cloud (fallback p/ OAuth) */}
      <WhatsappManualDialog
        open={manualWhatsappOpen}
        onClose={() => setManualWhatsappOpen(false)}
        onConectado={() => refetch()}
      />

      {/* Confirmação de excluir canal direto do card de erro */}
      <AlertDialog open={!!excluirCanalInfo} onOpenChange={(o) => { if (!o) setExcluirCanalInfo(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir canal {excluirCanalInfo?.nome}?</AlertDialogTitle>
            <AlertDialogDescription>
              O canal e suas configurações serão removidos. Conversas e mensagens
              passadas ficam preservadas no Atendimento. Você pode reconectar
              criando um novo canal depois.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={excluirCanalMut.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={excluirCanalMut.isPending}
              onClick={() => excluirCanalInfo && excluirCanalMut.mutate({ canalId: excluirCanalInfo.id })}
              className="bg-danger hover:bg-danger focus-visible:ring-danger"
            >
              {excluirCanalMut.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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

  const integracoes = [
    {
      id: "asaas",
      nome: "Asaas",
      descricao: "Cobranças por boleto, Pix e cartão",
      categoria: "Financeiro",
      logo: "💰",
      bgIcon: "bg-info-bg border-info/30",
      conectado: asaasStatus?.conectado || false,
    },
    {
      id: "chatgpt",
      nome: "ChatGPT",
      descricao: "OpenAI · GPT-4o · GPT-4o-mini",
      categoria: "IA",
      logo: "🤖",
      bgIcon: "bg-success-bg border-success/30",
      conectado: chatgptCanal?.status === "conectado",
    },
    {
      id: "claude",
      nome: "Claude",
      descricao: "Anthropic · Claude Sonnet / Haiku",
      categoria: "IA",
      logo: "🦾",
      bgIcon: "bg-warning-bg border-warning/30",
      conectado: claudeCanal?.status === "conectado",
    },
    {
      id: "twilio",
      nome: "Twilio VoIP",
      descricao: "Ligações telefônicas pelo sistema",
      categoria: "Mensageria",
      logo: "📞",
      bgIcon: "bg-info-bg border-info/30",
      conectado: twilioCanal?.status === "conectado",
    },
  ];

  const totalConectadas = integracoes.filter((i) => i.conectado).length;

  return (
    <>
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <div>
          <h3 className="text-base font-bold tracking-tight">Apps externos</h3>
          <p className="text-[11px] text-muted-foreground">
            {integracoes.length} integrações disponíveis ·
            <b className="text-success-fg ml-1">{totalConectadas} conectadas</b>
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {integracoes.map((integ) => (
          <div
            key={integ.id}
            onClick={() => setOpenDialog(integ.id)}
            className={`rounded-xl bg-card border border-border border-l-[3px] ${
              integ.conectado ? "border-l-success" : "border-l-muted-foreground/40"
            } hover:shadow-[0_4px_12px_-2px_rgb(0,0,0,0.08)] transition-all cursor-pointer p-4`}
          >
            <div className="flex items-start gap-3">
              <div className={`w-12 h-12 rounded-xl ${integ.bgIcon} border flex items-center justify-center text-2xl shrink-0`}>
                {integ.logo}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <p className="text-sm font-bold">{integ.nome}</p>
                  {integ.conectado ? (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-success-bg text-success-fg text-[9px] font-bold">
                      <span className="w-1 h-1 rounded-full bg-success" /> Conectada
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground text-[9px] font-bold">
                      <span className="w-1 h-1 rounded-full bg-muted-foreground/50" /> Não configurada
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5">{integ.descricao}</p>
                <p className="text-[9.5px] text-muted-foreground/70 mt-1 uppercase tracking-wider font-semibold">{integ.categoria}</p>
              </div>
            </div>
            <div className="flex gap-1.5 mt-3 pt-3 border-t border-border">
              <Button
                variant={integ.conectado ? "outline" : "default"}
                size="sm"
                className={`flex-1 h-7 text-[10.5px] rounded-md ${
                  integ.conectado
                    ? "border-border hover:bg-muted"
                    : "bg-info-bg text-info-fg hover:bg-info-bg border border-info/30"
                }`}
                onClick={(e) => { e.stopPropagation(); setOpenDialog(integ.id); }}
              >
                {integ.conectado ? "⚙ Gerenciar" : "+ Conectar"}
              </Button>
            </div>
          </div>
        ))}
      </div>

      {/* Dialogs das Integrações */}
      <AsaasDialog open={openDialog === "asaas"} onClose={() => setOpenDialog(null)} canEdit={canEdit} asaasStatus={asaasStatus} onRefresh={refetchAsaas} />
      <TwilioDialog open={openDialog === "twilio"} onClose={() => setOpenDialog(null)} canEdit={canEdit} />
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
const CATEGORIA_CORES: Record<string, string> = { saudacao: "bg-success-bg text-success-fg", cobranca: "bg-warning-bg text-warning-fg", agendamento: "bg-info-bg text-info-fg", juridico: "bg-info-bg text-info-fg", encerramento: "bg-muted text-foreground", outro: "bg-muted text-muted-foreground" };

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


