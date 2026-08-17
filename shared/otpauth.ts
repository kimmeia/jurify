/**
 * Leitura do `otpauth://` que vem dentro do QR de 2FA.
 *
 * O QR que o tribunal desenha na tela é só um texto: `otpauth://totp/...`,
 * com o segredo e os parâmetros de geração do código. Ler a imagem é
 * trabalho do navegador; interpretar o texto é aqui, separado, porque é a
 * parte que decide se o que foi lido serve — e é a parte que dá pra testar
 * sem imagem nenhuma.
 *
 * O cuidado que justifica o arquivo existir: o QR pode declarar algoritmo,
 * número de dígitos ou período diferentes do padrão. Nosso cofre guarda só o
 * segredo, e a geração do código é fixa em SHA-1/6 dígitos/30s. Aceitar um
 * QR fora desse padrão gravaria um segredo que nunca vai gerar o código
 * certo — e o sintoma seria "código inválido" pra sempre, sem nada na tela
 * explicando por quê.
 */

import { lerMigracao } from "./otpauth-migration";

/** Padrões do TOTP, e o que a geração do cofre assume. */
export const TOTP_PADRAO = { algoritmo: "SHA1", digitos: 6, periodo: 30 } as const;

export interface QrTotp {
  /** Base32 limpo, em maiúsculas. */
  secret: string;
  /** Quem emitiu — "PJe", "sso.cloud.pje.jus.br". Serve pra conferência. */
  emissor: string | null;
  /** A conta dentro do emissor. Idem. */
  conta: string | null;
}

export type MotivoRecusa =
  | "nao_e_otpauth"
  | "nao_e_totp"
  | "sem_secret"
  | "secret_invalido"
  | "fora_do_padrao"
  | "exportacao_vazia";

export type LeituraQr =
  | {
      ok: true;
      dados: QrTotp;
      /**
       * Outras contas achadas no MESMO QR. O de exportação do autenticador
       * traz o cofre inteiro da pessoa, e escolher por ela gravaria o 2FA de
       * um serviço no login de outro.
       */
      outras?: QrTotp[];
    }
  | { ok: false; motivo: MotivoRecusa; detalhe: string };

const BASE32 = /^[A-Z2-7]+=*$/;

function limparSecret(bruto: string): string {
  return bruto.replace(/\s+/g, "").toUpperCase();
}

/** O rótulo é `Emissor:conta` ou só `conta`, e vem percent-encoded. */
function separarRotulo(rotulo: string): { emissor: string | null; conta: string | null } {
  let texto = rotulo;
  try {
    texto = decodeURIComponent(rotulo);
  } catch {
    /* rótulo com % solto — usa como veio */
  }
  texto = texto.trim();
  if (!texto) return { emissor: null, conta: null };
  const i = texto.indexOf(":");
  if (i < 0) return { emissor: null, conta: texto };
  return {
    emissor: texto.slice(0, i).trim() || null,
    conta: texto.slice(i + 1).trim() || null,
  };
}

/**
 * Interpreta o conteúdo de um QR de 2FA.
 *
 * Devolve o motivo da recusa em vez de `null` porque a tela precisa dizer o
 * que houve: "esse QR não é de 2FA" e "esse QR é de um formato que não
 * suportamos" mandam a pessoa fazer coisas diferentes.
 */
