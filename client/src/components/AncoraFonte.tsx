/**
 * A âncora numerada que segue uma afirmação do JurisIA.
 *
 * Vive fora das duas telas que a usam (conversa de processo e pesquisa
 * jurisprudencial) porque ela é a marca visual do contrato anti-invenção: se
 * uma delas mudar o desenho sozinha, "isto tem fonte" passa a significar duas
 * coisas diferentes no mesmo produto.
 */

export function Ancora({ n }: { n: number }) {
  return (
    <sup className="ml-0.5 rounded border border-violet-200 bg-violet-100 px-1 py-px text-[8.5px] font-extrabold text-violet-700 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-300">
      {n}
    </sup>
  );
}
