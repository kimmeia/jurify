/**
 * Extração automática de valores em conversas via IA.
 *
 * Quando um agente tem variáveis configuradas (em `camposCaptura`),
 * o sistema chama a IA depois de cada mensagem do cliente pra tentar
 * extrair valores e persistir em `contatos.camposPersonalizados`.
 *
 * Estratégia:
 *  - Roda EM BACKGROUND (não bloqueia resposta da IA pro usuário)
 *  - Heurística de skip: se a última msg do cliente não tem caractere
 *    numérico/CPF/data, pula a chamada IA pra evitar burn money
 *  - Faz UPSERT em camposPersonalizados (merge, não overwrite)
 *  - Aceita descrição custom + datas relativas ("amanhã", "sexta")
 */
import { getDb } from "../db";
import {
  agentesIa,
  contatos,
  mensagens,
  camposPersonalizadosCliente,
} from "../../drizzle/schema";
import { and, desc, eq, inArray } from "drizzle-orm";
import { chamarIA, parseJsonIA, resolverChaveIAEscritorio } from "../_core/ai-call";
import { createLogger } from "../_core/logger";
import { parseAgenteVariaveis, type AgenteVariavel } from "../../shared/agente-variaveis-types";

const log = createLogger("agente-captura-campos");

export interface CampoCapturado {
  chave: string;
  label: string;
  valor: string | number | boolean;
  /** Tipo do campo no catálogo (texto/numero/data/etc) */
  tipo: string;
  /** Atributo técnico usado pela IA (pode diferir de `chave` quando o agente define alias) */
  atributo: string;
}

export interface UltimaTentativaCaptura {
  at: Date;
  novos: number;
  erro: string | null;
}

/**
 * Persiste metadados da tentativa de captura no agente. Chamado apenas
 * quando houve ATIVIDADE real (chamou IA, falhou) — skips por heurística
 * silenciosa não atualizam, pra não floodar UPDATEs em mensagens sociais.
 */
async function marcarTentativa(
  db: any,
  agenteId: number,
  escritorioId: number,
  resultado: { novos: number; erro: string | null },
): Promise<void> {
  try {
    await db
      .update(agentesIa)
      .set({
        ultimaCapturaAt: new Date(),
        ultimaCapturaNovos: resultado.novos,
        ultimoErroCaptura: resultado.erro ? resultado.erro.slice(0, 500) : null,
      })
      .where(and(eq(agentesIa.id, agenteId), eq(agentesIa.escritorioId, escritorioId)));
  } catch (e: any) {
    log.warn({ err: e?.message, agenteId }, "falha ao marcar tentativa de captura");
  }
}

/**
 * Saudações/agradecimentos curtos que jamais carregam valor extraível.
 * Lista deliberadamente restrita pra não pular falsos positivos.
 */
const MENSAGENS_SOCIAIS = new Set([
  "oi", "olá", "ola", "ok", "okay", "blz", "beleza",
  "obrigado", "obrigada", "valeu", "vlw",
  "tchau", "ate", "até",
  "bom dia", "boa tarde", "boa noite",
  "oi!", "oi.", "olá!", "ok.", "ok!",
]);

/**
 * Heurística rápida: a mensagem parece conter um valor extraível?
 * Evita chamar IA em conversas puramente sociais ("oi", "obrigado").
 *
 * Estratégia (mais permissiva que a versão anterior — era whitelist muito
 * estreita que pulava casos óbvios tipo "Rafael, para amanha"):
 *  - Mensagens muito curtas (< 3) ou exatamente saudações conhecidas pulam
 *  - Mensagens longas (> 30 chars) sempre passam — alta chance de ter info
 *  - Caso contrário, procura sinais (números, datas, dias da semana,
 *    termos temporais, booleans, palavras de agendamento/intenção)
 */
