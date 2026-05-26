/**
 * Footer da landing — links legais e institucionais.
 */

import { Logo } from "./Logo";

export function LandingFooter() {
  return (
    <footer className="border-t border-white/[0.06] bg-[#05040b]">
      <div className="mx-auto max-w-6xl px-4 py-12">
        <div className="mb-8 grid grid-cols-2 gap-8 md:grid-cols-4">
          <div className="col-span-2 md:col-span-1">
            <Logo className="text-xl" variant="dark" />
            <p className="mt-3 max-w-[260px] text-sm text-violet-100/50">
              O sistema operacional do escritório de advocacia moderno.
            </p>
          </div>

          <div>
            <h4 className="mb-3 text-sm font-bold text-white">Produto</h4>
            <ul className="space-y-2 text-sm text-violet-100/50">
              <li><a href="#pricing" className="transition-colors hover:text-violet-200">Planos</a></li>
              <li><a href="/roadmap" className="transition-colors hover:text-violet-200">Roadmap</a></li>
              <li><a href="#demo" className="transition-colors hover:text-violet-200">Demonstração</a></li>
            </ul>
          </div>

          <div>
            <h4 className="mb-3 text-sm font-bold text-white">Legal</h4>
            <ul className="space-y-2 text-sm text-violet-100/50">
              <li><a href="/termos" className="transition-colors hover:text-violet-200">Termos de uso</a></li>
              <li><a href="/privacidade" className="transition-colors hover:text-violet-200">Privacidade</a></li>
            </ul>
          </div>

          <div>
            <h4 className="mb-3 text-sm font-bold text-white">Suporte</h4>
            <ul className="space-y-2 text-sm text-violet-100/50">
              <li>
                <a href="mailto:contato@juridflow.com.br" className="transition-colors hover:text-violet-200">
                  contato@juridflow.com.br
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="flex flex-col items-center justify-between gap-3 border-t border-white/[0.06] pt-6 text-xs text-violet-100/40 sm:flex-row">
          <span>© {new Date().getFullYear()} JuridFlow. Todos os direitos reservados.</span>
          <span>Feito pra advogados que detestam Excel.</span>
        </div>
      </div>
    </footer>
  );
}
