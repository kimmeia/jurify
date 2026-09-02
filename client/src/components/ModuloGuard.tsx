/**
 * Guarda de rota por módulo CONTRATADO (plano do escritório) — o par client
 * do porteiro que vive em server/_core/gate-modulos.ts.
 *
 * Fail-open igual ao servidor: só bloqueia quando a resposta chegou, tem
 * lista não-vazia e a rota exige módulo fora dela. Carregando, erro, admin,
 * cortesia → renderiza normal (o servidor continua sendo a trava real).
 */

import { useLocation } from "wouter";
import { Lock } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { MODULOS_APP } from "@shared/modulos-app";
import { contratoLibera, modulosDaRota } from "@shared/modulos-contratacao";

function ModuloBloqueado({ modulos }: { modulos: string[] }) {
  const [, setLocation] = useLocation();
  const nome = MODULOS_APP.find((m) => m.id === modulos[0])?.nome ?? modulos[0];
  return (
    <div className="mx-auto mt-16 max-w-lg px-4 text-center">
      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-info/30 bg-info-bg dark:bg-info/40">
        <Lock className="h-7 w-7 text-info-fg" />
      </div>
      <h2 className="text-lg font-bold">{nome} não faz parte do seu plano</h2>
      <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
        Este módulo não está incluído no plano atual do escritório. Nenhum dado
        dele é carregado — o bloqueio vale também no servidor.
      </p>
      <div className="mt-5 flex justify-center gap-2.5">
        <Button onClick={() => setLocation("/configuracoes?tab=meu-plano")}>
          Ver meu plano
        </Button>
        <Button variant="outline" onClick={() => setLocation("/dashboard")}>
          Voltar pro início
        </Button>
      </div>
    </div>
  );
}

export function useModulosContratados(): string[] | null {
  const { data } = trpc.subscription.modulosContratados.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });
  return data?.modulos ?? null;
}

export default function ModuloGuard({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const contratados = useModulosContratados();

  const exigidos = modulosDaRota(location);
  if (exigidos && !contratoLibera(contratados, exigidos)) {
    return <ModuloBloqueado modulos={exigidos} />;
  }
  return <>{children}</>;
}