export function mensagemPareceTerValor(texto: string): boolean {
  if (!texto) return false;
  const limpo = texto.trim();
  if (limpo.length < 3) return false;

  // Saudações puras (mensagem inteira é a saudação)
  if (MENSAGENS_SOCIAIS.has(limpo.toLowerCase())) return false;

  // Mensagens longas têm alta chance de conter informação útil
  if (limpo.length > 30) return true;

  // Normaliza pra remover acentos — regex \b não reconhece "ã"/"á"/etc
  // como word-chars em ASCII, então procurar "amanhã" com \b sempre falha.
  // Strategy: comparamos sempre na forma sem acento (NFD + strip combining marks).
  const norm = limpo
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

  // Números, valores monetários, datas, CPF/CNPJ, horários
  if (/\d/.test(norm)) return true;
  // Datas por extenso (meses)
  if (/\b(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/.test(norm)) return true;
  // Dias da semana (com/sem "-feira", sem acento já normalizado)
  if (/\b(segunda|terca|quarta|quinta|sexta|sabado|domingo)(-?feira)?\b/.test(norm)) return true;
  // Termos temporais relativos
  if (/\b(amanha|hoje|ontem|anteontem|agora|ja)\b/.test(norm)) return true;
  if (/(depois de amanha|semana que vem|mes que vem|proxim[ao])/.test(norm)) return true;
  // Períodos do dia
  if (/\b(manha|tarde|noite|madrugada)\b/.test(norm)) return true;
  // Intenção de agendamento (mesmo sem data, sinaliza que vale tentar extrair)
  if (/\b(agendar|marcar|reservar|reagendar|remarcar|consulta|reuniao|audiencia)\b/.test(norm)) return true;
  // Booleans
  if (/\b(sim|nao|verdadeiro|falso|true|false)\b/.test(norm)) return true;

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
  /** Pula a heurística de skip (mensagemPareceTerValor). Usado quando a
   *  extração é disparada explicitamente pelo fluxo (agente num passo) —
   *  aí sempre tenta, pra não perder capturas tipo "sim"/"casado". */
  forcar?: boolean;
}): Promise<CampoCapturado[]> {
  try {
    const db = await getDb();
    if (!db) return [];

    // 1. Pega o agente e suas variáveis configuradas
    const [agente] = await db
      .select({ camposCaptura: agentesIa.camposCaptura })
      .from(agentesIa)
      .where(and(eq(agentesIa.id, opts.agenteId), eq(agentesIa.escritorioId, opts.escritorioId)))
      .limit(1);
    if (!agente?.camposCaptura) return [];

    const variaveis = parseAgenteVariaveis(agente.camposCaptura);
    if (variaveis.length === 0) return [];

    // 2. Resolve as definições dos campos personalizados referenciados
    const chavesCampo = Array.from(new Set(variaveis.map((v) => v.campoChave)));
    const definicoes = await db
      .select()
      .from(camposPersonalizadosCliente)
      .where(
        and(
          eq(camposPersonalizadosCliente.escritorioId, opts.escritorioId),
          inArray(camposPersonalizadosCliente.chave, chavesCampo),
        ),
      );
    if (definicoes.length === 0) return [];
    const definicaoPorChave = new Map(definicoes.map((d) => [d.chave, d]));

    // 3. Pega últimas mensagens da conversa
    const msgs = await db
      .select()
      .from(mensagens)
      .where(eq(mensagens.conversaId, opts.conversaId))
      .orderBy(desc(mensagens.createdAt))
      .limit(15);
    msgs.reverse();

    // Skip se nenhuma das últimas msgs do CLIENTE tem valor extraível
    // (a menos que `forcar` — fluxo pediu explicitamente).
    const ultimaCliente = [...msgs].reverse().find((m) => m.direcao === "entrada");
    if (!ultimaCliente?.conteudo) return [];
    if (!opts.forcar && !mensagemPareceTerValor(ultimaCliente.conteudo)) return [];

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

    // Variáveis AINDA não capturadas (campo de destino vazio no contato)
    type VarComDef = AgenteVariavel & { def: (typeof definicoes)[number] };
    const variaveisPendentes: VarComDef[] = [];
    for (const v of variaveis) {
      const def = definicaoPorChave.get(v.campoChave);
      if (!def) continue;
      const valorAtual = jaCapturados[def.chave];
      if (valorAtual !== undefined && valorAtual !== null && valorAtual !== "") continue;
      variaveisPendentes.push({ ...v, def });
    }
    if (variaveisPendentes.length === 0) return [];

    // 5. Resolve chave de IA — se não tem, pula sem erro
    const chaveIA = await resolverChaveIAEscritorio(opts.escritorioId);
    if (!chaveIA) return [];

    // 6. Prompt de extração estruturada — usa o atributo da variável como chave
    // do JSON e a descrição custom (quando houver) como hint pra IA.
    const camposDescricao = variaveisPendentes
      .map((v) => {
        const opcoes = v.def.tipo === "select" && v.def.opcoes
          ? ` Opções aceitas: ${v.def.opcoes}.`
          : "";
        const hint = v.descricao ? ` ${v.descricao}` : "";
        return `- ${v.atributo} (${v.def.label}, tipo ${v.def.tipo}).${hint}${opcoes}`;
      })
      .join("\n");

    const historico = msgs
      .slice(-10)
      .map((m) => `${m.direcao === "entrada" ? "CLIENTE" : "ADV"}: ${(m.conteudo || "").slice(0, 200)}`)
      .join("\n");

    // Contexto temporal pra resolver datas relativas ("amanhã", "sexta")
    const hoje = new Date();
    const diasSemana = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
    const hojeISO = hoje.toISOString().slice(0, 10);
    const diaSemanaHoje = diasSemana[hoje.getDay()];

    const raw = await chamarIA({
      escritorioId: opts.escritorioId,
      json: true,
      maxTokens: 400,
      temperature: 0.1,
      system: [
        "Você extrai valores estruturados de uma conversa via WhatsApp entre advogado e cliente.",
        "Retorne APENAS JSON com as chaves solicitadas. Para cada chave:",
        "  - Se a conversa contém o valor claramente, devolva o valor formatado conforme tipo (texto, numero, data ISO 8601, boolean true/false, string da opção exata se select).",
        "  - Se NÃO há valor confiável na conversa, devolva null pra essa chave.",
        "Números: extraia somente o número (sem R$, sem pontos de milhar, use ponto pra decimal: 50000 ou 50000.50).",
        `Datas: formato YYYY-MM-DD. Hoje é ${hojeISO} (${diaSemanaHoje}). Resolva datas relativas ("amanhã", "sexta", "semana que vem") em relação a essa data.`,
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
        `Retorne JSON com as chaves: ${variaveisPendentes.map((v) => v.atributo).join(", ")}`,
      ].join("\n"),
    });

    const parsed = parseJsonIA<Record<string, any>>(raw);
    if (!parsed || typeof parsed !== "object") {
      await marcarTentativa(db, opts.agenteId, opts.escritorioId, {
        novos: 0,
        erro: "Resposta da IA inválida (JSON não parseável)",
      });
      return [];
    }

    // 7. Filtra valores válidos (não null) e mapeia atributo → campoChave
    const novos: CampoCapturado[] = [];
    for (const v of variaveisPendentes) {
      const valor = parsed[v.atributo];
      if (valor === null || valor === undefined || valor === "") continue;
      novos.push({
        chave: v.def.chave,
        label: v.def.label,
        valor,
        tipo: v.def.tipo,
        atributo: v.atributo,
      });
    }

    if (novos.length === 0) {
      // IA rodou mas não achou nada — registra como tentativa válida sem novos.
      await marcarTentativa(db, opts.agenteId, opts.escritorioId, { novos: 0, erro: null });
      return [];
    }

    // 8. UPSERT em contatos.camposPersonalizados (merge, não overwrite)
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
        capturados: novos.map((n) => `${n.atributo}→${n.chave}`),
      },
      "campos extraídos da conversa",
    );

    await marcarTentativa(db, opts.agenteId, opts.escritorioId, {
      novos: novos.length,
      erro: null,
    });

    return novos;
  } catch (e: any) {
    log.warn({ err: e?.message }, "extrairECaptarCampos falhou (silencioso)");
    // Tenta marcar erro — ignora se o próprio db estiver indisponível
    try {
      const db = await getDb();
      if (db) {
        await marcarTentativa(db, opts.agenteId, opts.escritorioId, {
          novos: 0,
          erro: String(e?.message || e || "Erro desconhecido"),
        });
      }
    } catch { /* ignore — não podemos marcar */ }
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

/**
 * Lê metadados da última tentativa de captura do agente. Usado pelo painel
 * "Capturas IA" pra mostrar status visual ("há 2min · ok" / "há 4min · erro").
 * Retorna null se o agente nunca rodou (ultimaCapturaAt é null).
 */
export async function obterUltimaTentativaAgente(
  agenteId: number,
  escritorioId: number,
): Promise<UltimaTentativaCaptura | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select({
      at: agentesIa.ultimaCapturaAt,
      novos: agentesIa.ultimaCapturaNovos,
      erro: agentesIa.ultimoErroCaptura,
    })
    .from(agentesIa)
    .where(and(eq(agentesIa.id, agenteId), eq(agentesIa.escritorioId, escritorioId)))
    .limit(1);
  if (!row?.at) return null;
  return { at: row.at, novos: row.novos ?? 0, erro: row.erro ?? null };
}

