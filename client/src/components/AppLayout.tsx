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
  FileText,
  Handshake,
  Headphones,
  CalendarDays,
  Settings,
  Users,
  BarChart3,
  CheckSquare,
  DollarSign,
  BrainCircuit,
  Zap,
  LayoutGrid,
  Lightbulb,
  Monitor,
  Smartphone,
  Download,
} from "lucide-react";
import { CSSProperties, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";
import { Button } from "./ui/button";
import { moduloOcultoNoMenu } from "@/config/visibility";
import { toast } from "sonner";
import { InstalarAppDialog } from "@/components/InstalarAppDialog";
import { dispararInstalacao, pwaInstalado } from "@/lib/pwa-install";

const SIDEBAR_WIDTH_KEY = "sidebar-width";
const DEFAULT_WIDTH = 260;
const MIN_WIDTH = 200;
const MAX_WIDTH = 420;

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

  const isAdmin = user?.role === "admin";

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
          <SidebarHeader className="h-16 justify-center">
            <div className={"flex items-center w-full transition-all " + (isCollapsed ? "justify-center" : "gap-2 px-2")}>
              <button
                onClick={toggleSidebar}
                className="flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-accent/50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring shrink-0"
                aria-label="Alternar navegação"
                title="Recolher / expandir menu"
              >
                <MarcaJ size={26} wordmark={!isCollapsed} />
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

          <SidebarContent className="gap-0">
            <SidebarMenu className="px-2 py-1">
              {/* Dashboard */}
              {canSee("dashboard") && <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={location === "/dashboard"}
                  onClick={() => navigateOrBlock("/dashboard")}
                  tooltip="Dashboard"
                  className={`h-10 transition-all font-normal ${itemsLocked ? "opacity-50" : ""}`}
                >
                  <LayoutDashboard
                    className={`h-4 w-4 ${location === "/dashboard" ? "text-primary" : ""}`}
                  />
                  <span>Dashboard</span>
                  {itemsLocked && <Lock className="h-3 w-3 text-muted-foreground ml-1" />}
                </SidebarMenuButton>
              </SidebarMenuItem>}

              {/* Cálculos — navega pro hub /calculos (sem submenu).
                  As 5 ferramentas aparecem como cards visuais dentro do hub. */}
              {canSee("calculos") && !moduloOcultoNoMenu("calculos") && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    tooltip="Cálculos"
                    className={`h-10 transition-all font-normal ${itemsLocked ? "opacity-50" : ""}`}
                    isActive={location === "/calculos" || location.startsWith("/calculos/")}
                    onClick={() => navigateOrBlock("/calculos")}
                  >
                    <Calculator
                      className={`h-4 w-4 ${location.startsWith("/calculos") ? "text-primary" : ""}`}
                    />
                    <span className="flex-1">Cálculos</span>
                    {itemsLocked && <Lock className="h-3 w-3 text-muted-foreground ml-1" />}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}

              {/* Clientes */}
              {canSee("clientes") && <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={location === "/clientes"}
                  onClick={() => navigateOrBlock("/clientes")}
                  tooltip="Clientes"
                  className={`h-10 transition-all font-normal ${itemsLocked ? "opacity-50" : ""}`}
                >
                  <Users className={`h-4 w-4 ${location === "/clientes" ? "text-primary" : ""}`} />
                  <span className="flex-1">Clientes</span>
                </SidebarMenuButton>
              </SidebarMenuItem>}

              {/* Acordos — tratativas extrajudiciais. Gate herda de "clientes"
                  (acordo é vinculado a cliente; verProprios filtra por
                  responsável no backend). */}
              {canSee("clientes") && <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={location === "/acordos"}
                  onClick={() => navigateOrBlock("/acordos")}
                  tooltip="Acordos"
                  className={`h-10 transition-all font-normal ${itemsLocked ? "opacity-50" : ""}`}
                >
                  <Handshake className={`h-4 w-4 ${location === "/acordos" ? "text-primary" : ""}`} />
                  <span className="flex-1">Acordos</span>
                </SidebarMenuButton>
              </SidebarMenuItem>}

              {/* Modelos de contrato — módulo próprio "modelos". Herda de
                  "clientes" pra cargos antigos (ver check-permission / MODULO_HERANCA). */}
              {canSee("modelos") && <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={location === "/modelos-contrato"}
                  onClick={() => navigateOrBlock("/modelos-contrato")}
                  tooltip="Modelos de contrato"
                  className={`h-10 transition-all font-normal ${itemsLocked ? "opacity-50" : ""}`}
                >
                  <FileText className={`h-4 w-4 ${location === "/modelos-contrato" ? "text-primary" : ""}`} />
                  <span className="flex-1">Modelos</span>
                </SidebarMenuButton>
              </SidebarMenuItem>}

              {/* Agente Jurídico saiu daqui: agora vive dentro de "Agentes IA"
                  (é um agente). Card de acesso na página /agentes-ia. */}

              {/* Agenda (unifica Tarefas + Agendamento) */}
              {canSee("agenda") && !moduloOcultoNoMenu("agenda") && <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={location === "/agenda"}
                  onClick={() => navigateOrBlock("/agenda")}
                  tooltip="Agenda"
                  className={`h-10 transition-all font-normal ${itemsLocked ? "opacity-50" : ""}`}
                >
                  <CalendarDays className={`h-4 w-4 ${location === "/agenda" ? "text-primary" : ""}`} />
                  <span className="flex-1">Agenda</span>
                </SidebarMenuButton>
              </SidebarMenuItem>}

              {/* Processos */}
              {canSee("processos") && !moduloOcultoNoMenu("processos") && <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={location === "/processos"}
                  onClick={() => navigateOrBlock("/processos")}
                  tooltip="Processos"
                  className={`h-10 transition-all font-normal ${itemsLocked ? "opacity-50" : ""}`}
                >
                  <FileSearch
                    className={`h-4 w-4 ${location === "/processos" ? "text-primary" : ""}`}
                  />
                  <span>Processos</span>
                </SidebarMenuButton>
              </SidebarMenuItem>}

              {/* Atendimento */}
              {canSee("atendimento") && !moduloOcultoNoMenu("atendimento") && <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={location === "/atendimento"}
                  onClick={() => navigateOrBlock("/atendimento")}
                  tooltip="Atendimento"
                  className={`h-10 transition-all font-normal ${itemsLocked ? "opacity-50" : ""}`}
                >
                  <Headphones className={`h-4 w-4 ${location === "/atendimento" ? "text-primary" : ""}`} />
                  <span className="flex-1">Atendimento</span>
                </SidebarMenuButton>
              </SidebarMenuItem>}

              {/* Agentes IA */}
              {canSee("agentesIa") && !moduloOcultoNoMenu("agentesIa") && <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={location === "/agentes-ia"}
                  onClick={() => navigateOrBlock("/agentes-ia")}
                  tooltip="Agentes IA"
                  className={`h-10 transition-all font-normal ${itemsLocked ? "opacity-50" : ""}`}
                >
                  <BrainCircuit className={`h-4 w-4 ${location === "/agentes-ia" ? "text-primary" : ""}`} />
                  <span>Agentes IA</span>
                </SidebarMenuButton>
              </SidebarMenuItem>}

              {/* Kanban */}
              {canSee("kanban") && <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={location === "/kanban"}
                  onClick={() => navigateOrBlock("/kanban")}
                  tooltip="Kanban"
                  className={`h-10 transition-all font-normal ${itemsLocked ? "opacity-50" : ""}`}
                >
                  <LayoutGrid className={`h-4 w-4 ${location === "/kanban" ? "text-primary" : ""}`} />
                  <span className="flex-1">Kanban</span>
                </SidebarMenuButton>
              </SidebarMenuItem>}

              {/* SmartFlow */}
              {canSee("smartflow") && !moduloOcultoNoMenu("smartflow") && <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={location === "/smartflow"}
                  onClick={() => navigateOrBlock("/smartflow")}
                  tooltip="SmartFlow"
                  className={`h-10 transition-all font-normal ${itemsLocked ? "opacity-50" : ""}`}
                >
                  <Zap className={`h-4 w-4 ${location === "/smartflow" ? "text-primary" : ""}`} />
                  <span>SmartFlow</span>
                </SidebarMenuButton>
              </SidebarMenuItem>}

              {/* Relatórios */}
              {canSee("relatorios") && <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={location === "/relatorios"}
                  onClick={() => navigateOrBlock("/relatorios")}
                  tooltip="Relatórios"
                  className={`h-10 transition-all font-normal ${itemsLocked ? "opacity-50" : ""}`}
                >
                  <BarChart3 className={`h-4 w-4 ${location === "/relatorios" ? "text-primary" : ""}`} />
                  <span>Relatórios</span>
                </SidebarMenuButton>
              </SidebarMenuItem>}

              {/* Financeiro */}
              {canSee("financeiro") && <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={location === "/financeiro"}
                  onClick={() => navigateOrBlock("/financeiro")}
                  tooltip="Financeiro"
                  className={`h-10 transition-all font-normal ${itemsLocked ? "opacity-50" : ""}`}
                >
                  <DollarSign className={`h-4 w-4 ${location === "/financeiro" ? "text-primary" : ""}`} />
                  <span className="flex-1">Financeiro</span>
                </SidebarMenuButton>
              </SidebarMenuItem>}

              {/* Configurações */}
              {canSee("configuracoes") && <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={location === "/configuracoes"}
                  onClick={() => navigateOrBlock("/configuracoes")}
                  tooltip="Configurações"
                  className={`h-10 transition-all font-normal ${itemsLocked ? "opacity-50" : ""}`}
                >
                  <Settings className={`h-4 w-4 ${location === "/configuracoes" ? "text-primary" : ""}`} />
                  <span>Configurações</span>
                </SidebarMenuButton>
              </SidebarMenuItem>}

              {/* Roadmap — todos os usuários logados podem ver e votar.
                  Sem canSee() porque não está no sistema de permissões. */}
              {!moduloOcultoNoMenu("roadmap") && <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={location === "/roadmap"}
                  onClick={() => navigateOrBlock("/roadmap")}
                  tooltip="Roadmap"
                  className={`h-10 transition-all font-normal ${itemsLocked ? "opacity-50" : ""}`}
                >
                  <Lightbulb className={`h-4 w-4 ${location === "/roadmap" ? "text-primary" : ""}`} />
                  <span className="flex-1">Roadmap</span>
                </SidebarMenuButton>
              </SidebarMenuItem>}

              {/* Meu Plano migrou pra aba dentro de /configuracoes
                  (visível apenas pro Dono do escritório / admin). Aqui
                  fica só o atalho "Assinar plano" quando a conta está
                  sem assinatura ativa — guia o usuário pra ação. */}
              {(user?.role === "admin" || minhasPerms?.cargo === "Dono") && itemsLocked && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    onClick={() => setLocation("/configuracoes?tab=meu-plano")}
                    tooltip="Assinar plano"
                    className="h-10 transition-all font-normal"
                  >
                    <CreditCard className="h-4 w-4" />
                    <span>Assinar plano</span>
                    <Badge variant="destructive" className="text-[9px] px-1.5 py-0 ml-auto">
                      !
                    </Badge>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarContent>

          <SidebarFooter className="p-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-3 rounded-lg px-1 py-1 hover:bg-accent/50 transition-colors w-full text-left group-data-[collapsible=icon]:justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Avatar className="h-9 w-9 border shrink-0">
                    <AvatarFallback className="text-xs font-medium bg-primary/10 text-primary">
                      {user?.name?.charAt(0).toUpperCase() || "U"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
                    <p className="text-sm font-medium truncate leading-none text-foreground">
                      {user?.name || "Utilizador"}
                    </p>
                    <p className="text-xs text-muted-foreground truncate mt-1.5">
                      {user?.email || "-"}
                    </p>
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                {isAdmin && (
                  <>
                    <DropdownMenuItem
                      onClick={() => setLocation("/admin")}
                      className="cursor-pointer"
                    >
                      <ShieldCheck className="mr-2 h-4 w-4" />
                      <span>Painel Admin</span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                {isMobile && canSee("atendimento") && (
                  <>
                    <DropdownMenuItem onClick={voltarModoAtendimento} className="cursor-pointer">
                      <Smartphone className="mr-2 h-4 w-4" />
                      <span>Modo atendimento</span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                {mostrarInstalar && (
                  <DropdownMenuItem onClick={instalarApp} className="cursor-pointer">
                    <Download className="mr-2 h-4 w-4" />
                    <span>Instalar app</span>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onClick={logout}
                  className="cursor-pointer text-destructive focus:text-destructive"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Sair</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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
                      <AvatarFallback className="text-xs font-medium bg-primary/10 text-primary">
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
