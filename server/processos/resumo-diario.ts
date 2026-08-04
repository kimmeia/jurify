/**
 * Resumo diário das movimentações.
 *
 * É a versão do produto para quem não vai abrir nem o sistema: chega pronto,
 * com o que o juiz decidiu, o trecho literal e o prazo já calculado.
 *
 * A montagem (o que entra, em que ordem, como vira texto) fica separada do
 * envio de propósito — é a parte que decide se o resumo é útil ou é ruído, e
 * merece teste sem depender de Resend, Meta nem banco.
 *
 * Regra que organiza tudo: só vai para o WhatsApp o que exige ação. Se o
 * resumo do celular listar as 25 movimentações do dia, ele vira mais uma
 * notificação ignorada — e aí o dia em que houver uma sentença desfavorável
 * passa batido igual.
 */

export type ItemResumo = {
  cliente: string;
  cnj: string | null;
  titulo: string;
  pontos: string[];
  citacao: string | null;
  desfecho: "favoravel" | "desfavoravel" | "parcial" | "neutro" | null;
  ehAudiencia: boolean;
  prazoData: Date | null;
  prazoDiasUteisRestantes: number | null;
  vara: string | null;
};

export type DadosResumo = {
  nomeDestinatario: string;
  dataRef: string;
  totalMovimentacoes: number;
  totalProcessos: number;
  exigemAcao: ItemResumo[];
  /** Frases de uma linha das relevantes sem prazo. */
  relevantes: string[];
  totalRelevantes: number;
  totalRotina: number;
  /** Processos parados há muito tempo — o "vale um olhar". */
  paradosHaMuito: Array<{ cliente: string; dias: number }>;
  urlCentral: string;
};

function dataBR(d: Date): string {
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
}