/**
 * Atualiza um único campo personalizado do contato. Usado pela edição inline
 * no painel "Capturas IA" quando o atendente quer corrigir um valor que a IA
 * pegou errado. Valida que o campo existe no catálogo do escritório e
 * coage o valor pro tipo correto.
 */
export async function atualizarCampoCapturado(opts: {
  contatoId: number;
  escritorioId: number;
  chave: string;
  valor: unknown;
}): Promise<{ chave: string; label: string; valor: any; tipo: string } | null> {
  const db = await getDb();
  if (!db) throw new Error("Database indisponível");

  // 1. Valida que o campo existe no catálogo deste escritório
  const [def] = await db
    .select()
    .from(camposPersonalizadosCliente)
    .where(
      and(
        eq(camposPersonalizadosCliente.escritorioId, opts.escritorioId),
        eq(camposPersonalizadosCliente.chave, opts.chave),
      ),
    )
    .limit(1);
  if (!def) throw new Error(`Campo personalizado "${opts.chave}" não existe no catálogo`);

  // 2. Coage valor pro tipo correto (e valida select)
  const valorCoercido = coercaoPorTipo(opts.valor, def.tipo, def.opcoes);

  // 3. Lê camposPersonalizados existentes e faz merge
  const [contato] = await db
    .select({ camposPersonalizados: contatos.camposPersonalizados })
    .from(contatos)
    .where(and(eq(contatos.id, opts.contatoId), eq(contatos.escritorioId, opts.escritorioId)))
    .limit(1);
  if (!contato) throw new Error("Contato não encontrado");

  const atual: Record<string, any> = (() => {
    try { return contato.camposPersonalizados ? JSON.parse(contato.camposPersonalizados) : {}; }
    catch { return {}; }
  })();

  // Se valor vazio/null, REMOVE a chave (não persiste null poluindo)
  if (valorCoercido === null || valorCoercido === "") {
    delete atual[opts.chave];
  } else {
    atual[opts.chave] = valorCoercido;
  }

  await db
    .update(contatos)
    .set({ camposPersonalizados: JSON.stringify(atual) })
    .where(eq(contatos.id, opts.contatoId));

  log.info(
    { contatoId: opts.contatoId, chave: opts.chave, valor: valorCoercido },
    "campo capturado atualizado manualmente",
  );

  return {
    chave: def.chave,
    label: def.label,
    valor: valorCoercido,
    tipo: def.tipo,
  };
}

