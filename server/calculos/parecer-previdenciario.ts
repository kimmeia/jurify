/**
 * Gerador de Parecer Técnico — Módulo Previdenciário v2
 */

import type { ParametrosSimulacao, ResultadoSimulacao } from "../../shared/previdenciario-types";
import { TIPO_ATIVIDADE_LABELS } from "../../shared/previdenciario-types";

function fmtDate(s: string): string { const [y, m, d] = s.split("-"); return `${d}/${m}/${y}`; }
function fmtMeses(m: number): string { const a = Math.floor(m / 12); const r = m % 12; return r > 0 ? `${a} anos e ${r} meses` : `${a} anos`; }

export function gerarParecerSimulacao(params: ParametrosSimulacao, resultado: ResultadoSimulacao): string {
  const s: string[] = [];
  const tc = resultado.resumoTC;

  s.push(`# PARECER TÉCNICO — SIMULAÇÃO DE APOSENTADORIA\n`);
  s.push(`**Protocolo:** ${resultado.protocoloCalculo}`);
  s.push(`**Data:** ${fmtDate(resultado.dataCalculo)}\n`);
  s.push(`---\n`);

  // 1. Dados do segurado
  s.push(`## 1. DADOS DO SEGURADO\n`);
  s.push(`| Item | Valor |`);
  s.push(`|------|-------|`);
  s.push(`| Sexo | ${params.sexo === "F" ? "Feminino" : "Masculino"} |`);
  s.push(`| Data de nascimento | ${fmtDate(params.dataNascimento)} |`);
  s.push(`| Períodos informados | ${params.periodos.length} |`);
  s.push(``);

  // 2. Períodos de contribuição
  s.push(`## 2. PERÍODOS DE CONTRIBUIÇÃO\n`);
  for (const p of params.periodos) {
    const fim = p.aindaAtivo ? "Atual" : fmtDate(p.dataFim);
    s.push(`- **${fmtDate(p.dataInicio)}** a **${fim}** — ${TIPO_ATIVIDADE_LABELS[p.tipoAtividade]}${p.descricao ? ` (${p.descricao})` : ""}`);
  }
  s.push(``);

  // 3. Resumo do TC
  s.push(`## 3. TEMPO DE CONTRIBUIÇÃO CALCULADO\n`);
  s.push(`| Tipo | Tempo |`);
  s.push(`|------|-------|`);
  if (tc.totalMesesComum > 0) s.push(`| Urbano Comum | ${fmtMeses(tc.totalMesesComum)} |`);
  if (tc.totalMesesProfessor > 0) s.push(`| Professor | ${fmtMeses(tc.totalMesesProfessor)} |`);
  if (tc.totalMesesEspecial25 > 0) s.push(`| Especial 25a | ${fmtMeses(tc.totalMesesEspecial25)} |`);
  if (tc.totalMesesEspecial20 > 0) s.push(`| Especial 20a | ${fmtMeses(tc.totalMesesEspecial20)} |`);
  if (tc.totalMesesEspecial15 > 0) s.push(`| Especial 15a | ${fmtMeses(tc.totalMesesEspecial15)} |`);
  if (tc.totalMesesRural > 0) s.push(`| Rural | ${fmtMeses(tc.totalMesesRural)} |`);
  s.push(`| **Total Bruto** | **${fmtMeses(tc.totalMesesBruto)}** |`);
  s.push(`| **Total com Conversão** | **${fmtMeses(tc.totalMesesConvertido)}** |`);
  s.push(``);

  if (tc.conversoes.length > 0) {
    s.push(`### Conversões de Tempo Especial → Comum\n`);
    s.push(`A conversão aplica-se SOMENTE a períodos até 13/11/2019 (art. 25 §2º EC 103).\n`);
    for (const c of tc.conversoes) {
      s.push(`- ${c.periodo}: ${c.mesesOriginais}m × ${c.fatorConversao} = **${c.mesesConvertidos}m**`);
    }
    s.push(``);
  }

  // 4. Análise das regras
  s.push(`## 4. ANÁLISE DAS REGRAS\n`);
  for (const r of resultado.regras) {
    const status = r.elegivel ? "✅ ELEGÍVEL" : r.mesesRestantes > 0 ? `⏳ Faltam ${fmtMeses(r.mesesRestantes)}` : "❌ Não aplicável";
    s.push(`### ${r.nomeRegra}\n`);
    s.push(`**Status:** ${status}\n`);
    s.push(`| Requisito | Exigido | Atual |`);
    s.push(`|-----------|---------|-------|`);
    if (r.idadeMinimaExigida != null) s.push(`| Idade | ${r.idadeMinimaExigida} anos | ${r.idadeAtual} anos |`);
    if (r.pontosExigidos != null) s.push(`| Pontos | ${r.pontosExigidos} | ${r.pontosAtuais} |`);
    s.push(`| Tempo Contribuição | ${fmtMeses(r.tcMinimoExigidoMeses)} | ${fmtMeses(r.tcAtualMeses)} |`);
    if (r.pedagioMeses) s.push(`| Pedágio | ${fmtMeses(r.pedagioMeses)} | — |`);
    s.push(``);
    if (r.dataPrevistaAposentadoria && !r.elegivel) s.push(`**Previsão:** ${fmtDate(r.dataPrevistaAposentadoria)}\n`);
    s.push(`**Coeficiente:** ${r.detalhesCoeficiente}`);
    s.push(`**Fundamento:** ${r.fundamentacao}\n`);
  }

  // 5. Recomendação
  s.push(`## 5. RECOMENDAÇÃO\n`);
  if (resultado.melhorRegra) {
    s.push(`O segurado **já preenche** os requisitos pela **${resultado.melhorRegra.nomeRegra}** com coeficiente de **${(resultado.melhorRegra.coeficiente * 100).toFixed(0)}%**.\n`);
  } else if (resultado.regrasMaisProximas.length > 0) {
    const p = resultado.regrasMaisProximas[0];
    s.push(`O segurado ainda **não preenche** requisitos. Regra mais próxima: **${p.nomeRegra}** — faltam **${fmtMeses(p.mesesRestantes)}**${p.dataPrevistaAposentadoria ? ` (previsão: ${fmtDate(p.dataPrevistaAposentadoria)})` : ""}.\n`);
  } else {
    s.push(`Não foi possível projetar com os dados informados.\n`);
  }

  s.push(`## 6. FUNDAMENTAÇÃO LEGAL\n`);
  s.push(`- EC 103/2019 (arts. 15-21, 25, 26)`);
  s.push(`- Lei 8.213/1991 (arts. 29, 57-58)`);
  s.push(`- Decreto 3.048/1999`);
  s.push(`- STF Tema 709 (vedação trabalho nocivo pós-aposentadoria especial)`);
  s.push(`- STJ Tema 534 (rol de agentes nocivos é exemplificativo)`);
  s.push(``);
  s.push(`---\n*Parecer gerado automaticamente pelo SaaS de Cálculos Jurídicos.*`);

  return s.join("\n");
}
