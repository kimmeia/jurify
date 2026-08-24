/**
 * Área de colar/soltar o print do QR de 2FA.
 *
 * O fluxo que ela imita é o que a pessoa já faz: gera o QR no portal do
 * tribunal, tecla Print Screen, e cola. Guardar o arquivo numa pasta pra
 * depois procurá-lo é passo que não precisa existir — daí o Ctrl+V ser o
 * caminho principal, e o seletor de arquivo a alternativa.
 *
 * Tudo acontece no navegador. A imagem não é enviada a lugar nenhum: o QR
 * carrega o segredo em texto, e subir o print seria gravar a chave da conta
 * do advogado num arquivo de imagem no servidor.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Loader2, QrCode, Upload, X } from "lucide-react";
import { lerQrDeImagem } from "@/lib/ler-qr";

export interface QrLido {
  secret: string;
  emissor: string | null;
  conta: string | null;
}

interface Props {
  onLido: (dados: QrLido) => void;
  lido: QrLido | null;
  aoLimpar: () => void;
}

function mascarar(secret: string): string {
  if (secret.length <= 8) return secret;
  return `${secret.slice(0, 4)} •••• •••• •••• ${secret.slice(-4)}`;
}

export default function LeitorQr({ onLido, lido, aoLimpar }: Props) {
  const [lendo, setLendo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [arrastando, setArrastando] = useState(false);
  const [escolher, setEscolher] = useState<QrLido[] | null>(null);
  const [mostrarTudo, setMostrarTudo] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const processar = useCallback(
    async (arquivo: Blob | null | undefined) => {
      if (!arquivo) return;
      setLendo(true);
      setErro(null);
      setEscolher(null);
      try {
        const r = await lerQrDeImagem(arquivo);
        if (!r.ok) {
          setErro(r.detalhe);
          return;
        }
        const todas = [r.dados, ...(r.outras ?? [])];
        // O QR de exportação do autenticador traz todas as contas marcadas.
        // Pegar a primeira gravaria o 2FA do e-mail pessoal no login do
        // tribunal — e o erro só apareceria no login, dias depois.
        if (todas.length > 1) setEscolher(todas);
        else onLido(r.dados);
      } catch {
        setErro("Não consegui ler essa imagem.");
      } finally {
        setLendo(false);
      }
    },
    [onLido],
  );

  // Ctrl+V em qualquer lugar do diálogo. O evento de colar não chega em div
  // sem foco, e exigir que a pessoa clique na área antes de colar é um passo
  // invisível que ela não tem como adivinhar.
  useEffect(() => {
    const aoColar = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith("image/"));
      if (!item) return;
      e.preventDefault();
      void processar(item.getAsFile());
    };
    window.addEventListener("paste", aoColar);
    return () => window.removeEventListener("paste", aoColar);
  }, [processar]);

  if (escolher) {
    return (
      <div className="rounded-xl border border-violet-200 bg-violet-50/60 p-3 space-y-2 dark:border-violet-900 dark:bg-violet-950/20">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-[13px] font-semibold text-violet-800 dark:text-violet-300">
              Esse QR tem {escolher.length} contas
            </p>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              É o QR de transferência do autenticador — ele carrega tudo que você marcou. Escolha a
              conta do tribunal.
            </p>
          </div>
          <button type="button" onClick={() => setEscolher(null)} className="text-muted-foreground shrink-0">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="space-y-1 max-h-52 overflow-y-auto">
          {escolher.map((c, i) => (
            <button
              key={`${c.secret}-${i}`}
              type="button"
              onClick={() => {
                onLido(c);
                setEscolher(null);
              }}
              className="w-full text-left rounded-lg border bg-background px-2.5 py-2 hover:border-violet-400 transition"
            >
              <p className="text-xs font-semibold truncate">{c.emissor ?? "Sem emissor"}</p>
              {c.conta && <p className="text-[11px] text-muted-foreground truncate">{c.conta}</p>}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (lido) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 space-y-2 dark:border-emerald-900/50 dark:bg-emerald-950/20">
        <div className="flex items-start gap-2.5">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
              QR lido — confira a conta
            </p>
            <p className="text-xs font-semibold truncate">{lido.emissor ?? "Sem emissor no QR"}</p>
            {lido.conta && <p className="text-[11px] text-muted-foreground truncate">conta: {lido.conta}</p>}
          </div>
          <button type="button" onClick={aoLimpar} className="text-muted-foreground shrink-0" title="Trocar print">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex items-center justify-between gap-2 pt-2 border-t border-emerald-200 dark:border-emerald-900/50">
          <p className="font-mono text-xs tracking-wider truncate">
            {mostrarTudo ? lido.secret : mascarar(lido.secret)}
          </p>
          <button
            type="button"
            onClick={() => setMostrarTudo((v) => !v)}
            className="text-[11px] font-medium text-violet-700 shrink-0 dark:text-violet-400"
          >
            {mostrarTudo ? "Ocultar" : "Ver completo"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setArrastando(true);
        }}
        onDragLeave={() => setArrastando(false)}
        onDrop={(e) => {
          e.preventDefault();
          setArrastando(false);
          void processar(e.dataTransfer.files?.[0]);
        }}
        className={`rounded-xl border-[1.5px] border-dashed p-5 flex flex-col items-center gap-1.5 transition ${
          arrastando ? "border-violet-500 bg-violet-100/60" : "border-violet-300 bg-violet-50/60 dark:bg-violet-950/30"
        } dark:bg-violet-950/20 dark:border-violet-900`}
      >
        {lendo ? (
          <>
            <Loader2 className="h-6 w-6 text-violet-500 animate-spin" />
            <p className="text-xs text-muted-foreground">Procurando o QR na imagem…</p>
          </>
        ) : (
          <>
            <QrCode className="h-7 w-7 text-violet-400" />
            <p className="text-[13px] font-semibold text-violet-700 dark:text-violet-300">
              Cole o print do QR aqui
            </p>
            <p className="text-[11px] text-muted-foreground">
              Tecle <kbd className="px-1 py-0.5 rounded border bg-background text-[10px] font-semibold">Ctrl</kbd>
              {" + "}
              <kbd className="px-1 py-0.5 rounded border bg-background text-[10px] font-semibold">V</kbd> depois do
              Print Screen
            </p>
            <span className="text-[11px] text-muted-foreground/70">ou</span>
            <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
              <Upload className="h-3.5 w-3.5 mr-1.5" />
              Escolher arquivo
            </Button>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            void processar(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>

      {erro && (
        <div className="mt-2 rounded-lg border border-destructive/30 bg-destructive/5 p-2.5">
          <p className="text-[11px] font-semibold text-destructive">{erro}</p>
          <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
            Tire outro print pegando o QR inteiro (Win + Shift + S), ou volte em “Colar o código” e informe o
            base32 na mão.
          </p>
        </div>
      )}

      <p className="text-[10px] text-muted-foreground mt-1.5 leading-relaxed">
        A imagem não sai do seu navegador — só o código de 2FA é enviado, junto com o resto do cadastro.
      </p>
    </div>
  );
}
