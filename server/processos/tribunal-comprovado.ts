/**
 * Tribunal candidato só entra depois de um login de verdade.
 *
 * Os 24 TRTs foram cadastrados no registro do PJe com o endereço DEDUZIDO do
 * padrão histórico do PJe-JT (`pje.trtN.jus.br/primeirograu/`). Nenhum foi
 * aberto — e o adapter só sabe entrar por SSO do PDPJ, que o PJe-JT pode nem
 * aceitar. Aceitar o processo antes disso custa duas coisas:
 *
 *  1. o monitoramento nasce vermelho e o advogado não tem o que fazer com o
 *     erro, porque o problema não é dele;
 *  2. cada tentativa de login no portal candidato falha, e a falha marcava a
 *     CREDENCIAL — que é a mesma do TJCE, onde tudo funciona.
 *
 * A prova é objetiva e já está no banco: `cofre_credencial_tribunais` grava o
 * resultado por tribunal desde 01/09. Uma linha `ativa` naquele tribunal, numa
 * credencial deste escritório, quer dizer "um login real passou aqui". A partir
 * daí o tribunal libera sozinho, sem mudar uma linha de código — que é o ponto:
 * quem decide se a Justiça do Trabalho entra é o portal, não a nossa aposta.
 */

import { TRPCError } from "@trpc/server";
import { and, eq, ne } from "drizzle-orm";
import { cofreCredenciais, cofreCredencialTribunais } from "../../drizzle/schema";
import { mensagemTribunalEmTeste, siglaDoTribunal, tribunalEmTeste } from "../../shared/tribunais-pje";
import { tribunalRequerCredencial } from "./tribunais-pdpj";
import type { getDb } from "../db";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/**
 * Este tribunal exige prova de login antes de aceitar processo?
 *
 * Só quando as duas coisas valem: o caminho é candidato (`tribunalEmTeste`) E
 * ele depende de credencial. TRT2 e TRT15 têm consulta pública aberta, e por
 * ela `tribunalRequerCredencial` é false — esses seguem funcionando sem
 * credencial nenhuma, como já funcionavam.
 */
export function tribunalPrecisaDeProva(codigoTribunal: string): boolean {
  return tribunalEmTeste(codigoTribunal) && tribunalRequerCredencial(codigoTribunal);
}

/**
 * Algum login real já passou neste tribunal, com credencial deste escritório?
 *
 * Qualquer grau serve: quem consegue entrar no 1º grau provou que o portal
 * aceita o SSO, que é o que estava em dúvida. Credencial removida não conta —
 * o dono mandou apagar, e a prova morre com ela.
 */
export async function escritorioProvouTribunal(
  db: Db,
  escritorioId: number,
  codigoTribunal: string,
): Promise<boolean> {
  const [linha] = await db
    .select({ id: cofreCredencialTribunais.id })
    .from(cofreCredencialTribunais)
    .innerJoin(cofreCredenciais, eq(cofreCredenciais.id, cofreCredencialTribunais.credencialId))
    .where(
      and(
        eq(cofreCredencialTribunais.tribunal, codigoTribunal),
        eq(cofreCredencialTribunais.status, "ativa"),
        eq(cofreCredenciais.escritorioId, escritorioId),
        ne(cofreCredenciais.status, "removida"),
      ),
    )
    .limit(1);
  return !!linha;
}

/**
 * Todos os tribunais em que alguma credencial deste escritório já logou.
 *
 * Uma consulta pra um lote inteiro: a importação de planilha decide linha por
 * linha se ativa o monitor, e perguntar ao banco por linha transformaria uma
 * planilha de 500 processos em 500 consultas.
 */
export async function tribunaisProvadosDoEscritorio(
  db: Db,
  escritorioId: number,
): Promise<Set<string>> {
  const linhas = await db
    .select({ tribunal: cofreCredencialTribunais.tribunal })
    .from(cofreCredencialTribunais)
    .innerJoin(cofreCredenciais, eq(cofreCredenciais.id, cofreCredencialTribunais.credencialId))
    .where(
      and(
        eq(cofreCredencialTribunais.status, "ativa"),
        eq(cofreCredenciais.escritorioId, escritorioId),
        ne(cofreCredenciais.status, "removida"),
      ),
    );
  return new Set(linhas.map((l: { tribunal: string }) => l.tribunal));
}

/**
 * Barra o tribunal candidato sem prova. Tribunal comprovado (ou que nem precisa
 * de prova) passa sem consultar o banco — é o caminho de todo dia.
 */
export async function exigirTribunalComprovado(
  db: Db,
  escritorioId: number,
  codigoTribunal: string,
): Promise<void> {
  if (!tribunalPrecisaDeProva(codigoTribunal)) return;
  if (await escritorioProvouTribunal(db, escritorioId, codigoTribunal)) return;
  throw new TRPCError({
    code: "PRECONDITION_FAILED",
    message: mensagemTribunalEmTeste(siglaDoTribunal(codigoTribunal)),
    cause: { motivo: "tribunal_em_teste", tribunal: codigoTribunal },
  });
}
