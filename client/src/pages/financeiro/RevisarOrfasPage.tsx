/**
 * Página /financeiro/revisar-orfas — fila de revisão das cobranças sem
 * cliente vinculado.
 *
 * Cobrança fica órfã (contatoId=NULL) quando o webhook PAYMENT_RECEIVED
 * chega antes do customer Asaas ser vinculado a um contato do CRM. O
 * webhook tenta auto-vincular por CPF (PR-3), mas pode falhar se o cliente
 * não tem CPF cadastrado no Asaas ou se o CPF não bate com nenhum contato.
 *
 * Pra cada grupo (customer Asaas), o operador escolhe:
 *  - Vincular a cliente existente (busca por nome/CPF)
 *  - Cadastrar como cliente novo (cria contato + vincula)
 *  - Ignorar por agora
 */

import { useState } from "react";
import { ArrowLeft, UserPlus, Plus, Loader2, AlertTriangle } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "sonner";

function formatBRL(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatData(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso + "T12:00:00").toLocaleDateString("pt-BR");
}

export default function RevisarOrfasPage() {
  const utils = trpc.useUtils();
  const { data: orfas = [], isLoading, refetch } =
    trpc.financeiro.listarOrfasAgrupadas.useQuery(undefined, {
      staleTime: 30_000,
    });

  const vincularMut = trpc.financeiro.vincularOrfas.useMutation({
    onSuccess: (r) => {
      toast.success(`${r.vinculadas} cobrança(s) vinculada(s)`);
      refetch();
      utils.financeiro.contadoresPendencia.invalidate();
      utils.asaas.listarCobrancas.invalidate();
    },
    onError: (err: any) => toast.error("Erro", { description: err.message }),
  });

  return (
    <div className="container mx-auto px-4 sm:px-6 py-6 space-y-4 max-w-5xl">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => (window.location.href = "/financeiro")}
          className="h-8"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Voltar pro Financeiro
        </Button>
        <h1 className="text-xl font-semibold tracking-tight">
          Revisar cobranças sem cliente
        </h1>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            Como isso aconteceu?
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground space-y-1">
          <p>
            Quando o Asaas notifica um pagamento e o pagador (CPF do customer
            Asaas) ainda não está vinculado a um contato do seu CRM, a cobrança
            entra "órfã" — sem cliente associado.
          </p>
          <p>
            Pra cada grupo abaixo, vincule ao cliente correto. Se o pagador é
            só um <b>pagador eventual</b> (ex: esposa pagando pelo cliente),
            vincule ao cliente real (Carlos). O nome do pagador fica preservado
            como referência histórica.
          </p>
        </CardContent>
      </Card>

      {isLoading && (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {!isLoading && orfas.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            <UserPlus className="h-10 w-10 mx-auto mb-3 text-emerald-500 opacity-60" />
            Nenhuma cobrança órfã. 🎉
            <p className="text-xs mt-2">
              Toda cobrança recebida está vinculada a um cliente do CRM.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {orfas.map((g) => (
          <GrupoOrfa
            key={g.asaasCustomerId ?? "null"}
            grupo={g}
            onVincular={(contatoId) => {
              if (!g.asaasCustomerId) return;
              vincularMut.mutate({
                asaasCustomerId: g.asaasCustomerId,
                contatoId,
              });
            }}
            isPending={vincularMut.isPending}
          />
        ))}
      </div>
    </div>
  );
}

function GrupoOrfa({
  grupo,
  onVincular,
  isPending,
}: {
  grupo: {
    asaasCustomerId: string | null;
    nomeCustomer: string | null;
    qtd: number;
    valorTotal: number;
    primeiraData: string | null;
    ultimaData: string | null;
  };
  onVincular: (contatoId: number) => void;
  isPending: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState(grupo.nomeCustomer ?? "");
  const [selecionado, setSelecionado] = useState<{ id: number; nome: string } | null>(
    null,
  );
  const { data: contatos = [] } = (trpc as any).crm?.listarContatos?.useQuery?.(
    { busca: busca || undefined },
    { staleTime: 30_000, enabled: aberto },
  ) ?? { data: [] };

  const criarMut = (trpc as any).crm?.criarContato?.useMutation?.({
    onSuccess: (novo: any) => {
      toast.success(`Cliente "${novo.nome}" criado`);
      onVincular(novo.id);
      setAberto(false);
    },
    onError: (err: any) =>
      toast.error("Erro ao criar cliente", { description: err.message }),
  }) ?? { mutate: () => {}, isPending: false };

  return (
    <Card>
      <CardContent className="pt-4 space-y-2">
        <div className="flex items-start gap-4">
          <div className="flex-1">
            <div className="font-medium text-sm">
              {grupo.nomeCustomer ?? "(pagador desconhecido)"}
            </div>
            <div className="text-xs text-muted-foreground">
              Customer Asaas:{" "}
              <code className="text-[10px]">{grupo.asaasCustomerId ?? "—"}</code>
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {grupo.qtd} cobrança{grupo.qtd === 1 ? "" : "s"} ·{" "}
              <b className="text-foreground">{formatBRL(grupo.valorTotal)}</b> ·{" "}
              {formatData(grupo.primeiraData)} até {formatData(grupo.ultimaData)}
            </div>
          </div>
          {!aberto && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAberto(true)}
              disabled={!grupo.asaasCustomerId}
            >
              <UserPlus className="h-3.5 w-3.5 mr-1" />
              Vincular
            </Button>
          )}
        </div>

        {aberto && (
          <div className="border-t pt-3 space-y-2">
            <div className="space-y-1">
              <Label className="text-xs">Buscar cliente existente</Label>
              <Input
                placeholder="Nome ou CPF..."
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
            <div className="max-h-44 overflow-y-auto border rounded">
              {(contatos as any[]).length === 0 && busca.length > 0 && (
                <div className="p-2 text-xs text-muted-foreground text-center">
                  Nenhum cliente encontrado
                </div>
              )}
              {(contatos as any[]).slice(0, 10).map((c: any) => (
                <button
                  type="button"
                  key={c.id}
                  onClick={() => setSelecionado({ id: c.id, nome: c.nome })}
                  className={
                    "w-full text-left p-2 text-xs hover:bg-accent border-b last:border-b-0 " +
                    (selecionado?.id === c.id ? "bg-emerald-50" : "")
                  }
                >
                  <div className="font-medium">{c.nome}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {c.cpfCnpj || c.telefone || "sem CPF/telefone"}
                  </div>
                </button>
              ))}
            </div>
            <div className="flex gap-2 flex-wrap pt-1">
              <Button
                size="sm"
                disabled={!selecionado || isPending}
                onClick={() => selecionado && onVincular(selecionado.id)}
              >
                {isPending ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                ) : (
                  <UserPlus className="h-3.5 w-3.5 mr-1" />
                )}
                Vincular ao selecionado
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!grupo.nomeCustomer || isPending || criarMut.isPending}
                onClick={() => {
                  if (!grupo.nomeCustomer) return;
                  criarMut.mutate({ nome: grupo.nomeCustomer });
                }}
              >
                {criarMut.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                ) : (
                  <Plus className="h-3.5 w-3.5 mr-1" />
                )}
                Cadastrar como novo
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setAberto(false);
                  setSelecionado(null);
                }}
              >
                Cancelar
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
