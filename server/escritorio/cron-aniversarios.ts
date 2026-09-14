/**
 * O lembrete de aniversário.
 *
 * Roda de hora em hora e só faz alguma coisa no escritório onde já passou da
 * HORA combinada no fuso dele — o mesmo desenho do resumo de movimentações.
 * Um cron fixo em UTC mandaria o aviso às 5h da manhã pra metade do país.
 *
 * Quatro decisões que carregam o resto:
 *
 * 1. **Um aviso por dia, por pessoa, com todos os aniversariantes dentro.**
 *    Cinco aniversários não podem virar cinco toques: é assim que a pessoa
 *    desliga o aviso inteiro e perde junto o que importava.
 * 2. **Quem guarda "já mandei hoje" é o BANCO, não a memória do processo.**
 *    Um redeploy às 8h zeraria a memória e o aviso sairia duas vezes. O
 *    registro no sino sobrevive ao restart, e é ele que responde.
 * 3. **`>=` a hora, não `===`.** Se o processo estiver reiniciando exatamente
 *    às 8h, a janela passa e ninguém é lembrado naquele dia. Com `>=` o
 *    primeiro ciclo depois disso entrega, e a dedup do banco garante que
 *    entregue uma vez só.
 * 4. **Quem recebe é o responsável pelo cadastro**, e o dono também quando
 *    ligou "quero receber também o que é dos meus colaboradores" — a mesma
 *    régua da movimentação de processo. Ficha sem responsável vai pro dono de
 *    qualquer jeito: senão o aniversário não alcançaria ninguém.
 *
 * Cliente com serviço encerrado, cancelado ou rescindido fica de fora.
 * Parabenizar quem rescindiu é pior do que não parabenizar.
 */

import { and, eq, gte, inArray, isNotNull, like, ne, or } from "drizzle-orm";
import { getDb } from "../db";
import { contatos, colaboradores, escritorios, notificacoes } from "../../drizzle/schema";
import { dataHojeBR, inicioDoDiaNoFuso, FUSO_HORARIO_PADRAO } from "../../shared/escritorio-types";
import {
  PREFIXO_TITULO_ANIVERSARIO,
  proximoAniversario,
  resumoDoDia,
} from "../../shared/aniversario";
import { emitirNotificacao } from "../_core/sse-notifications";
import { donoQueQuerTudo, horaLocalEm } from "../_core/preferencias-notificacao";
import { createLogger } from "../_core/logger";

const log = createLogger("cron-aniversarios");

/** A hora, no fuso do escritório, a partir da qual o lembrete pode sair. */
export const HORA_DO_LEMBRETE = 8;

/** Situações de serviço que tiram a ficha do lembrete. */
const FORA_DO_LEMBRETE = ["encerrado", "cancelado", "rescindido"] as const;

/**
 * Junta nomes num destinatário sem sobrescrever o que ele já tinha.
 *
 * O dono costuma ser responsável por parte da carteira E ter o alcance do
 * escritório ligado: escrever por cima deixaria de fora justamente os
 * clientes dele.
 */
function somarNomes(destinos: Map<number, string[]>, userId: number, nomes: string[]): void {
  destinos.set(userId, [...(destinos.get(userId) ?? []), ...nomes]);
}

/** Já existe o lembrete de hoje pra esta pessoa? A pergunta é feita ao banco. */
async function jaAvisadoHoje(db: any, userId: number, comecoDoDia: Date): Promise<boolean> {
  const [linha] = await db
    .select({ id: notificacoes.id })
    .from(notificacoes)
    .where(
      and(
        eq(notificacoes.userId, userId),
        gte(notificacoes.createdAt, comecoDoDia),
        like(notificacoes.titulo, `${PREFIXO_TITULO_ANIVERSARIO}%`),
      ),
    )
    .limit(1);
  return !!linha;
}

