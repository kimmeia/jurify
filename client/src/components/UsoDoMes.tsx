/**
 * As barras de uso do mês — o que aparece no lugar do saldo de créditos.
 *
 * Crédito obrigava a saber de cabeça que consulta custa 1 e busca custa 3
 * para responder "posso consultar mais um processo?". Aqui cada operação tem
 * a sua barra e a pergunta se responde olhando.
 *
 * Operação sem limite no plano some da lista: barra cheia de nada é ruído.
 */
import { trpc } from "@/lib/trpc";
import {
  ROTULO_OPERACAO,
  fracaoUsada,
  limiteVale,
  type UsoDoMes as UsoDoMesItem,
} from "@shared/limites-uso";

function corDaBarra(fracao: number): string {
  if (fracao >= 1) return "bg-danger";
  if (fracao >= 0.8) return "bg-warning";
  return "bg-primary";
}

export function UsoDoMes({ titulo = "Uso deste mês" }: { titulo?: string }) {
  const { data } = (trpc as any).dashboard.usoDoMes.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });

  const itens: UsoDoMesItem[] = Array.isArray(data) ? data.filter((u: UsoDoMesItem) => limiteVale(u.limite)) : [];
  if (itens.length === 0) return null;

  return (
    <div className="space-y-2" data-testid="uso-do-mes">
      <p className="text-micro font-bold uppercase tracking-wide text-muted-foreground">{titulo}</p>
      {itens.map((u) => {
        const fracao = fracaoUsada(u);
        return (
          <div key={u.operacao}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-apoio font-semibold">{ROTULO_OPERACAO[u.operacao]}</span>
              <span className="text-micro tabular-nums text-muted-foreground">
                {u.usado} de {u.limite}
                {u.extra > 0 && <span className="ml-1 text-success-fg">(+{u.extra} liberados)</span>}
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
              <div className={"h-full rounded-full " + corDaBarra(fracao)} style={{ width: `${Math.round(fracao * 100)}%` }} />
            </div>
            {fracao >= 1 && (
              <p className="mt-0.5 text-micro text-danger-fg">
                Acabou por este mês. Fale com a gente para liberar mais.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
