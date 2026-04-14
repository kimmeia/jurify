import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { useEffect } from "react";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * SubscriptionGuard wraps client-area pages.
 * Allows access if user has active subscription OR has credits (avulso/trial).
 * Admins bypass this check entirely.
 */
export default function SubscriptionGuard({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading: authLoading } = useAuth();
  const [location, setLocation] = useLocation();

  const {
    data: subscription,
    isLoading: subLoading,
    isFetched: subFetched,
    error: subError,
  } = trpc.subscription.current.useQuery(undefined, {
    enabled: !!user && user.role === "user",
    retry: false,
    refetchOnWindowFocus: false,
  });

  const {
    data: credits,
    isLoading: creditsLoading,
    isFetched: creditsFetched,
    error: creditsError,
  } = trpc.dashboard.credits.useQuery(undefined, {
    enabled: !!user && user.role === "user",
    retry: false,
    refetchOnWindowFocus: false,
  });

  const isLoading = authLoading || (user?.role === "user" && (subLoading || creditsLoading));
  const hasSubscription = !!subscription;
  const hasCredits = (credits?.creditsRemaining ?? 0) > 0;
  const hasAccess = hasSubscription || hasCredits;
  const queriesDone = subFetched && creditsFetched;

  // Se as queries falharam por UNAUTHORIZED (ex: colaborador removido),
  // o handler global em main.tsx faz logout + redirect. NÃO devemos
  // mandar pra /plans nesse caso — isso confunde o usuário (sugere que
  // ele só precisa assinar, quando na verdade perdeu acesso ao escritório).
  const authError =
    (subError as any)?.data?.code === "UNAUTHORIZED" ||
    (creditsError as any)?.data?.code === "UNAUTHORIZED";

  useEffect(() => {
    if (isLoading) return;
    if (!user) return;
    if (user.role === "admin") return;
    if (authError) return; // logout em curso
    if (queriesDone && !hasAccess) {
      if (location !== "/plans") {
        setLocation("/plans");
      }
    }
  }, [isLoading, user, hasAccess, queriesDone, location, setLocation, authError]);

  if (isLoading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
        </div>
      </div>
    );
  }

  // Bloqueia render quando vai redirecionar pra Plans, OU quando há
  // erro de auth (logout em curso, evita flash de UI sem dados).
  if (
    user?.role === "user" &&
    queriesDone &&
    !hasAccess &&
    !authError &&
    location !== "/plans"
  ) {
    return null;
  }
  if (authError) return null;

  return <>{children}</>;
}
