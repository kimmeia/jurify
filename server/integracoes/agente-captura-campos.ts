/**
 * Extração automática de valores em conversas via IA.
 *
 * Quando um agente tem `camposCaptura` configurado (lista de chaves de
 * campos personalizados de cliente), o sistema chama a IA depois de cada
 * mensagem do cliente pra tentar extrair valores e persistir em
 * `contatos.camposPersonalizados`.
 *
 * Estratégia:
 *  - Roda EM BACKGROUND (não bloqueia resposta da IA pro usuário)
 *  - Heurística de skip: se a última msg do cliente não tem caractere
 *    numérico/CPF/data, pula a chamada IA pra evitar burn money
 *  - Faz UPSERT em camposPersonalizados (merge, não overwrite)
 *  - Loga em audit_log pra rastreabilidade
 */
import { getDb } from "../db";
import {
  agentesIa,
  contatos,
  mensagens,
  conversas,
  camposPersonalizadosCliente,
} from "../../drizzle/schema";
import { and, desc, eq, inArray } from "drizzle-orm";
import { chamarIA, parseJsonIA, resolverChaveIA } from "../_core/ai-call";
import { createLogger } from "../_core/logger";

const log = createLogger("agente-captura-campos");

export interface CampoCapturado {
  chave: string;
  label: string;
  valor: string | number | boolean;
  /** Tipo do campo no catálogo (texto/numero/data/etc) */
  tipo: string;
}

/**
 * Heurística rápida: a mensagem parece conter um valor extraível?
 * Evita chamar IA em conversas sociais como "oi", "obrigado", etc.
 */
