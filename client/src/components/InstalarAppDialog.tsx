/**
 * Diálogo com instruções de instalação da PWA, por aparelho.
 *
 * Abre quando o usuário toca em "Instalar app" e NÃO há instalador nativo
 * disponível (iPhone, ou navegador que não emitiu o beforeinstallprompt).
 * No Android/desktop com prompt nativo, o caller instala direto sem abrir
 * este diálogo.
 */

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Share, Plus, MoreVertical, Smartphone } from "lucide-react";
import { ehIOS } from "@/lib/pwa-install";

function Passo({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-1.5">
      <span className="h-6 w-6 rounded-full bg-violet-600 text-white text-xs font-bold flex items-center justify-center shrink-0">{n}</span>
      <p className="text-sm text-foreground/90 leading-relaxed">{children}</p>
    </div>
  );
}

export function InstalarAppDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const ios = ehIOS();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Smartphone className="h-5 w-5 text-violet-600" />
            {ios ? "Instalar no iPhone" : "Instalar o app"}
          </DialogTitle>
          <DialogDescription>
            Deixa o JuridFlow na tela inicial, em tela cheia e com notificações.
          </DialogDescription>
        </DialogHeader>

        {ios ? (
          <div className="space-y-0.5">
            <Passo n={1}>
              Toque em{" "}
              <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-semibold">
                <Share className="h-3.5 w-3.5" /> Compartilhar
              </span>{" "}
              na barra do Safari.
            </Passo>
            <Passo n={2}>
              Escolha{" "}
              <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-semibold">
                <Plus className="h-3.5 w-3.5" /> Adicionar à Tela de Início
              </span>{" "}
              e confirme.
            </Passo>
            <Passo n={3}>
              Pronto! Abra pelo <b>ícone do JuridFlow</b> na tela inicial — e ative as notificações no sino 🔔.
            </Passo>
          </div>
        ) : (
          <div className="space-y-0.5">
            <Passo n={1}>
              Abra o menu do navegador{" "}
              <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-semibold">
                <MoreVertical className="h-3.5 w-3.5" /> (⋮)
              </span>
              .
            </Passo>
            <Passo n={2}>
              Toque em <b>“Instalar app”</b> (ou “Adicionar à tela inicial”) e confirme.
            </Passo>
            <Passo n={3}>
              Pronto! Abra pelo <b>ícone do JuridFlow</b> e ative as notificações no sino 🔔.
            </Passo>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
