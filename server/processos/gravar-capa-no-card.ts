/**
 * Grava no card de nova ação a capa que alguém foi buscar depois.
 *
 * O "Carregar detalhes" custava uma consulta do plano e o resultado só vivia
 * na tela aberta: recarregou, sumiu, e a próxima pessoa pagava de novo pra ver
 * a mesma coisa. Aqui o que veio entra no evento, do lado da capa que o robô
 * tinha (ou não tinha) trazido.
 *
 * A regra que não pode escapar: marcação de polo feita À MÃO manda. Quem abriu
 * o processo e disse "esse cliente é réu" não pode ser desmentido por uma
 * leitura automática que veio depois — nem quando a leitura nova não tem parte
 * nenhuma, como a do DataJud.
 */

import { and, eq } from "drizzle-orm";
import { lerPolo, type PoloParte } from "../../shared/polo-parte";
import {
  montarCapaNovaAcao,
  capaTemConteudo,
  type CapaNovaAcao,
  type FonteCapa,
} from "../../shared/nova-acao-capa";
import { eventosProcesso, motorMonitoramentos, escritorios } from "../../drizzle/schema";
import { identificarPoloDoCliente } from "./polo-matcher";

export type CardComCapaNova = {
  json: string;
  polo: PoloParte;
};

export function conteudoComCapaNova(
  conteudoJson: string | null | undefined,
  capa: CapaNovaAcao,
): CardComCapaNova {
  let bruto: Record<string, unknown> = {};
  try {
    const lido = conteudoJson ? JSON.parse(conteudoJson) : {};
    if (lido && typeof lido === "object" && !Array.isArray(lido)) {
      bruto = lido as Record<string, unknown>;
    }
  } catch {
    /* JSON quebrado de alguma versão anterior: regrava com o que se sabe agora */
  }

  const guardado = lerPolo(bruto.poloDoCliente);
  // Leitura que não achou o cliente entre as partes (o DataJud nunca acha: ele
  // não publica partes) não apaga o polo que já estava sabido.
  const polo: PoloParte =
    !!bruto.poloManual || capa.poloDoCliente === "desconhecido" ? guardado : capa.poloDoCliente;

  bruto.capa = { ...capa, poloDoCliente: polo };
  bruto.capaFalhou = false;
  bruto.poloDoCliente = polo;
  return { json: JSON.stringify(bruto), polo };
}

/**
 * Monta a capa com o que veio e grava no card, escopado por escritório.
 *
 * O polo sai das partes lidas agora, pelo mesmo matcher do cron — mas quem
 * decide de fato é `conteudoComCapaNova`, que protege marcação manual e polo
 * já conhecido.
 */
export async function gravarCapaNoCard(args: {
  db: any;
  escritorioId: number;
  acaoId: number;
  bruta: Parameters<typeof montarCapaNovaAcao>[0];
  fonte: FonteCapa;
}): Promise<{ gravou: boolean; polo: PoloParte; capa: CapaNovaAcao | null }> {
  const { db, escritorioId, acaoId } = args;
  const [evento] = await db
    .select({
      id: eventosProcesso.id,
      conteudoJson: eventosProcesso.conteudoJson,
      monitoramentoId: eventosProcesso.monitoramentoId,
    })
    .from(eventosProcesso)
    .where(
      and(
        eq(eventosProcesso.id, acaoId),
        eq(eventosProcesso.escritorioId, escritorioId),
        eq(eventosProcesso.tipo, "nova_acao"),
      ),
    )
    .limit(1);
  if (!evento) return { gravou: false, polo: "desconhecido", capa: null };

  const [mon] = evento.monitoramentoId
    ? await db
        .select({ apelido: motorMonitoramentos.apelido, searchKey: motorMonitoramentos.searchKey })
        .from(motorMonitoramentos)
        .where(
          and(
            eq(motorMonitoramentos.id, evento.monitoramentoId),
            eq(motorMonitoramentos.escritorioId, escritorioId),
          ),
        )
        .limit(1)
    : [];
  const [esc] = await db
    .select({ oab: escritorios.oab })
    .from(escritorios)
    .where(eq(escritorios.id, escritorioId))
    .limit(1);

  const partes = Array.isArray(args.bruta.partes) ? args.bruta.partes : [];
  const poloLido = identificarPoloDoCliente(mon?.apelido ?? null, mon?.searchKey ?? "", partes);
  const capa = montarCapaNovaAcao(args.bruta, poloLido, new Date().toISOString(), {
    oabEscritorio: esc?.oab ?? null,
    fonte: args.fonte,
  });
  if (!capaTemConteudo(capa)) return { gravou: false, polo: "desconhecido", capa: null };

  const { json, polo } = conteudoComCapaNova(evento.conteudoJson, capa);
  await db
    .update(eventosProcesso)
    .set({ conteudoJson: json, poloCliente: polo })
    .where(
      and(
        eq(eventosProcesso.id, acaoId),
        eq(eventosProcesso.escritorioId, escritorioId),
        eq(eventosProcesso.tipo, "nova_acao"),
      ),
    );
  return { gravou: true, polo, capa: { ...capa, poloDoCliente: polo } };
}
