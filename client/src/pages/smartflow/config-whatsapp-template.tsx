/**
 * Construtor do modo "Template aprovado" (HSM) do bloco Enviar mensagem.
 *
 * Lista os templates aprovados do canal WhatsApp oficial (API Meta) via
 * `smartflow.listarTemplatesWhatsapp` e monta os campos de variáveis a partir
 * dos componentes do template escolhido (cabeçalho com mídia/variável, corpo
 * com {{1}}.., botões dinâmicos). Tudo aceita variáveis do fluxo `{{...}}`.
 *
 * Degrada com graça: se não houver canal oficial (ou a Meta recusar a
 * consulta), mostra um aviso e um modo manual (nome + idioma + variáveis).
 */
import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { VariableInput, VariableTrigger, type Variavel } from "@/components/VariableInput";
import { useSmartFlowVariaveis } from "@/hooks/useSmartFlowVariaveis";
import { trpc } from "@/lib/trpc";

type TemplateMeta = { name: string; language: string; status: string; category: string; components: any[] };

/** Conta as variáveis do corpo: posicionais ({{1}}..{{n}}) → maior índice; nomeadas → distintas. */
function contarVarsCorpo(texto: string): number {
  const ms = String(texto).match(/\{\{\s*([^}]+?)\s*\}\}/g) || [];
  if (ms.length === 0) return 0;
  const nums = ms.map((m) => Number(m.replace(/[{}]/g, "").trim())).filter((n) => Number.isFinite(n)) as number[];
  if (nums.length === ms.length) return Math.max(...nums);
  return new Set(ms).size;
}

/** Quebra a estrutura do template (componentes da Meta) no que a UI precisa. */
function analisar(components: any[]) {
  let header: { formato: string; temVar: boolean; texto?: string } | null = null;
  let bodyText = "";
  let footerText = "";
  let bodyVars = 0;
  const buttons: Array<{ index: number; bt: string; text: string; url?: string; dinamico: boolean; tipo: "URL" | "QUICK_REPLY" | "COPY_CODE" | "OUTRO" }> = [];
  for (const c of Array.isArray(components) ? components : []) {
    const type = String(c?.type || "").toUpperCase();
    if (type === "HEADER") {
      const fmt = String(c?.format || "TEXT").toUpperCase();
      const temVar = fmt === "TEXT" && /\{\{[^}]+\}\}/.test(String(c?.text || ""));
      header = { formato: fmt, temVar, texto: c?.text };
    } else if (type === "BODY") {
      bodyText = String(c?.text || "");
      bodyVars = contarVarsCorpo(bodyText);
    } else if (type === "FOOTER") {
      footerText = String(c?.text || "");
    } else if (type === "BUTTONS") {
      const arr = Array.isArray(c?.buttons) ? c.buttons : [];
      arr.forEach((b: any, i: number) => {
        const bt = String(b?.type || "").toUpperCase();
        let tipo: "URL" | "QUICK_REPLY" | "COPY_CODE" | "OUTRO" = "OUTRO";
        let dinamico = false;
        if (bt === "URL") { tipo = "URL"; dinamico = /\{\{[^}]+\}\}/.test(String(b?.url || "")); }
        else if (bt === "COPY_CODE") { tipo = "COPY_CODE"; dinamico = true; }
        else if (bt === "QUICK_REPLY") { tipo = "QUICK_REPLY"; dinamico = false; }
        buttons.push({ index: i, bt, text: String(b?.text || ""), url: b?.url, dinamico, tipo });
      });
    }
  }
  return { header, bodyText, bodyVars, footerText, buttons };
}

const ROTULO_MIDIA: Record<string, string> = { IMAGE: "imagem", VIDEO: "vídeo", DOCUMENT: "documento" };
function rotuloBotao(b: { tipo: string; bt: string }): string {
  if (b.tipo === "URL") return "abrir link";
  if (b.tipo === "QUICK_REPLY") return "resposta rápida";
  if (b.tipo === "COPY_CODE") return "copiar código";
  if (b.bt === "PHONE_NUMBER") return "ligar";
  return b.bt.toLowerCase();
}

