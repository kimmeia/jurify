import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { getEscritorioPorUsuario } from "../escritorio/db-escritorio";
import { getDb } from "../db";
import { contatos, clienteArquivos, clienteAnotacoes, clientePastas, conversas, leads, colaboradores, users } from "../../drizzle/schema";
import { eq, and, desc, like, or, sql, inArray, isNull } from "drizzle-orm";
import { checkPermission } from "./check-permission";
import { validarCpfCnpj, validarEmail, validarTelefone } from "../../shared/validacoes";
import { verificarLimite } from "../billing/plan-limits";
import { excluirClienteEmCascata } from "./excluir-cliente";
import { reconciliarCobrancasOrfas } from "./db-financeiro";
import { criarLead } from "./db-crm";
import { createLogger } from "../_core/logger";

const log = createLogger("router-clientes");

/** Remove entradas vazias/nulas e serializa pra TEXT.
 *  - `null`, `""`, `undefined` → omitidos
 *  - `false` é preservado (resposta válida pra checkbox)
 *  - retorna `null` quando não sobrou nada (limpa coluna no banco) */
function sanitizarCamposPersonalizados(
  raw: Record<string, string | number | boolean | null> | undefined,
): string | null {
  if (!raw || typeof raw !== "object") return null;
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v === null || v === undefined) continue;
    if (typeof v === "string") {
      const trimmed = v.trim();
      if (trimmed === "") continue;
      out[k] = trimmed;
    } else {
      out[k] = v;
    }
  }
  return Object.keys(out).length > 0 ? JSON.stringify(out) : null;
}

/**
 * Busca cliente com mesmo CPF/CNPJ (comparando só dígitos) dentro do
 * escritório. Retorna o primeiro match (ou null). Quando `excludeId` é
 * passado, ignora aquele cliente — útil em `atualizar` pra não comparar
 * contra si mesmo.
 *
 * Implementação: lê contatos com cpfCnpj não-nulo e filtra no JS. SQL com
 * REPLACE encadeado é mais eficiente mas estava quebrando em prod (driver
 * mysql2 + parameterized template), e o caso comum (escritório com até
 * milhares de clientes) não justifica a complexidade.
 */
async function buscarClienteDuplicadoCpf(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  escritorioId: number,
  cpfCnpj: string,
  excludeId?: number,
): Promise<{ id: number; nome: string } | null> {
  const cpfLimpo = cpfCnpj.replace(/\D/g, "");
  if (!cpfLimpo) return null;

  const candidatos = await db
    .select({ id: contatos.id, nome: contatos.nome, cpfCnpj: contatos.cpfCnpj })
    .from(contatos)
    .where(and(
      eq(contatos.escritorioId, escritorioId),
      sql`${contatos.cpfCnpj} IS NOT NULL`,
      sql`${contatos.cpfCnpj} <> ''`,
    ));

  for (const c of candidatos) {
    if (excludeId != null && c.id === excludeId) continue;
    if (!c.cpfCnpj) continue;
    if (c.cpfCnpj.replace(/\D/g, "") === cpfLimpo) {
      return { id: c.id, nome: c.nome };
    }
  }
  return null;
}

