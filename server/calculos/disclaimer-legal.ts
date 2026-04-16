/**
 * Disclaimer legal obrigatório — incluído no rodapé de TODO parecer
 * técnico gerado pelo sistema.
 *
 * Motivação: parecer vai a juízo. Precisamos deixar claro que:
 * 1. É gerado por sistema automatizado (não assinado por perito)
 * 2. Usa interpretação jurisprudencial corrente (não lei expressa)
 * 3. Deve ser revisado por advogado habilitado
 * 4. Tetos/limites podem depender de norma vigente na data do contrato
 * 5. Taxas BACEN foram buscadas em tempo real na data do cálculo
 */

export const DISCLAIMER_LEGAL = `
---

> **NOTA IMPORTANTE**
>
> Este parecer técnico foi gerado por sistema automatizado com base em:
> - Legislação federal vigente e jurisprudência consolidada do STJ/STF
> - Taxas médias oficiais do Banco Central do Brasil (API SGS), consultadas em tempo real na data do cálculo
> - Cálculos financeiros determinísticos (sistemas de amortização PRICE, SAC, SACRE e Gauss)
>
> **Limitações:**
> - A análise de abusividade utiliza o critério jurisprudencial de 1,5× a taxa média BACEN (REsp 1.061.530/RS), que é referência usual mas **não é texto expresso de lei** — o julgador pode adotar outro parâmetro
> - Tetos legais específicos (consignado INSS, servidor, cheque especial) são aplicados conforme norma vigente na data do cálculo; para contratos antigos, **verificar a norma vigente na data da contratação**
> - Categorias profissionais com regulamento próprio (militares, magistrados, servidores estaduais/municipais etc.) podem ter limites diferentes dos aplicados neste parecer
>
> **A validação final para fins processuais deve ser feita por advogado habilitado**, considerando a jurisprudência do foro específico, a norma vigente na data do contrato e as particularidades do caso concreto.
`.trim();

/**
 * Retorna o disclaimer formatado em Markdown para inclusão no parecer.
 * Chamado por cada gerarParecer*() no final do documento.
 */
export function appendDisclaimer(parecerTexto: string): string {
  return parecerTexto + "\n\n" + DISCLAIMER_LEGAL;
}
