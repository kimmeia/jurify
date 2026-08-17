/**
 * O QR de exportação do Google Authenticator (`otpauth-migration://`).
 *
 * É o QR que a pessoa tem à mão quando o 2FA já está configurado: o portal
 * só mostra o dele uma vez, no momento de configurar. Depois disso, quem quer
 * o código de volta abre o app autenticador e usa "exportar contas" — e o QR
 * que sai dali não é `otpauth://`, é este, com um payload protobuf em
 * base64url que pode carregar VÁRIAS contas de uma vez.
 *
 * O protobuf é lido na mão, com um decodificador mínimo, em vez de puxar uma
 * biblioteca: são dois tipos de campo (varint e delimitado por tamanho) e uma
 * mensagem de sete campos. A dependência custaria mais que o código.
 */

export interface ContaExportada {
  /** Base32, maiúsculas, sem padding — o formato que o cofre guarda. */
  secret: string;
  emissor: string | null;
  conta: string | null;
  /** `false` quando a conta usa algoritmo/dígitos fora do que o cofre gera. */
  compativel: boolean;
  /** O que a torna incompatível, quando for o caso. */
  motivoIncompativel: string | null;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** base64/base64url → bytes. Escrito à mão pra rodar igual no navegador e no teste. */
function deBase64(texto: string): Uint8Array | null {
  const limpo = texto.replace(/-/g, "+").replace(/_/g, "/").replace(/[^A-Za-z0-9+/]/g, "");
  const bytes: number[] = [];
  let acumulador = 0;
  let bits = 0;
  for (const ch of limpo) {
    const v = B64.indexOf(ch);
    if (v < 0) return null;
    acumulador = (acumulador << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((acumulador >> bits) & 0xff);
    }
  }
  return Uint8Array.from(bytes);
}

function paraBase32(bytes: Uint8Array): string {
  let saida = "";
  let acumulador = 0;
  let bits = 0;
  for (const b of bytes) {
    acumulador = (acumulador << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      saida += BASE32[(acumulador >> bits) & 31];
    }
  }
  if (bits > 0) saida += BASE32[(acumulador << (5 - bits)) & 31];
  return saida;
}

interface Campo {
  numero: number;
  varint?: number;
  bytes?: Uint8Array;
}

/** Lê os campos de uma mensagem protobuf. Ignora o que não conhece, como manda o formato. */
function lerCampos(buf: Uint8Array): Campo[] {
  const campos: Campo[] = [];
  let i = 0;
  while (i < buf.length) {
    let chave = 0;
    let deslocamento = 0;
    // varint da chave
    while (i < buf.length) {
      const b = buf[i++]!;
      chave |= (b & 0x7f) << deslocamento;
      if ((b & 0x80) === 0) break;
      deslocamento += 7;
      if (deslocamento > 28) return campos;
    }
    const numero = chave >>> 3;
    const tipo = chave & 7;

    if (tipo === 0) {
      let valor = 0;
      let d = 0;
      while (i < buf.length) {
        const b = buf[i++]!;
        valor |= (b & 0x7f) << d;
        if ((b & 0x80) === 0) break;
        d += 7;
        if (d > 28) break;
      }
      campos.push({ numero, varint: valor });
    } else if (tipo === 2) {
      let tamanho = 0;
      let d = 0;
      while (i < buf.length) {
        const b = buf[i++]!;
        tamanho |= (b & 0x7f) << d;
        if ((b & 0x80) === 0) break;
        d += 7;
        if (d > 28) return campos;
      }
      if (tamanho < 0 || i + tamanho > buf.length) return campos;
      campos.push({ numero, bytes: buf.slice(i, i + tamanho) });
      i += tamanho;
    } else if (tipo === 5) {
      i += 4;
    } else if (tipo === 1) {
      i += 8;
    } else {
      return campos;
    }
  }
  return campos;
}

const texto = (b?: Uint8Array) => (b ? new TextDecoder().decode(b) : "");

/** Nomes dos enums do formato, pra mensagem de incompatibilidade sair legível. */
const ALGORITMO = ["indefinido", "SHA1", "SHA256", "SHA512", "MD5"];

/**
 * Lê o payload de exportação e devolve as contas TOTP que ele carrega.
 *
 * Devolve `null` quando o texto não é um QR de exportação — quem chama
 * decide o que dizer.
 */
export function lerMigracao(uri: string): ContaExportada[] | null {
  const m = /^otpauth-migration:\/\/[^?]*(?:\?(.*))?$/i.exec(uri.trim());
  if (!m) return null;

  const dados = new URLSearchParams(m[1] ?? "").get("data");
  if (!dados) return [];

  const buf = deBase64(dados);
  if (!buf || buf.length === 0) return [];

  const contas: ContaExportada[] = [];
  for (const campo of lerCampos(buf)) {
    // Campo 1 do envelope: cada ocorrência é uma conta.
    if (campo.numero !== 1 || !campo.bytes) continue;

    const p = lerCampos(campo.bytes);
    const secretBytes = p.find((c) => c.numero === 1)?.bytes;
    if (!secretBytes || secretBytes.length === 0) continue;

    const nome = texto(p.find((c) => c.numero === 2)?.bytes).trim();
    const emissor = texto(p.find((c) => c.numero === 3)?.bytes).trim();
    const algoritmo = p.find((c) => c.numero === 4)?.varint ?? 1;
    const digitos = p.find((c) => c.numero === 5)?.varint ?? 1;
    const tipo = p.find((c) => c.numero === 6)?.varint ?? 2;

    // Tipo 1 é HOTP (contador). O cofre gera código por tempo.
    if (tipo === 1) continue;

    const problemas: string[] = [];
    // No formato, 1 = SHA1 e 0 = não informado (que o Google trata como SHA1).
    if (algoritmo !== 1 && algoritmo !== 0) {
      problemas.push(`algoritmo ${ALGORITMO[algoritmo] ?? algoritmo}`);
    }
    // 1 = seis dígitos, 2 = oito.
    if (digitos === 2) problemas.push("8 dígitos");

    // O nome costuma vir "Emissor:conta" quando o emissor não veio separado.
    let conta = nome;
    let emissorFinal = emissor || null;
    const sep = nome.indexOf(":");
    if (!emissorFinal && sep > 0) {
      emissorFinal = nome.slice(0, sep).trim() || null;
      conta = nome.slice(sep + 1).trim();
    }

    contas.push({
      secret: paraBase32(secretBytes),
      emissor: emissorFinal,
      conta: conta || null,
      compativel: problemas.length === 0,
      motivoIncompativel: problemas.length > 0 ? problemas.join(", ") : null,
    });
  }
  return contas;
}