export function lerOtpauth(texto: string): LeituraQr {
  const cru = (texto ?? "").trim();

  // Parse na mão, e não com `new URL`: esquema fora do conjunto conhecido
  // (http, ws, file…) tem tratamento diferente entre motores, e o rótulo
  // costuma trazer `:` e espaço codificados — terreno onde essas diferenças
  // aparecem.
  // Exportação do app autenticador. É o QR que a pessoa TEM à mão: o portal
  // só mostra o dele no momento de configurar, então depois disso o caminho
  // natural é abrir o autenticador e exportar.
  const exportadas = lerMigracao(cru);
  if (exportadas) {
    const uteis = exportadas.filter((c) => c.compativel);
    if (uteis.length === 0) {
      const incompativel = exportadas.find((c) => !c.compativel);
      return {
        ok: false,
        motivo: incompativel ? "fora_do_padrao" : "exportacao_vazia",
        detalhe: incompativel
          ? `A conta nesse QR usa ${incompativel.motivoIncompativel}, fora do padrão que o cofre gera.`
          : "Esse QR de exportação não trouxe nenhuma conta de código por tempo.",
      };
    }
    const [primeira, ...resto] = uteis;
    return {
      ok: true,
      dados: { secret: primeira!.secret, emissor: primeira!.emissor, conta: primeira!.conta },
      outras: resto.map((c) => ({ secret: c.secret, emissor: c.emissor, conta: c.conta })),
    };
  }

  const m = /^otpauth:\/\/([a-z]+)\/([^?]*)(?:\?(.*))?$/i.exec(cru);
  if (!m) {
    // O começo do que foi lido vai junto: sem isso, "não é de 2FA" manda a
    // pessoa adivinhar qual dos QRs da tela ela pegou. Só o começo — o
    // conteúdo pode ser o próprio segredo.
    const amostra = cru.slice(0, 40).replace(/\s+/g, " ");
    return {
      ok: false,
      motivo: "nao_e_otpauth",
      detalhe: amostra
        ? `O QR lido não é de verificação em duas etapas. Ele começa com "${amostra}${cru.length > 40 ? "…" : ""}".`
        : "O QR lido veio vazio.",
    };
  }

  const tipo = (m[1] ?? "").toLowerCase();
  if (tipo !== "totp") {
    return {
      ok: false,
      motivo: "nao_e_totp",
      // HOTP existe e usa contador em vez de relógio: o cofre não gera esse.
      detalhe: `Esse QR é do tipo "${tipo}", e o cofre só trabalha com o de código por tempo (TOTP).`,
    };
  }

  const params = new URLSearchParams(m[3] ?? "");
  const secretBruto = params.get("secret");
  if (!secretBruto) {
    return { ok: false, motivo: "sem_secret", detalhe: "O QR não trouxe o código de 2FA." };
  }

  const secret = limparSecret(secretBruto);
  if (secret.length < 16 || !BASE32.test(secret)) {
    return {
      ok: false,
      motivo: "secret_invalido",
      detalhe: "O código dentro do QR não tem o formato esperado.",
    };
  }

  const algoritmo = (params.get("algorithm") ?? TOTP_PADRAO.algoritmo).toUpperCase().replace("-", "");
  const digitos = Number(params.get("digits") ?? TOTP_PADRAO.digitos);
  const periodo = Number(params.get("period") ?? TOTP_PADRAO.periodo);

  const foraDoPadrao: string[] = [];
  if (algoritmo !== TOTP_PADRAO.algoritmo) foraDoPadrao.push(`algoritmo ${algoritmo}`);
  if (digitos !== TOTP_PADRAO.digitos) foraDoPadrao.push(`${digitos} dígitos`);
  if (periodo !== TOTP_PADRAO.periodo) foraDoPadrao.push(`período de ${periodo}s`);

  if (foraDoPadrao.length > 0) {
    // Recusa em vez de guardar: o cofre não tem onde anotar esses parâmetros,
    // e o código gerado sairia errado toda vez. Falhar aqui, com o motivo na
    // tela, é melhor que um "código inválido" eterno no login.
    return {
      ok: false,
      motivo: "fora_do_padrao",
      detalhe: `Esse QR usa ${foraDoPadrao.join(", ")}, fora do padrão que o cofre gera.`,
    };
  }

  const { emissor, conta } = separarRotulo(m[2] ?? "");
  return {
    ok: true,
    dados: { secret, emissor: params.get("issuer")?.trim() || emissor, conta },
  };
}
