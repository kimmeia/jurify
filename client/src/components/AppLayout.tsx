import { useAuth } from "@/_core/hooks/useAuth";
import { useNotificacoes } from "@/hooks/useNotificacoes";
import { ChamadaWhatsappProvider } from "@/hooks/whatsapp-call-context";
import NotificacoesSino from "@/components/NotificacoesSino";
import { MarcaJ } from "@/components/MarcaJ";
import { ImpersonationBanner } from "@/components/ImpersonationBanner";
import { trpc } from "@/lib/trpc";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { useIsMobile } from "@/hooks/useMobile";
import {
  LayoutDashboard,
  Calculator,
  LogOut,
  ShieldCheck,
  CreditCard,
  Clock,
  Lock,
  FileSearch,
  Gavel,
  FileText,
  Handshake,
  Headphones,
  CalendarDays,
  Settings,
  Users,
  BarChart3,
  CheckSquare,
  DollarSign,
  Zap,
  LayoutGrid,
  Lightbulb,
  Monitor,
  Smartphone,
  Download,
  Sun,
  Moon,
  Check,
  Search,
} from "lucide-react";
import { CSSProperties, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";
import { Button } from "./ui/button";
import { moduloOcultoNoMenu } from "@/config/visibility";
import { contratoLibera } from "@shared/modulos-contratacao";
import { useTheme } from "@/contexts/ThemeContext";
import { toast } from "sonner";
import { InstalarAppDialog } from "@/components/InstalarAppDialog";
import { PaletaComandos } from "@/components/PaletaComandos";
import { dispararInstalacao, pwaInstalado } from "@/lib/pwa-install";

const SIDEBAR_WIDTH_KEY = "sidebar-width";
const DEFAULT_WIDTH = 260;
const MIN_WIDTH = 200;
const MAX_WIDTH = 420;

/**
 * Ordem e agrupamento do menu.
 *
 * A ordem anterior era a de nascimento dos módulos (Cálculos em 2º, o feed de
 * Movimentações em 8º). Esta agrupa por momento de uso — "o que estou fazendo
 * agora" — e troca 15 itens soltos por 4 blocos de 3 a 4, que é o que o olho
 * varre sem precisar ler item por item.
 */
type ItemMenu = {
  id: string;
  rotulo: string;
  rota: string;
  icone: React.ComponentType<{ className?: string }>;
  /**
   * Quem pode ver. Cada item traz o seu gate porque eles não são uniformes:
   * Acordos herda de "clientes", Automações aceita smartflow OU agentesIa, e
   * Roadmap não passa por permissão nenhuma. Uniformizar aqui esconderia
   * módulo de quem tem acesso.
   */
  ver?: (canSee: (m: string) => boolean, canSeeEstrito: (m: string) => boolean) => boolean;
  /** Chave usada em `moduloOcultoNoMenu`, quando existe. */
  ocultaPor?: string;
  /** Ativo por prefixo (páginas com sub-rotas, como /automacoes/fluxos). */
  prefixo?: boolean;
  tomBadge?: "alerta" | "novidade";
  /** Selo fixo de texto ("beta"). Some quando há contagem: número esperando é
   *  informação viva e ganha do rótulo, e os dois não cabem em 34px. */
  selo?: string;
  /** Módulo(s) CONTRATADOS que liberam o item (basta um). Diferente de `ver`
   *  (permissão do cargo) e de `ocultaPor` (config global): este vem do
   *  PLANO do escritório. Sem o campo, o item nunca é escondido por plano. */
  modulo?: string[];
  /** O inverso: item só aparece quando NENHUM destes módulos está no
   *  contrato. É o que faz "Clientes essencial" e "Prazos" existirem só no
   *  pacote processual — quem contrata o módulo completo vê o item normal. */
  soSemModulo?: string[];
};

/**
 * Geometria do item quando o menu está recolhido.
 *
 * Precisa vencer o `group-data-[collapsible=icon]:size-8!` e o `p-2!` que o
 * `SidebarMenuButton` do shadcn aplica. Os dois lados têm a MESMA
 * especificidade e ambos sao `!important`, e o `twMerge` NAO desempata: ele
 * nao reconhece o `!` posfixado do Tailwind v4 e mantem as duas classes.
 * Quem desempata e a ordem de emissao, e ela esta a nosso favor por contrato
 * do framework: shorthand sai antes de longhand. Por isso aqui e
 * `h-auto`/`w-full` contra `size-8`, e `px`/`py` contra `p` — trocar por
 * `size-*` ou `p-*` empataria de novo e o override voltaria a perder.
 */
const CLASSES_ITEM_RAIL =
  "group-data-[collapsible=icon]:h-auto! group-data-[collapsible=icon]:w-full! " +
  "group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:justify-center " +
  "group-data-[collapsible=icon]:gap-0.5 group-data-[collapsible=icon]:px-0.5! " +
  "group-data-[collapsible=icon]:py-1.5!";

/** O rotulo desce pra baixo do icone. `truncate` proprio porque o do shadcn
 *  mira `>span:last-child`, que e o CONTADOR quando o item tem badge. */
const CLASSES_ROTULO_RAIL =
  "group-data-[collapsible=icon]:w-full group-data-[collapsible=icon]:flex-none " +
  "group-data-[collapsible=icon]:text-center group-data-[collapsible=icon]:text-[8.5px] " +
  "group-data-[collapsible=icon]:font-semibold group-data-[collapsible=icon]:leading-[1.1] " +
  "group-data-[collapsible=icon]:truncate";

const GRUPOS_MENU: Array<{ titulo: string; itens: ItemMenu[] }> = [
  {
    titulo: "Dia a dia",
    itens: [
      { id: "dashboard", rotulo: "Dashboard", rota: "/dashboard", icone: LayoutDashboard, ver: (c) => c("dashboard") },
      { id: "agenda", rotulo: "Agenda", rota: "/agenda", icone: CalendarDays, ver: (c) => c("agenda"), ocultaPor: "agenda", tomBadge: "alerta", modulo: ["agenda"] },
      { id: "atendimento", rotulo: "Atendimento", rota: "/atendimento", icone: Headphones, ver: (c) => c("atendimento"), ocultaPor: "atendimento", tomBadge: "novidade", modulo: ["atendimento"] },
    ],
  },
  {
    titulo: "Carteira",
    itens: [
      { id: "clientes", rotulo: "Clientes", rota: "/clientes", icone: Users, ver: (c) => c("clientes"), modulo: ["clientes"] },
      // Pacote processual (Fase 2): as versões enxutas só existem quando o
      // módulo completo correspondente NÃO está no contrato.
      { id: "clientes-essencial", rotulo: "Clientes", rota: "/clientes", icone: Users, ver: (c) => c("clientes"), modulo: ["processos"], soSemModulo: ["clientes"], selo: "essencial" },
      // A Central de Movimentações virou aba daqui — o contador de não lidas
      // veio junto, senão o número sumia do menu com a página.
      { id: "processos", rotulo: "Processos", rota: "/processos", icone: FileSearch, ver: (c) => c("processos"), ocultaPor: "processos", tomBadge: "novidade", prefixo: true, modulo: ["processos"] },
      { id: "prazos", rotulo: "Prazos", rota: "/prazos", icone: CalendarDays, ver: (c) => c("agenda"), modulo: ["processos"], soSemModulo: ["agenda"] },
      // Acordo é vinculado a cliente; o gate herda de "clientes" e o
      // verProprios filtra por responsável no backend.
      { id: "acordos", rotulo: "Acordos", rota: "/acordos", icone: Handshake, ver: (c) => c("clientes"), modulo: ["clientes"] },
      { id: "kanban", rotulo: "Kanban", rota: "/kanban", icone: LayoutGrid, ver: (c) => c("kanban"), ocultaPor: "kanban", modulo: ["kanban"] },
    ],
  },
  {
    titulo: "Ferramentas",
    itens: [
      // `ver` é permissão do colaborador; `ocultaPor` é o que o escritório
      // contratou. Só some do menu quando o módulo não foi contratado — antes
      // aparecia pra qualquer um com Processos e entregava "não está no seu
      // plano" depois do clique.
      { id: "jurisia", rotulo: "JurisIA", rota: "/jurisia", icone: Gavel, ver: (c) => c("processos"), ocultaPor: "jurisia", selo: "beta" },
      // Ponto tem módulo próprio na matriz de cargos, e por padrão só o Dono
      // o tem. Enquanto pegava carona em "equipe" o item aparecia pra
      // atendente, SDR e estagiário (todos têm verProprios lá) e, depois,
      // pro Gestor — que ninguém escolheu, veio junto com gerenciar a equipe.
      { id: "ponto", rotulo: "Ponto", rota: "/ponto", icone: Clock, ver: (_c, e) => e("ponto"), modulo: ["ponto"] },
      { id: "calculos", rotulo: "Cálculos", rota: "/calculos", icone: Calculator, ver: (c) => c("calculos"), ocultaPor: "calculos", modulo: ["calculos"] },
      { id: "modelos", rotulo: "Modelos", rota: "/modelos-contrato", icone: FileText, ver: (c) => c("modelos"), modulo: ["contratos"] },
      // Fusão de SmartFlow (Fluxos) + Agentes IA: aparece com qualquer um dos
      // dois; o gate por sub-aba fica dentro da página.
      { id: "automacoes", rotulo: "Automações", rota: "/automacoes", icone: Zap, ver: (c) => c("smartflow") || c("agentesIa"), ocultaPor: "smartflow", prefixo: true, modulo: ["smartflow", "agentes_ia"] },
    ],
  },
  {
    titulo: "Gestão",
    itens: [
      { id: "financeiro", rotulo: "Financeiro", rota: "/financeiro", icone: DollarSign, ver: (c) => c("financeiro"), ocultaPor: "financeiro", modulo: ["financeiro"] },
      { id: "relatorios", rotulo: "Relatórios", rota: "/relatorios", icone: BarChart3, ver: (c) => c("relatorios"), ocultaPor: "relatorios", modulo: ["relatorios"] },
      // Roadmap não está no sistema de permissões — todo logado vê e vota.
      { id: "roadmap", rotulo: "Roadmap", rota: "/roadmap", icone: Lightbulb, ocultaPor: "roadmap" },
    ],
  },
];

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    return saved ? parseInt(saved, 10) : DEFAULT_WIDTH;
  });
  const { loading, user } = useAuth();

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, sidebarWidth.toString());
  }, [sidebarWidth]);

  if (loading) {
    return <DashboardLayoutSkeleton />;
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="flex flex-col items-center gap-8 p-8 max-w-md w-full">
          <div className="flex flex-col items-center gap-4">
            <div className="h-14 w-14 rounded-xl bg-primary/10 flex items-center justify-center">
              <Calculator className="h-7 w-7 text-primary" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-center text-foreground">
              SaaS de Cálculos
            </h1>
            <p className="text-sm text-muted-foreground text-center max-w-sm">
              Acesse sua conta para utilizar os módulos de cálculos jurídicos.
            </p>
          </div>
          <Button
            onClick={() => {
              window.location.href = "/";
            }}
            size="lg"
            className="w-full shadow-lg hover:shadow-xl transition-all"
          >
            Entrar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": `${sidebarWidth}px`,
          // 4.5rem no lugar de 3rem: no modo estreito o rótulo desce pra
          // baixo do ícone, e em 48px não caberia nome nenhum.
          "--sidebar-width-icon": "4.5rem",
        } as CSSProperties
      }
    >
      <AppSidebarContent setSidebarWidth={setSidebarWidth}>
        {children}
      </AppSidebarContent>
    </SidebarProvider>
  );
}

