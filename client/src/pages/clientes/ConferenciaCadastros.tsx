/**
 * Conferência de cadastros — o relatório que o botão "Possíveis duplicados"
 * não era: quantos contatos estão duplicados (por telefone E por CPF), o que
 * difere entre as fichas (marcado em amarelo, CPF em vermelho), o que falta
 * ou está inválido, e os mesmos números em PDF e planilha.
 *
 * Decisões do dono (09/09/2026): grupo com CPFs diferentes troca o botão de
 * lugar ("Não é duplicado" vira o principal e o Mesclar pede confirmação
 * dizendo qual CPF seria descartado); "Não é duplicado" existe e é reversível
 * na aba própria; a página mora em Clientes; a planilha leva o CPF inteiro.
 *
 * Nada aqui roda sozinho: cada mesclagem é um clique, e a aba de faltas só
 * aponta — "Ver na lista" abre Clientes filtrado, a correção é na ficha.
 */

import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ArrowLeft, ClipboardCheck, Download, Loader2, Lock } from "lucide-react";
import { mascararTelefoneBR } from "@shared/telefone";
import type { EscolhasMesclagem } from "@shared/mesclar-campos";
import { useEscolhasMesclagem, TabelaEscolhaCampos, EsqueletoEscolhaCampos } from "./mesclar-escolher-campos";
import {
  COMO_DECIDE_FALTA, FALTA_TIPOS, FILTROS_GRUPO, ROTULO_DIVERGENCIA, ROTULO_FALTA, ROTULO_FILTRO,
  type ClasseGrupo, type Divergencia, type FaltaTipo, type FiltroGrupo, type TipoGrupo,
} from "@shared/conferencia-cadastros";

type Ficha = {
  id: number;
  nome: string;
  estagio: "lead" | "cliente";
  origem: string;
  createdAt: string | null;
  telefone: string | null;
  cpfCnpj: string | null;
  email: string | null;
  responsavelId: number | null;
  responsavelNome: string | null;
  conversas: number;
  cobrancas: number;
  processos: number;
};

type Grupo = {
  tipo: TipoGrupo;
  chave: string;
  rotulo: string;
  sobreviventeId: number;
  fichas: Ficha[];
  divergencias: Divergencia[];
  classe: ClasseGrupo;
  nomeIncompleto: boolean;
  tambemNoTelefone: boolean;
  ignorado: { marcadoPor: number | null; createdAt: string | null } | null;
};

type Falta = { total: number; clientes: number; leads: number; exemplo: { id: number; nome: string; origem: string; createdAt: string | null } | null };

type Resumo = {
  telefone: { grupos: number; fichas: number; comDivergencia: number; cpfsDiferentes: number; soFalta: number };
  cpf: { grupos: number; fichas: number; tambemNoTelefone: number };
  divergentes: { grupos: number; cpfsDiferentes: number };
  semTelefoneOuInvalido: number;
  clienteSemCpfOuInvalido: number;
  ignorados: number;
};

type Dados = {
  podeVer: boolean;
  geradoEm?: string;
  fichas?: { total: number; clientes: number; leads: number };
  resumo?: Resumo;
  gruposTelefone?: Grupo[];
  gruposCpf?: Grupo[];
  ignorados?: Grupo[];
  faltas?: Record<FaltaTipo, Falta>;
};

type Secao = "telefone" | "cpf" | "faltas" | "ignorados";
type Confirmacao =
  | { tipo: "cpf"; grupo: Grupo }
  | { tipo: "todos"; grupos: Grupo[] };

const POR_PAGINA = 20;

// "Cadastro manual", não "Clientes": a coluna diz de onde a ficha veio, e
// "Clientes" ao lado de "Lead" lia como se a pessoa fosse cliente.
const ORIGEM: Record<string, string> = {
  whatsapp: "WhatsApp", manual: "Cadastro manual", asaas: "Asaas", site: "Site",
  instagram: "Instagram", facebook: "Facebook", telefone: "Telefone",
};

