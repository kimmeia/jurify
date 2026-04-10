import { useAuth } from "@/_core/hooks/useAuth";
import { useNotificacoes } from "@/hooks/useNotificacoes";
import { trpc } from "@/lib/trpc";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { getLoginUrl } from "@/const";
import { useIsMobile } from "@/hooks/useMobile";
import {
  LayoutDashboard,
  Calculator,
  LogOut,
  PanelLeft,
  ChevronRight,
  Landmark,
  Building2,
  Briefcase,
  Receipt,
  ShieldCheck,
  TrendingUp,
  CreditCard,
  Lock,
  FileSearch,
  Headphones,
  CalendarDays,
  Settings,
  Users,
  BarChart3,
  Bell,
  CheckSquare,
  DollarSign,
  BrainCircuit,
  Zap,
  LayoutGrid,
} from "lucide-react";
import { CSSProperties, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";
import { Button } from "./ui/button";
import { toast } from "sonner";

const calculosSubItems = [
  { icon: Landmark, label: "Bancário", path: "/calculos/bancario" },
  { icon: Building2, label: "Imobiliário", path: "/calculos/imobiliario" },
  { icon: Briefcase, label: "Trabalhista", path: "/calculos/trabalhista" },
  { icon: Receipt, label: "Tributário", path: "/calculos/tributario" },
  { icon: ShieldCheck, label: "Previdenciário", path: "/calculos/previdenciario" },
  { icon: TrendingUp, label: "Cálculos Diversos", path: "/calculos/atualizacao-monetaria" },
];

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
              window.location.href = getLoginUrl();
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
  const [calculosOpen, setCalculosOpen] = useState(
    location.startsWith("/calculos")
  );

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

  // Permissões do usuário (sidebar dinâmica)
  const { data: minhasPerms } = (trpc as any).permissoes?.minhasPermissoes?.useQuery?.(undefined, { retry: false, refetchOnWindowFocus: false }) || { data: null };
  const canSee = (modulo: string) => {
    if (!minhasPerms?.permissoes) return true; // se não carregou ainda, mostra tudo
    const p = minhasPerms.permissoes[modulo];
    if (!p) return true; // módulo sem permissão explícita = visível por padrão
    return p?.verTodos || p?.verProprios;
  };

  useEffect(() => {
    if (location.startsWith("/calculos")) {
      setCalculosOpen(true);
    }
  }, [location]);

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
  const { naoLidas, limpar: limparNotificacoes } = useNotificacoes(user?.id);
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

  return (
    <>
      <div className="relative" ref={sidebarRef}>
        <Sidebar
          collapsible="icon"
          className="border-r-0"
          disableTransition={isResizing}
        >
          <SidebarHeader className="h-16 justify-center">
            <div className="flex items-center gap-3 px-2 transition-all w-full">
              <button
                onClick={toggleSidebar}
                className="h-8 w-8 flex items-center justify-center hover:bg-accent rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring shrink-0"
                aria-label="Alternar navegação"
              >
                <PanelLeft className="h-4 w-4 text-muted-foreground" />
              </button>
              {!isCollapsed ? (
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-semibold tracking-tight truncate text-foreground">
                    Cálculos
                  </span>
                  {isAdmin && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                      Admin
                    </Badge>
                  )}
                </div>
              ) : null}
              {!isCollapsed && naoLidas > 0 && (
                <button onClick={limparNotificacoes} className="relative h-8 w-8 flex items-center justify-center hover:bg-accent rounded-lg transition-colors ml-auto shrink-0" title={`${naoLidas} notificação(ões)`}>
                  <Bell className="h-4 w-4 text-muted-foreground" />
                  <span className="absolute -top-0.5 -right-0.5 h-4 min-w-[16px] rounded-full bg-red-500 text-[9px] font-bold text-white flex items-center justify-center px-1">{naoLidas > 99 ? "99+" : naoLidas}</span>
                </button>
              )}
            </div>
          </SidebarHeader>

          <SidebarContent className="gap-0">
            <SidebarMenu className="px-2 py-1">
              {/* Dashboard */}
              <SidebarMenuItem>
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
                  {itemsLocked && <Lock className="h-3 w-3 text-muted-foreground ml-auto" />}
                </SidebarMenuButton>
              </SidebarMenuItem>

              {/* Cálculos (collapsible) */}
              <Collapsible open={calculosOpen} onOpenChange={setCalculosOpen}>
                <SidebarMenuItem>
                  <CollapsibleTrigger asChild>
                    <SidebarMenuButton
                      tooltip="Cálculos"
                      className={`h-10 transition-all font-normal ${itemsLocked ? "opacity-50" : ""}`}
                      isActive={location.startsWith("/calculos")}
                    >
                      <Calculator
                        className={`h-4 w-4 ${location.startsWith("/calculos") ? "text-primary" : ""}`}
                      />
                      <span className="flex-1">Cálculos</span>
                      {itemsLocked && <Lock className="h-3 w-3 text-muted-foreground mr-1" />}
                      <ChevronRight
                        className={`h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 ${calculosOpen ? "rotate-90" : ""}`}
                      />
                    </SidebarMenuButton>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <SidebarMenuSub>
                      {calculosSubItems.map((item) => {
                        const isActive = location === item.path;
                        return (
                          <SidebarMenuSubItem key={item.path}>
                            <SidebarMenuSubButton
                              isActive={isActive}
                              onClick={() => navigateOrBlock(item.path)}
                              className={`cursor-pointer ${itemsLocked ? "opacity-50" : ""}`}
                            >
                              <item.icon className="h-3.5 w-3.5" />
                              <span>{item.label}</span>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        );
                      })}
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </SidebarMenuItem>
              </Collapsible>

              {/* Clientes */}
              {canSee("clientes") && <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={location === "/clientes"}
                  onClick={() => navigateOrBlock("/clientes")}
                  tooltip="Clientes"
                  className={`h-10 transition-all font-normal ${itemsLocked ? "opacity-50" : ""}`}
                >
                  <Users className={`h-4 w-4 ${location === "/clientes" ? "text-primary" : ""}`} />
                  <span>Clientes</span>
                </SidebarMenuButton>
              </SidebarMenuItem>}

              {/* Agenda (unifica Tarefas + Agendamento) */}
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={location === "/agenda"}
                  onClick={() => navigateOrBlock("/agenda")}
                  tooltip="Agenda"
                  className={`h-10 transition-all font-normal ${itemsLocked ? "opacity-50" : ""}`}
                >
                  <CalendarDays className={`h-4 w-4 ${location === "/agenda" ? "text-primary" : ""}`} />
                  <span>Agenda</span>
                </SidebarMenuButton>
              </SidebarMenuItem>

              {/* Processos */}
              {canSee("processos") && <SidebarMenuItem>
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
                  <Badge variant="outline" className="text-[9px] px-1 py-0 ml-auto border-amber-300 text-amber-600 bg-amber-50 dark:bg-amber-950/20">
                    Beta
                  </Badge>
                </SidebarMenuButton>
              </SidebarMenuItem>}

              {/* Atendimento */}
              {canSee("atendimento") && <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={location === "/atendimento"}
                  onClick={() => navigateOrBlock("/atendimento")}
                  tooltip="Atendimento"
                  className={`h-10 transition-all font-normal ${itemsLocked ? "opacity-50" : ""}`}
                >
                  <Headphones className={`h-4 w-4 ${location === "/atendimento" ? "text-primary" : ""}`} />
                  <span>Atendimento</span>
                  <Badge variant="outline" className="text-[9px] px-1 py-0 ml-auto border-amber-300 text-amber-600 bg-amber-50 dark:bg-amber-950/20">
                    Beta
                  </Badge>
                </SidebarMenuButton>
              </SidebarMenuItem>}

              {/* Agentes IA */}
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={location === "/agentes-ia"}
                  onClick={() => navigateOrBlock("/agentes-ia")}
                  tooltip="Agentes IA"
                  className={`h-10 transition-all font-normal ${itemsLocked ? "opacity-50" : ""}`}
                >
                  <BrainCircuit className={`h-4 w-4 ${location === "/agentes-ia" ? "text-primary" : ""}`} />
                  <span>Agentes IA</span>
                  <Badge variant="outline" className="text-[9px] px-1 py-0 ml-auto border-violet-300 text-violet-600 bg-violet-50 dark:bg-violet-950/20">
                    Novo
                  </Badge>
                </SidebarMenuButton>
              </SidebarMenuItem>

              {/* Kanban */}
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={location === "/kanban"}
                  onClick={() => navigateOrBlock("/kanban")}
                  tooltip="Kanban"
                  className={`h-10 transition-all font-normal ${itemsLocked ? "opacity-50" : ""}`}
                >
                  <LayoutGrid className={`h-4 w-4 ${location === "/kanban" ? "text-primary" : ""}`} />
                  <span>Kanban</span>
                  <Badge variant="outline" className="text-[9px] px-1 py-0 ml-auto border-indigo-300 text-indigo-600 bg-indigo-50 dark:bg-indigo-950/20">
                    Novo
                  </Badge>
                </SidebarMenuButton>
              </SidebarMenuItem>

              {/* SmartFlow */}
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={location === "/smartflow"}
                  onClick={() => navigateOrBlock("/smartflow")}
                  tooltip="SmartFlow"
                  className={`h-10 transition-all font-normal ${itemsLocked ? "opacity-50" : ""}`}
                >
                  <Zap className={`h-4 w-4 ${location === "/smartflow" ? "text-primary" : ""}`} />
                  <span>SmartFlow</span>
                  <Badge variant="outline" className="text-[9px] px-1 py-0 ml-auto border-amber-300 text-amber-600 bg-amber-50 dark:bg-amber-950/20">
                    Novo
                  </Badge>
                </SidebarMenuButton>
              </SidebarMenuItem>

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
                  <span>Financeiro</span>
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

              {/* Meu Plano - always accessible */}
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={location === "/plans"}
                  onClick={() => setLocation("/plans")}
                  tooltip="Meu Plano"
                  className="h-10 transition-all font-normal"
                >
                  <CreditCard
                    className={`h-4 w-4 ${location === "/plans" ? "text-primary" : ""}`}
                  />
                  <span>Meu Plano</span>
                  {itemsLocked && (
                    <Badge variant="destructive" className="text-[9px] px-1.5 py-0 ml-auto">
                      Assinar
                    </Badge>
                  )}
                </SidebarMenuButton>
              </SidebarMenuItem>
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
        {isMobile && (
          <div className="flex border-b h-14 items-center justify-between bg-background/95 px-2 backdrop-blur supports-[backdrop-filter]:backdrop-blur sticky top-0 z-40">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="h-9 w-9 rounded-lg bg-background" />
              <span className="tracking-tight text-foreground font-medium">
                SaaS de Cálculos
              </span>
            </div>
          </div>
        )}
        <main className="flex-1 p-6">{children}</main>
      </SidebarInset>
    </>
  );
}

/**
 * Banner amarelo persistente no topo do app indicando que o admin do
 * Jurify está vendo a conta de outro usuário (impersonation). Botão
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