export const clientesRouter = router({
  listar: protectedProcedure.input(z.object({ busca: z.string().optional(), limite: z.number().min(1).max(100).optional(), pagina: z.number().min(1).optional(), aguardandoDocumentacao: z.boolean().optional() }).optional()).query(async ({ ctx, input }) => {
    const perm = await checkPermission(ctx.user.id, "clientes", "ver");
    if (!perm.allowed) return { clientes: [], total: 0 };
    const db = await getDb(); if (!db) return { clientes: [], total: 0 };
    const limite = input?.limite || 50; const offset = ((input?.pagina || 1) - 1) * limite;
    let where: any = eq(contatos.escritorioId, perm.escritorioId);
    // Se só pode ver próprios, filtra por responsável
    if (!perm.verTodos && perm.verProprios) { where = and(where, eq(contatos.responsavelId, perm.colaboradorId)); }
    if (input?.busca) { const b = `%${input.busca}%`; where = and(where, or(like(contatos.nome, b), like(contatos.telefone, b), like(contatos.email, b), like(contatos.cpfCnpj, b))); }
    if (input?.aguardandoDocumentacao) { where = and(where, eq(contatos.documentacaoPendente, true)); }
    const rows = await db.select().from(contatos).where(where).orderBy(desc(contatos.createdAt)).limit(limite).offset(offset);
    const [cnt] = await db.select({ count: sql`COUNT(*)` }).from(contatos).where(where);
    return { clientes: rows.map(r => ({ ...r, createdAt: r.createdAt ? (r.createdAt as Date).toISOString() : "", updatedAt: r.updatedAt ? (r.updatedAt as Date).toISOString() : "" })), total: Number((cnt as { count: number } | undefined)?.count || 0), pagina: input?.pagina || 1, limite, totalPaginas: Math.ceil(Number((cnt as { count: number } | undefined)?.count || 0) / limite) };
  }),

  detalhe: protectedProcedure.input(z.object({ id: z.number() })).query(async ({ ctx, input }) => {
    const perm = await checkPermission(ctx.user.id, "clientes", "ver");
    if (!perm.allowed) return null;
    const db = await getDb(); if (!db) return null;
    const [c] = await db.select().from(contatos).where(and(eq(contatos.id, input.id), eq(contatos.escritorioId, perm.escritorioId))).limit(1);
    if (!c) return null;
    // verProprios: bloqueia acesso ao detalhe de cliente que não é seu
    if (!perm.verTodos && perm.verProprios && c.responsavelId !== perm.colaboradorId) {
      return null;
    }
    const esc = { escritorio: { id: perm.escritorioId } };
    const [cc] = await db.select({ count: sql`COUNT(*)` }).from(conversas).where(and(eq(conversas.contatoId, input.id), eq(conversas.escritorioId, esc.escritorio.id)));
    const [lc] = await db.select({ count: sql`COUNT(*)` }).from(leads).where(and(eq(leads.contatoId, input.id), eq(leads.escritorioId, esc.escritorio.id)));
    const [ac] = await db.select({ count: sql`COUNT(*)` }).from(clienteArquivos).where(and(eq(clienteArquivos.contatoId, input.id), eq(clienteArquivos.escritorioId, esc.escritorio.id)));
    const [nc] = await db.select({ count: sql`COUNT(*)` }).from(clienteAnotacoes).where(and(eq(clienteAnotacoes.contatoId, input.id), eq(clienteAnotacoes.escritorioId, esc.escritorio.id)));
    return { ...c, createdAt: c.createdAt ? (c.createdAt as Date).toISOString() : "", updatedAt: c.updatedAt ? (c.updatedAt as Date).toISOString() : "", totalConversas: Number((cc as { count: number } | undefined)?.count || 0), totalLeads: Number((lc as { count: number } | undefined)?.count || 0), totalArquivos: Number((ac as { count: number } | undefined)?.count || 0), totalAnotacoes: Number((nc as { count: number } | undefined)?.count || 0) };
  }),

  criar: protectedProcedure.input(z.object({ nome: z.string().min(2).max(255), telefone: z.string().max(20).optional(), email: z.string().max(320).optional(), cpfCnpj: z.string().max(18).optional(), origem: z.string().optional(), observacoes: z.string().optional(), tags: z.string().optional(), responsavelId: z.number().optional(), documentacaoPendente: z.boolean().optional(), documentacaoObservacoes: z.string().max(1000).optional(), camposPersonalizados: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(), profissao: z.string().max(100).nullable().optional(), estadoCivil: z.enum(["solteiro", "casado", "divorciado", "viuvo", "uniao_estavel"]).nullable().optional(), nacionalidade: z.string().max(50).nullable().optional(), cep: z.string().max(9).nullable().optional(), logradouro: z.string().max(200).nullable().optional(), numeroEndereco: z.string().max(20).nullable().optional(), complemento: z.string().max(100).nullable().optional(), bairro: z.string().max(100).nullable().optional(), cidade: z.string().max(100).nullable().optional(), uf: z.string().length(2).nullable().optional(),
    /**
     * Marcar cliente como JÁ FECHADO no momento do cadastro manual.
     * Quando true, cria lead automaticamente com etapaFunil="fechado_ganho" —
     * cliente entra no relatório comercial como conversão (mesmo critério
     * usado pelo pipeline kanban). Cobre o caso "fechei por ligação/
     * indicação e quero registrar a venda sem passar pelo funil".
     */
    jaFechado: z.boolean().optional(),
    /** Valor do contrato fechado (string pra preservar formatação BR). */
    valorFechamento: z.string().max(20).optional(),
    /** Origem da indicação ("indicacao", "ligacao", "evento", etc). */
    origemFechamento: z.string().max(128).optional(),
  }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "clientes", "criar");
      if (!perm.allowed) throw new Error("Sem permissão para cadastrar clientes.");
      const limite = await verificarLimite(perm.escritorioId, ctx.user.id, "clientes");
      if (!limite.permitido) throw new Error(limite.mensagem);
      if (input.email && !validarEmail(input.email)) throw new Error("Email inválido.");
      if (input.cpfCnpj) { const v = validarCpfCnpj(input.cpfCnpj); if (!v.valido) throw new Error(`${v.tipo === "cpf" ? "CPF" : v.tipo === "cnpj" ? "CNPJ" : "CPF/CNPJ"} inválido.`); }
      if (input.telefone && !validarTelefone(input.telefone)) throw new Error("Telefone inválido. Use formato (XX) XXXXX-XXXX.");
      const db = await getDb(); if (!db) throw new Error("Database indisponível");

      // Unicidade de CPF/CNPJ no escritório (compara só dígitos pra casar
      // com cadastros antigos com formatação variada). Operador recebe
      // nome+ID do cliente existente pra clicar e abrir a ficha.
      if (input.cpfCnpj) {
        const dup = await buscarClienteDuplicadoCpf(db, perm.escritorioId, input.cpfCnpj);
        if (dup) {
          // ID embutido na mensagem `[ID:n]` pra o frontend extrair via regex
          // e oferecer link "Abrir cliente existente" (TRPCError.cause não
          // chega no shape default do erro no client).
          throw new TRPCError({
            code: "CONFLICT",
            message: `CPF/CNPJ já cadastrado para "${dup.nome}" [ID:${dup.id}]`,
          });
        }
      }

      // Atendentes/estagiários só conseguem criar contato como próprio responsável.
      // Dono/Gestor (verTodos) pode atribuir a qualquer colaborador via input.responsavelId.
      const respId = perm.verTodos
        ? (input.responsavelId ?? perm.colaboradorId)
        : perm.colaboradorId;
      // Campos personalizados — só persiste o que tiver chave válida (string)
      // e pelo menos um valor não-vazio.
      const camposJson = sanitizarCamposPersonalizados(input.camposPersonalizados);
      const [r] = await db.insert(contatos).values({ escritorioId: perm.escritorioId, nome: input.nome, telefone: input.telefone || null, email: input.email || null, cpfCnpj: input.cpfCnpj || null, origem: (input.origem || "manual") as any, observacoes: input.observacoes || null, tags: input.tags || null, responsavelId: respId, documentacaoPendente: input.documentacaoPendente ?? false, documentacaoObservacoes: input.documentacaoObservacoes || null, camposPersonalizados: camposJson, profissao: input.profissao || null, estadoCivil: input.estadoCivil || null, nacionalidade: input.nacionalidade || null, cep: input.cep || null, logradouro: input.logradouro || null, numeroEndereco: input.numeroEndereco || null, complemento: input.complemento || null, bairro: input.bairro || null, cidade: input.cidade || null, uf: input.uf || null });
      const contatoId = (r as { insertId: number }).insertId;

      // Se marcado "já fechado", cria lead com etapa fechado_ganho — entra
      // no relatório comercial como conversão. Não-fatal: se falhar, o
      // contato já está salvo e o operador pode criar o lead manualmente.
      if (input.jaFechado) {
        try {
          await criarLead({
            escritorioId: perm.escritorioId,
            contatoId,
            responsavelId: respId,
            etapaFunil: "fechado_ganho",
            valorEstimado: input.valorFechamento || undefined,
            origemLead: input.origemFechamento || input.origem || "manual",
          });
        } catch (err: any) {
          log.warn(
            { err: err.message, contatoId },
            "[clientes.criar] falha ao criar lead automático de fechamento (não-fatal)",
          );
        }
      }

      return { id: contatoId };
    }),

  /**
   * Registra um fechamento retroativo no cliente — cria um novo lead com
   * `etapaFunil="fechado_ganho"`. Espelha o que o checkbox "Cliente já
   * fechou contrato" do `NovoClienteDialog` faz quando o cadastro é feito
   * com a flag marcada, mas como ação avulsa pra cobrir o caso "esqueci
   * de marcar" ou "cliente fechou um segundo contrato".
   *
   * Cada chamada cria um lead novo — propositalmente sem checagem de
   * duplicação. Um cliente pode legitimamente fechar N contratos e cada
   * fechamento deve contar separadamente na meta comercial. A UI exibe a
   * contagem de fechamentos já registrados pra evitar duplo-clique
   * acidental sem bloquear o fluxo.
   */
  registrarFechamento: protectedProcedure
    .input(
      z.object({
        contatoId: z.number(),
        valorFechamento: z.string().max(20).optional(),
        origemFechamento: z.string().max(128).optional(),
        /**
         * Atendente que fechou. Default = responsavelId do contato (ou o
         * colaborador logado se o contato não tem responsável). O dialog
         * "Registrar fechamento" passa essa escolha explicitamente — sem
         * isso, leads ficavam atribuídos a quem cadastrou o cliente (não
         * a quem vendeu), distorcendo o relatório comercial.
         */
        responsavelId: z.number().int().positive().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "clientes", "editar");
      if (!perm.allowed) throw new Error("Sem permissão para editar clientes.");
      const db = await getDb();
      if (!db) throw new Error("Database indisponível");

      const [contato] = await db
        .select({ id: contatos.id, responsavelId: contatos.responsavelId })
        .from(contatos)
        .where(
          and(
            eq(contatos.id, input.contatoId),
            eq(contatos.escritorioId, perm.escritorioId),
          ),
        )
        .limit(1);
      if (!contato) throw new Error("Cliente não encontrado.");
      if (
        !perm.verTodos &&
        perm.verProprios &&
        contato.responsavelId !== perm.colaboradorId
      ) {
        throw new Error("Sem permissão para registrar fechamento neste cliente.");
      }

      // Valida que o responsavelId informado pertence ao escritório.
      // Sem isso, operador malicioso poderia atribuir conversão a colaborador
      // de outro escritório (vazamento de dados em relatórios cruzados).
      if (input.responsavelId) {
        const [colab] = await db
          .select({ id: colaboradores.id })
          .from(colaboradores)
          .where(and(
            eq(colaboradores.id, input.responsavelId),
            eq(colaboradores.escritorioId, perm.escritorioId),
          ))
          .limit(1);
        if (!colab) throw new Error("Atendente inválido ou não pertence ao escritório.");
      }

      const leadId = await criarLead({
        escritorioId: perm.escritorioId,
        contatoId: input.contatoId,
        responsavelId: input.responsavelId ?? contato.responsavelId ?? perm.colaboradorId,
        etapaFunil: "fechado_ganho",
        valorEstimado: input.valorFechamento || undefined,
        origemLead: input.origemFechamento || "manual",
      });
      return { leadId };
    }),

  atualizar: protectedProcedure.input(z.object({ id: z.number(), nome: z.string().min(2).max(255).optional(), telefone: z.string().max(20).optional(), email: z.string().max(320).optional(), cpfCnpj: z.string().max(18).optional(), observacoes: z.string().optional(), tags: z.string().optional(), responsavelId: z.number().nullable().optional(), documentacaoPendente: z.boolean().optional(), documentacaoObservacoes: z.string().max(1000).nullable().optional(), camposPersonalizados: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(), profissao: z.string().max(100).nullable().optional(), estadoCivil: z.enum(["solteiro", "casado", "divorciado", "viuvo", "uniao_estavel"]).nullable().optional(), nacionalidade: z.string().max(50).nullable().optional(), cep: z.string().max(9).nullable().optional(), logradouro: z.string().max(200).nullable().optional(), numeroEndereco: z.string().max(20).nullable().optional(), complemento: z.string().max(100).nullable().optional(), bairro: z.string().max(100).nullable().optional(), cidade: z.string().max(100).nullable().optional(), uf: z.string().length(2).nullable().optional() }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "clientes", "editar");
      if (!perm.allowed) throw new Error("Sem permissão para editar clientes.");
      if (input.email && !validarEmail(input.email)) throw new Error("Email inválido.");
      if (input.cpfCnpj) { const v = validarCpfCnpj(input.cpfCnpj); if (!v.valido) throw new Error("CPF/CNPJ inválido."); }
      if (input.telefone && !validarTelefone(input.telefone)) throw new Error("Telefone inválido.");
      const db = await getDb(); if (!db) throw new Error("Database indisponível");

      // Unicidade de CPF/CNPJ: se o operador trocou pra um CPF de outro
      // cliente, bloqueia. excludeId evita comparar contra si mesmo.
      if (input.cpfCnpj) {
        const dup = await buscarClienteDuplicadoCpf(db, perm.escritorioId, input.cpfCnpj, input.id);
        if (dup) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `CPF/CNPJ já cadastrado para "${dup.nome}" [ID:${dup.id}]`,
          });
        }
      }

      // Se o telefone mudou, preserva o antigo em telefonesAnteriores
      // para que o handler do WhatsApp ainda reconheça mensagens do número
      // anterior (evita perda de histórico/conexão).
      let telefonesAnterioresAtualizado: string | null | undefined;
      if (input.telefone !== undefined) {
        try {
          const [existente] = await db.select({
            telefone: contatos.telefone,
            telefonesAnteriores: contatos.telefonesAnteriores,
          }).from(contatos)
            .where(and(eq(contatos.id, input.id), eq(contatos.escritorioId, perm.escritorioId)))
            .limit(1);

          if (existente?.telefone && existente.telefone !== input.telefone) {
            const historico = (existente.telefonesAnteriores || "")
              .split(",")
              .map((t: string) => t.trim())
              .filter(Boolean);
            if (!historico.includes(existente.telefone)) {
              historico.unshift(existente.telefone);
            }
            telefonesAnterioresAtualizado = historico.join(",");
          }
        } catch {
          /* schema antigo — ignora, próximo deploy garante a coluna */
        }
      }

      const { id, ...d } = input; const u: Record<string, unknown> = {};
      if (d.nome !== undefined) u.nome = d.nome;
      if (d.telefone !== undefined) u.telefone = d.telefone;
      if (telefonesAnterioresAtualizado !== undefined) u.telefonesAnteriores = telefonesAnterioresAtualizado;
      if (d.email !== undefined) u.email = d.email;
      if (d.cpfCnpj !== undefined) u.cpfCnpj = d.cpfCnpj;
      if (d.observacoes !== undefined) u.observacoes = d.observacoes;
      if (d.tags !== undefined) u.tags = d.tags;
      if (d.documentacaoPendente !== undefined) u.documentacaoPendente = d.documentacaoPendente;
      if (d.documentacaoObservacoes !== undefined) u.documentacaoObservacoes = d.documentacaoObservacoes;
      if (d.camposPersonalizados !== undefined) u.camposPersonalizados = sanitizarCamposPersonalizados(d.camposPersonalizados);
      // Qualificação civil + endereço — campos opcionais. `null`/string vazia
      // limpa o campo no banco.
      if (d.profissao !== undefined) u.profissao = d.profissao || null;
      if (d.estadoCivil !== undefined) u.estadoCivil = d.estadoCivil || null;
      if (d.nacionalidade !== undefined) u.nacionalidade = d.nacionalidade || null;
      if (d.cep !== undefined) u.cep = d.cep || null;
      if (d.logradouro !== undefined) u.logradouro = d.logradouro || null;
      if (d.numeroEndereco !== undefined) u.numeroEndereco = d.numeroEndereco || null;
      if (d.complemento !== undefined) u.complemento = d.complemento || null;
      if (d.bairro !== undefined) u.bairro = d.bairro || null;
      if (d.cidade !== undefined) u.cidade = d.cidade || null;
      if (d.uf !== undefined) u.uf = d.uf ? d.uf.toUpperCase() : null;
      // Reatribuição de responsável: só permitida pra quem tem verTodos
      // (atendente/estagiário não pode "passar" cliente pra outro).
      // Esse colaborador é o "dono" do cliente — recebe a conversa quando o
      // cliente entra em contato E recebe comissão pelas cobranças do cliente.
      // Detecta mudança ANTES do update para disparar a reconciliação depois.
      let responsavelMudou = false;
      let responsavelAlvo: number | null | undefined;
      if (d.responsavelId !== undefined && perm.verTodos) {
        const [antes] = await db.select({ atual: contatos.responsavelId })
          .from(contatos)
          .where(and(eq(contatos.id, id), eq(contatos.escritorioId, perm.escritorioId)))
          .limit(1);
        const valorAtual = antes?.atual ?? null;
        responsavelMudou = valorAtual !== (d.responsavelId ?? null);
        responsavelAlvo = d.responsavelId;
        u.responsavelId = d.responsavelId;
      }
      await db.update(contatos).set(u).where(and(eq(contatos.id, id), eq(contatos.escritorioId, perm.escritorioId)));

      // Reconciliação automática: se o responsável mudou para um colaborador
      // não-nulo, propaga pro histórico de cobranças órfãs deste cliente.
      // Cobranças com atendente já atribuído (manual ou via cascata) são
      // preservadas — a função reconciliarCobrancasOrfas só toca em órfãs.
      let reconciliadas = 0;
      let leadsReatribuidos = 0;
      if (responsavelMudou && responsavelAlvo !== null && responsavelAlvo !== undefined) {
        try {
          const r = await reconciliarCobrancasOrfas(perm.escritorioId, id);
          reconciliadas = r.atribuidas;
        } catch (err) {
          // Não derruba o update do contato se a reconciliação falhar.
          // O usuário ainda pode disparar manualmente em "Atribuir cobranças".
        }
        // Mesma lógica para leads sem responsável: cliente cadastrado sem
        // atendente → leads herdados ficaram com responsavelId NULL (fluxo
        // de "Registrar fechamento" antes do fix). Definir responsável no
        // cliente agora propaga pros leads NULL — não toca em leads que já
        // têm responsável (evita sobrescrever fechamento de outro atendente).
        try {
          const r = await db
            .update(leads)
            .set({ responsavelId: responsavelAlvo })
            .where(and(
              eq(leads.contatoId, id),
              eq(leads.escritorioId, perm.escritorioId),
              isNull(leads.responsavelId),
            ));
          leadsReatribuidos = Number((r as { affectedRows?: number }).affectedRows ?? 0);
        } catch {
          /* não-fatal */
        }
      }
      return { success: true, reconciliadas, leadsReatribuidos };
    }),

  excluir: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const perm = await checkPermission(ctx.user.id, "clientes", "excluir");
    if (!perm.allowed) throw new Error("Sem permissão para excluir clientes.");
    // Cascata: cancela cobranças no Asaas, deleta espelhos locais,
    // conversas, mensagens, leads, tarefas, anotações, arquivos e
    // assinaturas — tudo vinculado a este cliente.
    const resultado = await excluirClienteEmCascata(input.id, perm.escritorioId);
    return resultado;
  }),

  listarAnotacoes: protectedProcedure.input(z.object({ contatoId: z.number() })).query(async ({ ctx, input }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id); if (!esc) return []; const db = await getDb(); if (!db) return [];
    const rows = await db.select().from(clienteAnotacoes).where(and(eq(clienteAnotacoes.contatoId, input.contatoId), eq(clienteAnotacoes.escritorioId, esc.escritorio.id))).orderBy(desc(clienteAnotacoes.createdAt));
    return rows.map(r => ({ ...r, createdAt: r.createdAt ? (r.createdAt as Date).toISOString() : "", updatedAt: r.updatedAt ? (r.updatedAt as Date).toISOString() : "" }));
  }),
  criarAnotacao: protectedProcedure.input(z.object({ contatoId: z.number(), titulo: z.string().max(255).optional(), conteudo: z.string().min(1) })).mutation(async ({ ctx, input }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id); if (!esc) throw new Error("Escritório não encontrado."); const db = await getDb(); if (!db) throw new Error("Database indisponível");
    const [r] = await db.insert(clienteAnotacoes).values({ escritorioId: esc.escritorio.id, contatoId: input.contatoId, titulo: input.titulo || null, conteudo: input.conteudo, criadoPor: esc.colaborador.id });
    return { id: (r as { insertId: number }).insertId };
  }),
  excluirAnotacao: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id); if (!esc) throw new Error("Escritório não encontrado."); const db = await getDb(); if (!db) throw new Error("Database indisponível");
    await db.delete(clienteAnotacoes).where(and(eq(clienteAnotacoes.id, input.id), eq(clienteAnotacoes.escritorioId, esc.escritorio.id)));
    return { success: true };
  }),

  listarArquivos: protectedProcedure.input(z.object({
    contatoId: z.number(),
    // pastaId: undefined = todos (comportamento legado); null = só raiz;
    // number = só arquivos daquela pasta específica.
    pastaId: z.number().nullable().optional(),
  })).query(async ({ ctx, input }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id); if (!esc) return []; const db = await getDb(); if (!db) return [];
    const conds: any[] = [
      eq(clienteArquivos.contatoId, input.contatoId),
      eq(clienteArquivos.escritorioId, esc.escritorio.id),
    ];
    if (input.pastaId === null) conds.push(isNull(clienteArquivos.pastaId));
    else if (typeof input.pastaId === "number") conds.push(eq(clienteArquivos.pastaId, input.pastaId));
    const rows = await db.select().from(clienteArquivos).where(and(...conds)).orderBy(desc(clienteArquivos.createdAt));
    return rows.map(r => ({ ...r, createdAt: r.createdAt ? (r.createdAt as Date).toISOString() : "" }));
  }),
  salvarArquivo: protectedProcedure.input(z.object({
    contatoId: z.number(),
    pastaId: z.number().nullable().optional(),
    nome: z.string().max(255),
    tipo: z.string().max(255).optional(),
    tamanho: z.number().optional(),
    url: z.string(),
  })).mutation(async ({ ctx, input }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id); if (!esc) throw new Error("Escritório não encontrado."); const db = await getDb(); if (!db) throw new Error("Database indisponível");
    // Se pastaId foi informado, valida que a pasta pertence ao contato/escritório.
    if (typeof input.pastaId === "number") {
      const [pasta] = await db.select({ id: clientePastas.id }).from(clientePastas)
        .where(and(
          eq(clientePastas.id, input.pastaId),
          eq(clientePastas.contatoId, input.contatoId),
          eq(clientePastas.escritorioId, esc.escritorio.id),
        ))
        .limit(1);
      if (!pasta) throw new Error("Pasta inválida ou não pertence a este cliente.");
    }
    const [r] = await db.insert(clienteArquivos).values({
      escritorioId: esc.escritorio.id,
      contatoId: input.contatoId,
      pastaId: input.pastaId ?? null,
      nome: input.nome,
      tipo: input.tipo || null,
      tamanho: input.tamanho || null,
      url: input.url,
      uploadPor: esc.colaborador.id,
    });
    return { id: (r as { insertId: number }).insertId };
  }),
  excluirArquivo: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id); if (!esc) throw new Error("Escritório não encontrado."); const db = await getDb(); if (!db) throw new Error("Database indisponível");
    await db.delete(clienteArquivos).where(and(eq(clienteArquivos.id, input.id), eq(clienteArquivos.escritorioId, esc.escritorio.id)));
    return { success: true };
  }),
  moverArquivo: protectedProcedure.input(z.object({
    id: z.number(),
    pastaId: z.number().nullable(), // null = mover pra raiz
  })).mutation(async ({ ctx, input }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id); if (!esc) throw new Error("Escritório não encontrado."); const db = await getDb(); if (!db) throw new Error("Database indisponível");
    // Pega o arquivo + contato pra validar que a pasta destino é do mesmo contato.
    const [arquivo] = await db.select().from(clienteArquivos)
      .where(and(eq(clienteArquivos.id, input.id), eq(clienteArquivos.escritorioId, esc.escritorio.id)))
      .limit(1);
    if (!arquivo) throw new Error("Arquivo não encontrado.");
    if (input.pastaId !== null) {
      const [pasta] = await db.select({ id: clientePastas.id }).from(clientePastas)
        .where(and(
          eq(clientePastas.id, input.pastaId),
          eq(clientePastas.contatoId, arquivo.contatoId),
          eq(clientePastas.escritorioId, esc.escritorio.id),
        ))
        .limit(1);
      if (!pasta) throw new Error("Pasta destino inválida.");
    }
    await db.update(clienteArquivos).set({ pastaId: input.pastaId })
      .where(eq(clienteArquivos.id, input.id));
    return { success: true };
  }),

  // ─── PASTAS ──────────────────────────────────────────────────────────
  listarPastas: protectedProcedure.input(z.object({
    contatoId: z.number(),
    // parentId: undefined = todas do contato; null = só raiz; number = só filhas diretas.
    parentId: z.number().nullable().optional(),
  })).query(async ({ ctx, input }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id); if (!esc) return []; const db = await getDb(); if (!db) return [];
    const conds: any[] = [
      eq(clientePastas.contatoId, input.contatoId),
      eq(clientePastas.escritorioId, esc.escritorio.id),
    ];
    if (input.parentId === null) conds.push(isNull(clientePastas.parentId));
    else if (typeof input.parentId === "number") conds.push(eq(clientePastas.parentId, input.parentId));

    const pastas = await db.select().from(clientePastas).where(and(...conds)).orderBy(clientePastas.nome);

    // Contagens (arquivos diretos + subpastas diretas) para exibir no card.
    const ids = pastas.map((p) => p.id);
    const contagens: Record<number, { arquivos: number; subpastas: number }> = {};
    if (ids.length > 0) {
      const arq = await db.select({ pastaId: clienteArquivos.pastaId, total: sql<number>`COUNT(*)` })
        .from(clienteArquivos)
        .where(and(eq(clienteArquivos.escritorioId, esc.escritorio.id), inArray(clienteArquivos.pastaId, ids)))
        .groupBy(clienteArquivos.pastaId);
      const sub = await db.select({ parentId: clientePastas.parentId, total: sql<number>`COUNT(*)` })
        .from(clientePastas)
        .where(and(eq(clientePastas.escritorioId, esc.escritorio.id), inArray(clientePastas.parentId, ids)))
        .groupBy(clientePastas.parentId);
      for (const id of ids) contagens[id] = { arquivos: 0, subpastas: 0 };
      for (const r of arq) if (r.pastaId != null) contagens[r.pastaId].arquivos = Number(r.total);
      for (const r of sub) if (r.parentId != null) contagens[r.parentId].subpastas = Number(r.total);
    }

    return pastas.map((p) => ({
      ...p,
      createdAt: p.createdAt ? (p.createdAt as Date).toISOString() : "",
      totalArquivos: contagens[p.id]?.arquivos ?? 0,
      totalSubpastas: contagens[p.id]?.subpastas ?? 0,
    }));
  }),

  criarPasta: protectedProcedure.input(z.object({
    contatoId: z.number(),
    nome: z.string().min(1).max(128),
    parentId: z.number().nullable().optional(),
  })).mutation(async ({ ctx, input }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id); if (!esc) throw new Error("Escritório não encontrado."); const db = await getDb(); if (!db) throw new Error("Database indisponível");
    const nomeLimpo = input.nome.trim();
    if (!nomeLimpo) throw new Error("Nome da pasta não pode ser vazio.");

    // Se parentId foi informado, valida que a pasta mãe pertence ao mesmo contato/escritório.
    if (typeof input.parentId === "number") {
      const [mae] = await db.select({ id: clientePastas.id }).from(clientePastas)
        .where(and(
          eq(clientePastas.id, input.parentId),
          eq(clientePastas.contatoId, input.contatoId),
          eq(clientePastas.escritorioId, esc.escritorio.id),
        ))
        .limit(1);
      if (!mae) throw new Error("Pasta mãe inválida.");
    }

    // Evita duplicata de nome no mesmo nível.
    const conds: any[] = [
      eq(clientePastas.contatoId, input.contatoId),
      eq(clientePastas.escritorioId, esc.escritorio.id),
      eq(clientePastas.nome, nomeLimpo),
    ];
    if (input.parentId == null) conds.push(isNull(clientePastas.parentId));
    else conds.push(eq(clientePastas.parentId, input.parentId));
    const [dup] = await db.select({ id: clientePastas.id }).from(clientePastas).where(and(...conds)).limit(1);
    if (dup) throw new Error("Já existe uma pasta com esse nome neste local.");

    const [r] = await db.insert(clientePastas).values({
      escritorioId: esc.escritorio.id,
      contatoId: input.contatoId,
      parentId: input.parentId ?? null,
      nome: nomeLimpo,
      criadoPor: esc.colaborador.id,
    });
    return { id: (r as { insertId: number }).insertId };
  }),

  renomearPasta: protectedProcedure.input(z.object({
    id: z.number(),
    nome: z.string().min(1).max(128),
  })).mutation(async ({ ctx, input }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id); if (!esc) throw new Error("Escritório não encontrado."); const db = await getDb(); if (!db) throw new Error("Database indisponível");
    const nomeLimpo = input.nome.trim();
    if (!nomeLimpo) throw new Error("Nome da pasta não pode ser vazio.");
    const [atual] = await db.select().from(clientePastas)
      .where(and(eq(clientePastas.id, input.id), eq(clientePastas.escritorioId, esc.escritorio.id)))
      .limit(1);
    if (!atual) throw new Error("Pasta não encontrada.");

    // Checa duplicata de nome no mesmo nível (exceto a própria pasta).
    const conds: any[] = [
      eq(clientePastas.contatoId, atual.contatoId),
      eq(clientePastas.escritorioId, esc.escritorio.id),
      eq(clientePastas.nome, nomeLimpo),
    ];
    if (atual.parentId == null) conds.push(isNull(clientePastas.parentId));
    else conds.push(eq(clientePastas.parentId, atual.parentId));
    const [dup] = await db.select({ id: clientePastas.id }).from(clientePastas).where(and(...conds)).limit(1);
    if (dup && dup.id !== input.id) throw new Error("Já existe uma pasta com esse nome neste local.");

    await db.update(clientePastas).set({ nome: nomeLimpo }).where(eq(clientePastas.id, input.id));
    return { success: true };
  }),

  excluirPasta: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id); if (!esc) throw new Error("Escritório não encontrado."); const db = await getDb(); if (!db) throw new Error("Database indisponível");
    const [pasta] = await db.select().from(clientePastas)
      .where(and(eq(clientePastas.id, input.id), eq(clientePastas.escritorioId, esc.escritorio.id)))
      .limit(1);
    if (!pasta) throw new Error("Pasta não encontrada.");

    // BFS para coletar todos os IDs de subpastas (e a própria).
    const todosIds: number[] = [pasta.id];
    let fronteira = [pasta.id];
    while (fronteira.length > 0) {
      const filhos = await db.select({ id: clientePastas.id }).from(clientePastas)
        .where(and(
          eq(clientePastas.escritorioId, esc.escritorio.id),
          inArray(clientePastas.parentId, fronteira),
        ));
      const novos = filhos.map((f) => f.id);
      if (novos.length === 0) break;
      todosIds.push(...novos);
      fronteira = novos;
    }

    // Exclusão definitiva: primeiro arquivos de todas, depois as pastas.
    let arquivosExcluidos = 0;
    const delArq = await db.delete(clienteArquivos)
      .where(and(
        eq(clienteArquivos.escritorioId, esc.escritorio.id),
        inArray(clienteArquivos.pastaId, todosIds),
      ));
    arquivosExcluidos = (delArq as unknown as { affectedRows?: number })?.affectedRows ?? 0;

    await db.delete(clientePastas)
      .where(and(
        eq(clientePastas.escritorioId, esc.escritorio.id),
        inArray(clientePastas.id, todosIds),
      ));

    return { success: true, pastasExcluidas: todosIds.length, arquivosExcluidos };
  }),

  /**
   * Lista recursivamente todo o conteúdo de uma pasta (subpastas + arquivos),
   * devolvendo o path relativo de cada arquivo para montagem do ZIP no
   * frontend. Pastas vazias não aparecem (jszip as cria implicitamente).
   */
  listarConteudoRecursivo: protectedProcedure.input(z.object({
    pastaId: z.number(),
  })).query(async ({ ctx, input }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id); if (!esc) return { nome: "", arquivos: [] as Array<{ nome: string; url: string; pathRelativo: string }> };
    const db = await getDb(); if (!db) return { nome: "", arquivos: [] };

    const [raiz] = await db.select().from(clientePastas)
      .where(and(eq(clientePastas.id, input.pastaId), eq(clientePastas.escritorioId, esc.escritorio.id)))
      .limit(1);
    if (!raiz) return { nome: "", arquivos: [] };

    // BFS mantendo o caminho relativo de cada pasta.
    const caminhos = new Map<number, string>();
    caminhos.set(raiz.id, raiz.nome);
    const resultado: Array<{ nome: string; url: string; pathRelativo: string }> = [];

    let fronteira: number[] = [raiz.id];
    while (fronteira.length > 0) {
      const arquivos = await db.select().from(clienteArquivos)
        .where(and(
          eq(clienteArquivos.escritorioId, esc.escritorio.id),
          inArray(clienteArquivos.pastaId, fronteira),
        ));
      for (const a of arquivos) {
        const base = caminhos.get(a.pastaId as number) || raiz.nome;
        resultado.push({ nome: a.nome, url: a.url, pathRelativo: `${base}/${a.nome}` });
      }

      const subs = await db.select().from(clientePastas)
        .where(and(
          eq(clientePastas.escritorioId, esc.escritorio.id),
          inArray(clientePastas.parentId, fronteira),
        ));
      if (subs.length === 0) break;
      for (const s of subs) {
        const base = caminhos.get(s.parentId as number) || raiz.nome;
        caminhos.set(s.id, `${base}/${s.nome}`);
      }
      fronteira = subs.map((s) => s.id);
    }

    return { nome: raiz.nome, arquivos: resultado };
  }),

  listarConversas: protectedProcedure.input(z.object({ contatoId: z.number() })).query(async ({ ctx, input }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id); if (!esc) return []; const db = await getDb(); if (!db) return [];
    const rows = await db.select().from(conversas).where(and(eq(conversas.contatoId, input.contatoId), eq(conversas.escritorioId, esc.escritorio.id))).orderBy(desc(conversas.createdAt));
    return rows.map(r => ({ id: r.id, status: r.status, assunto: r.assunto, ultimaMensagemPreview: r.ultimaMensagemPreview, ultimaMensagemAt: r.ultimaMensagemAt ? (r.ultimaMensagemAt as Date).toISOString() : "", createdAt: r.createdAt ? (r.createdAt as Date).toISOString() : "" }));
  }),

  listarLeads: protectedProcedure.input(z.object({ contatoId: z.number() })).query(async ({ ctx, input }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id); if (!esc) return []; const db = await getDb(); if (!db) return [];
    const rows = await db
      .select({
        id: leads.id,
        etapaFunil: leads.etapaFunil,
        valorEstimado: leads.valorEstimado,
        createdAt: leads.createdAt,
        responsavelId: leads.responsavelId,
        responsavelNome: users.name,
      })
      .from(leads)
      .leftJoin(colaboradores, eq(leads.responsavelId, colaboradores.id))
      .leftJoin(users, eq(colaboradores.userId, users.id))
      .where(and(eq(leads.contatoId, input.contatoId), eq(leads.escritorioId, esc.escritorio.id)))
      .orderBy(desc(leads.createdAt));
    return rows.map(r => ({
      id: r.id,
      etapaFunil: r.etapaFunil,
      valorEstimado: r.valorEstimado,
      createdAt: r.createdAt ? (r.createdAt as Date).toISOString() : "",
      responsavelId: r.responsavelId,
      responsavelNome: r.responsavelNome,
    }));
  }),

  estatisticas: protectedProcedure.query(async ({ ctx }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id); if (!esc) return { total: 0, novosHoje: 0, comTelefone: 0, comEmail: 0, aguardandoDocumentacao: 0 };
    const db = await getDb(); if (!db) return { total: 0, novosHoje: 0, comTelefone: 0, comEmail: 0, aguardandoDocumentacao: 0 };
    const eid = esc.escritorio.id;
    const [t] = await db.select({ count: sql`COUNT(*)` }).from(contatos).where(eq(contatos.escritorioId, eid));
    const [ct] = await db.select({ count: sql`COUNT(*)` }).from(contatos).where(and(eq(contatos.escritorioId, eid), sql`telefoneContato IS NOT NULL AND telefoneContato != ''`));
    const [ce] = await db.select({ count: sql`COUNT(*)` }).from(contatos).where(and(eq(contatos.escritorioId, eid), sql`emailContato IS NOT NULL AND emailContato != ''`));
    const [nh] = await db.select({ count: sql`COUNT(*)` }).from(contatos).where(and(eq(contatos.escritorioId, eid), sql`DATE(createdAtContato) = CURDATE()`));
    const [docs] = await db.select({ count: sql`COUNT(*)` }).from(contatos).where(and(eq(contatos.escritorioId, eid), eq(contatos.documentacaoPendente, true)));
    return {
      total: Number((t as { count: number } | undefined)?.count || 0),
      novosHoje: Number((nh as { count: number } | undefined)?.count || 0),
      comTelefone: Number((ct as { count: number } | undefined)?.count || 0),
      comEmail: Number((ce as { count: number } | undefined)?.count || 0),
      aguardandoDocumentacao: Number((docs as { count: number } | undefined)?.count || 0),
    };
  }),

  /**
   * Auditoria read-only: lista clientes que compartilham o mesmo CPF/CNPJ
   * dentro do escritório. Permite operador identificar duplicatas antigas
   * (criadas antes da validação de unicidade) e tratar caso a caso pela UI
   * normal (editar/excluir). Não deleta nada.
   *
   * Permission: clientes.ver com verTodos (gestores/dono). Mostrar
   * duplicatas é uma operação de saneamento de base — não cabe a atendentes
   * comuns.
   */
  duplicatasCpf: protectedProcedure.query(async ({ ctx }) => {
    const perm = await checkPermission(ctx.user.id, "clientes", "ver");
    if (!perm.allowed || !perm.verTodos) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Apenas dono/gestor pode listar duplicatas.",
      });
    }
    const db = await getDb();
    if (!db) return { grupos: [] };

    // Lê todos com CPF e agrupa no JS por CPF normalizado. Mais simples
    // e portátil que SQL com REPLACE encadeado.
    const todos = await db
      .select({ id: contatos.id, nome: contatos.nome, cpfCnpj: contatos.cpfCnpj, createdAt: contatos.createdAt })
      .from(contatos)
      .where(and(
        eq(contatos.escritorioId, perm.escritorioId),
        sql`${contatos.cpfCnpj} IS NOT NULL`,
        sql`${contatos.cpfCnpj} <> ''`,
      ));

    const porCpf = new Map<string, Array<{ id: number; nome: string; cpfCnpj: string; createdAt: Date }>>();
    for (const c of todos) {
      if (!c.cpfCnpj) continue;
      const limpo = c.cpfCnpj.replace(/\D/g, "");
      if (!limpo) continue;
      const grupo = porCpf.get(limpo) || [];
      grupo.push({ id: c.id, nome: c.nome, cpfCnpj: c.cpfCnpj, createdAt: c.createdAt as Date });
      porCpf.set(limpo, grupo);
    }

    const grupos = Array.from(porCpf.entries())
      .filter(([, lista]) => lista.length > 1)
      .map(([cpfLimpo, lista]) => ({
        cpfLimpo,
        qtd: lista.length,
        clientes: lista
          .slice()
          .sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0)),
      }))
      .sort((a, b) => b.qtd - a.qtd);

    return { grupos };
  }),

  /**
   * Verifica em tempo real se um CPF/CNPJ já está cadastrado. Usado pelo
   * frontend ao sair do campo CPF no dialog de novo cliente: se já existe,
   * dialog mostra "CPF já cadastrado" antes do submit.
   *
   * Devolve `null` quando livre; quando ocupado, retorna `{id, nome}` do
   * cliente existente.
   */
  /**
   * Gera PDF com lista de duplicatas de CPF/CNPJ. Retorna base64 pro client
   * baixar via blob — mesmo padrão do `financeiro.exportarDrePdf`. Permission:
   * dono/gestor (verTodos), igual à listagem.
   */
  exportarDuplicatasPdf: protectedProcedure.mutation(async ({ ctx }) => {
    const perm = await checkPermission(ctx.user.id, "clientes", "ver");
    if (!perm.allowed || !perm.verTodos) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Apenas dono/gestor pode exportar relatório de duplicatas.",
      });
    }
    const db = await getDb();
    if (!db) throw new Error("Database indisponível");

    const esc = await getEscritorioPorUsuario(ctx.user.id);
    if (!esc) throw new Error("Escritório não encontrado");

    const todos = await db
      .select({ id: contatos.id, nome: contatos.nome, cpfCnpj: contatos.cpfCnpj, createdAt: contatos.createdAt })
      .from(contatos)
      .where(and(
        eq(contatos.escritorioId, perm.escritorioId),
        sql`${contatos.cpfCnpj} IS NOT NULL`,
        sql`${contatos.cpfCnpj} <> ''`,
      ));

    const porCpf = new Map<string, Array<{ id: number; nome: string; cpfCnpj: string; createdAt: Date | null }>>();
    for (const c of todos) {
      if (!c.cpfCnpj) continue;
      const limpo = c.cpfCnpj.replace(/\D/g, "");
      if (!limpo) continue;
      const grupo = porCpf.get(limpo) || [];
      grupo.push({ id: c.id, nome: c.nome, cpfCnpj: c.cpfCnpj, createdAt: c.createdAt as Date | null });
      porCpf.set(limpo, grupo);
    }
    const grupos = Array.from(porCpf.entries())
      .filter(([, lista]) => lista.length > 1)
      .map(([cpfLimpo, lista]) => ({
        cpfLimpo,
        qtd: lista.length,
        clientes: lista.slice().sort((a, b) => (a.createdAt?.getTime?.() ?? 0) - (b.createdAt?.getTime?.() ?? 0)),
      }))
      .sort((a, b) => b.qtd - a.qtd);

    const { gerarDuplicatasPDF } = await import("./duplicatas-pdf");
    const buffer = await gerarDuplicatasPDF(grupos, esc.escritorio.nome);
    return {
      filename: `duplicatas_${new Date().toISOString().slice(0, 10)}.pdf`,
      base64: buffer.toString("base64"),
      mimeType: "application/pdf",
    };
  }),

  verificarCpf: protectedProcedure
    .input(z.object({
      cpfCnpj: z.string(),
      excluirId: z.number().int().positive().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "clientes", "ver");
      if (!perm.allowed) return null;
      const db = await getDb();
      if (!db) return null;
      const cpfLimpo = input.cpfCnpj.replace(/\D/g, "");
      // Só verifica CPF (11) ou CNPJ (14) completos — evita ruído digitando.
      if (cpfLimpo.length !== 11 && cpfLimpo.length !== 14) return null;
      return buscarClienteDuplicadoCpf(db, perm.escritorioId, input.cpfCnpj, input.excluirId);
    }),
});
