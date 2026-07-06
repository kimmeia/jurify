/**
 * Dossiê do cliente pro Agente Jurídico: reúne os DADOS REAIS cadastrados
 * (qualificação do contato + processo + anotações) que alimentam a redação da
 * peça, pra ela deixar de ser genérica.
 *
 * As funções de formatação são puras (testáveis); `montarDossie` faz o acesso
 * ao banco. A leitura do TEXTO dos documentos (Vision) é etapa separada — aqui
 * só listamos os arquivos disponíveis.
 */
import { contatos, clienteProcessos, clienteProcessoAnotacoes, clienteArquivos } from "../../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";

const ESTADO_CIVIL: Record<string, string> = {
  solteiro: "solteiro(a)",
  casado: "casado(a)",
  divorciado: "divorciado(a)",
  viuvo: "viúvo(a)",
  uniao_estavel: "em união estável",
};

export interface ContatoDossie {
  nome: string;
  cpfCnpj?: string | null;
  nacionalidade?: string | null;
  estadoCivil?: string | null;
  profissao?: string | null;
  cep?: string | null;
  logradouro?: string | null;
  numeroEndereco?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  uf?: string | null;
}

export interface ProcessoDossie {
  numeroCnj?: string | null;
  apelido?: string | null;
  tribunal?: string | null;
  classe?: string | null;
  valorCausa?: number | null;
  polo?: string | null;
}

function montarEndereco(c: ContatoDossie): string | null {
  const linha = [c.logradouro, c.numeroEndereco, c.complemento].filter(Boolean).join(", ");
  const cidadeUf = [c.cidade, c.uf].filter(Boolean).join("/");
  const cep = c.cep ? `CEP ${c.cep}` : "";
  const full = [linha, c.bairro, cidadeUf, cep].filter(Boolean).join(" - ");
  return full || null;
}

/**
 * Bloco rotulado com a qualificação do autor (dados reais). O prompt instrui a
 * IA a compor a frase de qualificação a partir daqui — mais confiável do que
 * montar a frase na mão (gênero, concordância).
 */
export function montarQualificacao(c: ContatoDossie): string {
  const linhas: string[] = [`Nome: ${c.nome}`];
  if (c.nacionalidade) linhas.push(`Nacionalidade: ${c.nacionalidade}`);
  if (c.estadoCivil) linhas.push(`Estado civil: ${ESTADO_CIVIL[c.estadoCivil] || c.estadoCivil}`);
  if (c.profissao) linhas.push(`Profissão: ${c.profissao}`);
  if (c.cpfCnpj) linhas.push(`CPF/CNPJ: ${c.cpfCnpj}`);
  const end = montarEndereco(c);
  if (end) linhas.push(`Endereço: ${end}`);
  return linhas.join("\n");
}

/** Bloco rotulado do processo. valorCausa é tratado como reais (dado cadastral). */
export function montarResumoProcesso(p: ProcessoDossie): string {
  const linhas: string[] = [];
  if (p.apelido) linhas.push(`Referência: ${p.apelido}`);
  if (p.numeroCnj) linhas.push(`Número CNJ: ${p.numeroCnj}`);
  if (p.classe) linhas.push(`Classe/assunto: ${p.classe}`);
  if (p.tribunal) linhas.push(`Tribunal: ${p.tribunal}`);
  if (p.valorCausa != null) {
    linhas.push(`Valor da causa: R$ ${Number(p.valorCausa).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`);
  }
  if (p.polo) linhas.push(`Polo do cliente: ${p.polo}`);
  return linhas.join("\n");
}

export interface DocumentoDossie {
  id: number;
  nome: string;
  tipo: string | null;
  url: string;
}

export interface Dossie {
  qualificacao?: string;
  processo?: string;
  /** Anotações do processo, como contexto factual adicional. */
  fatosContexto?: string;
  /** Arquivos do cliente — pra seleção/leitura (texto vem na etapa Vision). */
  documentos: DocumentoDossie[];
}

/**
 * Monta o dossiê a partir do banco: qualificação do contato, processo escolhido
 * (ou o primeiro do cliente), anotações do processo e a lista de documentos.
 * Sempre filtra por escritório (isolamento).
 */
export async function montarDossie(
  db: any,
  escritorioId: number,
  contatoId: number,
  processoId?: number,
): Promise<Dossie> {
  const [c] = await db
    .select({
      nome: contatos.nome,
      cpfCnpj: contatos.cpfCnpj,
      nacionalidade: contatos.nacionalidade,
      estadoCivil: contatos.estadoCivil,
      profissao: contatos.profissao,
      cep: contatos.cep,
      logradouro: contatos.logradouro,
      numeroEndereco: contatos.numeroEndereco,
      complemento: contatos.complemento,
      bairro: contatos.bairro,
      cidade: contatos.cidade,
      uf: contatos.uf,
    })
    .from(contatos)
    .where(and(eq(contatos.id, contatoId), eq(contatos.escritorioId, escritorioId)))
    .limit(1);
  if (!c) return { documentos: [] };

  const dossie: Dossie = { qualificacao: montarQualificacao(c), documentos: [] };

  // Processo: o escolhido ou o primeiro do cliente.
  const procs = await db
    .select({
      id: clienteProcessos.id,
      numeroCnj: clienteProcessos.numeroCnj,
      apelido: clienteProcessos.apelido,
      tribunal: clienteProcessos.tribunal,
      classe: clienteProcessos.classe,
      valorCausa: clienteProcessos.valorCausa,
      polo: clienteProcessos.polo,
    })
    .from(clienteProcessos)
    .where(and(eq(clienteProcessos.contatoId, contatoId), eq(clienteProcessos.escritorioId, escritorioId)));
  const proc = processoId ? procs.find((p: any) => p.id === processoId) : procs[0];
  if (proc) {
    dossie.processo = montarResumoProcesso(proc);
    const anots = await db
      .select({ conteudo: clienteProcessoAnotacoes.conteudo })
      .from(clienteProcessoAnotacoes)
      .where(eq(clienteProcessoAnotacoes.processoId, proc.id))
      .orderBy(desc(clienteProcessoAnotacoes.createdAt))
      .limit(10);
    if (anots.length) {
      dossie.fatosContexto = "Anotações do processo:\n" + anots.map((a: any) => `- ${a.conteudo}`).join("\n");
    }
  }

  const docs = await db
    .select({ id: clienteArquivos.id, nome: clienteArquivos.nome, tipo: clienteArquivos.tipo, url: clienteArquivos.url })
    .from(clienteArquivos)
    .where(and(eq(clienteArquivos.contatoId, contatoId), eq(clienteArquivos.escritorioId, escritorioId)));
  dossie.documentos = docs;

  return dossie;
}
