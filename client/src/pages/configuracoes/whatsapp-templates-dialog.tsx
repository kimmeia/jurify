/**
 * Dialog de gerenciamento de Message Templates do WhatsApp Cloud API.
 *
 * Lista os templates da WABA (com status de aprovação da Meta), permite criar
 * novos templates (corpo com variáveis {{1}}, cabeçalho/rodapé/botões) e
 * excluir existentes. Também envia um template aprovado pra um número (teste).
 */

import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, Plus, Trash2, Send, FileText, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  WA_STATUS_TEMPLATE_LABELS,
  WA_STATUS_TEMPLATE_CORES,
  WA_CATEGORIA_TEMPLATE_LABELS,
  WA_IDIOMAS_TEMPLATE,
  contarVariaveisTemplate,
  validarNomeTemplate,
} from "@shared/whatsapp-cloud-types";
import type {
  WACloudTemplate,
  WACategoriaTemplate,
  WAStatusTemplate,
} from "@shared/whatsapp-cloud-types";

interface Props {
  open: boolean;
  onClose: () => void;
  canalId: number;
  canEdit: boolean;
}

function corpoDoTemplate(t: WACloudTemplate): string {
  return t.components?.find((c) => c.type === "BODY")?.text || "";
}

export function WhatsAppTemplatesDialog({ open, onClose, canalId, canEdit }: Props) {
  const [modo, setModo] = useState<"lista" | "criar">("lista");
  const [excluindo, setExcluindo] = useState<WACloudTemplate | null>(null);
  const [enviarPara, setEnviarPara] = useState<WACloudTemplate | null>(null);

  const { data: templates, isLoading, error, refetch, isRefetching } =
    trpc.whatsappCloud.listarTemplates.useQuery(
      { canalId },
      { enabled: open, retry: false },
    );

  const excluirMut = trpc.whatsappCloud.excluirTemplate.useMutation({
    onSuccess: () => {
      toast.success("Template excluído.");
      setExcluindo(null);
      refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-emerald-600" />
            Templates de mensagem
          </DialogTitle>
          <DialogDescription>
            Modelos aprovados pela Meta para iniciar conversas (ex.: lembretes, avisos).
            Templates de marketing e utilidade passam por análise antes de poder ser usados.
          </DialogDescription>
        </DialogHeader>

        {modo === "criar" ? (
          <FormularioCriar
            canalId={canalId}
            onCancel={() => setModo("lista")}
            onCreated={() => {
              setModo("lista");
              refetch();
            }}
          />
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {templates?.length || 0} template(s)
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refetch()}
                  disabled={isRefetching}
                >
                  {isRefetching ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                </Button>
                {canEdit && (
                  <Button size="sm" onClick={() => setModo("criar")}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> Novo template
                  </Button>
                )}
              </div>
            </div>

            {isLoading && (
              <div className="flex items-center justify-center py-10 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando templates...
              </div>
            )}

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {(error as any).message}
              </div>
            )}

            {!isLoading && !error && (templates?.length || 0) === 0 && (
              <div className="text-center py-8 text-sm text-muted-foreground">
                Nenhum template ainda. Crie o primeiro para começar.
              </div>
            )}

            <div className="space-y-2">
              {templates?.map((t) => (
                <div
                  key={`${t.name}_${t.language}`}
                  className="rounded-lg border p-3 hover:border-primary/30 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-sm font-medium truncate">{t.name}</span>
                        <StatusBadge status={t.status} />
                        <Badge variant="outline" className="text-[10px]">
                          {WA_CATEGORIA_TEMPLATE_LABELS[t.category] || t.category}
                        </Badge>
                        <Badge variant="outline" className="text-[10px] text-muted-foreground">
                          {t.language}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2 whitespace-pre-wrap">
                        {corpoDoTemplate(t) || "—"}
                      </p>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2"
                        title="Enviar (teste)"
                        disabled={t.status !== "APPROVED"}
                        onClick={() => setEnviarPara(t)}
                      >
                        <Send className="h-3.5 w-3.5" />
                      </Button>
                      {canEdit && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-destructive"
                          title="Excluir"
                          onClick={() => setExcluindo(t)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </DialogContent>

      {/* Confirmação de exclusão */}
      <AlertDialog open={!!excluindo} onOpenChange={(v) => !v && setExcluindo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir template?</AlertDialogTitle>
            <AlertDialogDescription>
              O template <span className="font-mono font-medium">{excluindo?.name}</span> será
              removido permanentemente da sua conta WhatsApp Business. Esta ação não pode ser
              desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => excluindo && excluirMut.mutate({ canalId, nome: excluindo.name })}
              disabled={excluirMut.isPending}
            >
              {excluirMut.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Envio de teste */}
      {enviarPara && (
        <EnviarTemplateDialog
          canalId={canalId}
          template={enviarPara}
          onClose={() => setEnviarPara(null)}
        />
      )}
    </Dialog>
  );
}

function StatusBadge({ status }: { status: WAStatusTemplate }) {
  return (
    <Badge variant="outline" className={`text-[10px] ${WA_STATUS_TEMPLATE_CORES[status] || ""}`}>
      {WA_STATUS_TEMPLATE_LABELS[status] || status}
    </Badge>
  );
}

// ─── Formulário de criação ────────────────────────────────────────────────────

function FormularioCriar({
  canalId,
  onCancel,
  onCreated,
}: {
  canalId: number;
  onCancel: () => void;
  onCreated: () => void;
}) {
  const [nome, setNome] = useState("");
  const [categoria, setCategoria] = useState<WACategoriaTemplate>("UTILITY");
  const [idioma, setIdioma] = useState("pt_BR");
  const [cabecalho, setCabecalho] = useState("");
  const [corpo, setCorpo] = useState("");
  const [rodape, setRodape] = useState("");
  const [exemplos, setExemplos] = useState<string[]>([]);

  const numVars = useMemo(() => contarVariaveisTemplate(corpo), [corpo]);

  // Mantém o array de exemplos do tamanho do número de variáveis.
  const exemplosAjustados = useMemo(() => {
    const arr = [...exemplos];
    arr.length = numVars;
    for (let i = 0; i < numVars; i++) if (arr[i] === undefined) arr[i] = "";
    return arr;
  }, [exemplos, numVars]);

  const criarMut = trpc.whatsappCloud.criarTemplate.useMutation({
    onSuccess: () => {
      toast.success("Template enviado para análise da Meta.");
      onCreated();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const erroNome = nome ? validarNomeTemplate(nome) : null;
  const podeSalvar =
    !erroNome &&
    nome.trim() &&
    corpo.trim() &&
    (numVars === 0 || exemplosAjustados.every((e) => e && e.trim()));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5 col-span-2">
          <Label className="text-xs">Nome do template *</Label>
          <Input
            value={nome}
            onChange={(e) => setNome(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))}
            placeholder="lembrete_audiencia"
            className="font-mono text-sm"
          />
          {erroNome && <p className="text-[11px] text-red-600">{erroNome}</p>}
          <p className="text-[10px] text-muted-foreground">
            Só letras minúsculas, números e underscore.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Categoria *</Label>
          <Select value={categoria} onValueChange={(v) => setCategoria(v as WACategoriaTemplate)}>
            <SelectTrigger className="text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(WA_CATEGORIA_TEMPLATE_LABELS) as WACategoriaTemplate[]).map((c) => (
                <SelectItem key={c} value={c}>
                  {WA_CATEGORIA_TEMPLATE_LABELS[c]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Idioma *</Label>
          <Select value={idioma} onValueChange={setIdioma}>
            <SelectTrigger className="text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WA_IDIOMAS_TEMPLATE.map((i) => (
                <SelectItem key={i.code} value={i.code}>
                  {i.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Cabeçalho (opcional)</Label>
        <Input
          value={cabecalho}
          onChange={(e) => setCabecalho(e.target.value)}
          placeholder="Título curto (até 60 caracteres)"
          maxLength={60}
          className="text-sm"
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Corpo da mensagem *</Label>
        <Textarea
          value={corpo}
          onChange={(e) => setCorpo(e.target.value)}
          placeholder="Olá {{1}}, sua audiência do processo {{2}} está marcada."
          rows={4}
          maxLength={1024}
          className="text-sm"
        />
        <p className="text-[10px] text-muted-foreground">
          Use {"{{1}}"}, {"{{2}}"}... para variáveis preenchidas no envio.
        </p>
      </div>

      {numVars > 0 && (
        <div className="space-y-1.5 rounded-lg border bg-muted/30 p-3">
          <Label className="text-xs">Exemplos das variáveis *</Label>
          <p className="text-[10px] text-muted-foreground mb-1">
            A Meta exige um exemplo por variável para aprovar o template.
          </p>
          {exemplosAjustados.map((ex, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="font-mono text-xs text-muted-foreground w-8">{`{{${i + 1}}}`}</span>
              <Input
                value={ex}
                onChange={(e) => {
                  const arr = [...exemplosAjustados];
                  arr[i] = e.target.value;
                  setExemplos(arr);
                }}
                placeholder={`Exemplo ${i + 1}`}
                className="text-sm h-8"
              />
            </div>
          ))}
        </div>
      )}

      <div className="space-y-1.5">
        <Label className="text-xs">Rodapé (opcional)</Label>
        <Input
          value={rodape}
          onChange={(e) => setRodape(e.target.value)}
          placeholder="Ex.: Responda PARAR para não receber mais"
          maxLength={60}
          className="text-sm"
        />
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
        <Button
          onClick={() =>
            criarMut.mutate({
              canalId,
              nome,
              categoria,
              idioma,
              corpo,
              cabecalhoTexto: cabecalho || undefined,
              rodapeTexto: rodape || undefined,
              exemplosCorpo: numVars > 0 ? exemplosAjustados : undefined,
            })
          }
          disabled={!podeSalvar || criarMut.isPending}
        >
          {criarMut.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Plus className="h-4 w-4 mr-2" />
          )}
          Criar e enviar para análise
        </Button>
      </div>
    </div>
  );
}

// ─── Envio de teste ───────────────────────────────────────────────────────────

function EnviarTemplateDialog({
  canalId,
  template,
  onClose,
}: {
  canalId: number;
  template: WACloudTemplate;
  onClose: () => void;
}) {
  const corpo = corpoDoTemplate(template);
  const numVars = contarVariaveisTemplate(corpo);
  const [telefone, setTelefone] = useState("");
  const [params, setParams] = useState<string[]>(Array(numVars).fill(""));

  const enviarMut = trpc.whatsappCloud.enviarTemplate.useMutation({
    onSuccess: () => {
      toast.success("Template enviado!");
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const podeEnviar =
    telefone.replace(/\D/g, "").length >= 10 && params.every((p) => p.trim());

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-4 w-4 text-emerald-600" />
            Enviar template
          </DialogTitle>
          <DialogDescription className="font-mono text-xs">{template.name}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-lg bg-muted/40 p-3 text-sm whitespace-pre-wrap text-muted-foreground">
            {corpo}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Telefone do destinatário *</Label>
            <Input
              value={telefone}
              onChange={(e) => setTelefone(e.target.value)}
              placeholder="5585999999999"
              className="text-sm"
            />
          </div>

          {numVars > 0 &&
            params.map((p, i) => (
              <div key={i} className="space-y-1.5">
                <Label className="text-xs font-mono">{`Variável {{${i + 1}}}`}</Label>
                <Input
                  value={p}
                  onChange={(e) => {
                    const arr = [...params];
                    arr[i] = e.target.value;
                    setParams(arr);
                  }}
                  className="text-sm"
                />
              </div>
            ))}

          <Button
            className="w-full"
            disabled={!podeEnviar || enviarMut.isPending}
            onClick={() =>
              enviarMut.mutate({
                canalId,
                telefone,
                templateName: template.name,
                languageCode: template.language,
                parametrosCorpo: numVars > 0 ? params : undefined,
              })
            }
          >
            {enviarMut.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Send className="h-4 w-4 mr-2" />
            )}
            Enviar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
