/**
 * Mesclar dois cadastros: o que fica em cada campo.
 *
 * A regra silenciosa de sempre é "o que sobrevive vence, e o outro só preenche
 * buraco vazio" — quem mesclava não via o que estava perdendo. Aqui as duas
 * fichas viram LINHAS, e cada linha diz se há escolha a fazer, se o valor entra
 * sozinho (só um lado tem) ou se os dois cabem juntos.
 *
 * O padrão de cada escolha é exatamente o que o sistema faria sozinho: quem não
 * mexer em nada termina com o resultado de antes, com a diferença de ter visto.
 */

export type LadoMesclagem = "principal" | "duplicado";

/** Campos onde só um valor sobrevive — por isso podem virar escolha. */
export const CAMPOS_ESCOLHIVEIS = ["nome", "email", "cpfCnpj", "observacoes", "responsavelId"] as const;
export type CampoEscolhivel = (typeof CAMPOS_ESCOLHIVEIS)[number];

/** Campos onde os dois lados cabem juntos — não há o que escolher. */
export const CAMPOS_QUE_SOMAM = ["telefone", "tags"] as const;
export type CampoQueSoma = (typeof CAMPOS_QUE_SOMAM)[number];

export const ROTULO_CAMPO: Record<CampoEscolhivel | CampoQueSoma, string> = {
  nome: "Nome",
  email: "E-mail",
  cpfCnpj: "CPF/CNPJ",
  observacoes: "Observações",
  responsavelId: "Responsável",
  telefone: "Telefone",
  tags: "Tags",
};

/**
 * O responsável não é só cadastro: o mesmo campo decide quem enxerga o
 * cliente, o padrão de comissão das cobranças que nascerem e se a próxima
 * conversa pula o rodízio. A tela precisa dizer isso ao lado da linha.
 */
export const AVISO_RESPONSAVEL =
  "Trocar o responsável muda quem enxerga o cliente, o padrão de comissão das cobranças que nascerem e o rodízio da próxima conversa.";

export type FichaMesclagem = {
  id: number;
  nome: string;
  telefone: string | null;
  telefonesSecundarios: string | null;
  email: string | null;
  cpfCnpj: string | null;
  observacoes: string | null;
  tags: string | null;
  responsavelId: number | null;
  responsavelNome: string | null;
};

export type LinhaMesclagem = {
  campo: CampoEscolhivel | CampoQueSoma;
  /** escolha = os dois lados têm valor e discordam; um_lado = só um tem; somam = cabem juntos. */
  tipo: "escolha" | "um_lado" | "somam";
  /** Como o valor aparece na tela, de cada lado. */
  principal: string | null;
  duplicado: string | null;
  /** Só em `escolha` e `um_lado`: o lado que fica se ninguém mexer. */
  padrao: LadoMesclagem;
};

function texto(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  return s.length > 0 ? s : null;
}

function digitos(v: string | null | undefined): string {
  return (v ?? "").replace(/\D/g, "");
}

/** Dois valores do mesmo campo são "o mesmo"? CPF ignora máscara. */
function mesmoValor(campo: CampoEscolhivel, a: string | null, b: string | null): boolean {
  if (campo === "cpfCnpj") return digitos(a) === digitos(b);
  return (a ?? "") === (b ?? "");
}

function valorDoCampo(f: FichaMesclagem, campo: CampoEscolhivel): string | null {
  if (campo === "responsavelId") {
    if (f.responsavelId == null) return null;
    return texto(f.responsavelNome) ?? `#${f.responsavelId}`;
  }
  return texto(f[campo] as string | null);
}

/**
 * As linhas que a tela mostra, na ordem em que ela mostra. Campo vazio dos dois
 * lados não vira linha (não há nada a decidir nem a conferir), e campo igual
 * dos dois lados também não — só polui.
 */
export function linhasDaMesclagem(principal: FichaMesclagem, duplicado: FichaMesclagem): LinhaMesclagem[] {
  const linhas: LinhaMesclagem[] = [];

  for (const campo of CAMPOS_ESCOLHIVEIS) {
    const vp = valorDoCampo(principal, campo);
    const vd = valorDoCampo(duplicado, campo);
    if (vp === null && vd === null) continue;
    if (vp !== null && vd !== null) {
      if (mesmoValor(campo, vp, vd)) continue;
      // Os dois preenchidos e diferentes: alguém tem que ficar de fora.
      // O padrão é o de hoje — a ficha que sobrevive vence.
      linhas.push({ campo, tipo: "escolha", principal: vp, duplicado: vd, padrao: "principal" });
      continue;
    }
    // Só um lado tem valor. E-mail, CPF e observações preenchem buraco vazio
    // desde sempre; nome e responsável NUNCA foram copiados. O padrão respeita
    // isso, então quem não mexer continua tendo o resultado de antes.
    const soODuplicadoTem = vp === null;
    const preencheBuracoHoje = campo !== "nome" && campo !== "responsavelId";
    linhas.push({
      campo,
      tipo: "um_lado",
      principal: vp,
      duplicado: vd,
      padrao: soODuplicadoTem && preencheBuracoHoje ? "duplicado" : "principal",
    });
  }

  const telefones = [principal.telefone, duplicado.telefone].map(texto).filter((t): t is string => !!t);
  if (telefones.length > 0) {
    linhas.push({
      campo: "telefone",
      tipo: "somam",
      principal: texto(principal.telefone),
      duplicado: texto(duplicado.telefone),
      padrao: "principal",
    });
  }

  if (texto(principal.tags) || texto(duplicado.tags)) {
    linhas.push({
      campo: "tags",
      tipo: "somam",
      principal: texto(principal.tags),
      duplicado: texto(duplicado.tags),
      padrao: "principal",
    });
  }

  return linhas;
}

export type EscolhasMesclagem = Partial<Record<CampoEscolhivel, LadoMesclagem>>;

/** O que a tela já vem marcando — o resultado de sempre, escrito. */
export function escolhasPadrao(linhas: LinhaMesclagem[]): EscolhasMesclagem {
  const out: EscolhasMesclagem = {};
  for (const l of linhas) {
    if (l.tipo === "somam") continue;
    out[l.campo as CampoEscolhivel] = l.padrao;
  }
  return out;
}

/** Quantas linhas pedem decisão de verdade (as duas fichas discordam). */
export function quantasEscolhas(linhas: LinhaMesclagem[]): number {
  return linhas.filter((l) => l.tipo === "escolha").length;
}

/**
 * As escolhas que DIFEREM do padrão. É o que o servidor precisa aplicar depois
 * da mesclagem de sempre: mandar o pacote inteiro faria a procedure reescrever
 * campo que ninguém encostou.
 */
export function escolhasQueMudam(linhas: LinhaMesclagem[], escolhas: EscolhasMesclagem): EscolhasMesclagem {
  const out: EscolhasMesclagem = {};
  for (const l of linhas) {
    if (l.tipo === "somam") continue;
    const campo = l.campo as CampoEscolhivel;
    const lado = escolhas[campo];
    if (lado && lado !== l.padrao) out[campo] = lado;
  }
  return out;
}