function dataBRLonga(d: Date): string {
  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** "9 dias úteis", "vence hoje", "2 dias vencido" — o número que muda a ação. */
export function textoRestante(dias: number | null): string {
  if (dias === null) return "";
  if (dias < 0) return `${Math.abs(dias)} ${Math.abs(dias) === 1 ? "dia" : "dias"} vencido`;
  if (dias === 0) return "vence hoje";
  return `${dias} ${dias === 1 ? "dia útil" : "dias úteis"}`;
}

/**
 * Assunto do e-mail. É o que decide se ele abre agora ou depois do almoço, e
 * por isso carrega o número — "Resumo diário" não diz se dá pra esperar.
 */
export function assuntoEmail(d: DadosResumo): string {
  const n = d.exigemAcao.length;
  if (n === 0) return `Nenhuma movimentação exige sua ação hoje — ${d.dataRef}`;
  const vencendo = d.exigemAcao.filter(
    (i) => typeof i.prazoDiasUteisRestantes === "number" && i.prazoDiasUteisRestantes <= 0,
  ).length;
  const base = `${n} ${n === 1 ? "movimentação exige" : "movimentações exigem"} sua ação hoje`;
  return vencendo > 0 ? `⚠ ${base} — ${vencendo} no prazo final — ${d.dataRef}` : `${base} — ${d.dataRef}`;
}

/**
 * Texto do WhatsApp. Só o que exige ação, com o prazo em negrito.
 *
 * Devolve null quando não há nada acionável: mandar "bom dia, nada pra você
 * hoje" todo dia é o caminho mais rápido pro advogado silenciar o número, e
 * aí a mensagem que importava não chega.
 */
export function textoWhatsApp(d: DadosResumo): string | null {
  if (d.exigemAcao.length === 0) return null;

  const linhas: string[] = [
    `☀️ Bom dia, ${d.nomeDestinatario}. ${d.exigemAcao.length} ${
      d.exigemAcao.length === 1 ? "movimentação exige" : "movimentações exigem"
    } sua ação.`,
    "",
  ];

  for (const i of d.exigemAcao) {
    linhas.push(`*${i.cliente}*`);
    linhas.push(i.titulo);
    if (i.prazoData) {
      const restante = textoRestante(i.prazoDiasUteisRestantes);
      linhas.push(
        `${i.ehAudiencia ? "📌 Audiência em" : "⏰ Vence"} ${dataBR(i.prazoData)}${restante ? ` — ${restante}` : ""}`,
      );
    }
    linhas.push("");
  }

  const resto: string[] = [];
  if (d.totalRelevantes > 0) {
    resto.push(
      `${d.totalRelevantes} ${d.totalRelevantes === 1 ? "movimentação relevante" : "movimentações relevantes"} sem prazo`,
    );
  }
  if (d.totalRotina > 0) resto.push(`${d.totalRotina} de rotina`);
  if (resto.length) linhas.push(`Fora essas: ${resto.join(" e ")}.`);
  linhas.push(`Ver tudo: ${d.urlCentral}`);

  return linhas.join("\n").trim();
}

function escaparHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const COR_DESFECHO: Record<string, { bg: string; borda: string; texto: string; label: string }> = {
  favoravel: { bg: "#ecfdf5", borda: "#a7f3d0", texto: "#047857", label: "🟢 Favorável" },
  desfavoravel: { bg: "#fef2f2", borda: "#fecaca", texto: "#b91c1c", label: "🔴 Desfavorável" },
  parcial: { bg: "#fffbeb", borda: "#fde68a", texto: "#b45309", label: "🟡 Parcialmente favorável" },
  neutro: { bg: "#f1f5f9", borda: "#e2e8f0", texto: "#475569", label: "⚪ Sem mérito" },
};

/**
 * HTML do e-mail. Tabela e estilo inline porque cliente de e-mail ignora
 * `<style>` no head e não tem flexbox — layout moderno aqui quebra no
 * Outlook, que é justamente onde escritório lê e-mail.
 */
export function htmlEmail(d: DadosResumo): string {
  const cartao = (n: number, rotulo: string, cor: string, bg: string, borda: string) => `
    <td width="33%" style="padding:4px">
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${borda};background:${bg};border-radius:10px">
        <tr><td style="padding:10px 12px">
          <div style="font-size:22px;font-weight:700;color:${cor};line-height:1">${n}</div>
          <div style="font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:${cor};padding-top:5px">${rotulo}</div>
        </td></tr>
      </table>
    </td>`;

  const itens = d.exigemAcao
    .map((i) => {
      const desf = i.desfecho ? COR_DESFECHO[i.desfecho] : null;
      const restante = textoRestante(i.prazoDiasUteisRestantes);
      const corBarra = i.ehAudiencia ? "#ea580c" : "#dc2626";
      return `
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:11px;margin-bottom:10px">
        <tr>
          <td width="4" style="background:${corBarra};border-radius:11px 0 0 11px"></td>
          <td style="padding:12px 14px">
            <div style="font-size:11.5px;color:#64748b">
              <strong style="color:#0f172a;font-size:12.5px">${escaparHtml(i.cliente)}</strong>
              ${i.cnj ? ` · ${escaparHtml(i.cnj)}` : ""}${i.vara ? ` · ${escaparHtml(i.vara)}` : ""}
            </div>
            <div style="font-size:14px;font-weight:700;color:#0f172a;padding-top:3px;line-height:1.3">${escaparHtml(i.titulo)}</div>
            ${
              i.pontos.length
                ? `<div style="font-size:12.5px;color:#475569;padding-top:4px;line-height:1.45">${escaparHtml(i.pontos.join(" "))}</div>`
                : ""
            }
            ${
              i.citacao
                ? `<div style="font-size:11.5px;color:#78350f;background:#fffbeb;border-left:3px solid #fde68a;border-radius:0 6px 6px 0;padding:6px 10px;margin-top:6px;line-height:1.4">“${escaparHtml(i.citacao)}”</div>`
                : ""
            }
            <div style="padding-top:8px">
              ${
                desf
                  ? `<span style="display:inline-block;background:${desf.bg};border:1px solid ${desf.borda};color:${desf.texto};border-radius:999px;padding:3px 10px;font-size:11px;font-weight:700;margin-right:6px">${desf.label}</span>`
                  : ""
              }
              ${
                i.prazoData
                  ? `<span style="display:inline-block;background:${i.ehAudiencia ? "#fff7ed" : "#fef2f2"};border:1px solid ${i.ehAudiencia ? "#fed7aa" : "#fecaca"};color:${i.ehAudiencia ? "#c2410c" : "#b91c1c"};border-radius:999px;padding:3px 10px;font-size:11px;font-weight:700">${
                      i.ehAudiencia ? "📌 Audiência em" : "⏰ Vence"
                    } ${dataBR(i.prazoData)}${restante ? ` · ${restante}` : ""}</span>`
                  : ""
              }
            </div>
          </td>
        </tr>
      </table>`;
    })
    .join("");

  const secaoResto =
    d.relevantes.length || d.totalRotina
      ? `
      <div style="font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#94a3b8;padding:16px 0 8px">O resto, em uma linha</div>
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px dashed #e2e8f0;border-radius:11px">
        <tr><td style="padding:11px 13px;font-size:12px;color:#64748b;line-height:1.55">
          ${
            d.relevantes.length
              ? `<strong style="color:#0f172a">${d.totalRelevantes} sem prazo:</strong> ${escaparHtml(d.relevantes.join("; "))}.<br>`
              : ""
          }
          ${d.totalRotina ? `<strong style="color:#0f172a">${d.totalRotina} de rotina:</strong> conclusos, juntadas, remessas e publicações.` : ""}
        </td></tr>
      </table>`
      : "";

  const secaoParados = d.paradosHaMuito.length
    ? `
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #fde68a;background:#fffbeb;border-radius:11px;margin-top:10px">
        <tr><td style="padding:11px 13px;font-size:12px;color:#92400e;line-height:1.5">
          <strong>Vale um olhar:</strong> ${d.paradosHaMuito
            .map((p) => `${escaparHtml(p.cliente)} (${p.dias} dias)`)
            .join(", ")} sem movimentação.
        </td></tr>
      </table>`
    : "";

  const abertura =
    d.exigemAcao.length > 0
      ? `Nas últimas 24 horas o monitoramento leu <strong>${d.totalMovimentacoes} ${
          d.totalMovimentacoes === 1 ? "movimentação" : "movimentações"
        }</strong> em ${d.totalProcessos} ${d.totalProcessos === 1 ? "processo" : "processos"}. Já separei o que muda o seu dia.`
      : `Nas últimas 24 horas o monitoramento leu <strong>${d.totalMovimentacoes} ${
          d.totalMovimentacoes === 1 ? "movimentação" : "movimentações"
        }</strong> e <strong>nenhuma exige providência sua</strong>.`;

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f8fafc">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:24px 12px">
  <tr><td align="center">
    <table width="640" cellpadding="0" cellspacing="0" style="max-width:640px;background:#fff;border:1px solid #e2e8f0;border-radius:14px;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#0f172a">
      <tr><td style="padding:18px 22px;border-bottom:1px solid #f1f5f9">
        <div style="font-size:17px;font-weight:700">${escaparHtml(assuntoEmail(d))}</div>
        <div style="font-size:11.5px;color:#94a3b8;padding-top:4px">JuridFlow · Monitoramento de processos</div>
      </td></tr>

      <tr><td style="padding:16px 22px">
        <div style="font-size:13.5px;color:#334155;line-height:1.5">Bom dia, <strong>${escaparHtml(d.nomeDestinatario)}</strong>. ${abertura}</div>

        <table width="100%" cellpadding="0" cellspacing="0" style="margin:12px -4px 0">
          <tr>
            ${cartao(d.exigemAcao.length, "Exigem ação", "#dc2626", "#fef2f2", "#fecaca")}
            ${cartao(d.totalRelevantes, "Relevantes", "#6d28d9", "#faf5ff", "#ddd6fe")}
            ${cartao(d.totalRotina, "Rotina", "#64748b", "#ffffff", "#e2e8f0")}
          </tr>
        </table>

        ${
          d.exigemAcao.length
            ? `<div style="font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#94a3b8;padding:18px 0 8px">Exigem ação sua</div>${itens}`
            : ""
        }
        ${secaoResto}
        ${secaoParados}
      </td></tr>

      <tr><td style="padding:14px 22px;border-top:1px solid #f1f5f9">
        <a href="${escaparHtml(d.urlCentral)}" style="display:inline-block;background:#0f172a;color:#fff;border-radius:9px;padding:10px 16px;font-size:12.5px;font-weight:700;text-decoration:none">Abrir a central de movimentações</a>
        <div style="font-size:10.5px;color:#94a3b8;padding-top:10px;line-height:1.4">
          Resumos e prazos gerados por IA a partir da íntegra do documento publicado.<br>
          Confira o inteiro teor antes de peticionar. A contagem de prazo não cobre feriado local do tribunal nem suspensão específica do processo.
        </div>
      </td></tr>
    </table>
    <div style="font-size:10.5px;color:#94a3b8;padding-top:12px">Referente a ${escaparHtml(dataBRLonga(new Date(`${d.dataRef}T00:00:00Z`)))}</div>
  </td></tr>
</table>
</body></html>`;
}

/** Versão texto do e-mail — clientes que bloqueiam HTML ainda recebem o essencial. */
export function textoEmail(d: DadosResumo): string {
  const linhas = [assuntoEmail(d), ""];
  for (const i of d.exigemAcao) {
    linhas.push(`• ${i.cliente}${i.cnj ? ` (${i.cnj})` : ""}`);
    linhas.push(`  ${i.titulo}`);
    if (i.prazoData) {
      const r = textoRestante(i.prazoDiasUteisRestantes);
      linhas.push(`  ${i.ehAudiencia ? "Audiência em" : "Vence"} ${dataBR(i.prazoData)}${r ? ` — ${r}` : ""}`);
    }
    linhas.push("");
  }
  if (d.totalRelevantes) linhas.push(`${d.totalRelevantes} relevantes sem prazo. ${d.relevantes.join("; ")}`);
  if (d.totalRotina) linhas.push(`${d.totalRotina} movimentações de rotina.`);
  linhas.push("", d.urlCentral);
  return linhas.join("\n");
}
