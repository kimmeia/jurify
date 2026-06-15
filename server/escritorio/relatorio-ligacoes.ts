/**
 * Agregação das chamadas (tabela `chamadas`) pro relatório de atendimentos.
 * Funções puras — recebem as linhas já agrupadas no banco e produzem os
 * números da seção "Ligações". Testáveis sem rede nem DB.
 *
 * Definições:
 *  - feitas    = ligações de saída (todas)
 *  - recebidas = entrada ATENDIDA (status "encerrada")
 *  - perdidas  = entrada não atendida (status "perdida"/"falha")
 *  - recusadas = entrada recusada pelo atendente (status "rejeitada")
 *  - taxa atendimento = recebidas / (recebidas + perdidas + recusadas)
 *  - duração  = soma do tempo OFICIAL da Meta (só chamadas atendidas)
 */

export interface LinhaChamada {
  direcao: string;
  status: string;
  total: number;
  durTotal: number;
}

export interface ResumoLigacoes {
  feitas: number;
  feitasAtendidas: number;
  recebidas: number;
  perdidas: number;
  recusadas: number;
  taxaAtendimento: number | null;
  duracaoTotalSeg: number;
  duracaoMediaSeg: number | null;
}

export function agregarLigacoes(rows: LinhaChamada[]): ResumoLigacoes {
  let feitas = 0;
  let feitasAtendidas = 0;
  let recebidas = 0;
  let perdidas = 0;
  let recusadas = 0;
  let duracaoTotal = 0;
  let atendidas = 0; // chamadas com áudio (qualquer direção) — base da duração média

  for (const r of rows) {
    const total = Number(r.total) || 0;
    const dur = Number(r.durTotal) || 0;
    if (r.direcao === "saida") {
      feitas += total;
      if (r.status === "encerrada") {
        feitasAtendidas += total;
        duracaoTotal += dur;
        atendidas += total;
      }
    } else {
      if (r.status === "encerrada") {
        recebidas += total;
        duracaoTotal += dur;
        atendidas += total;
      } else if (r.status === "rejeitada") {
        recusadas += total;
      } else if (r.status === "perdida" || r.status === "falha") {
        perdidas += total;
      }
      // "tocando"/"conectando"/"em_andamento" = em curso, não entram no resultado
    }
  }

  const denom = recebidas + perdidas + recusadas;
  return {
    feitas,
    feitasAtendidas,
    recebidas,
    perdidas,
    recusadas,
    taxaAtendimento: denom > 0 ? Math.round((recebidas / denom) * 100) : null,
    duracaoTotalSeg: duracaoTotal,
    duracaoMediaSeg: atendidas > 0 ? Math.round(duracaoTotal / atendidas) : null,
  };
}

export interface LinhaAtendenteLigacao {
  colabId: number;
  nome: string;
  feitas: number;
  recebidas: number;
  perdidas: number;
  duracaoTotalSeg: number;
  taxaAtendimento: number | null;
}

export function agregarLigacoesPorAtendente(
  rows: Array<LinhaChamada & { colabId: number | null }>,
  nomePorColab: (id: number) => string,
): LinhaAtendenteLigacao[] {
  const map = new Map<
    number,
    { feitas: number; recebidas: number; perdidas: number; recusadas: number; dur: number }
  >();
  for (const r of rows) {
    if (r.colabId == null) continue;
    const x = map.get(r.colabId) || { feitas: 0, recebidas: 0, perdidas: 0, recusadas: 0, dur: 0 };
    const total = Number(r.total) || 0;
    const dur = Number(r.durTotal) || 0;
    if (r.direcao === "saida") {
      x.feitas += total;
      if (r.status === "encerrada") x.dur += dur;
    } else if (r.status === "encerrada") {
      x.recebidas += total;
      x.dur += dur;
    } else if (r.status === "rejeitada") {
      x.recusadas += total;
    } else if (r.status === "perdida" || r.status === "falha") {
      x.perdidas += total;
    }
    map.set(r.colabId, x);
  }
  return [...map.entries()]
    .map(([colabId, x]) => {
      const denom = x.recebidas + x.perdidas + x.recusadas;
      return {
        colabId,
        nome: nomePorColab(colabId),
        feitas: x.feitas,
        recebidas: x.recebidas,
        perdidas: x.perdidas,
        duracaoTotalSeg: x.dur,
        taxaAtendimento: denom > 0 ? Math.round((x.recebidas / denom) * 100) : null,
      };
    })
    .sort((a, b) => b.feitas + b.recebidas - (a.feitas + a.recebidas));
}

export function agregarLigacoesPorDia(
  rows: Array<{ dia: string; direcao: string; status: string; total: number }>,
): Array<{ dia: string; feitas: number; recebidas: number; perdidas: number }> {
  const map = new Map<string, { dia: string; feitas: number; recebidas: number; perdidas: number }>();
  const g = (d: string) => {
    if (!map.has(d)) map.set(d, { dia: d, feitas: 0, recebidas: 0, perdidas: 0 });
    return map.get(d)!;
  };
  for (const r of rows) {
    const total = Number(r.total) || 0;
    const x = g(String(r.dia));
    if (r.direcao === "saida") x.feitas += total;
    else if (r.status === "encerrada") x.recebidas += total;
    else if (r.status === "perdida" || r.status === "falha") x.perdidas += total;
  }
  return [...map.values()].sort((a, b) => a.dia.localeCompare(b.dia));
}