/** Campo com VariableInput + botão de inserir variável do fluxo. Módulo-level pra não remontar (perder foco) a cada tecla. */
function CampoVar({
  id, label, hint, value, onValue, variaveis, placeholder,
}: {
  id: string; label: string; hint?: string; value: string; onValue: (v: string) => void; variaveis: Variavel[]; placeholder?: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <Label htmlFor={id} className="text-xs">{label}</Label>
        <VariableTrigger inputId={id} variaveis={variaveis} onInsert={(p) => onValue((value ? value + " " : "") + `{{${p}}}`)} />
      </div>
      <VariableInput id={id} value={value} onChange={onValue} variaveis={variaveis} placeholder={placeholder} preview />
      {hint && <p className="text-[10px] text-muted-foreground mt-1">{hint}</p>}
    </div>
  );
}

/** Caixa de preview de um texto do template, com as variáveis {{...}} destacadas. */
function PreviewBox({ titulo, texto }: { titulo: string; texto: string }) {
  const partes = String(texto).split(/(\{\{[^}]+\}\})/g);
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">{titulo}</p>
      <div className="text-[11px] whitespace-pre-wrap rounded bg-background border p-2 text-foreground/80 leading-relaxed">
        {partes.map((p, i) =>
          /^\{\{[^}]+\}\}$/.test(p) ? (
            <span key={i} className="px-1 rounded bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300 font-mono text-[10px]">{p}</span>
          ) : (
            <span key={i}>{p}</span>
          ),
        )}
      </div>
    </div>
  );
}