export async function rodarLembretesDeAniversario(agora: Date = new Date()): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const escs = await db
    .select({ id: escritorios.id, fuso: escritorios.fusoHorario })
    .from(escritorios);

  for (const esc of escs) {
    const fuso = esc.fuso || FUSO_HORARIO_PADRAO;
    if (horaLocalEm(fuso, agora) < HORA_DO_LEMBRETE) continue;

    const hoje = dataHojeBR(fuso, agora);
    const comecoDoDia = inicioDoDiaNoFuso(hoje, fuso);

    try {
      const fichas = await db
        .select({
          id: contatos.id,
          nome: contatos.nome,
          nascimento: contatos.dataNascimento,
          responsavelId: contatos.responsavelId,
        })
        .from(contatos)
        .where(
          and(
            eq(contatos.escritorioId, esc.id),
            isNotNull(contatos.dataNascimento),
            ...FORA_DO_LEMBRETE.map((s) => ne(contatos.situacaoServico, s)),
          ),
        );

      const doDia = fichas.filter(
        (f) => proximoAniversario((f.nascimento ?? "").slice(0, 10), hoje)?.ehHoje === true,
      );
      if (doDia.length === 0) continue;

      // Por destinatário: o responsável de cada ficha recebe a lista DELE.
      const porResponsavel = new Map<number, string[]>();
      const semResponsavel: string[] = [];
      for (const f of doDia) {
        if (f.responsavelId) {
          porResponsavel.set(f.responsavelId, [...(porResponsavel.get(f.responsavelId) ?? []), f.nome]);
        } else {
          semResponsavel.push(f.nome);
        }
      }

      // colaboradores.id → users.id: a notificação é de PESSOA, não de vínculo.
      const ids = [...porResponsavel.keys()];
      const vinculos = ids.length
        ? await db
            .select({ id: colaboradores.id, userId: colaboradores.userId })
            .from(colaboradores)
            .where(and(eq(colaboradores.escritorioId, esc.id), inArray(colaboradores.id, ids)))
        : [];
      const userDoColaborador = new Map(vinculos.map((v) => [v.id, v.userId]));

      const destinos = new Map<number, string[]>();
      for (const [colabId, nomes] of porResponsavel) {
        const userId = userDoColaborador.get(colabId);
        if (userId) somarNomes(destinos, userId, nomes);
      }

      const donoAlcance = await donoQueQuerTudo(esc.id, null);
      if (donoAlcance) {
        somarNomes(destinos, donoAlcance, doDia.map((f) => f.nome));
      } else if (semResponsavel.length > 0) {
        const [dono] = await db
          .select({ userId: colaboradores.userId })
          .from(colaboradores)
          .where(
            and(
              eq(colaboradores.escritorioId, esc.id),
              eq(colaboradores.cargo, "dono"),
              eq(colaboradores.ativo, true),
            ),
          )
          .limit(1);
        if (dono?.userId) somarNomes(destinos, dono.userId, semResponsavel);
      }

      for (const [userId, nomes] of destinos) {
        if (await jaAvisadoHoje(db, userId, comecoDoDia)) continue;
        const texto = resumoDoDia([...new Set(nomes)]);
        if (!texto) continue;

        // O registro no sino vem PRIMEIRO: é ele que responde "já mandei hoje"
        // na próxima volta. Se falhar, não emite — melhor não avisar do que
        // avisar de hora em hora.
        try {
          await db.insert(notificacoes).values({
            userId,
            titulo: texto.titulo,
            mensagem: texto.mensagem,
            tipo: "sistema",
          });
        } catch (err) {
          log.warn({ userId, err: (err as Error).message }, "[aniversarios] não gravou o aviso");
          continue;
        }

        emitirNotificacao(userId, {
          tipo: "aniversario_cliente",
          titulo: texto.titulo,
          mensagem: texto.mensagem,
          dados: { quantidade: new Set(nomes).size },
        });
      }
    } catch (err) {
      log.warn({ escritorioId: esc.id, err: (err as Error).message }, "[aniversarios] falhou");
    }
  }
}
