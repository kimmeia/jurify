/**
 * Dialog "Importar processos da Advbox" — sobe XLSX, vê preview, confirma.
 *
 * 4 etapas no mesmo Dialog (controladas por estado):
 *   1. upload   — drag-drop / file picker
 *   2. preview  — totais + tabela das primeiras N linhas + botão importar
 *   3. running  — progress bar enquanto faz N chunks de até 50 linhas
 *   4. done     — sumário final (criados, reutilizados, erros)
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  FileUp, Loader2, CheckCircle2, AlertTriangle, FileSpreadsheet, Radar,
} from "lucide-react";
import { toast } from "sonner";

const CUSTO_MONITORAMENTO_MES = 2;

const TAMANHO_CHUNK = 50;

type ClienteAdvbox = {
  nome: string;
  cpfCnpj: string | null;
  tipoDoc: "cpf" | "cnpj" | null;
  textoOriginal: string;
};

type PreviewLinha = {
  linhaNum: number;
  cnj: string | null;
  cnjOriginal: string;
  cnjValido: boolean;
  tribunal: string | null;
  codigoTribunal: string | null;
  temMotorProprio: boolean;
  classe: string | null;
  valorCausaCentavos: number | null;
  valorCausaTexto: string;
  clientes: ClienteAdvbox[];
  alertas: string[];
  status:
    | "novo"
    | "ja_existe_processo"
    | "cnj_em_outro_cliente"
    | "sem_cliente"
    | "sem_cnj_invalido";
  contatoExistenteId: number | null;
  contatoExistenteNome: string | null;
  processoExistenteId: number | null;
  cnjEmOutrosContatos: { contatoId: number; contatoNome: string }[];
};

type Resumo = {
  novos: number;
  jaExistem: number;
  cnjEmOutroCliente: number;
  semCliente: number;
  semCnjOuInvalido: number;
  monitoraveisPorSistema: Record<string, number>;
};

type PreviewResultado = {
  totalLinhas: number;
  resumo: Resumo;
  linhas: PreviewLinha[];
};

type ResultadoFinal = {
  contatosCriados: number;
  contatosReutilizados: number;
  processosCriados: number;
  processosJaExistiam: number;
  monitoramentosCriados: number;
  monitoramentosJaExistiam: number;
  monitoramentosNaoElegiveis: number;
  creditosConsumidos: number;
  erros: { linhaNum: number; motivo: string }[];
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

type Etapa = "upload" | "preview" | "running" | "done";

function formatBRLCentavos(c: number | null): string {
  if (c === null) return "—";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency", currency: "BRL",
  }).format(c / 100);
}

/** Lê arquivo como base64 puro (sem o prefix data:...) */
function arquivoParaBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Falha ao ler arquivo."));
    reader.onload = () => {
      const txt = String(reader.result ?? "");
      const idx = txt.indexOf(",");
      resolve(idx >= 0 ? txt.slice(idx + 1) : txt);
    };
    reader.readAsDataURL(file);
  });
}

