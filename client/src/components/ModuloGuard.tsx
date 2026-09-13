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
import { moduloRemovidoNoAmbiente } from "@shared/modulos-por-ambiente";

/**
 * Tela do módulo que existe no produto mas não NESTE ambiente.
 *
 * Separada da de "não faz parte do seu plano" de propósito: não é questão de
 * contrato, e mandar o advogado "ver meu plano" pra um módulo que nem está no
 * ar seria empurrá-lo pra uma resposta que não existe.
 */
function ModuloEmTestes({ modulos }: { modulos: string[] }) {
  const [, setLocation] = useLocation();
  const nome = MODULOS_APP.find((m) => m.id === modulos[0])?.nome ?? modulos[0];
  return (
    <div className="mx-auto mt-16 max-w-lg px-4 text-center">
      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-warning/30 bg-warning-bg dark:bg-warning/40">
        <Lock className="h-7 w-7 text-warning-fg" />
      </div>
      <h2 className="text-lg font-bold">{nome} está em testes</h2>
      <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
        Este módulo ainda não foi liberado. Ele volta pra cá quando estiver
        pronto — nada do que você já cadastrou foi apagado.
      </p>
      <div className="mt-5 flex justify-center gap-2.5">
        <Button variant="outline" onClick={() => setLocation("/dashboard")}>
          Voltar pro início
        </Button>
      </div>
    </div>
  );
}

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

/** Ambiente onde o app está rodando, como o servidor o resolveu. */
export function useAmbienteDoApp() {
  const { data } = trpc.subscription.modulosContratados.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });
  return data?.ambiente ?? null;
}

export default function ModuloGuard({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const contratados = useModulosContratados();
  const ambiente = useAmbienteDoApp();

  const exigidos = modulosDaRota(location);
  // Módulo fora deste ambiente é barrado ANTES da conta de contrato: o
  // fail-open (cesta indeterminada = tudo liberado) abriria a rota de um
  // módulo que o dono tirou do ar. Sem ambiente resolvido nada muda — quem
  // decide o "na dúvida é produção" é o shared, com o valor que o servidor
  // mandou, não a ausência de resposta.
  if (exigidos && ambiente && exigidos.some((m) => moduloRemovidoNoAmbiente(m, ambiente))) {
    return <ModuloEmTestes modulos={exigidos} />;
  }
  if (exigidos && !contratoLibera(contratados, exigidos)) {
    return <ModuloBloqueado modulos={exigidos} />;
  }
  return <>{children}</>;
}