/** Modo manual das variáveis do corpo (fallback quando não dá pra listar templates). */
function ManualCorpo({ cfg, onChange, variaveis }: { cfg: any; onChange: (patch: Record<string, unknown>) => void; variaveis: Variavel[] }) {
  const corpo: string[] = Array.isArray(cfg.templateCorpo) ? cfg.templateCorpo : [];
  const set = (i: number, v: string) => {
    const arr = [...corpo];
    arr[i] = v;
    onChange({ templateCorpo: arr });
  };
  const add = () => onChange({ templateCorpo: [...corpo, ""] });
  const rem = (i: number) => onChange({ templateCorpo: corpo.filter((_, j) => j !== i) });
  return (
    <div className="space-y-2">
      <Label className="text-xs">Variáveis do corpo (na ordem {"{{1}}, {{2}}…"})</Label>
      {corpo.map((v, i) => (
        <div key={i} className="flex items-end gap-1">
          <div className="flex-1">
            <CampoVar id={`tpl-manual-${i}`} label={`Variável {{${i + 1}}}`} value={String(v || "")} onValue={(nv) => set(i, nv)} variaveis={variaveis} placeholder="ex.: {{cliente.nome}}" />
          </div>
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => rem(i)} title="Remover">
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={add}>
        <Plus className="h-3 w-3 mr-1" /> Adicionar variável
      </Button>
    </div>
  );
}

export function ConfigWhatsappTemplateBuilder({ cfg, onChange }: { cfg: any; onChange: (patch: Record<string, unknown>) => void }) {
  const variaveis = useSmartFlowVariaveis();
  const { data, isLoading } = (trpc as any).smartflow.listarTemplatesWhatsapp.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 5 * 60 * 1000,
  });
  const disponivel = !!data?.disponivel;
  const motivo: string | null = data?.motivo ?? null;
  const templates: TemplateMeta[] = Array.isArray(data?.templates) ? data.templates : [];

  const chaveDe = (t: { name: string; language: string }) => `${t.name}::${t.language}`;
  const selecionado =
    templates.find((t) => chaveDe(t) === `${cfg.templateNome || ""}::${cfg.templateIdioma || ""}`) ||
    templates.find((t) => t.name === cfg.templateNome) ||
    null;
  const estrutura = selecionado ? analisar(selecionado.components) : null;

  const escolher = (k: string) => {
    const t = templates.find((x) => chaveDe(x) === k);
    if (!t) return;
    const e = analisar(t.components);
    const header =
      e.header && e.header.formato !== "TEXT"
        ? { formato: e.header.formato, valor: "", nomeArquivo: "" }
        : e.header && e.header.temVar
          ? { formato: "TEXT", valor: "" }
          : undefined;
    const botoes = e.buttons
      .filter((b) => b.dinamico && b.tipo !== "OUTRO")
      .map((b) => ({ index: b.index, tipo: b.tipo as "URL" | "QUICK_REPLY" | "COPY_CODE", valor: "" }));
    onChange({
      templateNome: t.name,
      templateIdioma: t.language,
      templateHeader: header,
      templateCorpo: Array.from({ length: e.bodyVars }, () => ""),
      templateBotoes: botoes,
      // Texto do corpo aprovado (com {{1}}..{{n}}) — guardado pra reconstruir a
      // mensagem REAL na timeline de Atendimentos (o corpo vive na Meta; sem
      // guardar, a timeline só teria o resumo "[Template: nome] valores").
      templateCorpoTexto: e.bodyText,
    });
  };

  const setCorpo = (i: number, v: string) => {
    const arr = Array.isArray(cfg.templateCorpo) ? [...cfg.templateCorpo] : [];
    while (arr.length <= i) arr.push("");
    arr[i] = v;
    onChange({ templateCorpo: arr });
  };
  const valorBotao = (index: number): string => {
    const arr = Array.isArray(cfg.templateBotoes) ? cfg.templateBotoes : [];
    return String(arr.find((b: any) => b.index === index)?.valor ?? "");
  };
  const setBotao = (index: number, tipo: string, v: string) => {
    const arr = Array.isArray(cfg.templateBotoes) ? [...cfg.templateBotoes] : [];
    const j = arr.findIndex((b: any) => b.index === index);
    if (j >= 0) arr[j] = { ...arr[j], tipo, valor: v };
    else arr.push({ index, tipo, valor: v });
    onChange({ templateBotoes: arr });
  };
  const setHeader = (patch: Record<string, unknown>) => onChange({ templateHeader: { ...(cfg.templateHeader || {}), ...patch } });

  const mostrarManual = !disponivel || (!!cfg.templateNome && !selecionado);

  return (
    <div className="space-y-3">
      {isLoading && <p className="text-xs text-muted-foreground">Carregando templates da sua conta WhatsApp…</p>}

      {!isLoading && !disponivel && (
        <div className="rounded border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-2.5 text-[11px] text-amber-800 dark:text-amber-200 space-y-1">
          <p className="font-semibold flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Não consegui listar seus templates</p>
          <p>{motivo || "Verifique o canal WhatsApp oficial."}</p>
          <p className="text-amber-700/80 dark:text-amber-300/80">Dá pra informar o template manualmente abaixo mesmo assim.</p>
        </div>
      )}

      {!isLoading && disponivel && (
        <div>
          <Label className="text-xs">Template aprovado</Label>
          <Select value={selecionado ? chaveDe(selecionado) : ""} onValueChange={escolher}>
            <SelectTrigger>
              <SelectValue placeholder={templates.length ? "Escolha um template…" : "Nenhum template aprovado"} />
            </SelectTrigger>
            <SelectContent>
              {templates.map((t) => (
                <SelectItem key={chaveDe(t)} value={chaveDe(t)}>
                  {t.name} · {t.language}{t.category ? ` · ${String(t.category).toLowerCase()}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {templates.length === 0 && (
            <p className="text-[10px] text-muted-foreground mt-1">Nenhum template <b>aprovado</b> na sua conta Meta ainda.</p>
          )}
        </div>
      )}

      {estrutura && (
        <div className="space-y-3 rounded-md border p-2.5 bg-muted/10">
          {/* Cabeçalho com mídia */}
          {estrutura.header && estrutura.header.formato !== "TEXT" && (
            <div className="space-y-2">
              <CampoVar
                id="tpl-header-url"
                label={`URL ${estrutura.header.formato === "DOCUMENT" ? "do" : "da"} ${ROTULO_MIDIA[estrutura.header.formato] || "mídia"}`}
                hint="Link público do arquivo (pode usar variável do fluxo)."
                value={String(cfg.templateHeader?.valor || "")}
                onValue={(v) => setHeader({ formato: estrutura.header!.formato, valor: v })}
                variaveis={variaveis}
                placeholder="https://…"
              />
              {estrutura.header.formato === "DOCUMENT" && (
                <div>
                  <Label className="text-xs">Nome do arquivo (opcional)</Label>
                  <Input
                    value={String(cfg.templateHeader?.nomeArquivo || "")}
                    onChange={(e) => setHeader({ nomeArquivo: e.target.value })}
                    placeholder="contrato.pdf"
                  />
                </div>
              )}
            </div>
          )}
          {/* Cabeçalho de texto com variável */}
          {estrutura.header && estrutura.header.formato === "TEXT" && estrutura.header.temVar && (
            <div className="space-y-1">
              <PreviewBox titulo="Cabeçalho" texto={estrutura.header.texto || ""} />
              <CampoVar
                id="tpl-header-text"
                label="Variável do cabeçalho"
                value={String(cfg.templateHeader?.valor || "")}
                onValue={(v) => setHeader({ formato: "TEXT", valor: v })}
                variaveis={variaveis}
                placeholder="ex.: {{cliente.nome}}"
              />
            </div>
          )}
          {/* Cabeçalho de texto fixo */}
          {estrutura.header && estrutura.header.formato === "TEXT" && !estrutura.header.temVar && estrutura.header.texto && (
            <PreviewBox titulo="Cabeçalho" texto={estrutura.header.texto} />
          )}

          {/* Corpo */}
          <div className="space-y-2">
            <PreviewBox titulo="Corpo da mensagem" texto={estrutura.bodyText} />
            {estrutura.bodyVars === 0 ? (
              <p className="text-[10px] text-muted-foreground">Esse template não tem variáveis no corpo — o texto é fixo.</p>
            ) : (
              Array.from({ length: estrutura.bodyVars }).map((_, i) => (
                <CampoVar
                  key={i}
                  id={`tpl-body-${i}`}
                  label={`Variável {{${i + 1}}}`}
                  value={String(cfg.templateCorpo?.[i] || "")}
                  onValue={(v) => setCorpo(i, v)}
                  variaveis={variaveis}
                  placeholder="ex.: {{cliente.nome}}"
                />
              ))
            )}
          </div>

          {/* Rodapé (fixo) */}
          {estrutura.footerText && <PreviewBox titulo="Rodapé" texto={estrutura.footerText} />}

          {/* Botões */}
          {estrutura.buttons.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Botões</p>
              {estrutura.buttons.map((b) => (
                <div key={b.index} className="space-y-1">
                  <p className="text-[11px]">
                    <span className="font-medium">{b.text || "(sem texto)"}</span>
                    <span className="text-muted-foreground"> · {rotuloBotao(b)}</span>
                  </p>
                  {b.dinamico && b.tipo === "URL" && (
                    <CampoVar
                      id={`tpl-btn-${b.index}`}
                      label="Parte variável do link"
                      hint={`Base do link: ${b.url}`}
                      value={valorBotao(b.index)}
                      onValue={(v) => setBotao(b.index, "URL", v)}
                      variaveis={variaveis}
                      placeholder="ex.: {{agendamentoId}}"
                    />
                  )}
                  {b.dinamico && b.tipo === "COPY_CODE" && (
                    <CampoVar
                      id={`tpl-btn-${b.index}`}
                      label="Código a copiar"
                      value={valorBotao(b.index)}
                      onValue={(v) => setBotao(b.index, "COPY_CODE", v)}
                      variaveis={variaveis}
                      placeholder="ex.: PROMO10"
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Modo manual / fallback */}
      {mostrarManual && (
        <div className="space-y-2 rounded-md border p-2.5">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Template (manual)</p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Nome do template</Label>
              <Input
                value={String(cfg.templateNome || "")}
                onChange={(e) => onChange({ templateNome: e.target.value })}
                placeholder="ex.: lembrete_audiencia"
              />
            </div>
            <div>
              <Label className="text-xs">Idioma</Label>
              <Input
                value={String(cfg.templateIdioma || "pt_BR")}
                onChange={(e) => onChange({ templateIdioma: e.target.value })}
                placeholder="pt_BR"
              />
            </div>
          </div>
          <ManualCorpo cfg={cfg} onChange={onChange} variaveis={variaveis} />
        </div>
      )}

      <p className="text-[10px] text-muted-foreground">
        Templates exigem o WhatsApp <b>oficial (API Meta)</b> e precisam estar <b>aprovados</b> na Meta. Use template pra
        falar fora da janela de 24h (cobrança, lembrete, follow-up).
      </p>
    </div>
  );
}
