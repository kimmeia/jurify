/**
 * Faixa de integrações — "conecta com o que o escritório já usa".
 * Reforça credibilidade logo após o hero.
 */

const integracoes = [
  { nome: "Asaas", cor: "bg-emerald-500" },
  { nome: "WhatsApp", cor: "bg-[#25d366]" },
  { nome: "Instagram", cor: "bg-[#e1306c]" },
  { nome: "PJe · TJCE", cor: "bg-blue-500" },
  { nome: "BACEN", cor: "bg-amber-500" },
  { nome: "Cal.com", cor: "bg-violet-600" },
];

export function Integracoes() {
  return (
    <section className="border-y border-white/[0.06] bg-[#0a0817] py-8">
      <div className="mx-auto max-w-6xl px-4">
        <p className="text-center text-xs font-semibold uppercase tracking-[0.06em] text-violet-100/50">
          Conecta com o que seu escritório já usa
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
          {integracoes.map((i) => (
            <span
              key={i.nome}
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-[15px] font-bold text-violet-50"
            >
              <span className={`h-2.5 w-2.5 rounded-full ${i.cor}`} />
              {i.nome}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
