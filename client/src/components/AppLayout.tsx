import { useAuth } from "@/_core/hooks/useAuth";
import { useNotificacoes } from "@/hooks/useNotificacoes";
import { ChamadaWhatsappProvider } from "@/hooks/whatsapp-call-context";
import NotificacoesSino from "@/components/NotificacoesSino";
import { MarcaJ } from "@/components/MarcaJ";
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
} from "lucide-react";
import { CSSProperties, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";
import { Button } from "./ui/button";
import { moduloOcultoNoMenu } from "@/config/visibility";
import { useTheme } from "@/contexts/ThemeContext";
import { toast } from "sonner";
import { InstalarAppDialog } from "@/components/InstalarAppDialog";
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
  ver?: (canSee: (m: string) => boolean) => boolean;
  /** Chave usada em `moduloOcultoNoMenu`, quando existe. */
  ocultaPor?: string;
  /** Ativo por prefixo (páginas com sub-rotas, como /automacoes/fluxos). */
  prefixo?: boolean;
  tomBadge?: "alerta" | "novidade";
  /** Selo fixo de texto ("beta"). Some quando há contagem: número esperando é
   *  informação viva e ganha do rótulo, e os dois não cabem em 34px. */
  selo?: string;
};

const GRUPOS_MENU: Array<{ titulo: string; itens: ItemMenu[] }> = [
  {
    titulo: "Dia a dia",
    itens: [
      { id: "dashboard", rotulo: "Dashboard", rota: "/dashboard", icone: LayoutDashboard, ver: (c) => c("dashboard") },
      { id: "movimentacoes", rotulo: "Movimentações", rota: "/movimentacoes", icone: Gavel, ver: (c) => c("processos"), ocultaPor: "processos", tomBadge: "novidade" },
      { id: "agenda", rotulo: "Agenda", rota: "/agenda", icone: CalendarDays, ver: (c) => c("agenda"), ocultaPor: "agenda", tomBadge: "alerta" },
      { id: "atendimento", rotulo: "Atendimento", rota: "/atendimento", icone: Headphones, ver: (c) => c("atendimento"), ocultaPor: "atendimento", tomBadge: "novidade" },
    ],
  },
  {
    titulo: "Carteira",
    itens: [
      { id: "clientes", rotulo: "Clientes", rota: "/clientes", icone: Users, ver: (c) => c("clientes") },
      { id: "processos", rotulo: "Processos", rota: "/processos", icone: FileSearch, ver: (c) => c("processos"), ocultaPor: "processos" },
      // Acordo é vinculado a cliente; o gate herda de "clientes" e o
      // verProprios filtra por responsável no backend.
      { id: "acordos", rotulo: "Acordos", rota: "/acordos", icone: Handshake, ver: (c) => c("clientes") },
      { id: "kanban", rotulo: "Kanban", rota: "/kanban", icone: LayoutGrid, ver: (c) => c("kanban"), ocultaPor: "kanban" },
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
      { id: "calculos", rotulo: "Cálculos", rota: "/calculos", icone: Calculator, ver: (c) => c("calculos"), ocultaPor: "calculos" },
      { id: "modelos", rotulo: "Modelos", rota: "/modelos-contrato", icone: FileText, ver: (c) => c("modelos") },
      // Fusão de SmartFlow (Fluxos) + Agentes IA: aparece com qualquer um dos
      // dois; o gate por sub-aba fica dentro da página.
      { id: "automacoes", rotulo: "Automações", rota: "/automacoes", icone: Zap, ver: (c) => c("smartflow") || c("agentesIa"), ocultaPor: "smartflow", prefixo: true },
    ],
  },
  {
    titulo: "Gestão",
    itens: [
      { id: "financeiro", rotulo: "Financeiro", rota: "/financeiro", icone: DollarSign, ver: (c) => c("financeiro"), ocultaPor: "financeiro" },
      { id: "relatorios", rotulo: "Relatórios", rota: "/relatorios", icone: BarChart3, ver: (c) => c("relatorios"), ocultaPor: "relatorios" },
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
  });
  const { data: contConversas } = (trpc as any).crm?.contarConversas?.useQuery?.(undefined, {
    refetchInterval: 2 * 60_000,
    retry: false,
  }) ?? { data: null };

  const badges: Record<string, number> = {
    movimentacoes: contMovs?.naoLidas ?? 0,
    agenda: contAgenda?.atrasadosCount ?? 0,
    atendimento: contConversas?.aguardando ?? 0,
  };

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
  const modoFocadoMobile = isMobile && !mobileCompleto && canSee("atendimento");
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
        <Sidebar
          collapsible="icon"
          className="border-r-0"
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

          <SidebarContent className="gap-0 rolagem-menu">
            {GRUPOS_MENU.map((grupo) => {
              const visiveis = grupo.itens.filter(
                (i) => !(i.ocultaPor && moduloOcultoNoMenu(i.ocultaPor)) && (i.ver ? i.ver(canSee) : true),
              );
              if (visiveis.length === 0) return null;
              return (
                <div key={grupo.titulo} className="px-2 pb-0.5">
                  {/* O rótulo some no modo ícone — sobra o separador, que já
                      diz onde um grupo termina. */}
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
                            <span className="absolute left-0 top-1.5 bottom-1.5 z-10 w-[3px] rounded-r bg-sidebar-primary group-data-[collapsible=icon]:hidden" />
                          )}
                          <SidebarMenuButton
                            isActive={ativo}
                            onClick={() => navigateOrBlock(item.rota)}
                            tooltip={item.rotulo}
                            className={`h-[34px] relative transition-all ${ativo ? "font-semibold" : "font-normal"} ${itemsLocked ? "opacity-50" : ""}`}
                          >
                            <Icone className={`h-4 w-4 ${ativo ? "text-sidebar-primary" : ""}`} />
                            <span className="flex-1">{item.rotulo}</span>
                            {item.selo && contagem === 0 && (
                              <span className="ml-auto rounded-full border border-amber-400/40 bg-amber-400/15 px-1.5 py-px text-[9px] font-extrabold uppercase tracking-[0.06em] text-amber-300 group-data-[collapsible=icon]:hidden">
                                {item.selo}
                              </span>
                            )}
                            {contagem > 0 && (
                              <>
                                <span
                                  className={`ml-auto rounded-full px-1.5 py-px text-[10px] font-extrabold tabular-nums group-data-[collapsible=icon]:hidden ${
                                    item.tomBadge === "alerta"
                                      ? "bg-rose-500/20 text-rose-200"
                                      : "bg-sidebar-primary/20 text-sidebar-primary"
                                  }`}
                                >
                                  {contagem > 99 ? "99+" : contagem}
                                </span>
                                {/* Recolhido o número não cabe; o ponto ainda
                                    responde "tem algo esperando aqui?". */}
                                <span
                                  className={`absolute right-1.5 top-1.5 hidden h-1.5 w-1.5 rounded-full group-data-[collapsible=icon]:block ${
                                    item.tomBadge === "alerta" ? "bg-rose-400" : "bg-sidebar-primary"
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
                      className="h-9 transition-all font-normal"
                    >
                      <CreditCard className="h-4 w-4" />
                      <span>Assinar plano</span>
                      <Badge variant="destructive" className="text-[9px] px-1.5 py-0 ml-auto">
                        !
                      </Badge>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </div>
            )}
          </SidebarContent>

          <SidebarFooter className="p-3 shrink-0">
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
                className="h-8 w-8 shrink-0 rounded-lg border border-rose-400/40 bg-rose-500/10 flex items-center justify-center text-rose-300 hover:bg-rose-500/20 transition-colors"
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
          <ImpersonationBanner targetName={user?.name || user?.email || "Usuário"} onExit={logout} />
        )}
        {/* Banner topo: trial em andamento (Fase 3) */}
        <TrialBanner />
        {isMobile && modoFocadoMobile && (
          /* Header enxuto do app de atendimento (celular). */
          <div className="flex border-b h-14 items-center justify-between bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:backdrop-blur sticky top-0 z-40">
            <div className="flex items-center gap-2">
              <span
                className="inline-flex items-center justify-center font-display font-extrabold text-white shrink-0 select-none"
                style={{ width: 30, height: 30, borderRadius: 8, fontSize: 16, lineHeight: 1, background: "linear-gradient(135deg,#7c3aed,#4f46e5)" }}
                aria-hidden
              >
                J<span style={{ color: "#c4b5fd" }}>.</span>
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

  const dias = (subscription as any)?.diasRestantesTrial as number | null | undefined;
  if (subscription?.status !== "trialing" || dias == null) return null;

  const cor =
    dias >= 4 ? "bg-amber-50 border-amber-200 text-amber-900 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-200" :
    dias >= 2 ? "bg-orange-50 border-orange-200 text-orange-900 dark:bg-orange-950/30 dark:border-orange-800 dark:text-orange-200" :
                "bg-red-50 border-red-200 text-red-900 dark:bg-red-950/30 dark:border-red-800 dark:text-red-200";

  const texto =
    dias === 0 ? "Seu trial termina hoje." :
    dias === 1 ? "Seu trial termina amanhã." :
                 `Trial: ${dias} dias restantes.`;

  return (
    <div className={`border-b px-4 py-2 flex items-center justify-between gap-3 text-sm ${cor}`}>
      <span className="font-medium">{texto}</span>
      <button
        onClick={() => setLocation("/configuracoes?tab=meu-plano")}
        className="text-xs font-semibold underline underline-offset-2 hover:opacity-80"
      >
        Adicionar pagamento →
      </button>
    </div>
  );
}

/**
 * Banner amarelo persistente no topo do app indicando que o admin do
 * JuridFlow está vendo a conta de outro usuário (impersonation). Botão
 * "Sair" faz logout (que limpa o cookie de impersonation).
 */
function ImpersonationBanner({ targetName, onExit }: { targetName: string; onExit: () => void }) {
  return (
    <div className="bg-amber-500 text-amber-950 px-4 py-2.5 flex items-center justify-between gap-3 sticky top-0 z-50 border-b border-amber-600 shadow-md">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Lock className="h-4 w-4" />
        <span>
          Você está vendo o sistema como <strong>{targetName}</strong> — toda ação
          é registrada em nome do admin original.
        </span>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="bg-white hover:bg-amber-50 border-amber-700 text-amber-950 h-8 text-xs font-medium"
        onClick={onExit}
      >
        <LogOut className="h-3.5 w-3.5 mr-1.5" />
        Sair da impersonação
      </Button>
    </div>
  );
}
