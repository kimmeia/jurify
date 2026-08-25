/**
 * Clientes essencial — o cadastro de 3 campos do pacote Acompanhamento
 * Processual: nome, CPF/CNPJ e responsável. É a MESMA tabela `contatos` do
 * CRM; contratar Clientes completo depois só destrava funil/histórico/
 * documentos, sem migração.
 *
 * Existe porque monitorar novas ações por CPF/CNPJ exige cliente cadastrado
 * e porque o "ver só os meus" depende do responsável gravado no cliente.
 */

import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, Plus, Search, Users } from "lucide-react";
import { toast } from "sonner";

export default function ClientesEssencial() {
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const [busca, setBusca] = useState("");
  const { data, isLoading } = trpc.clientesEssencial.listar.useQuery({ busca: busca || undefined });
  const { data: respData } = trpc.clientesEssencial.responsaveis.useQuery();

  const [criarOpen, setCriarOpen] = useState(false);
  const [nome, setNome] = useState("");
  const [cpfCnpj, setCpfCnpj] = useState("");
  const [responsavelId, setResponsavelId] = useState<string>("");

  // Deep-link do guia processual (/clientes?novo=1): abre o cadastro direto,
  // sem obrigar o clique extra de quem veio do passo 2.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("novo") === "1") setCriarOpen(true);
  }, []);

  const criarMut = trpc.clientesEssencial.criar.useMutation({
    onError: (err) => toast.error("Erro ao cadastrar", { description: err.message }),
  });

  const itens = data?.itens ?? [];

  const submeter = (monitorar: boolean) => {
    if (!nome.trim()) { toast.error("Informe o nome"); return; }
    if (monitorar && !cpfCnpj.trim()) { toast.error("Pra monitorar, informe o CPF/CNPJ"); return; }
    criarMut.mutate(
      {
        nome: nome.trim(),
        cpfCnpj: cpfCnpj.trim() || undefined,
        responsavelId: responsavelId ? Number(responsavelId) : undefined,
      },
      {
        onSuccess: () => {
          utils.clientesEssencial.listar.invalidate();
          setCriarOpen(false);
          setNome(""); setCpfCnpj(""); setResponsavelId("");
          if (monitorar) {
            toast.success("Cliente cadastrado", {
              description: "Agora crie o monitoramento por CPF/CNPJ na aba Novas ações.",
            });
            setLocation("/processos");
          } else {
            toast.success("Cliente cadastrado");
          }
        },
      },
    );
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight leading-tight flex items-center gap-2">
            <Users className="h-5 w-5 text-violet-600 dark:text-violet-400" /> Clientes
            <Badge variant="outline" className="text-[9px] font-bold border-violet-500/40 text-violet-700 dark:text-violet-300">
              ESSENCIAL
            </Badge>
          </h1>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">
            O essencial pra vigiar processos e atribuir responsável — nome, CPF/CNPJ e quem cuida.
          </p>
        </div>
        <Button onClick={() => setCriarOpen(true)}>
          <Plus className="h-4 w-4 mr-1.5" /> Novo cliente
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative w-80 max-w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            className="pl-9 h-9"
            placeholder="Buscar por nome ou CPF/CNPJ…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
        <span className="text-xs text-muted-foreground">
          {itens.length} cliente{itens.length === 1 ? "" : "s"}
        </span>
      </div>

      {isLoading ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : itens.length === 0 ? (
        <div className="border rounded-xl py-14 text-center text-muted-foreground">
          <Users className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">
            {busca ? "Nenhum cliente encontrado." : "Cadastre o primeiro cliente pra começar a vigiar processos."}
          </p>
        </div>
      ) : (
        <div className="border rounded-xl bg-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Nome</th>
                <th className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">CPF · CNPJ</th>
                <th className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Responsável</th>
                <th className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Vigiado por</th>
                <th className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Cadastro</th>
              </tr>
            </thead>
            <tbody>
              {itens.map((c) => (
                <tr key={c.id} className="border-b last:border-0 hover:bg-accent/40">
                  <td className="px-4 py-2.5 font-semibold">{c.nome}</td>
                  <td className="px-4 py-2.5 text-muted-foreground tabular-nums">{c.cpfCnpj ?? "—"}</td>
                  <td className="px-4 py-2.5">{c.responsavelNome ?? "—"}</td>
                  <td className="px-4 py-2.5">
                    <span className="inline-flex flex-wrap gap-1.5">
                      {c.processosVinculados > 0 && (
                        <Badge variant="outline" className="text-[10px] border-violet-500/40 text-violet-700 dark:text-violet-300 bg-violet-500/10">
                          CNJ · {c.processosVinculados} processo{c.processosVinculados > 1 ? "s" : ""}
                        </Badge>
                      )}
                      {c.documentoVigiado && (
                        <Badge variant="outline" className="text-[10px] border-cyan-500/40 text-cyan-700 dark:text-cyan-300 bg-cyan-500/10">
                          {(c.cpfCnpj ?? "").replace(/\D/g, "").length === 14 ? "CNPJ" : "CPF"} · novas ações
                        </Badge>
                      )}
                      {c.processosVinculados === 0 && !c.documentoVigiado && (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground tabular-nums">
                    {new Date(c.criadoEm).toLocaleDateString("pt-BR")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        Funil, histórico de atendimento e documentos ficam no módulo Clientes completo — mesmo cadastro, sem migração.
      </p>

      <Dialog open={criarOpen} onOpenChange={setCriarOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Novo cliente</DialogTitle>
            <DialogDescription>3 campos e pronto — dá pra vigiar em menos de um minuto.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <Label>Nome completo</Label>
              <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Maria da Silva" maxLength={255} autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label>CPF ou CNPJ</Label>
              <Input value={cpfCnpj} onChange={(e) => setCpfCnpj(e.target.value)} placeholder="000.000.000-00" maxLength={18} inputMode="numeric" />
            </div>
            <div className="space-y-1.5">
              <Label>Responsável</Label>
              <Select value={responsavelId} onValueChange={setResponsavelId}>
                <SelectTrigger><SelectValue placeholder="Eu mesmo" /></SelectTrigger>
                <SelectContent>
                  {(respData?.itens ?? []).map((r) => (
                    <SelectItem key={r.id} value={String(r.id)}>{r.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="rounded-lg bg-muted/60 p-2.5 text-[11px] text-muted-foreground leading-relaxed">
              Funil de vendas, histórico de atendimento e documentos ficam no módulo <b>Clientes completo</b> — aqui é só o que o monitoramento precisa.
            </p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setCriarOpen(false)}>Cancelar</Button>
            <Button variant="outline" disabled={criarMut.isPending} onClick={() => submeter(false)}>
              Só salvar
            </Button>
            <Button disabled={criarMut.isPending} onClick={() => submeter(true)}>
              {criarMut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Salvar e monitorar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
