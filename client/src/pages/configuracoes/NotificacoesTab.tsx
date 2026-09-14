/**
 * Notificações — o que faz o celular tocar.
 *
 * A lista vem do servidor já filtrada por quem a pessoa é: Dinheiro só com
 * acesso ao Financeiro, Saúde do sistema só pro dono. Oferecer a chave de um
 * aviso que a pessoa nunca receberia é prometer o que não acontece.
 *
 * Cada chave salva sozinha — não existe botão "Salvar". Numa tela de dezessete
 * interruptores, o botão é o lugar onde a escolha se perde.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import {
  BellRing,
  BellOff,
  Gavel,
  MessageCircle,
  DollarSign,
  FileSignature,
  HeartPulse,
  Moon,
  Cake,
} from "lucide-react";
import { toast } from "sonner";

const ICONE: Record<string, React.ReactNode> = {
  processos: <Gavel className="h-4 w-4" />,
  atendimento: <MessageCircle className="h-4 w-4" />,
  clientes: <Cake className="h-4 w-4" />,
  dinheiro: <DollarSign className="h-4 w-4" />,
  documentos: <FileSignature className="h-4 w-4" />,
  saude: <HeartPulse className="h-4 w-4" />,
};

/** O aparelho é separado da escolha: ativar no computador não ativa no celular. */
function EsteAparelho() {
  const push = usePushNotifications();
  const testar = trpc.push.testar.useMutation({
    onSuccess: (r: { inscricoes?: number; enviados?: number }) => {
      if ((r?.enviados ?? 0) > 0) {
        toast.success("Enviado", { description: "Se não aparecer, recarregue o app uma vez." });
      } else {
        toast.error("Não saiu", {
          description: `Este aparelho tem ${r?.inscricoes ?? 0} inscrição(ões). Ative de novo aqui.`,
        });
      }
    },
    onError: (e) => toast.error("Não deu pra testar", { description: e.message }),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Este aparelho</CardTitle>
        <CardDescription>
          Cada aparelho é separado: ativar no computador não ativa no celular. É no celular que o
          aviso serve pra alguma coisa.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {push.estado === "ativo" ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-success/30 bg-success/5 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <BellRing className="h-4 w-4 text-success-fg" />
              <p className="text-[13px] font-semibold text-success-fg">Ativado neste aparelho</p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-[12px]"
                disabled={testar.isPending}
                onClick={() => testar.mutate()}
              >
                Enviar um teste
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-[12px] text-muted-foreground"
                disabled={push.ocupado}
                onClick={() => push.desativar()}
              >
                Desativar aqui
              </Button>
            </div>
          </div>
        ) : push.estado === "negado" ? (
          <p className="flex items-center gap-2 rounded-xl border bg-muted/40 px-3 py-2.5 text-[12.5px] text-muted-foreground">
            <BellOff className="h-4 w-4 shrink-0" />
            As notificações estão bloqueadas no navegador deste aparelho. Libere nas configurações
            do navegador e volte aqui.
          </p>
        ) : push.estado === "indisponivel" ? (
          <p className="rounded-xl border bg-muted/40 px-3 py-2.5 text-[12.5px] text-muted-foreground">
            Este navegador não recebe notificação. No iPhone, é preciso instalar o app na tela de
            início primeiro.
          </p>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border px-3 py-2.5">
            <p className="text-[12.5px] text-muted-foreground">
              Este aparelho ainda não recebe notificação.
            </p>
            <Button size="sm" className="h-8 text-[12px]" disabled={push.ocupado} onClick={() => push.ativar()}>
              <BellRing className="mr-1.5 h-3.5 w-3.5" />
              Ativar neste aparelho
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Linha({
  titulo,
  explica,
  padrao,
  ligado,
  onChange,
}: {
  titulo: string;
  explica: string;
  padrao?: boolean;
  ligado: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border/60 py-3 last:border-0">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold">{titulo}</span>
          {padrao && (
            <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              padrão
            </span>
          )}
        </div>
        <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{explica}</p>
      </div>
      <Switch checked={ligado} onCheckedChange={onChange} aria-label={titulo} />
    </div>
  );
}

export default function NotificacoesTab() {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.notificacoes.preferencias.useQuery(undefined, { retry: false });
  /** O que o clique acabou de mudar, antes de o servidor confirmar. */
  const [local, setLocal] = useState<Record<string, boolean>>({});

  const salvar = trpc.notificacoes.salvarPreferencia.useMutation({
    onError: (e, vars) => {
      // Desfaz o clique otimista: chave que falhou não pode ficar mostrando o
      // que não foi gravado.
      setLocal((m) => {
        const copia = { ...m };
        delete copia[vars.chave];
        return copia;
      });
      toast.error("Não deu pra salvar", { description: e.message });
    },
    onSettled: () => utils.notificacoes.preferencias.invalidate(),
  });

  const mudar = (chave: string, ligado: boolean) => {
    setLocal((m) => ({ ...m, [chave]: ligado }));
    salvar.mutate({ chave, ligado });
  };

  if (isLoading) return <Skeleton className="h-96 rounded-xl" />;

  const valor = (chave: string, doServidor: boolean) => local[chave] ?? doServidor;

  return (
    <div className="space-y-4">
      <EsteAparelho />

      {(data?.grupos ?? []).map((g) => (
        <Card key={g.id}>
          <CardHeader className="pb-1">
            <CardTitle className="flex items-center gap-2 text-base">
              {ICONE[g.id]}
              {g.titulo}
              {g.quemVe === "dono" && (
                <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                  só o dono
                </span>
              )}
            </CardTitle>
            {g.descricao && <CardDescription>{g.descricao}</CardDescription>}
          </CardHeader>
          <CardContent className="pt-1">
            {g.avisos.map((a) => (
              <Linha
                key={a.id}
                titulo={a.titulo}
                explica={a.explica}
                padrao={a.padrao}
                ligado={valor(a.id, a.ligado)}
                onChange={(v) => mudar(a.id, v)}
              />
            ))}
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Moon className="h-4 w-4" />
            Silêncio e alcance
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <Linha
            titulo="Não me incomode das 21h às 7h"
            explica="O aviso não some — fica no sino e aparece de manhã. Só não toca o celular de madrugada."
            ligado={valor("ajuste.silencio-noturno", data?.ajustes.silencioNoturno ?? true)}
            onChange={(v) => mudar("ajuste.silencio-noturno", v)}
          />
          {data?.ehDono && (
            <Linha
              titulo="Quero receber também o que é dos meus colaboradores"
              explica="O aviso de movimentação vai pra quem cadastrou o processo no vigia. Se um colaborador cadastrou, o dono não fica sabendo."
              ligado={valor("ajuste.tudo-do-escritorio", data?.ajustes.tudoDoEscritorio ?? false)}
              onChange={(v) => mudar("ajuste.tudo-do-escritorio", v)}
            />
          )}
          <p className="mt-2 rounded-lg border bg-muted/40 px-3 py-2 text-[12px] text-muted-foreground">
            Prefere um aviso só por dia? O <b className="text-foreground">resumo diário</b> continua
            vindo por e-mail e WhatsApp — ele não depende de nada desta tela.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
