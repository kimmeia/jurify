/**
 * Footer da landing — links legais e institucionais.
 */

import { Scale } from "lucide-react";

export function LandingFooter() {
  return (
    <footer className="border-t bg-muted/30">
      <div className="max-w-6xl mx-auto px-4 py-10">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-8">
          <div className="col-span-2 md:col-span-1">
            <div className="flex items-center gap-2 mb-3">
              <div className="h-8 w-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center">
                <Scale className="h-4 w-4" />
              </div>
              <span className="font-bold text-lg">Jurify</span>
            </div>
            <p className="text-sm text-muted-foreground">
              O sistema operacional do escritório de advocacia moderno.
            </p>
          </div>

          <div>
            <h4 className="font-semibold text-sm mb-3">Produto</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>
                <a href="#pricing" className="hover:text-foreground transition-colors">
                  Planos
                </a>
              </li>
              <li>
                <a href="/roadmap" className="hover:text-foreground transition-colors">
                  Roadmap
                </a>
              </li>
              <li>
                <a href="#demo" className="hover:text-foreground transition-colors">
                  Demonstração
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold text-sm mb-3">Legal</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>
                <a href="/termos" className="hover:text-foreground transition-colors">
                  Termos de uso
                </a>
              </li>
              <li>
                <a href="/privacidade" className="hover:text-foreground transition-colors">
                  Privacidade
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold text-sm mb-3">Suporte</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>
                <a href="mailto:contato@jurify.com.br" className="hover:text-foreground transition-colors">
                  contato@jurify.com.br
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="border-t pt-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>© {new Date().getFullYear()} Jurify. Todos os direitos reservados.</span>
          <span>Feito com ❤️ pra advogados que detestam Excel.</span>
        </div>
      </div>
    </footer>
  );
}
