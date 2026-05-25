/**
 * Footer da landing — links legais e institucionais.
 */

import { Logo } from "./Logo";

export function LandingFooter() {
  return (
    <footer className="border-t bg-white">
      <div className="mx-auto max-w-6xl px-4 py-12">
        <div className="mb-8 grid grid-cols-2 gap-8 md:grid-cols-4">
          <div className="col-span-2 md:col-span-1">
            <Logo className="text-xl" />
            <p className="mt-3 max-w-[260px] text-sm text-muted-foreground">
              O sistema operacional do escritório de advocacia moderno.
            </p>
          </div>

          <div>
            <h4 className="mb-3 text-sm font-bold">Produto</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li><a href="#pricing" className="transition-colors hover:text-foreground">Planos</a></li>
              <li><a href="/roadmap" className="transition-colors hover:text-foreground">Roadmap</a></li>
              <li><a href="#demo" className="transition-colors hover:text-foreground">Demonstração</a></li>
            </ul>
          </div>

          <div>
            <h4 className="mb-3 text-sm font-bold">Legal</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li><a href="/termos" className="transition-colors hover:text-foreground">Termos de uso</a></li>
              <li><a href="/privacidade" className="transition-colors hover:text-foreground">Privacidade</a></li>
            </ul>
          </div>

          <div>
            <h4 className="mb-3 text-sm font-bold">Suporte</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>
                <a href="mailto:contato@juridflow.com.br" className="transition-colors hover:text-foreground">
                  contato@juridflow.com.br
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="flex flex-col items-center justify-between gap-3 border-t pt-6 text-xs text-muted-foreground sm:flex-row">
          <span>© {new Date().getFullYear()} JuridFlow. Todos os direitos reservados.</span>
          <span>Feito pra advogados que detestam Excel.</span>
        </div>
      </div>
    </footer>
  );
}