function mensagemPareceTerValor(texto: string): boolean {
  if (!texto || texto.length < 3) return false;
  // Números, valores monetários, datas, CPF/CNPJ
  if (/\d/.test(texto)) return true;
  // Datas por extenso ("janeiro", "fevereiro", etc)
  if (/\b(janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/i.test(texto)) return true;
  // Booleans
  if (/\b(sim|não|nao|verdadeiro|falso|true|false)\b/i.test(texto)) return true;
  return false;
}

/**
 * Faz extração + persistência. Não lança erros — falhas são logadas.
 * Roda em background (fire-and-forget pelo caller).
 */
export async function extrairECaptarCampos(opts: {
  agenteId: number;
  conversaId: number;
  contatoId: number;
  escritorioId: number;
}): Promise<CampoCapturado[]> {
  try {
    const db = await getDb();
    if (!db) return [];

    // 1. Pega o agente e a lista de campos que ele deve capturar
    const [agente] = await db
      .select({ camposCaptura: agentesIa.camposCaptura })
      .from(agentesIa)
      .where(and(eq(agentesIa.id, opts.agenteId), eq(agentesIa.escritorioId, opts.escritorioId)))
      .limit(1);
    if (!agente?.camposCaptura) return [];

    let chaves: string[];
    try { chaves = JSON.parse(agente.camposCaptura); } catch { return []; }
    if (!Array.isArray(chaves) || chaves.length === 0) return [];

    // 2. Resolve as definições dos campos (label/tipo/opcoes)
    const definicoes = await db
      .select()
      .from(camposPersonalizadosCliente)
      .where(
        and(
          eq(camposPersonalizadosCliente.escritorioId, opts.escritorioId),
          inArray(camposPersonalizadosCliente.chave, chaves),
        ),
      );
    if (definicoes.length === 0) return [];

    // 3. Pega últimas mensagens da conversa
    const msgs = await db
      .select()
      .from(mensagens)
      .where(eq(mensagens.conversaId, opts.conversaId))
      .orderBy(desc(mensagens.createdAt))
      .limit(15);
    msgs.reverse();

    // Skip se nenhuma das últimas msgs do CLIENTE tem valor extraível
    const ultimaCliente = [...msgs].reverse().find((m) => m.direcao === "entrada");
    if (!ultimaCliente?.conteudo) return [];
    if (!mensagemPareceTerValor(ultimaCliente.conteudo)) return [];

    // 4. Pega valores JÁ capturados pra não repetir extração
    const [contato] = await db
      .select({ camposPersonalizados: contatos.camposPersonalizados })
      .from(contatos)
      .where(eq(contatos.id, opts.contatoId))
      .limit(1);
    const jaCapturados: Record<string, any> = (() => {
      try { return contato?.camposPersonalizados ? JSON.parse(contato.camposPersonalizados) : {}; }
      catch { return {}; }
    })();

    // Campos AINDA não capturados (skip os que já têm valor)
    const definicoesPendentes = definicoes.filter((d) => {
      const v = jaCapturados[d.chave];
      return v === undefined || v === null || v === "";
    });
    if (definicoesPendentes.length === 0) return [];

    // 5. Resolve chave de IA — se não tem, pula sem erro
    const chaveIA = await resolverChaveIA();
    if (!chaveIA) return [];

    // 6. Prompt de extração estruturada
    const camposDescricao = definicoesPendentes
      .map((d) => {
        const opcoes = d.tipo === "select" && d.opcoes
          ? ` (uma destas opções: ${d.opcoes})`
          : "";
        return `- ${d.chave} (${d.label}, tipo ${d.tipo}${opcoes})`;
      })
      .join("\n");

    const historico = msgs
      .slice(-10)
      .map((m) => `${m.direcao === "entrada" ? "CLIENTE" : "ADV"}: ${(m.conteudo || "").slice(0, 200)}`)
      .join("\n");

    const raw = await chamarIA({
      json: true,
      maxTokens: 400,
      temperature: 0.1,
      system: [
        "Você extrai valores estruturados de uma conversa via WhatsApp entre advogado e cliente.",
        "Retorne APENAS JSON com as chaves solicitadas. Para cada chave:",
        "  - Se a conversa contém o valor claramente, devolva o valor formatado conforme tipo (texto, numero, data ISO 8601, boolean true/false, string da opção exata se select).",
        "  - Se NÃO há valor confiável na conversa, devolva null pra essa chave.",
        "Números: extraia somente o número (sem R$, sem pontos de milhar, use ponto pra decimal: 50000 ou 50000.50).",
        "Datas: formato YYYY-MM-DD.",
        "NÃO invente valores. Em dúvida, retorne null.",
        "RESPONDA SÓ COM O JSON. Sem markdown.",
      ].join("\n"),
      user: [
        `## Campos a extrair`,
        camposDescricao,
        ``,
        `## Histórico recente da conversa`,
        historico,
        ``,
        `Retorne JSON com as chaves: ${definicoesPendentes.map((d) => d.chave).join(", ")}`,
      ].join("\n"),
    });

    const parsed = parseJsonIA<Record<string, any>>(raw);
    if (!parsed || typeof parsed !== "object") return [];

    // 7. Filtra valores válidos (não null) e prepara para persistência
    const novos: CampoCapturado[] = [];
    for (const def of definicoesPendentes) {
      const v = parsed[def.chave];
      if (v === null || v === undefined || v === "") continue;
      novos.push({ chave: def.chave, label: def.label, valor: v, tipo: def.tipo });
    }
    if (novos.length === 0) return [];

    // 8. UPSERT em contatos.camposPersonalizados
    const merged = { ...jaCapturados };
    for (const novo of novos) merged[novo.chave] = novo.valor;

    await db
      .update(contatos)
      .set({ camposPersonalizados: JSON.stringify(merged) })
      .where(eq(contatos.id, opts.contatoId));

    log.info(
      {
        agenteId: opts.agenteId,
        conversaId: opts.conversaId,
        contatoId: opts.contatoId,
        capturados: novos.map((n) => n.chave),
      },
      "campos extraídos da conversa",
    );

    return novos;
  } catch (e: any) {
    log.warn({ err: e?.message }, "extrairECaptarCampos falhou (silencioso)");
    return [];
  }
}

/**
 * Lê os valores já capturados pra mostrar no chat. Retorna lista pronta
 * pra ser injetada como mensagens de sistema ("💾 X salvo no cadastro").
 */
export async function listarCamposCapturadosDoContato(
  contatoId: number,
  escritorioId: number,
): Promise<Array<{ chave: string; label: string; valor: any; tipo: string }>> {
  const db = await getDb();
  if (!db) return [];

  const [contato] = await db
    .select({ camposPersonalizados: contatos.camposPersonalizados })
    .from(contatos)
    .where(eq(contatos.id, contatoId))
    .limit(1);
  if (!contato?.camposPersonalizados) return [];

  let valores: Record<string, any>;
  try { valores = JSON.parse(contato.camposPersonalizados); } catch { return []; }
  const chaves = Object.keys(valores).filter((k) => valores[k] !== null && valores[k] !== "");
  if (chaves.length === 0) return [];

  const defs = await db
    .select()
    .from(camposPersonalizadosCliente)
    .where(
      and(
        eq(camposPersonalizadosCliente.escritorioId, escritorioId),
        inArray(camposPersonalizadosCliente.chave, chaves),
      ),
    );

  return defs.map((d) => ({
    chave: d.chave,
    label: d.label,
    valor: valores[d.chave],
    tipo: d.tipo,
  }));
}
