/**
 * Guia de 3 passos do pacote Acompanhamento Processual — quem chega da
 * campanha não cai numa tela vazia, cai num caminho. Cada passo abre o
 * fluxo REAL correspondente (cofre, cliente essencial, novas ações); não
 * é um wizard paralelo. Completou → vira linha de sucesso e some.
 */

import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, KeyRound, Radar, UserPlus } from "lucide-react";
import { TRIBUNAIS_PJE } from "@shared/tribunais-pje";

const FLAG_EM_ANDAMENTO = "guiaProcessualEmAndamento";

function lerFlag(): boolean {
  try {
    return sessionStorage.getItem(FLAG_EM_ANDAMENTO) === "1";
  } catch {
    return false;
  }
}

export default function GuiaProcessual({
  credenciais,
  monitoramentosAtivos,
}: {
  credenciais: { id: number }[] | undefined;
  monitoramentosAtivos: number;
}) {
  const [, setLocation] = useLocation();
  const [sucessoOculto, setSucessoOculto] = useState(false);

  // Mesma regra do Cofre (podeCofre): o guia pede credencial, e credencial
  // é coisa de dono/gestor — colaborador comum não tem o que fazer aqui.
  const { data: minhasPerms } = trpc.permissoes?.minhasPermissoes?.useQuery?.(
    undefined,
    { retry: false, refetchOnWindowFocus: false },
  ) || { data: null };
  const podeGuia =
    minhasPerms?.cargo === "Dono" || !!minhasPerms?.permissoes?.processos?.verTodos;

  const { data: clientesData } = trpc.clientesEssencial.listar.useQuery(
    {},
    { retry: false, staleTime: 60_000, enabled: podeGuia },
  );

  const passo1 = (credenciais?.length ?? 0) > 0;
  const passo2 = (clientesData?.itens?.length ?? 0) > 0;
  const passo3 = monitoramentosAtivos > 0;
  const feitos = [passo1, passo2, passo3].filter(Boolean).length;
  const completo = passo1 && passo3;
  const carregado = credenciais != null;

  const mostrarGuia = carregado && podeGuia && !completo;

  // Marca que o guia esteve na tela: é o que permite mostrar a linha de
  // sucesso SÓ pra quem acabou de completar (e não pra toda conta antiga
  // que já monitora há meses). Some sozinha no próximo login.
  useEffect(() => {
    if (!mostrarGuia) return;
    try {
      sessionStorage.setItem(FLAG_EM_ANDAMENTO, "1");
    } catch {
      /* storage bloqueado — o guia funciona igual, só sem linha de sucesso */
    }
  }, [mostrarGuia]);

  const mostrarSucesso = carregado && podeGuia && completo && lerFlag() && !sucessoOculto;

  if (mostrarSucesso) {
    return (
      <Card className="border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30">
        <CardContent className="flex flex-wrap items-center gap-3 py-3.5">
          <span className="text-xl">🎉</span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-emerald-900 dark:text-emerald-200">
              Monitoramento ligado — {feitos} de 3 passos
            </p>
            <p className="text-xs text-emerald-800 dark:text-emerald-300/90">
              Credencial conectada e monitoramento ativo. Os alertas chegam sozinhos a partir de agora.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="border-emerald-300 dark:border-emerald-800"
            onClick={() => {
              setSucessoOculto(true);
              try {
                sessionStorage.removeItem(FLAG_EM_ANDAMENTO);
              } catch {
                /* sem storage não há o que limpar */
              }
            }}
          >
            Entendi, pode esconder
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!mostrarGuia) return null;

  const passos = [
    {
      n: 1,
      feito: passo1,
      icone: KeyRound,
      titulo: "Conecte seu tribunal",
      desc: "Sua credencial do PJe, guardada cifrada — é com ela que consultamos por você.",
      botao: "Conectar credencial",
      destino: "/processos?tab=cofre&novo=1",
      travado: false,
    },
    {
      n: 2,
      feito: passo2,
      icone: UserPlus,
      titulo: "Cadastre um cliente",
      desc: "Só nome, CPF/CNPJ e responsável. Opcional pra quem só quer vigiar um CNJ.",
      botao: "Cadastrar cliente",
      destino: "/clientes?novo=1",
      travado: false,
    },
    {
      n: 3,
      feito: passo3,
      icone: Radar,
      titulo: "Vigie um processo ou CPF",
      desc: "Cole um CNJ ou monitore o CPF/CNPJ do cliente pra detectar ações novas.",
      botao: passo1 ? "Vigiar agora" : "Precisa do passo 1",
      destino: "/processos?tab=novas-acoes&novo=1",
      travado: !passo1,
    },
  ];

  return (
    <Card className="border-violet-200 dark:border-violet-800/60 bg-gradient-to-br from-violet-50 dark:from-violet-950/40 to-background">
      <CardContent className="py-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="font-bold text-foreground">Ligue seu monitoramento em 3 passos</p>
            <p className="text-sm text-muted-foreground">
              Em ~5 minutos o JuridFlow começa a vigiar seus processos e te avisar de cada movimentação.
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm font-bold text-violet-700 dark:text-violet-300 tabular-nums">
              {feitos} de 3
            </p>
            <p className="text-[10px] text-muted-foreground">este guia some quando terminar</p>
          </div>
        </div>

        <div className="grid gap-2.5 md:grid-cols-3">
          {passos.map((p) => (
            <div
              key={p.n}
              className={`rounded-xl border bg-card p-3.5 ${
                p.feito ? "border-emerald-300 dark:border-emerald-800" : ""
              } ${p.travado ? "opacity-60" : ""}`}
            >
              <div className="flex items-center gap-2 mb-1.5">
                {p.feito ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                ) : (
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-600 text-[11px] font-bold text-white">
                    {p.n}
                  </span>
                )}
                <p className="text-sm font-semibold leading-tight">{p.titulo}</p>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed min-h-[2.5rem]">{p.desc}</p>
              {!p.feito && (
                <Button
                  size="sm"
                  className="mt-2 w-full"
                  variant={p.n === 2 ? "outline" : "default"}
                  disabled={p.travado}
                  onClick={() => setLocation(p.destino)}
                >
                  <p.icone className="h-3.5 w-3.5 mr-1.5" />
                  {p.botao}
                </Button>
              )}
              {p.feito && (
                <p className="mt-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300">Feito ✓</p>
              )}
            </div>
          ))}
        </div>

        <p className="text-[11px] text-muted-foreground">
          Cobertura hoje: PJe em {TRIBUNAIS_PJE.length} estados (
          {TRIBUNAIS_PJE.slice(0, 5).map((t) => t.uf).join(", ")}…) · novas ações por CPF/CNPJ: TJCE.
          Seu tribunal não está na lista? Registre o interesse no Cofre — a gente avisa quando chegar.
        </p>
      </CardContent>
    </Card>
  );
}
