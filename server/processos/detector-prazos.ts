/**
 * Detector heurístico de prazos/audiências em movimentações processuais.
 *
 * Analisa o texto de uma movimentação e retorna sugestão estruturada de
 * agendamento quando bater algum padrão conhecido:
 *
 *   - Audiência designada/marcada/em DD/MM/AAAA
 *   - Intimação. Prazo de X dias (úteis ou corridos)
 *   - Manifeste-se em X dias
 *   - Recurso/Réplica/Contestação em X dias
 *   - Despacho com prazo de X dias
 *   - Sentença publicada (recurso 15 dias por padrão)
 *
 * Retorna null se nenhum padrão bater — não inventa prazos pra evitar
 * falsos positivos que poluem o painel do advogado. Falsos negativos
 * são aceitáveis (user pode criar manualmente).
 *
 * As regexes são propositalmente permissivas com case/acentos/espaços
 * porque o texto vem do PJe TJCE que normaliza inconsistentemente.
 *
 * Ordem importa: padrões mais específicos vêm primeiro. Audiência é
 * sempre prioridade sobre prazo (já tem data explícita).
 */

export type SugestaoPrazo = {
  tipo: "audiencia" | "prazo_processual";
  /** Título sugerido pra UI ("Audiência - DD/MM" ou "Prazo de réplica") */
  titulo: string;
  /** Data sugerida quando já dá pra calcular (audiência ou prazo a partir
   *  da data do evento). Null quando só temos "X dias úteis" sem data
   *  base — UI calcula com helpers já existentes. */
  dataSugerida: Date | null;
  /** Quantidade de dias quando aplicável (pra exibir "Prazo: 15 dias") */
  prazoDias?: number;
  prazoUteis?: boolean;
  /** Motivo legível pra mostrar no card de sugestão */
  motivo: string;
  /** Trecho original que disparou a detecção (pra contexto) */
  trechoOrigem: string;
};

/** Date base: data do evento (mov). Usado pra calcular prazo absoluto
 *  a partir de "X dias". Por convenção é a `dataEvento` da movimentação. */
type Contexto = {
  dataEvento: Date;
};

/**
 * Faz o parse de DD/MM/AAAA, DD-MM-AAAA, DD.MM.AAAA — formatos comuns
 * em movimentações brasileiras. Aceita anos com 2 ou 4 dígitos (se 2,
 * assume 20XX — não há processo de antes de 2000 no PJe).
 */
function parsearDataBR(diaStr: string, mesStr: string, anoStr: string): Date | null {
  const dia = parseInt(diaStr, 10);
  const mes = parseInt(mesStr, 10);
  let ano = parseInt(anoStr, 10);
  if (ano < 100) ano += 2000;
  if (Number.isNaN(dia) || Number.isNaN(mes) || Number.isNaN(ano)) return null;
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  const d = new Date(ano, mes - 1, dia, 0, 0, 0, 0);
  if (Number.isNaN(d.getTime())) return null;
  // Sanity: nunca retorna data > 5 anos no futuro (prazo improvável)
  // nem > 1 ano no passado (data tipo "11/09" pode ter sido parseada
  // com ano errado por convenção 20XX)
  const agora = Date.now();
  const cincoAnos = 5 * 365 * 24 * 60 * 60 * 1000;
  const umAno = 365 * 24 * 60 * 60 * 1000;
  if (d.getTime() > agora + cincoAnos) return null;
  if (d.getTime() < agora - umAno) return null;
  return d;
}

/** Adiciona N dias corridos (não respeita úteis — caller decide na UI). */
function adicionarDias(base: Date, dias: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + dias);
  return d;
}

/**
 * Detecta sugestão de prazo no texto de uma movimentação.
 *
 * @param texto Texto da mov (pode ter HTML stripado, acentos, etc)
 * @param ctx Contexto (data do evento) — usado pra calcular prazo absoluto
 */
