/**
 * Gerador de Parecer Técnico — FGTS
 *
 * Produz um documento em Markdown formatado para uso judicial,
 * com demonstrativo de depósitos mensais, saldo e multa rescisória.
 */

import type { ParametrosFGTS, ResultadoFGTS } from "./engine-fgts";
import { DISCLAIMER_LEGAL } from "./disclaimer-legal";

const TIPO_MULTA_LABEL: Record<string, string> = {
  sem_justa_causa: "Demissão sem Justa Causa (art. 18 § 1º Lei 8.036/1990)",
  rescisao_indireta: "Rescisão Indireta (art. 483 CLT c/c art. 18 § 1º Lei 8.036/1990)",
  acordo_mutuo: "Acordo Mútuo (art. 484-A CLT — Reforma Trabalhista 2017)",
  sem_multa: "Sem Multa Rescisória (pedido de demissão / justa causa / término de contrato)",
};

function fmt(n: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
}

function fmtMes(mesAno: string): string {
  const [ano, mes] = mesAno.split("-");
  const meses = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  return `${meses[parseInt(mes) - 1]}/${ano}`;
}

export function gerarParecerFGTS(params: ParametrosFGTS, resultado: ResultadoFGTS): string {
  const hoje = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
  const tipoMultaDesc = TIPO_MULTA_LABEL[params.tipoMulta] ?? params.tipoMulta;

  const linhasTabela = resultado.periodos.map((p) =>
    `| ${fmtMes(p.mesAno)} | ${fmt(p.remuneracao)} | ${fmt(p.deposito)} | ${fmt(p.juros)} | ${fmt(p.saldoFinal)} |`
  ).join("\n");

  const multaSection = resultado.multaPercentual > 0
    ? `
## IV — MULTA RESCISÓRIA DO FGTS

Com fundamento no **${tipoMultaDesc}**, incide sobre o saldo total do FGTS a multa de **${resultado.multaPercentual}%**:

| Descrição | Valor |
|-----------|-------|
| Saldo Total do FGTS | ${fmt(resultado.saldoTotal)} |
| Multa Rescisória (${resultado.multaPercentual}%) | ${fmt(resultado.valorMulta)} |
| **Total a Receber** | **${fmt(resultado.totalAReceber)}** |

> O valor da multa rescisória é de responsabilidade do empregador e deve ser depositado na conta vinculada do FGTS do trabalhador, nos termos do art. 18 da Lei 8.036/1990.
`
    : `
## IV — MULTA RESCISÓRIA DO FGTS

Considerando a modalidade de rescisão informada (**${tipoMultaDesc}**), **não há incidência de multa rescisória** sobre o saldo do FGTS.

| Descrição | Valor |
|-----------|-------|
| Saldo Total do FGTS | ${fmt(resultado.saldoTotal)} |
| Multa Rescisória | R$ 0,00 |
| **Total a Receber** | **${fmt(resultado.totalAReceber)}** |
`;

  return `# PARECER TÉCNICO — FGTS
## Protocolo: ${resultado.protocoloCalculo}

**Data de Emissão:** ${hoje}

---

## I — IDENTIFICAÇÃO DO CÁLCULO

Este parecer técnico apresenta o demonstrativo de depósitos do Fundo de Garantia do Tempo de Serviço (FGTS), calculado com base nos períodos e remunerações informados, nos termos da **Lei 8.036/1990** e do **Decreto 99.684/1990**.

**Modalidade de Rescisão:** ${tipoMultaDesc}

**Parâmetros Utilizados:**
- Alíquota de depósito: 8% sobre a remuneração mensal
- Taxa de juros: 3% a.a. (0,2466% a.m.) — simplificado, sem variação da TR
- Saldo anterior informado: ${fmt(params.saldoAnterior ?? 0)}
- Períodos calculados: ${resultado.periodos.length} mês(es)

---

## II — DEMONSTRATIVO DE DEPÓSITOS MENSAIS

| Mês/Ano | Remuneração | Depósito (8%) | Juros (TR+3%) | Saldo Final |
|---------|------------|---------------|---------------|-------------|
${linhasTabela}

---

## III — RESUMO DO SALDO FGTS

| Descrição | Valor |
|-----------|-------|
| Saldo Anterior | ${fmt(resultado.saldoAnterior)} |
| Total de Depósitos | ${fmt(resultado.totalDepositos)} |
| Total de Juros/Correção | ${fmt(resultado.totalJuros)} |
| **Saldo Total do FGTS** | **${fmt(resultado.saldoTotal)}** |

${multaSection}

---

## V — FUNDAMENTOS LEGAIS

- **Lei 8.036/1990** — Dispõe sobre o Fundo de Garantia do Tempo de Serviço
- **Decreto 99.684/1990** — Regulamenta o FGTS
- **Art. 18 § 1º Lei 8.036/1990** — Multa de 40% na demissão sem justa causa
- **Art. 484-A CLT** — Multa de 20% no acordo mútuo (Reforma Trabalhista 2017)
- **Circular CAIXA 860/2019** — Regulamenta os procedimentos operacionais do FGTS

---

## VI — OBSERVAÇÕES TÉCNICAS

> **Nota sobre a Taxa Referencial (TR):** Este cálculo utiliza taxa de juros simplificada de 3% a.a. sem variação da TR histórica. Para fins judiciais, recomenda-se a utilização das tabelas oficiais da Caixa Econômica Federal com a TR efetiva de cada período.

> **Nota sobre o saldo anterior:** Caso o trabalhador possua saldo FGTS em períodos anteriores aos informados, esse valor deve ser somado ao saldo anterior para obter o total correto.

---

*Parecer técnico gerado eletronicamente em ${hoje}.*
*Protocolo: ${resultado.protocoloCalculo}*

${DISCLAIMER_LEGAL}
`;
}