function dataBR(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("pt-BR");
}

function num(n: number): string {
  return n.toLocaleString("pt-BR");
}

function plural(n: number, um: string, varios: string): string | null {
  return n > 0 ? `${n} ${n === 1 ? um : varios}` : null;
}

function vinculos(f: Ficha): string {
  return [
    plural(f.processos, "processo", "processos"),
    plural(f.cobrancas, "cobrança", "cobranças"),
    plural(f.conversas, "conversa", "conversas"),
  ].filter(Boolean).join(" · ") || "—";
}

function paresDoGrupo(
  g: Grupo,
  confirmarCpfDiferente = false,
  escolhasPorFicha: Record<number, EscolhasMesclagem> = {},
) {
  return g.fichas
    .filter((f) => f.id !== g.sobreviventeId)
    .map((f) => ({
      principalId: g.sobreviventeId,
      duplicadoId: f.id,
      ...(confirmarCpfDiferente ? { confirmarCpfDiferente: true } : {}),
      ...(escolhasPorFicha[f.id] && Object.keys(escolhasPorFicha[f.id]).length > 0
        ? { escolhas: escolhasPorFicha[f.id] }
        : {}),
    }));
}

/**
 * O grupo pode ter mais de duas fichas, e a escolha é sempre entre DUAS: a que
 * sobrevive e uma absorvida. Por isso o diálogo caminha par a par, e pula
 * sozinho o par em que os dois lados não discordam de nada.
 */