type AppSidebarContentProps = {
  children: React.ReactNode;
  setSidebarWidth: (width: number) => void;
};

function AppSidebarContent({
  children,
  setSidebarWidth,
}: AppSidebarContentProps) {
  const { user, logout } = useAuth();
  const [location, setLocation] = useLocation();
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();

  // Check subscription status for sidebar navigation gating
  const { data: subscription, isFetched: subFetched } = trpc.subscription.current.useQuery(
    undefined,
    {
      enabled: !!user && user.role === "user",
      retry: false,
      refetchOnWindowFocus: false,
    }
  );

  const { data: credits, isFetched: creditsFetched } = trpc.dashboard.credits.useQuery(
    undefined,
    {
      enabled: !!user && user.role === "user",
      retry: false,
      refetchOnWindowFocus: false,
    }
  );

  const hasSubscription = !!subscription;
  const hasCredits = (credits?.creditsRemaining ?? 0) > 0;
  const isUser = user?.role === "user";
  // Items are locked only if user has NEITHER subscription NOR credits
  const itemsLocked = isUser && subFetched && creditsFetched && !hasSubscription && !hasCredits;

  // Nome do escritório — exibido no header do sidebar para deixar
  // claro a qual escritório o colaborador pertence.
  const { data: meuEscritorioData } = (trpc as any).configuracoes?.meuEscritorio?.useQuery?.(
    undefined,
    {
      enabled: !!user && user.role === "user",
      retry: false,
      refetchOnWindowFocus: false,
    },
  ) || { data: null };
  const nomeEscritorio: string | null = meuEscritorioData?.escritorio?.nome || null;

  // Permissões do usuário (sidebar dinâmica). Refetch a cada 5min —
  // antes era 30s + window focus, mas permissões mudam raramente
  // (admin altera cargo de colaborador uma vez por semana?). 30s
  // significava ~2 req/min globalmente em todas as páginas só pra
  // permissões — contribuía pro estouro de cota. staleTime e
  // refetchOnWindowFocus seguem o default global (60s / false).
  const { data: minhasPerms } = (trpc as any).permissoes?.minhasPermissoes?.useQuery?.(
    undefined,
    {
      retry: false,
      refetchInterval: 5 * 60_000,
    },
  ) || { data: null };
  /**
   * Igual ao `canSee`, com uma diferença: enquanto as permissões carregam,
   * ESCONDE em vez de mostrar.
   *
   * O default do `canSee` é otimista pra evitar piscada em módulo que quase
   * todo mundo tem. Num módulo de gestão a conta se inverte: mostrar o Ponto
   * por meio segundo pra quem não tem acesso é pior que ele aparecer meio
   * segundo depois pra quem tem.
   */
  // Módulos CONTRATADOS pelo plano do escritório — null = tudo liberado
  // (cortesia/admin/carregando). Complementa canSee: cargo diz quem PODE,
  // o plano diz o que o escritório TEM.
  const { data: modulosData } = trpc.subscription.modulosContratados.useQuery(undefined, {
    enabled: !!user && user.role === "user",
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });
  const modulosContratados: string[] | null = modulosData?.modulos ?? null;

  const canSeeEstrito = (modulo: string) => {
    if (user?.role === "admin" || minhasPerms?.cargo === "Dono") return true;
    if (!minhasPerms?.permissoes) return false;
    const p = minhasPerms.permissoes[modulo];
    return !!(p?.verTodos || p?.verProprios);
  };

  const canSee = (modulo: string) => {
    // Dono e admin do sistema nunca são bloqueados
    if (user?.role === "admin" || minhasPerms?.cargo === "Dono") return true;
    // Permissões ainda carregando — mostra tudo pra evitar flicker
    if (!minhasPerms?.permissoes) return true;
    const p = minhasPerms.permissoes[modulo];
    // Permissões carregadas mas módulo ausente do map → NEGAR.
    // O backend agora preenche todos os módulos com defaults false, então
    // ausência aqui é intencional (cargo legado sem entry pra esse módulo).
    if (!p) return false;
    return !!(p?.verTodos || p?.verProprios);
  };

  useEffect(() => {
    if (isCollapsed) {
      setIsResizing(false);
    }
  }, [isCollapsed]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const sidebarLeft =
        sidebarRef.current?.getBoundingClientRect().left ?? 0;
      const newWidth = e.clientX - sidebarLeft;
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) {
        setSidebarWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, setSidebarWidth]);

  // Heartbeat — registra atividade do colaborador a cada 5 minutos
  const heartbeatMut = (trpc as any).configuracoes?.heartbeat?.useMutation?.() || { mutate: () => {} };

  // Notificações em tempo real via SSE
  // Conecta SSE pra mostrar toasts em tempo real (chat, etc).
  // O badge de contagem persistente fica no <NotificacoesSino /> abaixo.
  useNotificacoes(user?.id);
  useEffect(() => {
    heartbeatMut.mutate?.();
    const interval = setInterval(() => heartbeatMut.mutate?.(), 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const handleLockedClick = () => {
    toast.info("Assine um plano para acessar este módulo.", {
      action: {
        label: "Ver Planos",
        onClick: () => setLocation("/plans"),
      },
    });
  };

  const navigateOrBlock = (path: string) => {
    if (itemsLocked) {
      handleLockedClick();
    } else {
      setLocation(path);
    }
  };

  const { preferencia, setPreferencia } = useTheme();

  const isAdmin = user?.role === "admin";

  // Contadores dos badges. Cada um é uma query barata (COUNT) — o menu vive
  // em toda tela, então puxar as listas completas só pra mostrar um número
  // seria caro a cada navegação.
  const { data: contMovs } = (trpc as any).movimentacoes?.contador?.useQuery?.(undefined, {
    refetchInterval: 2 * 60_000,
    retry: false,
  }) ?? { data: null };
  const { data: contAgenda } = trpc.agenda.contadores.useQuery(undefined, {
    refetchInterval: 2 * 60_000,
    retry: false,
    // Sem Agenda no contrato a chamada só devolveria FORBIDDEN a cada 2min.
    enabled: contratoLibera(modulosContratados, ["agenda"]),
  });
  const { data: contConversas } = (trpc as any).crm?.contarConversas?.useQuery?.(undefined, {
    refetchInterval: 2 * 60_000,
    retry: false,
  }) ?? { data: null };

  const badges: Record<string, number> = {
    processos: contMovs?.naoLidas ?? 0,
    agenda: contAgenda?.atrasadosCount ?? 0,
    atendimento: contConversas?.aguardando ?? 0,
  };

  /**
   * Quem aparece no menu. Vive fora do JSX porque a paleta ⌘K navega para
   * a MESMA lista — se as duas calculassem visibilidade por conta própria,
   * a busca ofereceria tela que o cargo/plano não abre.
   */
  const itemVisivelNoMenu = (i: ItemMenu) =>
    !(i.ocultaPor && moduloOcultoNoMenu(i.ocultaPor)) &&
    (i.modulo ? contratoLibera(modulosContratados, i.modulo) : true) &&
    (i.soSemModulo ? !contratoLibera(modulosContratados, i.soSemModulo) : true) &&
    (i.ver ? i.ver(canSee, canSeeEstrito) : true);

  const telasNavegaveis = GRUPOS_MENU.flatMap((g) => g.itens)
    .filter(itemVisivelNoMenu)
    .map((i) => ({ id: i.id, rotulo: i.rotulo, rota: i.rota, icone: i.icone }));

  // Paleta de comandos (⌘K / Ctrl+K). É caminho ADICIONAL: o menu continua
  // inteiro, e quem nunca apertar o atalho não perde nada.
  const [paletaAberta, setPaletaAberta] = useState(false);
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setPaletaAberta((v) => !v);
      }
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, []);

  // Modo "app de atendimento" no celular (opção A): quem tem o módulo
  // Atendimento abre o app focado nele, sem o menu dos outros módulos.
  // "Abrir versão completa" (no menu do perfil) sai do foco e mostra a
  // sidebar inteira; "Modo atendimento" (no menu de usuário) volta.
  // Vale inclusive pro dono/admin do escritório — o painel admin global
  // vive em /admin (AdminLayout, fora daqui) e segue acessível pela
  // versão completa. Quem não vê Atendimento mantém o menu completo.
  const [mobileCompleto, setMobileCompleto] = useState<boolean>(() => {
    try { return localStorage.getItem("jurify:mobileCompleto") === "1"; } catch { return false; }
  });
  const modoFocadoMobile =
    isMobile && !mobileCompleto && canSee("atendimento") &&
    contratoLibera(modulosContratados, ["atendimento"]);
  const abrirVersaoCompleta = () => {
    try { localStorage.setItem("jurify:mobileCompleto", "1"); } catch { /* modo privado */ }
    setMobileCompleto(true);
  };
  const voltarModoAtendimento = () => {
    try { localStorage.removeItem("jurify:mobileCompleto"); } catch { /* modo privado */ }
    setMobileCompleto(false);
    setLocation("/atendimento");
  };

  // "Instalar app" no menu de perfil: tenta o instalador nativo
  // (Android/Chrome/Edge/desktop); se não houver, abre o passo a passo manual
  // (iOS/Safari). Some quando o app já está rodando instalado.
  const [instalarOpen, setInstalarOpen] = useState(false);
  const mostrarInstalar = !pwaInstalado();
  const instalarApp = async () => {
    const r = await dispararInstalacao();
    if (r === "indisponivel") setInstalarOpen(true);
  };

  // No modo focado, qualquer rota fora de Atendimento/Configurações volta
  // pro Atendimento — o app no celular não navega pros outros módulos.
  useEffect(() => {
    if (!modoFocadoMobile) return;
    const permitida = location === "/atendimento" || location.startsWith("/configuracoes");
    if (!permitida) setLocation("/atendimento");
  }, [modoFocadoMobile, location, setLocation]);

  return (
    <>
      <div className="relative" ref={sidebarRef}>
        {/* O `!` da borda vale SÓ no rail. Sem variante ele vence o
            `group-data-[side=left]:border-r` do shadcn nos dois estados e o
            menu aberto perde o fio que hoje o separa do conteúdo — no tema
            escuro as duas superfícies diferem em 4 níveis de RGB e a borda é a
            única divisa. O `border-r-0` cru fica: ele perde, como sempre
            perdeu, e é isso que mantém o menu aberto igual ao que está no ar. */}
        <Sidebar
          collapsible="icon"
          className="border-r-0 group-data-[collapsible=icon]:border-r-0!"
          disableTransition={isResizing}
        >
          {/* `shrink-0` não é decorativo: a regra global `.flex{min-height:0}`
              deixa header e rodapé encolherem, e com o menu comprido o rodapé
              (conta, engrenagem, sair) aparecia cortado. */}
          <SidebarHeader className="h-16 shrink-0 justify-center">
            <div className={"flex items-center w-full transition-all " + (isCollapsed ? "justify-center" : "gap-2 px-2")}>
              <button
                onClick={toggleSidebar}
                className="flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-sidebar-accent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring shrink-0"
                aria-label="Alternar navegação"
                title="Recolher / expandir menu"
              >
                <MarcaJ size={26} wordmark={!isCollapsed} tom="sidebar" />
              </button>
              {!isCollapsed && isAdmin && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                  Admin
                </Badge>
              )}
              {!isCollapsed && (
                <div className="ml-auto shrink-0">
                  <NotificacoesSino />
                </div>
              )}
            </div>
          </SidebarHeader>

          {/* No rail a rolagem existe mas a barra não: `.rolagem-menu` é barra
              CLÁSSICA (scrollbar-width: thin), que RESERVA largura. Medido em
              Chromium com barra clássica, viewport de 768px: ela comia 10px dos
              72px — botão de 56 pra 46, coluna de ícones 5px fora do centro do
              logo e do rodapé, e 5 rótulos truncando. Ou seja, exatamente nas
              telas baixas que motivaram a rolagem o rótulo se perdia. A roda e
              o trackpad continuam rolando.

              O `!` aqui não é gosto: `.rolagem-menu` mora no index.css FORA de
              camada, e regra sem camada vence qualquer `@layer utilities`
              independente de especificidade. Sem ele o `scrollbar-width`
              continuava `thin` — conferido no navegador. */}
          <SidebarContent className="gap-0 rolagem-menu group-data-[collapsible=icon]:overflow-y-auto group-data-[collapsible=icon]:[scrollbar-width:none]! group-data-[collapsible=icon]:[&::-webkit-scrollbar]:w-0!">
            {GRUPOS_MENU.map((grupo) => {
              const visiveis = grupo.itens.filter(itemVisivelNoMenu);
              if (visiveis.length === 0) return null;
              return (
                <div key={grupo.titulo} className="px-2 pb-0.5">
                  {/* O rótulo some no modo ícone — sobra o separador, que já
                      diz onde um grupo termina; abreviado ele viraria "DIA",
                      "CART", "FERR", que não querem dizer nada. */}
                  <p className="px-2 pt-2 pb-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-sidebar-foreground/45 group-data-[collapsible=icon]:hidden">
                    {grupo.titulo}
                  </p>
                  <div className="hidden group-data-[collapsible=icon]:block mx-auto my-1.5 h-px w-6 bg-sidebar-border" />
                  <SidebarMenu>
                    {visiveis.map((item) => {
                      const ativo = item.prefixo
                        ? location.startsWith(item.rota)
                        : location === item.rota;
                      const contagem = badges[item.id] ?? 0;
                      const Icone = item.icone;
                      return (
                        <SidebarMenuItem key={item.id}>
                          {/* A barra fica FORA do botão: o SidebarMenuButton
                              tem overflow-hidden, e dentro dele o marcador
                              seria cortado. */}
                          {ativo && (
                            <span className="absolute left-0 top-1.5 bottom-1.5 z-10 w-[3px] rounded-r bg-sidebar-primary" />
                          )}
                          <SidebarMenuButton
                            isActive={ativo}
                            onClick={() => navigateOrBlock(item.rota)}
                            tooltip={item.rotulo}
                            className={`relative h-[34px] transition-all ${CLASSES_ITEM_RAIL} ${
                              ativo ? "font-semibold" : "font-normal"
                            } ${itemsLocked ? "opacity-50" : ""}`}
                          >
                            <Icone className={`h-4 w-4 ${ativo ? "text-sidebar-primary" : ""}`} />
                            {/* Recolhido o rótulo desce pra baixo do ícone em vez de
                                sumir: eram 16 ícones sem nome nenhum. O estilo
                                vive no className e não em CSS porque a regra em
                                CSS não casava com o DOM (ver CLASSES_ITEM_RAIL).
                                `rotulo-item` não tem regra nenhuma: é âncora de
                                leitura e de teste. */}
                            <span className={`flex-1 rotulo-item ${CLASSES_ROTULO_RAIL}`}>
                              {item.rotulo}
                            </span>
                            {item.selo && contagem === 0 && (
                              <span className="ml-auto rounded-full border border-warning/30 bg-warning/15 px-1.5 py-px text-[9px] font-extrabold uppercase tracking-[0.06em] text-warning-fg group-data-[collapsible=icon]:hidden">
                                {item.selo}
                              </span>
                            )}
                            {contagem > 0 && (
                              <>
                                <span
                                  className={`ml-auto rounded-full px-1.5 py-px text-[10px] font-extrabold tabular-nums group-data-[collapsible=icon]:hidden ${
                                    item.tomBadge === "alerta"
                                      ? "bg-danger/20 text-danger-fg"
                                      : "bg-sidebar-primary/20 text-sidebar-primary"
                                  }`}
                                >
                                  {contagem > 99 ? "99+" : contagem}
                                </span>
                                {/* Recolhido o número não cabe; o ponto ainda
                                    responde "tem algo esperando aqui?". */}
                                <span
                                  className={`absolute right-1.5 top-1.5 hidden h-1.5 w-1.5 rounded-full group-data-[collapsible=icon]:block group-data-[collapsible=icon]:left-1/2 group-data-[collapsible=icon]:right-auto group-data-[collapsible=icon]:ml-1 group-data-[collapsible=icon]:top-1 ${
                                    item.tomBadge === "alerta" ? "bg-danger" : "bg-sidebar-primary"
                                  }`}
                                />
                              </>
                            )}
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      );
                    })}
                  </SidebarMenu>
                </div>
              );
            })}

            {/* Sem assinatura ativa: atalho pra resolver, fora dos grupos. */}
            {(user?.role === "admin" || minhasPerms?.cargo === "Dono") && itemsLocked && (
              <div className="px-2 pb-2">
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      onClick={() => setLocation("/configuracoes?tab=meu-plano")}
                      tooltip="Assinar plano"
                      className={`relative h-9 transition-all font-normal ${CLASSES_ITEM_RAIL}`}
                    >
                      <CreditCard className="h-4 w-4" />
                      <span className={CLASSES_ROTULO_RAIL}>Assinar plano</span>
                      {/* Recolhido o selo sai do fluxo: em coluna ele viraria
                          uma terceira linha e este item ficaria mais alto que
                          todos os outros do rail. */}
                      <Badge
                        variant="destructive"
                        className="text-[9px] px-1.5 py-0 ml-auto group-data-[collapsible=icon]:absolute group-data-[collapsible=icon]:right-0.5 group-data-[collapsible=icon]:top-0.5 group-data-[collapsible=icon]:ml-0 group-data-[collapsible=icon]:px-1"
                      >
                        !
                      </Badge>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </div>
            )}
          </SidebarContent>

          <SidebarFooter className="p-3 shrink-0">
            {/* O atalho precisa se anunciar: paleta de comandos que ninguém
                descobre é paleta que ninguém usa. Some no modo ícone, onde
                não há largura pro rótulo. */}
            <button
              onClick={() => setPaletaAberta(true)}
              className="mb-2 flex w-full items-center gap-2 rounded-lg border border-sidebar-border bg-sidebar-accent/40 px-2.5 py-1.5 text-[11px] text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground group-data-[collapsible=icon]:hidden"
            >
              <Search className="h-3.5 w-3.5 shrink-0" />
              <span className="flex-1 text-left">Buscar</span>
              <kbd className="rounded border border-sidebar-border bg-sidebar-accent px-1 py-px font-mono text-[10px] font-semibold text-sidebar-foreground/75">
                ⌘K
              </kbd>
            </button>
            <div className="flex items-center gap-2 group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:gap-1">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex flex-1 min-w-0 items-center gap-2.5 rounded-lg px-1 py-1 hover:bg-sidebar-accent transition-colors text-left group-data-[collapsible=icon]:flex-none focus:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring">
                    <Avatar className="h-8 w-8 border shrink-0">
                      <AvatarFallback className="text-xs font-medium bg-sidebar-primary/20 text-sidebar-primary">
                        {user?.name?.charAt(0).toUpperCase() || "U"}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
                      <p className="text-[12.5px] font-semibold truncate leading-none text-sidebar-foreground">
                        {user?.name || "Utilizador"}
                      </p>
                      <p className="text-[10.5px] text-sidebar-foreground/55 truncate mt-1">
                        {user?.email || "-"}
                      </p>
                    </div>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Aparência
                  </DropdownMenuLabel>
                  {(["claro", "escuro", "sistema"] as const).map((op) => (
                    <DropdownMenuItem
                      key={op}
                      onClick={() => setPreferencia(op)}
                      className="cursor-pointer capitalize"
                    >
                      {op === "claro" ? (
                        <Sun className="mr-2 h-4 w-4" />
                      ) : op === "escuro" ? (
                        <Moon className="mr-2 h-4 w-4" />
                      ) : (
                        <Monitor className="mr-2 h-4 w-4" />
                      )}
                      <span>{op}</span>
                      {preferencia === op && <Check className="ml-auto h-3.5 w-3.5 text-primary" />}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  {isAdmin && (
                    <>
                      <DropdownMenuItem onClick={() => setLocation("/admin")} className="cursor-pointer">
                        <ShieldCheck className="mr-2 h-4 w-4" />
                        <span>Painel Admin</span>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                    </>
                  )}
                  {isMobile && canSee("atendimento") && (
                    <DropdownMenuItem onClick={voltarModoAtendimento} className="cursor-pointer">
                      <Smartphone className="mr-2 h-4 w-4" />
                      <span>Modo atendimento</span>
                    </DropdownMenuItem>
                  )}
                  {mostrarInstalar && (
                    <DropdownMenuItem onClick={instalarApp} className="cursor-pointer">
                      <Download className="mr-2 h-4 w-4" />
                      <span>Instalar app</span>
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Configurações e sair saem do menu suspenso: um é ajuste (não
                  trabalho do dia, então não merece linha na lista), o outro
                  estava escondido a dois cliques. */}
              {canSee("configuracoes") && (
                <button
                  onClick={() => navigateOrBlock("/configuracoes")}
                  title="Configurações"
                  aria-label="Configurações"
                  className={`h-8 w-8 shrink-0 rounded-lg border border-sidebar-border flex items-center justify-center text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors ${
                    location === "/configuracoes"
                      ? "border-sidebar-primary text-sidebar-primary bg-sidebar-primary/10"
                      : ""
                  }`}
                >
                  <Settings className="h-4 w-4" />
                </button>
              )}
              <button
                onClick={logout}
                title="Sair"
                aria-label="Sair"
                className="h-8 w-8 shrink-0 rounded-lg border border-danger/30 bg-danger/10 flex items-center justify-center text-danger-fg hover:bg-danger/20 transition-colors"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </SidebarFooter>
        </Sidebar>
        <div
          className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/20 transition-colors ${isCollapsed ? "hidden" : ""}`}
          onMouseDown={() => {
            if (isCollapsed) return;
            setIsResizing(true);
          }}
          style={{ zIndex: 50 }}
        />
      </div>

      <SidebarInset>
        {/* Banner de impersonation — mostrado quando admin entrou como cliente */}
        {(user as any)?.impersonatedBy && (
          <ImpersonationBanner alvoNome={user?.name || user?.email || "Usuário"} />
        )}
        {/* Banner topo: trial em andamento (Fase 3) */}
        <TrialBanner />
        {isMobile && modoFocadoMobile && (
          /* Header enxuto do app de atendimento (celular). */
          <div className="flex border-b h-14 items-center justify-between bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:backdrop-blur sticky top-0 z-40">
            <div className="flex items-center gap-2">
              <span
                className="inline-flex items-center justify-center font-display font-extrabold text-white shrink-0 select-none"
                style={{ width: 30, height: 30, borderRadius: 8, fontSize: 16, lineHeight: 1, background: "linear-gradient(135deg, var(--hero) 0%, var(--hero-2) 100%)" }}
                aria-hidden
              >
                J<span style={{ color: "var(--sidebar-primary)" }}>.</span>
              </span>
              <span className="font-bold tracking-tight text-foreground">Atendimento</span>
            </div>
            <div className="flex items-center gap-1">
              <NotificacoesSino />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Perfil">
                    <Avatar className="h-8 w-8 border">
                      <AvatarFallback className="text-xs font-medium bg-sidebar-primary/20 text-sidebar-primary">
                        {user?.name?.charAt(0).toUpperCase() || "U"}
                      </AvatarFallback>
                    </Avatar>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <div className="px-2 py-1.5">
                    <p className="text-sm font-medium truncate leading-none text-foreground">{user?.name || "Utilizador"}</p>
                    <p className="text-xs text-muted-foreground truncate mt-1.5">{nomeEscritorio || user?.email || "-"}</p>
                  </div>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setLocation("/configuracoes")} className="cursor-pointer">
                    <Settings className="mr-2 h-4 w-4" />
                    <span>Configurações</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={abrirVersaoCompleta} className="cursor-pointer">
                    <Monitor className="mr-2 h-4 w-4" />
                    <span>Abrir versão completa</span>
                  </DropdownMenuItem>
                  {mostrarInstalar && (
                    <DropdownMenuItem onClick={instalarApp} className="cursor-pointer">
                      <Download className="mr-2 h-4 w-4" />
                      <span>Instalar app</span>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={logout} className="cursor-pointer text-destructive focus:text-destructive">
                    <LogOut className="mr-2 h-4 w-4" />
                    <span>Sair</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        )}
        {isMobile && !modoFocadoMobile && (
          <div className="flex border-b h-14 items-center justify-between bg-background/95 px-2 backdrop-blur supports-[backdrop-filter]:backdrop-blur sticky top-0 z-40">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="h-9 w-9 rounded-lg bg-background" />
              <span className="tracking-tight text-foreground font-medium">
                {nomeEscritorio || "JuridFlow"}
              </span>
            </div>
          </div>
        )}
        <main className={"flex-1 " + (modoFocadoMobile ? "p-0" : "p-6")}>
          <ChamadaWhatsappProvider>{children}</ChamadaWhatsappProvider>
        </main>
      </SidebarInset>
      <InstalarAppDialog open={instalarOpen} onOpenChange={setInstalarOpen} />
      <PaletaComandos
        aberta={paletaAberta}
        onOpenChange={setPaletaAberta}
        telas={telasNavegaveis}
        onNavegar={navigateOrBlock}
      />
    </>
  );
}

/**
 * Banner topo exibido enquanto cliente está em trial. Mostra dias restantes
 * + CTA pra adicionar pagamento (vai pra /configuracoes?tab=meu-plano).
 *
 * Cores escalam por urgência:
 *   - ≥ 4 dias: amarelo neutro
 *   - 2-3 dias: laranja
 *   - 0-1 dia: vermelho
 */
function TrialBanner() {
  const [, setLocation] = useLocation();
  const { data: subscription } = trpc.subscription.current.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });
  // Plano sob consulta não tem checkout — "Adicionar pagamento" levaria a
  // uma tela sem botão de pagar. O CTA vira a conversa comercial.
  const { data: planos } = trpc.subscription.plans.useQuery(undefined, {
    staleTime: 5 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const { data: contato } = trpc.subscription.contatoComercial.useQuery(undefined, {
    staleTime: 5 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const dias = (subscription as any)?.diasRestantesTrial as number | null | undefined;
  if (subscription?.status !== "trialing" || dias == null) return null;

  const planoAtual = (planos ?? []).find((p: any) => p.slug === (subscription as any)?.planId);
  const sobConsulta = Boolean((planoAtual as any)?.precoSobConsulta);
  const abrirConversa = () => {
    const texto = `Olá! Meu teste do plano ${(planoAtual as any)?.nome ?? "JuridFlow"} está acabando — quero fechar o valor.`;
    const url = contato?.whatsapp
      ? `https://wa.me/${contato.whatsapp}?text=${encodeURIComponent(texto)}`
      : `mailto:contato@juridflow.com.br?subject=${encodeURIComponent("Quero fechar o valor do meu plano")}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const cor =
    dias >= 4 ? "bg-warning-bg border-warning/30 text-warning-fg dark:border-warning/30" :
    dias >= 2 ? "bg-warning-bg border-warning/30 text-warning-fg dark:border-warning/30" :
                "bg-danger-bg border-danger/30 text-danger-fg dark:border-danger/30";

  const texto =
    dias === 0 ? "Seu trial termina hoje." :
    dias === 1 ? "Seu trial termina amanhã." :
                 `Trial: ${dias} dias restantes.`;

  return (
    <div className={`border-b px-4 py-2 flex items-center justify-between gap-3 text-sm ${cor}`}>
      <span className="font-medium">{texto}</span>
      <button
        onClick={() => (sobConsulta ? abrirConversa() : setLocation("/configuracoes?tab=meu-plano"))}
        className="text-xs font-semibold underline underline-offset-2 hover:opacity-80"
      >
        {sobConsulta ? "💬 Fechar valor com a gente →" : "Adicionar pagamento →"}
      </button>
    </div>
  );
}