export function coercaoPorTipo(valor: unknown, tipo: string, opcoesJson: string | null): any {
  if (valor === null || valor === undefined || valor === "") return null;
  const s = String(valor).trim();
  if (!s) return null;

  switch (tipo) {
    case "numero": {
      // BR usa ponto pra milhar + vírgula decimal ("1.234,56").
      // ISO usa ponto decimal ("1234.56"). Detecta pela presença de vírgula:
      // se tem vírgula, assume BR (remove pontos, vírgula vira ponto).
      // Se não tem vírgula, assume ISO (mantém ponto como decimal).
      const limpo = s.includes(",")
        ? s.replace(/\./g, "").replace(",", ".")
        : s;
      const n = Number(limpo);
      if (!Number.isFinite(n)) throw new Error(`Valor "${s}" não é um número válido`);
      return n;
    }
    case "boolean": {
      if (s === "true" || s === "sim" || s === "1") return true;
      if (s === "false" || s === "não" || s === "nao" || s === "0") return false;
      throw new Error(`Valor "${s}" não é um boolean válido (use sim/não/true/false)`);
    }
    case "data": {
      // Aceita YYYY-MM-DD direto ou DD/MM/YYYY → converte
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
      const matchBr = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (matchBr) return `${matchBr[3]}-${matchBr[2]}-${matchBr[1]}`;
      throw new Error(`Data "${s}" inválida. Use YYYY-MM-DD ou DD/MM/YYYY`);
    }
    case "select": {
      if (!opcoesJson) return s;
      // Isola try ao parse — erro de validação NÃO deve ser engolido.
      let opcoes: string[] | null = null;
      try {
        const parsed = JSON.parse(opcoesJson);
        if (Array.isArray(parsed)) opcoes = parsed;
      } catch { /* opcoesJson inválido — aceita string crua */ }
      if (opcoes && opcoes.length > 0 && !opcoes.includes(s)) {
        throw new Error(`"${s}" não está nas opções permitidas (${opcoes.join(", ")})`);
      }
      return s;
    }
    case "texto":
    case "textarea":
    default:
      return s;
  }
}
