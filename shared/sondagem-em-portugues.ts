/**
 * A sondagem dita em português.
 *
 * Por que existe: a sondagem nasceu como ferramenta minha e a tela mostrava o
 * que eu precisava ler — `403`, `tls`, `dns`, `responde-json`, "é o IP". O dono
 * olhou o resultado e respondeu "entendi nada, sinceramente". Ele estava certo:
 * quem decide se a base de conhecimento vai encher não precisa saber o que é
 * certificado nem faixa de IP, precisa saber três coisas — essa fonte traz o
 * texto da decisão, dá pra ligar agora, e quando não dá, de quem é o conserto.
 *
 * O número técnico não foi tirado da tela; desceu pro detalhe da linha. Aqui
 * mora a tradução, PURA, para o mesmo texto valer na tela, no aviso e em
 * qualquer relatório que venha depois — e para o teste poder travar a frase.
 */

/** O subconjunto do resultado da sondagem que a tradução precisa ler. */
export interface SondaParaLer {
  status: number | null;
  veredito: string;
  /** Achou texto de decisão no corpo? null = nem deu pra olhar. */
  temEmenta: boolean | null;
  /** Quantos enunciados de súmula o corpo entregou. Ausente = sondagem antiga. */
  sumulasNoCorpo?: number | null;
  /** Por que falhou sem responder: dns · tcp · tls · timeout · outra. */
  causa: string | null;
  /** A repetição do 403 com identificação de navegador passou? */
  retryNavegador: "passou" | "persistiu" | null;
}

/**
 * O tom decide a cor e a ordem da lista.
 *
 * `conserto` e `fechado` existem separados de propósito: os dois são "não
 * funciona hoje", mas um depende de mim e o outro depende de sair por outra
 * porta. Juntar os dois numa cor só foi o que fez a tela velha parecer que
 * todos os tribunais tinham fechado a porta.
 */
export type TomDoRecado = "funciona" | "quase" | "conserto" | "fechado";

export interface RecadoDaSonda {
  tom: TomDoRecado;
  /** O que aconteceu, sem jargão. */
  frase: string;
  /** O que fazer com isso. Vazio quando não há nada a fazer. */
  acao: string;
}

export function recadoDaSonda(r: SondaParaLer): RecadoDaSonda {
  // Recusa explícita vem antes de tudo: o corpo de uma página de recusa às
  // vezes tem a palavra "ementa" no rodapé e passaria por fonte que serve.
  if (r.veredito === "bloqueado" || (r.status !== null && r.status >= 400)) {
    if (r.status === 404) {
      return {
        tom: "conserto",
        frase: "O endereço não existe mais nesse tribunal — a página mudou de lugar.",
        acao: "Conserto na nossa lista de endereços. É do nosso lado.",
      };
    }
    if (r.retryNavegador === "passou") {
      return {
        tom: "conserto",
        frase: "O tribunal recusou só porque o robô se apresentou como robô.",
        acao: "Conserto de uma linha no nosso lado — a página em si está aberta.",
      };
    }
    if (r.retryNavegador === "persistiu") {
      return {
        tom: "fechado",
        frase: "O tribunal barrou o nosso servidor, não o nosso pedido.",
        acao: "Só passa saindo por outra porta de internet. Nada que se conserte no código.",
      };
    }
    return {
      tom: "fechado",
      frase: `O tribunal recusou o acesso${r.status ? ` (código ${r.status})` : ""}.`,
      acao: "Precisa descobrir se é o nosso servidor ou o endereço.",
    };
  }

  if (r.veredito === "erro") {
    if (r.causa === "dns") {
      return {
        tom: "conserto",
        frase: "Esse endereço não existe — provavelmente escrevi errado ou o tribunal mudou o site.",
        acao: "Conserto na nossa lista. É do nosso lado.",
      };
    }
    if (r.causa === "tls") {
      return {
        tom: "conserto",
        frase: "A conversa travou no certificado de segurança do site do tribunal.",
        acao: "Quase sempre é o nosso servidor que não conhece o certificado — conserto do nosso lado.",
      };
    }
    if (r.causa === "timeout") {
      return {
        tom: "fechado",
        frase: "O site demorou demais e a gente desistiu de esperar.",
        acao: "Tentar de novo mais tarde; se repetir, é firewall calado do outro lado.",
      };
    }
    return {
      tom: "fechado",
      frase: "Não deu nem pra conectar no site.",
      acao: "Tentar de novo; se repetir, o caminho até esse tribunal está fechado daqui.",
    };
  }

  if (r.veredito === "vazio") {
    return {
      tom: "quase",
      frase: "O site abriu e não mandou nada.",
      acao: "O endereço responde, mas essa não é a página da busca.",
    };
  }

  // Respondeu. A única pergunta que sobra é a que decide o produto.
  //
  // Súmula vem antes de ementa porque é o material mais forte e o mais barato
  // de manter: o número é a prova, o enunciado é curto, e o conjunto é
  // fechado. Contar quantas vieram também é mais honesto do que "sim/não".
  const sumulas = r.sumulasNoCorpo ?? 0;
  if (sumulas > 0) {
    return {
      tom: "funciona",
      frase:
        sumulas === 1
          ? "Responde e traz 1 enunciado de súmula nesta página."
          : `Responde e traz ${sumulas} enunciados de súmula nesta página.`,
      acao: "Pode ligar: súmula é a citação mais segura, e essa lista entra inteira.",
    };
  }
  if (r.temEmenta === true) {
    return {
      tom: "funciona",
      frase: "Responde e traz o texto da decisão — é o que se cita na petição.",
      acao: "Pode ligar a coleta automática desta fonte.",
    };
  }
  return {
    tom: "quase",
    frase: "Responde, mas nessa página não vem o texto da decisão — só o número do processo.",
    acao: "Serve de estatística, não de citação. Falta achar a página do inteiro teor.",
  };
}

/** Ordem de leitura: o que serve primeiro, o que não tem jeito no fim. */
export const ORDEM_DO_TOM: Record<TomDoRecado, number> = {
  funciona: 0,
  conserto: 1,
  quase: 2,
  fechado: 3,
};

/**
 * O resumo que o dono lê antes da tabela.
 *
 * Uma frase por grupo, e só dos grupos que existem — "0 fontes fechadas" é
 * ruído que empurra o que importa para baixo.
 */
export function resumoDaSondagem(rs: SondaParaLer[]): string[] {
  const conta = { funciona: 0, quase: 0, conserto: 0, fechado: 0 };
  for (const r of rs) conta[recadoDaSonda(r).tom]++;

  const frases: string[] = [];
  if (conta.funciona > 0) {
    frases.push(
      conta.funciona === 1
        ? "1 fonte já traz o texto da decisão e pode ser ligada agora."
        : `${conta.funciona} fontes já trazem o texto da decisão e podem ser ligadas agora.`,
    );
  }
  if (conta.conserto > 0) {
    frases.push(
      conta.conserto === 1
        ? "1 depende de conserto do nosso lado (endereço ou certificado)."
        : `${conta.conserto} dependem de conserto do nosso lado (endereço ou certificado).`,
    );
  }
  if (conta.quase > 0) {
    frases.push(
      conta.quase === 1
        ? "1 responde, mas sem o texto da decisão nessa página."
        : `${conta.quase} respondem, mas sem o texto da decisão nessa página.`,
    );
  }
  if (conta.fechado > 0) {
    frases.push(
      conta.fechado === 1
        ? "1 barrou o nosso servidor — só passa saindo por outra porta."
        : `${conta.fechado} barraram o nosso servidor — só passam saindo por outra porta.`,
    );
  }
  return frases;
}