function MesclarComEscolhaDialog({
  grupo, pendente, onCancelar, onConfirmar,
}: {
  grupo: Grupo;
  pendente: boolean;
  onCancelar: () => void;
  onConfirmar: (escolhasPorFicha: Record<number, EscolhasMesclagem>) => void;
}) {
  const absorvidas = grupo.fichas.filter((f) => f.id !== grupo.sobreviventeId);
  const [i, setI] = useState(0);
  const [acumulado, setAcumulado] = useState<Record<number, EscolhasMesclagem>>({});
  const atual = absorvidas[i];
  const campos = useEscolhasMesclagem(grupo.sobreviventeId, atual?.id, !!atual);

  const guardar = (escolhas: EscolhasMesclagem) => {
    const juntas = atual && Object.keys(escolhas).length > 0
      ? { ...acumulado, [atual.id]: escolhas }
      : acumulado;
    if (i + 1 < absorvidas.length) {
      setAcumulado(juntas);
      setI(i + 1);
    } else {
      onConfirmar(juntas);
    }
  };

  // Par sem nada a decidir não vira tela.
  useEffect(() => {
    if (!atual || campos.carregando || campos.precisaEscolher) return;
    guardar({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atual?.id, campos.carregando, campos.precisaEscolher]);

  return (
    <AlertDialog open onOpenChange={(o) => { if (!o) onCancelar(); }}>
      <AlertDialogContent className="max-w-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle>O que fica na ficha final</AlertDialogTitle>
          <AlertDialogDescription>
            {absorvidas.length > 1 ? `Ficha ${i + 1} de ${absorvidas.length}. ` : ""}
            Os dois cadastros têm valor diferente em alguns campos. Escolha o que fica em cada um.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="max-h-[60vh] overflow-y-auto pr-1">
          {campos.carregando || !campos.principal || !campos.duplicado ? (
            <EsqueletoEscolhaCampos />
          ) : (
            <TabelaEscolhaCampos
              linhas={campos.linhas}
              escolhas={campos.escolhas}
              setEscolha={campos.setEscolha}
              nomePrincipal={campos.principal.nome}
              nomeDuplicado={campos.duplicado.nome}
            />
          )}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pendente}>Cancelar</AlertDialogCancel>
          <Button disabled={pendente || campos.carregando} onClick={() => guardar(campos.mudancas)}>
            {pendente ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            {i + 1 < absorvidas.length ? "Continuar" : "Mesclar"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function baixarBase64(r: { filename: string; base64: string; mimeType: string }) {
  const bin = atob(r.base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: r.mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = r.filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
}

function ChipDivergencia({ d }: { d: Divergencia }) {
  const tom = d === "cpf" ? "bg-danger-bg text-danger-fg" : "bg-warning-bg text-warning-fg";
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${tom}`}>{d === "cpf" ? "⚠ " : ""}{ROTULO_DIVERGENCIA[d]}</span>;
}

function Cartao({ titulo, valor, unidade, detalhe, tom }: { titulo: string; valor: number; unidade?: string; detalhe: string; tom: "neutro" | "info" | "warning" | "danger" }) {
  const classes = {
    neutro: "bg-muted/40 border-border text-foreground",
    info: "bg-info-bg border-info/30 text-info-fg",
    warning: "bg-warning-bg border-warning/30 text-warning-fg",
    danger: "bg-danger-bg border-danger/30 text-danger-fg",
  }[tom];
  return (
    <div className={`rounded-xl border px-3 py-2 ${classes}`}>
      <p className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">{titulo}</p>
      <p className="mt-1 text-2xl font-extrabold tabular-nums leading-none">
        {num(valor)}{unidade ? <span className="ml-1 text-xs font-semibold text-muted-foreground">{unidade}</span> : null}
      </p>
      <p className="mt-1 text-[11px] text-muted-foreground">{detalhe}</p>
    </div>
  );
}

function celulaDivergente(g: Grupo, d: Divergencia): string {
  if (!g.divergencias.includes(d)) return "";
  return d === "cpf" ? "bg-danger-bg text-danger-fg font-semibold" : "bg-warning-bg text-warning-fg font-semibold";
}

function GrupoCard({ g, pendente, onMesclar, onMesclarMesmoAssim, onNaoDuplicado, onVoltar }: {
  g: Grupo;
  pendente: boolean;
  onMesclar: (g: Grupo) => void;
  onMesclarMesmoAssim: (g: Grupo) => void;
  onNaoDuplicado: (g: Grupo) => void;
  onVoltar?: (g: Grupo) => void;
}) {
  const cpfsDiferentes = g.classe === "cpfs_diferentes";
  const [, setLocation] = useLocation();
  return (
    <div className={`border-t border-border px-4 py-3 ${cpfsDiferentes ? "bg-warning-bg/40" : ""}`} data-testid={`grupo-${g.tipo}-${g.chave}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-extrabold tabular-nums">{g.rotulo}</span>
        <span className="text-[11px] text-muted-foreground">{g.fichas.length} fichas{g.tipo === "cpf" && g.tambemNoTelefone ? " · também no telefone" : ""}</span>
        {g.divergencias.map((d) => <ChipDivergencia key={d} d={d} />)}
        {g.nomeIncompleto && <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">nome incompleto</span>}
        {g.divergencias.length === 0 && <span className="rounded-full bg-success-bg px-2 py-0.5 text-[10px] font-bold text-success-fg">só falta preencher</span>}
        <div className="ml-auto flex items-center gap-1.5">
          {g.ignorado ? (
            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={pendente} onClick={() => onVoltar?.(g)}>Voltar a considerar</Button>
          ) : cpfsDiferentes ? (
            <>
              <Button size="sm" variant="outline" className="h-7 text-xs" disabled={pendente} onClick={() => onMesclarMesmoAssim(g)}>Mesclar mesmo assim</Button>
              <Button size="sm" className="h-7 text-xs" disabled={pendente} onClick={() => onNaoDuplicado(g)}>Não é duplicado</Button>
            </>
          ) : (
            <>
              <Button size="sm" className="h-7 text-xs" disabled={pendente} onClick={() => onMesclar(g)}>
                {pendente ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                {g.fichas.length > 2 ? `Mesclar as ${g.fichas.length}` : "Mesclar"}
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" disabled={pendente} onClick={() => onNaoDuplicado(g)}>Não é duplicado</Button>
            </>
          )}
        </div>
      </div>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-left text-[9px] uppercase tracking-wider text-muted-foreground">
              <th className="px-2 py-1 font-bold">Nome</th>
              <th className="px-2 py-1 font-bold">Estágio</th>
              <th className="px-2 py-1 font-bold">Origem · data</th>
              {g.tipo === "cpf" && <th className="px-2 py-1 font-bold">Telefone</th>}
              <th className="px-2 py-1 font-bold">CPF/CNPJ</th>
              <th className="px-2 py-1 font-bold">E-mail</th>
              <th className="px-2 py-1 font-bold">Responsável</th>
              <th className="px-2 py-1 font-bold">Vínculos</th>
            </tr>
          </thead>
          <tbody>
            {g.fichas.map((f) => (
              <tr key={f.id} className="border-t border-border/60">
                <td className={`px-2 py-1 whitespace-nowrap ${celulaDivergente(g, "nome") || "font-semibold"}`}>
                  <button type="button" className="hover:underline" onClick={() => setLocation(`/clientes?id=${f.id}`)} title="Abrir ficha">{f.nome}</button>
                  {f.id === g.sobreviventeId
                    ? <span className="ml-1.5 rounded-full bg-success-bg px-1.5 py-px text-[9px] font-bold uppercase text-success-fg">sobrevive</span>
                    : <span className="ml-1.5 rounded-full bg-muted px-1.5 py-px text-[9px] font-bold uppercase text-muted-foreground">entra nela</span>}
                </td>
                <td className="px-2 py-1">{f.estagio === "cliente" ? "Cliente" : "Lead"}</td>
                <td className="px-2 py-1 whitespace-nowrap">{ORIGEM[f.origem] ?? f.origem} · {dataBR(f.createdAt)}</td>
                {g.tipo === "cpf" && (
                  <td className={`px-2 py-1 tabular-nums whitespace-nowrap ${celulaDivergente(g, "telefone")}`}>{f.telefone ? mascararTelefoneBR(f.telefone) : <span className="text-muted-foreground">—</span>}</td>
                )}
                <td className={`px-2 py-1 tabular-nums whitespace-nowrap ${celulaDivergente(g, "cpf")}`}>{f.cpfCnpj || <span className="text-muted-foreground">—</span>}</td>
                <td className={`px-2 py-1 ${celulaDivergente(g, "email")}`}>{f.email || <span className="text-muted-foreground">—</span>}</td>
                <td className={`px-2 py-1 whitespace-nowrap ${celulaDivergente(g, "responsavel")}`}>{f.responsavelNome || (f.responsavelId != null ? `#${f.responsavelId}` : <span className="text-muted-foreground">—</span>)}</td>
                <td className="px-2 py-1 whitespace-nowrap">{vinculos(f)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function ConferenciaCadastros() {
  const [, setLocation] = useLocation();
  const [secao, setSecao] = useState<Secao>("telefone");
  const [filtro, setFiltro] = useState<FiltroGrupo>("todos");
  const [pagina, setPagina] = useState(1);
  const [confirmacao, setConfirmacao] = useState<Confirmacao | null>(null);
  const [emLote, setEmLote] = useState(false);
  const [escolhendo, setEscolhendo] = useState<Grupo | null>(null);

  const utils = trpc.useUtils();
  const { data, isLoading, refetch } = (trpc as any).clientes.conferenciaCadastros.useQuery(undefined, {
    retry: false,
    staleTime: 30_000,
  }) as { data: Dados | undefined; isLoading: boolean; refetch: () => void };

  const atualizar = () => {
    refetch();
    // O "(N)" do botão "Possíveis duplicados" e a lista de Clientes leem a mesma conta.
    (utils as any).clientes?.invalidate?.();
  };

  const mesclar = (trpc as any).clientes.mesclarDuplicados.useMutation({
    onSuccess: (r: { feitos: number[]; falhas: Array<{ duplicadoId: number; erro: string }> }) => {
      const n = r.feitos.length;
      if (n > 0) {
        toast.success(n === 1 ? "Cadastros mesclados" : `${n} cadastros mesclados`, {
          description: r.falhas.length > 0 ? `${r.falhas.length} não deu: ${r.falhas[0].erro}` : "Dá pra desfazer por 7 dias, na conversa do cliente.",
        });
      } else if (r.falhas.length > 0) {
        toast.error("Não deu pra mesclar", { description: r.falhas[0].erro });
      }
      atualizar();
    },
    onError: (e: any) => toast.error("Não deu pra mesclar", { description: e.message }),
  });
  const marcar = (trpc as any).clientes.marcarNaoDuplicado.useMutation({
    onSuccess: () => { toast.success("Fora da conta", { description: "Dá pra voltar na aba \"Não é duplicado\"." }); atualizar(); },
    onError: (e: any) => toast.error("Não deu pra marcar", { description: e.message }),
  });
  const desmarcar = (trpc as any).clientes.desmarcarNaoDuplicado.useMutation({
    onSuccess: () => { toast.success("Voltou a contar como possível duplicado"); atualizar(); },
    onError: (e: any) => toast.error("Não deu pra voltar", { description: e.message }),
  });
  const pdf = (trpc as any).clientes.exportarConferenciaPdf.useMutation({
    onSuccess: (r: { filename: string; base64: string; mimeType: string }) => { baixarBase64(r); toast.success("PDF da conferência baixado"); },
    onError: (e: any) => toast.error("Não foi possível gerar o PDF", { description: e.message }),
  });
  const csv = (trpc as any).clientes.exportarConferenciaCsv.useMutation({
    onSuccess: (r: { filename: string; base64: string; mimeType: string }) => { baixarBase64(r); toast.success("Planilha da conferência baixada"); },
    onError: (e: any) => toast.error("Não foi possível gerar a planilha", { description: e.message }),
  });

  const pendente = mesclar.isPending || marcar.isPending || desmarcar.isPending || emLote;

  const gruposDaSecao: Grupo[] = useMemo(() => {
    if (!data?.podeVer) return [];
    if (secao === "telefone") return data.gruposTelefone ?? [];
    if (secao === "cpf") return data.gruposCpf ?? [];
    if (secao === "ignorados") return data.ignorados ?? [];
    return [];
  }, [data, secao]);

  const contagemFiltro = (f: FiltroGrupo) => gruposDaSecao.filter((g) => passaNoFiltro(g.classe, f)).length;
  const filtrados = gruposDaSecao.filter((g) => passaNoFiltro(g.classe, filtro));
  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / POR_PAGINA));
  const paginaAtual = Math.min(pagina, totalPaginas);
  const visiveis = filtrados.slice((paginaAtual - 1) * POR_PAGINA, paginaAtual * POR_PAGINA);
  const soFalta = gruposDaSecao.filter((g) => g.classe === "so_falta");

  const trocarSecao = (s: Secao) => { setSecao(s); setFiltro("todos"); setPagina(1); };
  const trocarFiltro = (f: FiltroGrupo) => { setFiltro(f); setPagina(1); };

  const mesclarTodosSoFalta = async (grupos: Grupo[]) => {
    const pares = grupos.flatMap((g) => paresDoGrupo(g));
    setEmLote(true);
    let feitos = 0;
    let falhas = 0;
    try {
      for (let i = 0; i < pares.length; i += 50) {
        const r = await mesclar.mutateAsync({ pares: pares.slice(i, i + 50) });
        feitos += r.feitos.length;
        falhas += r.falhas.length;
      }
      toast.success(`${feitos} cadastros mesclados`, { description: falhas > 0 ? `${falhas} não deram.` : "Dá pra desfazer por 7 dias, na conversa de cada cliente." });
    } catch (e: any) {
      toast.error("A mesclagem em lote parou", { description: e?.message });
    } finally {
      setEmLote(false);
      atualizar();
    }
  };

  const confirmar = () => {
    if (!confirmacao) return;
    if (confirmacao.tipo === "cpf") mesclar.mutate({ pares: paresDoGrupo(confirmacao.grupo, true) });
    else void mesclarTodosSoFalta(confirmacao.grupos);
    setConfirmacao(null);
  };

  if (isLoading) {
    return (
      <div className="space-y-3 p-2">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!data?.podeVer) {
    return (
      <div className="mx-auto mt-16 max-w-lg px-4 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-border bg-muted">
          <Lock className="h-7 w-7 text-muted-foreground" />
        </div>
        <h2 className="text-lg font-bold">A conferência é de quem pode excluir clientes</h2>
        <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
          Ela conta o escritório inteiro e mescla cadastros — a mesma permissão do "Mesclar".
        </p>
        <Button variant="outline" className="mt-5" onClick={() => setLocation("/clientes")}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Voltar pra Clientes
        </Button>
      </div>
    );
  }

  const r = data.resumo!;
  const faltas = data.faltas!;
  const fichas = data.fichas!;
  const cpfDescartado = confirmacao?.tipo === "cpf"
    ? confirmacao.grupo.fichas.find((f) => f.id !== confirmacao.grupo.sobreviventeId)
    : null;

  return (
    <div className="rounded-2xl bg-gradient-to-br from-muted/40 via-white dark:via-muted to-info-bg/20 p-6 space-y-4">
      <div className="rounded-2xl border bg-card text-card-foreground shadow-sm">
        <div className="flex flex-wrap items-start gap-3 border-b border-border px-5 py-4">
          <div>
            <p className="text-[11px] text-muted-foreground">
              <button type="button" className="hover:underline" onClick={() => setLocation("/clientes")}>Clientes</button>
              {" › "}<b className="text-foreground">Conferência de cadastros</b>
            </p>
            <h1 className="mt-1 flex items-center gap-2 text-lg font-bold"><ClipboardCheck className="h-5 w-5 text-info-fg" /> Conferência de cadastros</h1>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Números do escritório inteiro, calculados agora · telefone comparado por DDD + 8 dígitos (com ou sem 9, com ou sem 55) · CPF comparado só pelos dígitos
            </p>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <Button size="sm" variant="outline" className="h-8 text-xs" disabled={pdf.isPending} onClick={() => pdf.mutate({ filtro })}>
              <Download className="mr-1 h-3.5 w-3.5" /> {pdf.isPending ? "Gerando..." : "Baixar PDF"}
            </Button>
            <Button size="sm" variant="outline" className="h-8 text-xs" disabled={csv.isPending} onClick={() => csv.mutate({ filtro })}>
              <Download className="mr-1 h-3.5 w-3.5" /> {csv.isPending ? "Gerando..." : "Baixar planilha"}
            </Button>
            <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setLocation("/clientes")}>Voltar</Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 px-5 pt-4 md:grid-cols-3 xl:grid-cols-6">
          <Cartao tom="neutro" titulo="Fichas" valor={fichas.total} detalhe={`${num(fichas.clientes)} clientes · ${num(fichas.leads)} leads`} />
          <Cartao tom="info" titulo="Mesmo telefone" valor={r.telefone.grupos} unidade="números" detalhe={`${num(r.telefone.fichas)} fichas envolvidas`} />
          <Cartao tom="info" titulo="Mesmo CPF" valor={r.cpf.grupos} unidade="CPFs" detalhe={`${num(r.cpf.fichas)} fichas · ${num(r.cpf.tambemNoTelefone)} também no telefone`} />
          <Cartao tom="warning" titulo="Com dados divergentes" valor={r.divergentes.grupos} unidade="grupos" detalhe={`${num(r.divergentes.cpfsDiferentes)} com CPFs diferentes`} />
          <Cartao tom="danger" titulo="Sem telefone ou inválido" valor={r.semTelefoneOuInvalido} detalhe={`${num(faltas.sem_telefone.total)} sem · ${num(faltas.telefone_invalido.total)} inválidos`} />
          <Cartao tom="danger" titulo="Cliente sem CPF ou inválido" valor={r.clienteSemCpfOuInvalido} detalhe={`${num(faltas.cliente_sem_cpf.total)} sem · ${num(faltas.cpf_invalido.total)} inválidos`} />
        </div>

        <div className="mx-5 mt-4 flex flex-wrap gap-1 border-b border-border text-xs font-semibold">
          {([
            ["telefone", "Mesmo telefone", r.telefone.grupos],
            ["cpf", "Mesmo CPF", r.cpf.grupos],
            ["faltas", "Faltando ou inválido", FALTA_TIPOS.reduce((n, t) => n + faltas[t].total, 0)],
            ["ignorados", "Não é duplicado", r.ignorados],
          ] as Array<[Secao, string, number]>).map(([id, rotulo, n]) => (
            <button
              key={id}
              type="button"
              onClick={() => trocarSecao(id)}
              className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 transition-colors ${secao === id ? "border-info/50 text-info-fg" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              {rotulo}
              <span className={`rounded-full px-1.5 py-px text-[10px] font-bold tabular-nums ${secao === id ? "bg-info text-info-on" : "bg-muted text-muted-foreground"}`}>{num(n)}</span>
            </button>
          ))}
        </div>

        {(secao === "telefone" || secao === "cpf") && (
          <>
            <div className="flex flex-wrap items-center gap-1.5 px-5 py-3 text-[11px] text-muted-foreground">
              <span>Mostrar:</span>
              {FILTROS_GRUPO.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => trocarFiltro(f)}
                  className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${filtro === f ? "border-foreground bg-foreground text-background" : f === "cpfs_diferentes" ? "border-warning/40 bg-warning-bg text-warning-fg" : "border-border bg-card text-foreground"}`}
                >
                  {ROTULO_FILTRO[f]} {contagemFiltro(f)}
                </button>
              ))}
              <span className="ml-auto">Ordem: <b className="text-foreground">mais fichas primeiro</b> · {POR_PAGINA} por página</span>
            </div>
            {visiveis.length === 0 ? (
              <p className="border-t border-border px-5 py-10 text-center text-sm text-muted-foreground">
                {gruposDaSecao.length === 0 ? "Nenhum grupo — base limpa nesta seção." : "Nenhum grupo com esse filtro."}
              </p>
            ) : visiveis.map((g) => (
              <GrupoCard
                key={`${g.tipo}:${g.chave}`}
                g={g}
                pendente={pendente}
                onMesclar={(grupo) => setEscolhendo(grupo)}
                onMesclarMesmoAssim={(grupo) => setConfirmacao({ tipo: "cpf", grupo })}
                onNaoDuplicado={(grupo) => marcar.mutate({ tipo: grupo.tipo, contatoId: grupo.sobreviventeId })}
              />
            ))}
            <div className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-3 text-[11px] text-muted-foreground">
              <span>{num(filtrados.length)} {filtrados.length === 1 ? "grupo" : "grupos"} · página {paginaAtual} de {totalPaginas}</span>
              <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={paginaAtual <= 1} onClick={() => setPagina(paginaAtual - 1)}>Anterior</Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={paginaAtual >= totalPaginas} onClick={() => setPagina(paginaAtual + 1)}>Próxima</Button>
              {soFalta.length > 0 && (
                <Button size="sm" variant="outline" className="ml-auto h-7 text-xs" disabled={pendente} onClick={() => setConfirmacao({ tipo: "todos", grupos: soFalta })}>
                  Mesclar todos os "só falta preencher" ({num(soFalta.length)})
                </Button>
              )}
            </div>
          </>
        )}

        {secao === "faltas" && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[9px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-5 py-2 font-bold">O que</th>
                  <th className="px-3 py-2 font-bold">Quantas</th>
                  <th className="px-3 py-2 font-bold">Como o sistema decide</th>
                  <th className="px-3 py-2 font-bold">Exemplo</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {FALTA_TIPOS.map((tipo) => {
                  const f = faltas[tipo];
                  return (
                    <tr key={tipo} className="border-t border-border align-top">
                      <td className="px-5 py-2.5 font-semibold">{ROTULO_FALTA[tipo]}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span className="text-sm font-extrabold tabular-nums">{num(f.total)}</span>
                        <div className="text-[10px] text-muted-foreground">{num(f.clientes)} clientes · {num(f.leads)} leads</div>
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground">{COMO_DECIDE_FALTA[tipo]}</td>
                      <td className="px-3 py-2.5 text-muted-foreground">
                        {f.exemplo ? `"${f.exemplo.nome}" · ${ORIGEM[f.exemplo.origem] ?? f.exemplo.origem} · ${dataBR(f.exemplo.createdAt)}` : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <Button size="sm" variant="outline" className="h-7 text-xs" disabled={f.total === 0} onClick={() => setLocation(`/clientes?conferencia=${tipo}`)}>Ver na lista</Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="border-t border-border px-5 py-3 text-[11px] text-muted-foreground">
              <b className="text-foreground">Só informa, não mexe.</b> Nenhuma linha desta aba altera cadastro. "Ver na lista" abre Clientes com o filtro aplicado; a correção é a de sempre, na ficha.
            </p>
          </div>
        )}

        {secao === "ignorados" && (
          gruposDaSecao.length === 0 ? (
            <p className="border-t border-border px-5 py-10 text-center text-sm text-muted-foreground">
              Nada marcado ainda. "Não é duplicado" tira um grupo da conta e ele aparece aqui, de onde volta com um clique.
            </p>
          ) : gruposDaSecao.map((g) => (
            <GrupoCard
              key={`${g.tipo}:${g.chave}`}
              g={g}
              pendente={pendente}
              onMesclar={() => {}}
              onMesclarMesmoAssim={() => {}}
              onNaoDuplicado={() => {}}
              onVoltar={(grupo) => desmarcar.mutate({ tipo: grupo.tipo, contatoId: grupo.sobreviventeId })}
            />
          ))
        )}
      </div>

      {escolhendo && (
        <MesclarComEscolhaDialog
          key={escolhendo.chave}
          grupo={escolhendo}
          pendente={mesclar.isPending}
          onCancelar={() => setEscolhendo(null)}
          onConfirmar={(escolhasPorFicha) => {
            const g = escolhendo;
            setEscolhendo(null);
            mesclar.mutate({ pares: paresDoGrupo(g, false, escolhasPorFicha) });
          }}
        />
      )}

      <AlertDialog open={!!confirmacao} onOpenChange={(o) => { if (!o) setConfirmacao(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmacao?.tipo === "cpf" ? "Mesclar fichas com CPFs diferentes?" : `Mesclar ${num(confirmacao?.tipo === "todos" ? confirmacao.grupos.length : 0)} grupos sem divergência?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmacao?.tipo === "cpf" ? (
                <>
                  O CPF/CNPJ de <b>{cpfDescartado?.nome}</b> ({cpfDescartado?.cpfCnpj}) será <b>descartado</b>: a ficha sobrevivente fica com o dela.
                  Se forem duas pessoas com o mesmo telefone, o certo é "Não é duplicado". Dá pra desfazer por 7 dias.
                </>
              ) : (
                <>Só entram grupos onde nenhuma ficha contradiz a outra. Quem tem divergência fica de fora. Cada mesclagem fica desfazível por 7 dias, na conversa do cliente.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmar}>{confirmacao?.tipo === "cpf" ? "Mesclar mesmo assim" : "Mesclar"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function passaNoFiltro(classe: ClasseGrupo, filtro: FiltroGrupo): boolean {
  if (filtro === "todos") return true;
  if (filtro === "divergencia") return classe !== "so_falta";
  return classe === filtro;
}