export function detectarSugestaoPrazo(
  texto: string,
  ctx: Contexto,
): SugestaoPrazo | null {
  if (!texto || texto.length < 5) return null;
  const t = texto.toLowerCase();

  // ─── 1. AUDIÊNCIA com data explícita ──────────────────────────────────────
  // "audiência designada para DD/MM/AAAA" (com variações)
  const audMatch = t.match(
    /audi[eê]ncia[^.]*(?:designada|marcada|aprazada|em)[^\d]*(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:\s+(?:[àa]s?\s+)?(\d{1,2})[:h](\d{2}))?/iu,
  );
  if (audMatch) {
    const data = parsearDataBR(audMatch[1], audMatch[2], audMatch[3]);
    if (data) {
      const horaH = audMatch[4] ? parseInt(audMatch[4], 10) : null;
      const horaM = audMatch[5] ? parseInt(audMatch[5], 10) : null;
      if (horaH !== null && horaM !== null && horaH >= 0 && horaH < 24 && horaM >= 0 && horaM < 60) {
        data.setHours(horaH, horaM);
      } else {
        data.setHours(9, 0); // default 9h da manhã
      }
      const dataBR = data.toLocaleDateString("pt-BR");
      const horaBR = horaH !== null ? `${String(horaH).padStart(2, "0")}:${String(horaM).padStart(2, "0")}` : "";
      return {
        tipo: "audiencia",
        titulo: `Audiência — ${dataBR}${horaBR ? ` ${horaBR}` : ""}`,
        dataSugerida: data,
        motivo: `Audiência designada para ${dataBR}${horaBR ? ` às ${horaBR}` : ""}`,
        trechoOrigem: extrairTrecho(texto, audMatch.index ?? 0),
      };
    }
  }

  // ─── 2. PRAZOS COM N DIAS ─────────────────────────────────────────────────
  // Pega o tipo de ato e os dias. Trabalhamos com lista de gatilhos
  // (palavras-chave) — pra cada match, capturamos os dias na vizinhança.
  const gatilhos: Array<{ regex: RegExp; titulo: (dias: number, uteis: boolean) => string; motivoBase: string }> = [
    {
      regex: /(?:apresentar|interpor)?\s*r[eé]plica/i,
      titulo: (d) => `Réplica em ${d} dias`,
      motivoBase: "Réplica",
    },
    {
      regex: /(?:apresentar|interpor)?\s*contesta[cç][aã]o/i,
      titulo: (d) => `Contestação em ${d} dias`,
      motivoBase: "Contestação",
    },
    {
      regex: /(?:interpor|apresentar)?\s*recurso/i,
      titulo: (d) => `Recurso em ${d} dias`,
      motivoBase: "Recurso",
    },
    {
      regex: /(?:apresentar|oferecer)?\s*embargos/i,
      titulo: (d) => `Embargos em ${d} dias`,
      motivoBase: "Embargos",
    },
    {
      regex: /manifest[ea](?:r-se|m-se|e-se)?/i,
      titulo: (d) => `Manifestação em ${d} dias`,
      motivoBase: "Manifestação",
    },
    {
      regex: /intima[cç][aã]o/i,
      titulo: (d) => `Prazo de intimação — ${d} dias`,
      motivoBase: "Intimação",
    },
    {
      regex: /despacho/i,
      titulo: (d) => `Despacho — ${d} dias`,
      motivoBase: "Despacho",
    },
    {
      regex: /cita[cç][aã]o/i,
      titulo: (d) => `Citação — ${d} dias`,
      motivoBase: "Citação",
    },
  ];

  // Padrão de prazo: "prazo de X dias", "em X dias", "X dias úteis"
  const prazoMatch = t.match(/(?:prazo\s+(?:legal\s+)?de\s+|em\s+|dentro\s+de\s+)(\d{1,3})\s*(?:dias?|d\.?)\s*(?:[uú]teis)?/i);
  if (prazoMatch) {
    const dias = parseInt(prazoMatch[1], 10);
    // Bounds sensatos pra prazos processuais brasileiros (1-180)
    if (dias >= 1 && dias <= 180) {
      const uteis = /[uú]teis/i.test(prazoMatch[0]);

      // Procura gatilho mais próximo (até 200 chars antes ou depois do prazo)
      const inicio = Math.max(0, (prazoMatch.index ?? 0) - 200);
      const fim = Math.min(t.length, (prazoMatch.index ?? 0) + 200);
      const vizinhanca = t.slice(inicio, fim);

      const gatilhoMatch = gatilhos.find((g) => g.regex.test(vizinhanca));
      if (gatilhoMatch) {
        // Calcula data absoluta (corrida). Frontend pode reajustar pra
        // úteis ao aprovar — pra agora, simplifica usando dias corridos.
        const dataCalculada = adicionarDias(ctx.dataEvento, uteis ? dias + Math.floor(dias / 5) * 2 : dias);
        return {
          tipo: "prazo_processual",
          titulo: gatilhoMatch.titulo(dias, uteis),
          dataSugerida: dataCalculada,
          prazoDias: dias,
          prazoUteis: uteis,
          motivo: `${gatilhoMatch.motivoBase}: prazo de ${dias} dias${uteis ? " úteis" : ""}`,
          trechoOrigem: extrairTrecho(texto, prazoMatch.index ?? 0),
        };
      }
    }
  }

  // ─── 3. SENTENÇA / DECISÃO (prazo recursal 15 dias default) ───────────────
  // Quando movimentação menciona "sentença" ou "decisão" sem prazo explícito,
  // assumimos 15 dias úteis (CPC art. 1.003). Isso é prazo padrão mas pode
  // estar errado em casos especiais (juizado especial é 10, recurso em
  // execução pode ser outro). Marcamos com motivo claro pra user revisar.
  // Aceita masc + fem do particípio porque "sentença" é fem mas "acórdão"
  // é masc, e o PJe inconsistente às vezes não concorda gênero.
  if (/(?:senten[cç]a|ac[oó]rd[aã]o)\s+(?:publicad[ao]|prolatad[ao]|proferid[ao])/i.test(t)) {
    const dias = 15;
    return {
      tipo: "prazo_processual",
      titulo: `Recurso — 15 dias úteis`,
      dataSugerida: adicionarDias(ctx.dataEvento, 21), // 15 úteis ≈ 21 corridos
      prazoDias: dias,
      prazoUteis: true,
      motivo: "Sentença publicada — prazo recursal padrão CPC art. 1.003 (revise se for juizado/exec)",
      trechoOrigem: extrairTrecho(texto, 0, 200),
    };
  }

  return null;
}

/** Extrai trecho de até `len` chars ao redor de uma posição pra exibir contexto. */
function extrairTrecho(texto: string, inicio: number, len = 200): string {
  const start = Math.max(0, inicio - len / 4);
  const end = Math.min(texto.length, inicio + (len * 3) / 4);
  let trecho = texto.slice(start, end).trim();
  if (start > 0) trecho = `…${trecho}`;
  if (end < texto.length) trecho = `${trecho}…`;
  return trecho;
}