export function ImportarAdvboxDialog({ open, onOpenChange, onSuccess }: Props) {
  const [etapa, setEtapa] = useState<Etapa>("upload");
  const [nomeArquivo, setNomeArquivo] = useState<string>("");
  const [preview, setPreview] = useState<PreviewResultado | null>(null);
  const [progresso, setProgresso] = useState<{ atual: number; total: number }>({ atual: 0, total: 0 });
  const [resultado, setResultado] = useState<ResultadoFinal | null>(null);
  const [ativarMonitor, setAtivarMonitor] = useState(false);
  const [credencialIdEscolhida, setCredencialIdEscolhida] = useState<string>("");

  const { data: credenciais } = (trpc as any).cofreCredenciais.listarParaSelecao.useQuery(
    undefined,
    { retry: false, enabled: etapa === "preview" },
  );
  const credsAtivas: { id: number; sistema: string; apelido?: string | null; status: string }[] =
    (credenciais ?? []).filter((c: any) => c.status === "ativa");

  const previewMut = (trpc as any).importarProcessos.previewAdvbox.useMutation({
    onSuccess: (r: PreviewResultado) => {
      setPreview(r);
      setEtapa("preview");
    },
    onError: (err: any) => {
      toast.error("Falha ao ler planilha", { description: err.message });
      setEtapa("upload");
    },
  });

  const executarMut = (trpc as any).importarProcessos.executarAdvbox.useMutation();

  const handleClose = () => {
    if (etapa === "running") return;
    setEtapa("upload");
    setNomeArquivo("");
    setPreview(null);
    setProgresso({ atual: 0, total: 0 });
    setResultado(null);
    setAtivarMonitor(false);
    setCredencialIdEscolhida("");
    onOpenChange(false);
  };

  const handleArquivo = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      toast.error("Arquivo precisa ser .xlsx");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Arquivo muito grande (máx 10MB)");
      return;
    }
    setNomeArquivo(file.name);
    try {
      const b64 = await arquivoParaBase64(file);
      previewMut.mutate({ xlsxBase64: b64 });
    } catch (err: any) {
      toast.error("Falha ao ler arquivo", { description: err.message });
    }
  };

  const handleImportar = async () => {
    if (!preview) return;
    const linhasParaImportar = preview.linhas.filter((l) => l.status === "novo");
    if (linhasParaImportar.length === 0) {
      toast.warning("Nenhuma linha nova pra importar.");
      return;
    }

    setEtapa("running");
    const chunks: PreviewLinha[][] = [];
    for (let i = 0; i < linhasParaImportar.length; i += TAMANHO_CHUNK) {
      chunks.push(linhasParaImportar.slice(i, i + TAMANHO_CHUNK));
    }
    setProgresso({ atual: 0, total: chunks.length });

    const acumulado: ResultadoFinal = {
      contatosCriados: 0, contatosReutilizados: 0,
      processosCriados: 0, processosJaExistiam: 0,
      monitoramentosCriados: 0, monitoramentosJaExistiam: 0,
      monitoramentosNaoElegiveis: 0, creditosConsumidos: 0,
      erros: [],
    };

    const credId = ativarMonitor && credencialIdEscolhida
      ? Number(credencialIdEscolhida)
      : undefined;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      try {
        const r: ResultadoFinal = await executarMut.mutateAsync({
          monitorar: ativarMonitor,
          credencialId: credId,
          linhas: chunk.map((l) => ({
            linhaNum: l.linhaNum,
            cnj: l.cnj,
            cnjOriginal: l.cnjOriginal,
            cnjValido: l.cnjValido,
            tribunal: l.tribunal,
            codigoTribunal: l.codigoTribunal,
            temMotorProprio: l.temMotorProprio,
            classe: l.classe,
            valorCausaCentavos: l.valorCausaCentavos,
            clientes: l.clientes.map((c) => ({
              nome: c.nome,
              cpfCnpj: c.cpfCnpj,
              tipoDoc: c.tipoDoc,
            })),
          })),
        });
        acumulado.contatosCriados += r.contatosCriados;
        acumulado.contatosReutilizados += r.contatosReutilizados;
        acumulado.processosCriados += r.processosCriados;
        acumulado.processosJaExistiam += r.processosJaExistiam;
        acumulado.monitoramentosCriados += r.monitoramentosCriados;
        acumulado.monitoramentosJaExistiam += r.monitoramentosJaExistiam;
        acumulado.monitoramentosNaoElegiveis += r.monitoramentosNaoElegiveis;
        acumulado.creditosConsumidos += r.creditosConsumidos;
        acumulado.erros.push(...r.erros);
      } catch (err: any) {
        // Falha no chunk inteiro vira erro por linha pra mostrar.
        for (const linha of chunk) {
          acumulado.erros.push({ linhaNum: linha.linhaNum, motivo: err?.message ?? "Erro no chunk." });
        }
      }
      setProgresso({ atual: i + 1, total: chunks.length });
    }

    setResultado(acumulado);
    setEtapa("done");
    onSuccess?.();

    if (acumulado.erros.length === 0) {
      toast.success(`${acumulado.processosCriados} processos importados!`);
    } else {
      toast.warning(
        `${acumulado.processosCriados} criados · ${acumulado.erros.length} com erro`,
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileUp className="h-5 w-5" /> Importar processos da Advbox
          </DialogTitle>
          <DialogDescription>
            Exporte de Advbox → Processos → Exportar XLSX. O arquivo deve ter as 28
            colunas padrão da Advbox.
          </DialogDescription>
        </DialogHeader>

        {/* Etapa 1: Upload */}
        {etapa === "upload" && (
          <div className="space-y-4">
            <label className="block border-2 border-dashed border-slate-300 rounded-lg p-8 text-center cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/40 transition-colors">
              <input
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleArquivo(f);
                }}
                disabled={previewMut.isPending}
              />
              <FileSpreadsheet className="h-10 w-10 mx-auto text-slate-400 mb-2" />
              <p className="text-sm font-medium">Clique pra escolher o arquivo .xlsx</p>
              <p className="text-xs text-muted-foreground mt-1">Máximo 10MB.</p>
            </label>
            {previewMut.isPending && (
              <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Lendo {nomeArquivo}…
              </p>
            )}
          </div>
        )}

        {/* Etapa 2: Preview */}
        {etapa === "preview" && preview && (
          <div className="space-y-4">
            <div className="bg-slate-50 border rounded-lg p-3 flex items-center gap-3">
              <FileSpreadsheet className="h-5 w-5 text-slate-600" />
              <div className="flex-1">
                <p className="text-sm font-medium">{nomeArquivo}</p>
                <p className="text-xs text-muted-foreground">
                  {preview.totalLinhas} linha(s) na planilha
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setEtapa("upload")}>
                Trocar
              </Button>
            </div>

            <div className="grid grid-cols-5 gap-2 text-center">
              <div className="bg-emerald-50 border border-emerald-200 rounded p-3">
                <p className="text-[10px] text-emerald-700 uppercase font-semibold">Novos</p>
                <p className="text-2xl font-bold text-emerald-700 tabular-nums">{preview.resumo.novos}</p>
              </div>
              <div className="bg-slate-50 border rounded p-3">
                <p className="text-[10px] text-slate-700 uppercase font-semibold">Já existem</p>
                <p className="text-2xl font-bold text-slate-700 tabular-nums">{preview.resumo.jaExistem}</p>
              </div>
              <div
                className="bg-orange-50 border border-orange-200 rounded p-3"
                title="CNJ já cadastrado no escritório vinculado a OUTRO cliente — pulados pra evitar duplicata acidental."
              >
                <p className="text-[10px] text-orange-700 uppercase font-semibold">Outro cliente</p>
                <p className="text-2xl font-bold text-orange-700 tabular-nums">{preview.resumo.cnjEmOutroCliente}</p>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded p-3">
                <p className="text-[10px] text-amber-700 uppercase font-semibold">Sem cliente</p>
                <p className="text-2xl font-bold text-amber-700 tabular-nums">{preview.resumo.semCliente}</p>
              </div>
              <div className="bg-rose-50 border border-rose-200 rounded p-3">
                <p className="text-[10px] text-rose-700 uppercase font-semibold">CNJ inválido</p>
                <p className="text-2xl font-bold text-rose-700 tabular-nums">{preview.resumo.semCnjOuInvalido}</p>
              </div>
            </div>

            <ScrollArea className="h-64 border rounded">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 sticky top-0">
                  <tr className="border-b">
                    <th className="text-left p-2 font-semibold">#</th>
                    <th className="text-left p-2 font-semibold">Cliente</th>
                    <th className="text-left p-2 font-semibold">CNJ</th>
                    <th className="text-left p-2 font-semibold">Tribunal</th>
                    <th className="text-right p-2 font-semibold">Valor</th>
                    <th className="text-left p-2 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.linhas.map((l) => (
                    <tr key={l.linhaNum} className="border-b last:border-0">
                      <td className="p-2 text-muted-foreground tabular-nums">{l.linhaNum}</td>
                      <td className="p-2 max-w-[200px] truncate" title={l.clientes.map((c) => c.nome).join("; ")}>
                        {l.clientes[0]?.nome ?? "—"}
                        {l.clientes.length > 1 && (
                          <span className="text-muted-foreground"> +{l.clientes.length - 1}</span>
                        )}
                      </td>
                      <td className="p-2 font-mono text-[10px]">{l.cnjOriginal || "—"}</td>
                      <td className="p-2">{l.tribunal ?? "—"}</td>
                      <td className="p-2 text-right tabular-nums">{formatBRLCentavos(l.valorCausaCentavos)}</td>
                      <td className="p-2">
                        {l.status === "novo" && <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">Novo</Badge>}
                        {l.status === "ja_existe_processo" && <Badge variant="secondary">Já existe</Badge>}
                        {l.status === "cnj_em_outro_cliente" && (
                          <Badge
                            className="bg-orange-100 text-orange-700 border-orange-200"
                            title={`Vinculado a ${l.cnjEmOutrosContatos.map((c) => c.contatoNome).join(", ")}`}
                          >
                            Outro cliente
                          </Badge>
                        )}
                        {l.status === "sem_cliente" && <Badge className="bg-amber-100 text-amber-700 border-amber-200">Sem cliente</Badge>}
                        {l.status === "sem_cnj_invalido" && <Badge className="bg-rose-100 text-rose-700 border-rose-200">CNJ inválido</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>

            {/* Bloco de monitoramento — só faz sentido quando há linhas
                monitoráveis. Calcula custo dinâmico baseado na credencial
                escolhida. */}
            {Object.keys(preview.resumo.monitoraveisPorSistema).length > 0 && (
              <div className="border-2 border-indigo-200 bg-indigo-50/40 rounded-lg p-3 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2">
                    <Radar className="h-4 w-4 text-indigo-600 mt-0.5 shrink-0" />
                    <div>
                      <Label htmlFor="ativar-mon" className="text-sm font-semibold cursor-pointer">
                        Ativar monitoramento automático
                      </Label>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        Cada processo monitorado consome {CUSTO_MONITORAMENTO_MES} créditos/mês.
                        Requer credencial OAB do tribunal.
                      </p>
                    </div>
                  </div>
                  <Switch
                    id="ativar-mon"
                    checked={ativarMonitor}
                    onCheckedChange={(v) => {
                      setAtivarMonitor(v);
                      if (!v) setCredencialIdEscolhida("");
                    }}
                  />
                </div>

                {ativarMonitor && (
                  <div className="space-y-2">
                    <Label className="text-xs">Credencial OAB</Label>
                    {credsAtivas.length === 0 ? (
                      <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                        Nenhuma credencial ativa. Cadastre uma em{" "}
                        <a href="/processos?tab=cofre" className="underline">
                          Cofre
                        </a>{" "}
                        antes de monitorar.
                      </p>
                    ) : (
                      <Select value={credencialIdEscolhida} onValueChange={setCredencialIdEscolhida}>
                        <SelectTrigger className="h-9 text-xs">
                          <SelectValue placeholder="Escolha a credencial" />
                        </SelectTrigger>
                        <SelectContent>
                          {credsAtivas.map((c) => {
                            const monitoraveis = preview.resumo.monitoraveisPorSistema[c.sistema] ?? 0;
                            return (
                              <SelectItem key={c.id} value={String(c.id)}>
                                {c.apelido ?? c.sistema} ({c.sistema}) — {monitoraveis} processo(s) elegível(is)
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                    )}

                    {credencialIdEscolhida && (() => {
                      const cred = credsAtivas.find((c) => String(c.id) === credencialIdEscolhida);
                      if (!cred) return null;
                      const monitoraveis = preview.resumo.monitoraveisPorSistema[cred.sistema] ?? 0;
                      const custo = monitoraveis * CUSTO_MONITORAMENTO_MES;
                      return (
                        <div className="text-xs bg-white border rounded p-2 space-y-1">
                          <p>
                            <strong className="tabular-nums">{monitoraveis}</strong> processo(s) serão
                            monitorados automaticamente. Os demais ficam como vínculo (sem poll).
                          </p>
                          <p className="text-indigo-700 font-medium">
                            Custo estimado: <span className="tabular-nums">{custo}</span> créditos
                            (1ª mensalidade) · recorrente mensal a cada poll bem-sucedido.
                          </p>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            )}

            <p className="text-[11px] text-muted-foreground">
              Polo padrão: <strong>ativo</strong>. Tipo: <strong>litigioso</strong>. Cliente sem CPF/CNPJ é
              criado com flag "documentação pendente". Tribunal é inferido do CNJ.
            </p>
          </div>
        )}

        {/* Etapa 3: Importando */}
        {etapa === "running" && (
          <div className="space-y-4 py-8">
            <div className="flex items-center justify-center gap-2 text-sm">
              <Loader2 className="h-5 w-5 animate-spin text-indigo-600" />
              <span>Importando lote {progresso.atual} de {progresso.total}…</span>
            </div>
            <Progress value={(progresso.atual / Math.max(1, progresso.total)) * 100} />
            <p className="text-xs text-center text-muted-foreground">
              Não feche essa janela enquanto importa.
            </p>
          </div>
        )}

        {/* Etapa 4: Resultado */}
        {etapa === "done" && resultado && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-emerald-700">
              <CheckCircle2 className="h-5 w-5" />
              <p className="font-semibold">Importação finalizada</p>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="border rounded p-3">
                <p className="text-[10px] text-muted-foreground uppercase">Processos criados</p>
                <p className="text-2xl font-bold tabular-nums">{resultado.processosCriados}</p>
              </div>
              <div className="border rounded p-3">
                <p className="text-[10px] text-muted-foreground uppercase">Já existiam (pulados)</p>
                <p className="text-2xl font-bold tabular-nums">{resultado.processosJaExistiam}</p>
              </div>
              <div className="border rounded p-3">
                <p className="text-[10px] text-muted-foreground uppercase">Clientes criados</p>
                <p className="text-2xl font-bold tabular-nums">{resultado.contatosCriados}</p>
              </div>
              <div className="border rounded p-3">
                <p className="text-[10px] text-muted-foreground uppercase">Clientes reutilizados</p>
                <p className="text-2xl font-bold tabular-nums">{resultado.contatosReutilizados}</p>
              </div>
            </div>

            {(resultado.monitoramentosCriados > 0 ||
              resultado.monitoramentosJaExistiam > 0 ||
              resultado.monitoramentosNaoElegiveis > 0) && (
              <div className="border-2 border-indigo-200 bg-indigo-50/40 rounded-lg p-3">
                <p className="flex items-center gap-2 text-sm font-semibold text-indigo-700 mb-2">
                  <Radar className="h-4 w-4" />
                  Monitoramento
                </p>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="bg-white border rounded p-2">
                    <p className="text-[10px] text-muted-foreground uppercase">Ativados</p>
                    <p className="text-lg font-bold tabular-nums text-emerald-700">{resultado.monitoramentosCriados}</p>
                  </div>
                  <div className="bg-white border rounded p-2">
                    <p className="text-[10px] text-muted-foreground uppercase">Já ativos</p>
                    <p className="text-lg font-bold tabular-nums">{resultado.monitoramentosJaExistiam}</p>
                  </div>
                  <div className="bg-white border rounded p-2">
                    <p className="text-[10px] text-muted-foreground uppercase">Não elegíveis</p>
                    <p className="text-lg font-bold tabular-nums text-amber-700">{resultado.monitoramentosNaoElegiveis}</p>
                  </div>
                </div>
                {resultado.creditosConsumidos > 0 && (
                  <p className="text-[11px] text-muted-foreground mt-2">
                    Consumido: <strong className="tabular-nums">{resultado.creditosConsumidos}</strong> créditos
                  </p>
                )}
              </div>
            )}
            {resultado.erros.length > 0 && (
              <div className="border border-amber-200 bg-amber-50 rounded p-3">
                <p className="flex items-center gap-2 text-sm font-semibold text-amber-800">
                  <AlertTriangle className="h-4 w-4" />
                  {resultado.erros.length} linha(s) com erro
                </p>
                <ScrollArea className="h-32 mt-2">
                  <ul className="text-xs space-y-1">
                    {resultado.erros.map((e, i) => (
                      <li key={i} className="text-amber-900">
                        Linha {e.linhaNum}: {e.motivo}
                      </li>
                    ))}
                  </ul>
                </ScrollArea>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {etapa === "preview" && (
            <>
              <Button variant="outline" onClick={handleClose}>Cancelar</Button>
              <Button
                onClick={handleImportar}
                disabled={
                  preview!.resumo.novos === 0 ||
                  (ativarMonitor && !credencialIdEscolhida)
                }
                title={
                  ativarMonitor && !credencialIdEscolhida
                    ? "Escolha a credencial OAB ou desative o monitoramento"
                    : undefined
                }
              >
                Importar {preview!.resumo.novos} processo(s)
              </Button>
            </>
          )}
          {etapa === "done" && (
            <Button onClick={handleClose}>Fechar</Button>
          )}
          {etapa === "upload" && !previewMut.isPending && (
            <Button variant="outline" onClick={handleClose}>Cancelar</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
