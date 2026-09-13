/**
 * Central de ajuda — o que o servidor sabe sobre o escritório.
 *
 * `primeirosPassos`: a marcação automática dos 5 passos do dono. Cada passo
 * é detectado por uma consulta amarrada ao escritório da sessão (nunca por
 * id vindo do client); quem não é o dono recebe a lista vazia — não é
 * "sem permissão", é "isto não é pra você" (decisão 3 do mockup: colaborador
 * convidado cai num escritório já configurado, e "conecte o WhatsApp" só
 * confunde).
 */

import { and, asc, eq, inArray, isNotNull, ne } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { getEscritorioPorUsuario } from "./db-escritorio";
import {
  canaisIntegrados,
  cofreCredenciais,
  colaboradores,
  contatos,
  convitesColaborador,
  motorMonitoramentos,
} from "../../drizzle/schema";
import {
  PAYLOAD_VAZIO,
  montarPrimeirosPassos,
  passosDoContrato,
  type DeteccaoPassos,
  type PassoId,
} from "@shared/primeiros-passos";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

function maisAntiga(...datas: Array<Date | null | undefined>): Date | null {
  const validas = datas.filter((d): d is Date => d instanceof Date && !Number.isNaN(d.getTime()));
  if (!validas.length) return null;
  return validas.reduce((a, b) => (a <= b ? a : b));
}

/**
 * Um detector por passo. Todos devolvem a data do registro MAIS ANTIGO que
 * satisfaz o passo (é o "feito em" do cartão) ou null.
 */
const DETECTORES: Record<PassoId, (db: Db, escritorioId: number) => Promise<Date | null>> = {
  // A mesma régua da aba Canais: número que aparece como conectado é
  // whatsapp_api + conectado + telefone (o Embedded Signup deixa órfãos sem
  // telefone que a tela não lista).
  whatsapp: async (db, escritorioId) => {
    const [row] = await db
      .select({ createdAt: canaisIntegrados.createdAt })
      .from(canaisIntegrados)
      .where(and(
        eq(canaisIntegrados.escritorioId, escritorioId),
        eq(canaisIntegrados.tipo, "whatsapp_api"),
        eq(canaisIntegrados.status, "conectado"),
        isNotNull(canaisIntegrados.telefone),
      ))
      .orderBy(asc(canaisIntegrados.createdAt))
      .limit(1);
    return row?.createdAt ?? null;
  },
  // "Cadastrar" é ação de alguém do escritório: o cadastro manual, a
  // importação e o Asaas contam; o lead que o Atendimento cria sozinho na
  // primeira mensagem (`criarOuReutilizarContato`, origem whatsapp) não —
  // senão o passo vira "feito" assim que um desconhecido diz "oi" no número
  // conectado no passo 1, e ninguém cadastrou nada.
  cliente: async (db, escritorioId) => {
    const [row] = await db
      .select({ createdAt: contatos.createdAt })
      .from(contatos)
      .where(and(
        eq(contatos.escritorioId, escritorioId),
        ne(contatos.origem, "whatsapp"),
      ))
      .orderBy(asc(contatos.createdAt))
      .limit(1);
    return row?.createdAt ?? null;
  },
  cofre: async (db, escritorioId) => {
    const [row] = await db
      .select({ createdAt: cofreCredenciais.createdAt })
      .from(cofreCredenciais)
      .where(and(
        eq(cofreCredenciais.escritorioId, escritorioId),
        inArray(cofreCredenciais.status, ["ativa", "validando"]),
      ))
      .orderBy(asc(cofreCredenciais.createdAt))
      .limit(1);
    return row?.createdAt ?? null;
  },
  // O passo é o diálogo do CNJ ("Cole o CNJ"): só o monitor de
  // movimentações satisfaz. Monitor de novas ações por CPF é outro fluxo e
  // não prova que um processo está vigiado.
  processo: async (db, escritorioId) => {
    const [row] = await db
      .select({ createdAt: motorMonitoramentos.createdAt })
      .from(motorMonitoramentos)
      .where(and(
        eq(motorMonitoramentos.escritorioId, escritorioId),
        eq(motorMonitoramentos.tipoMonitoramento, "movimentacoes"),
        eq(motorMonitoramentos.status, "ativo"),
      ))
      .orderBy(asc(motorMonitoramentos.createdAt))
      .limit(1);
    return row?.createdAt ?? null;
  },
  // Mais de um colaborador ativo (o primeiro é o próprio dono) OU um convite
  // enviado — convite recusado/expirado ainda é convite enviado.
  equipe: async (db, escritorioId) => {
    const ativos = await db
      .select({ createdAt: colaboradores.createdAt })
      .from(colaboradores)
      .where(and(eq(colaboradores.escritorioId, escritorioId), eq(colaboradores.ativo, true)))
      .orderBy(asc(colaboradores.createdAt))
      .limit(2);
    const [convite] = await db
      .select({ createdAt: convitesColaborador.createdAt })
      .from(convitesColaborador)
      .where(eq(convitesColaborador.escritorioId, escritorioId))
      .orderBy(asc(convitesColaborador.createdAt))
      .limit(1);
    return maisAntiga(ativos.length > 1 ? ativos[1]?.createdAt : null, convite?.createdAt ?? null);
  },
};

export const ajudaRouter = router({
  primeirosPassos: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return PAYLOAD_VAZIO;

    const vinculo = await getEscritorioPorUsuario(ctx.user.id);
    if (!vinculo || vinculo.colaborador.cargo !== "dono") return PAYLOAD_VAZIO;
    const escritorioId = vinculo.escritorio.id;

    // O mesmo contrato que o menu e o ModuloGuard usam
    // (`subscription.modulosContratados`): admin e impersonação veem tudo.
    let modulosContratados: string[] | null = null;
    if (ctx.user.role !== "admin" && !ctx.user.impersonatedBy) {
      const { modulosContratadosDoUsuario } = await import("../_core/gate-modulos");
      modulosContratados = await modulosContratadosDoUsuario(ctx.user.id);
    }

    // Só consulta o que vai aparecer — passo de módulo não contratado não
    // custa query. O cadeado do passo 4 olha o 3, e os dois vivem no mesmo
    // módulo, então a detecção do pai sempre existe quando o filho existe.
    const listados = passosDoContrato(modulosContratados);
    const detectado: DeteccaoPassos = {};
    await Promise.all(
      listados.map(async (p) => {
        detectado[p.id] = await DETECTORES[p.id](db, escritorioId);
      }),
    );

    return montarPrimeirosPassos(detectado, modulosContratados);
  }),
});
