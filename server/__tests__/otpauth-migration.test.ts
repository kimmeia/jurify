/**
 * O QR de exportação do Google Authenticator.
 *
 * É o QR que a pessoa realmente tem à mão. O portal do tribunal só mostra o
 * dele uma vez, no momento de configurar o 2FA; depois disso o caminho
 * natural é abrir o autenticador e usar "transferir contas". O conteúdo não é
 * `otpauth://` — é `otpauth-migration://` com um protobuf em base64url, e ele
 * costuma trazer VÁRIAS contas de uma vez.
 *
 * Daí o cuidado que estes testes prendem: pegar a primeira conta do QR sem
 * perguntar gravaria o 2FA do e-mail pessoal no login do tribunal.
 */

import { describe, expect, it } from "vitest";
import { lerMigracao } from "../../shared/otpauth-migration";
import { lerOtpauth } from "../../shared/otpauth";

// ─── Montagem de um payload de verdade, pra não testar contra mock ──────────
const bytes = (...b: number[]) => Uint8Array.from(b);

function varint(n: number): number[] {
  const saida: number[] = [];
  let v = n;
  do {
    let b = v & 0x7f;
    v >>>= 7;
    if (v > 0) b |= 0x80;
    saida.push(b);
  } while (v > 0);
  return saida;
}

function delimitado(chave: number, conteudo: number[] | Uint8Array): number[] {
  const arr = Array.from(conteudo);
  return [chave, ...varint(arr.length), ...arr];
}

const texto = (s: string) => Array.from(new TextEncoder().encode(s));

function conta(opts: {
  secret: number[];
  nome?: string;
  emissor?: string;
  algoritmo?: number;
  digitos?: number;
  tipo?: number;
}): number[] {
  return [
    ...delimitado(0x0a, opts.secret),
    ...(opts.nome ? delimitado(0x12, texto(opts.nome)) : []),
    ...(opts.emissor ? delimitado(0x1a, texto(opts.emissor)) : []),
    ...(opts.algoritmo != null ? [0x20, ...varint(opts.algoritmo)] : []),
    ...(opts.digitos != null ? [0x28, ...varint(opts.digitos)] : []),
    ...(opts.tipo != null ? [0x30, ...varint(opts.tipo)] : []),
  ];
}

function qrDe(...contas: number[][]): string {
  const corpo = contas.flatMap((c) => delimitado(0x0a, c));
  let bin = "";
  for (const b of corpo) bin += String.fromCharCode(b);
  const base64 = btoa(bin).replace(/\+/g, "-").replace(/\//g, "_");
  return `otpauth-migration://offline?data=${encodeURIComponent(base64)}`;
}

/** "Hello" em base32 é JBSWY3DP — 5 bytes viram 8 chars exatos. */
const HELLO = [0x48, 0x65, 0x6c, 0x6c, 0x6f];
const SEGREDO_20B = [...HELLO, ...HELLO, ...HELLO, ...HELLO];
const BASE32_20B = "JBSWY3DPJBSWY3DPJBSWY3DPJBSWY3DP";

describe("lerMigracao", () => {
  it("converte o segredo de bytes pra base32", () => {
    const r = lerMigracao(qrDe(conta({ secret: SEGREDO_20B, nome: "38828", emissor: "PJe", tipo: 2 })));
    expect(r).toHaveLength(1);
    expect(r![0]!.secret).toBe(BASE32_20B);
    expect(r![0]!.emissor).toBe("PJe");
    expect(r![0]!.conta).toBe("38828");
    expect(r![0]!.compativel).toBe(true);
  });

  it("separa emissor do nome quando vem colado", () => {
    const r = lerMigracao(qrDe(conta({ secret: SEGREDO_20B, nome: "PJe:38828@oab-ce", tipo: 2 })));
    expect(r![0]!.emissor).toBe("PJe");
    expect(r![0]!.conta).toBe("38828@oab-ce");
  });

  it("lê todas as contas do QR, não só a primeira", () => {
    // É o ponto: o app exporta o cofre inteiro da pessoa de uma vez.
    const r = lerMigracao(
      qrDe(
        conta({ secret: SEGREDO_20B, nome: "gmail", emissor: "Google", tipo: 2 }),
        conta({ secret: SEGREDO_20B, nome: "38828", emissor: "PJe", tipo: 2 }),
        conta({ secret: SEGREDO_20B, nome: "conta3", emissor: "Outro", tipo: 2 }),
      ),
    );
    expect(r).toHaveLength(3);
    expect(r!.map((c) => c.emissor)).toEqual(["Google", "PJe", "Outro"]);
  });

  it("descarta HOTP, que é por contador", () => {
    const r = lerMigracao(qrDe(conta({ secret: SEGREDO_20B, nome: "x", tipo: 1 })));
    expect(r).toEqual([]);
  });

  it("marca incompatível o que o cofre não consegue gerar", () => {
    const sha256 = lerMigracao(qrDe(conta({ secret: SEGREDO_20B, nome: "x", algoritmo: 2, tipo: 2 })));
    expect(sha256![0]!.compativel).toBe(false);
    expect(sha256![0]!.motivoIncompativel).toContain("SHA256");

    const oito = lerMigracao(qrDe(conta({ secret: SEGREDO_20B, nome: "x", digitos: 2, tipo: 2 })));
    expect(oito![0]!.compativel).toBe(false);
    expect(oito![0]!.motivoIncompativel).toContain("8 dígitos");
  });

  it("algoritmo não informado vale como SHA1", () => {
    const r = lerMigracao(qrDe(conta({ secret: SEGREDO_20B, nome: "x", algoritmo: 0, tipo: 2 })));
    expect(r![0]!.compativel).toBe(true);
  });

  it("não é QR de exportação devolve null", () => {
    expect(lerMigracao("otpauth://totp/PJe?secret=JBSWY3DPEHPK3PXP")).toBeNull();
    expect(lerMigracao("https://exemplo.com")).toBeNull();
  });

  it("payload quebrado não derruba a leitura", () => {
    expect(lerMigracao("otpauth-migration://offline?data=%%%")).toEqual([]);
    expect(lerMigracao("otpauth-migration://offline")).toEqual([]);
    expect(lerMigracao("otpauth-migration://offline?data=AAAA")).toEqual([]);
  });
});

describe("lerOtpauth com QR de exportação", () => {
  it("aceita e devolve a primeira conta com as outras ao lado", () => {
    const r = lerOtpauth(
      qrDe(
        conta({ secret: SEGREDO_20B, nome: "38828", emissor: "PJe", tipo: 2 }),
        conta({ secret: SEGREDO_20B, nome: "gmail", emissor: "Google", tipo: 2 }),
      ),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dados.emissor).toBe("PJe");
    // As outras vão junto porque a tela precisa PERGUNTAR qual é a certa:
    // escolher sozinho gravaria o 2FA do e-mail no login do tribunal.
    expect(r.outras).toHaveLength(1);
    expect(r.outras![0]!.emissor).toBe("Google");
  });

  it("QR de exportação só com conta incompatível é recusado com o motivo", () => {
    const r = lerOtpauth(qrDe(conta({ secret: SEGREDO_20B, nome: "x", algoritmo: 3, tipo: 2 })));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.motivo).toBe("fora_do_padrao");
      expect(r.detalhe).toContain("SHA512");
    }
  });

  it("QR de exportação sem conta nenhuma explica isso", () => {
    const r = lerOtpauth(qrDe(conta({ secret: SEGREDO_20B, nome: "x", tipo: 1 })));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("exportacao_vazia");
  });
});

describe("a mensagem de recusa ajuda a diagnosticar", () => {
  it("mostra o começo do que foi lido", () => {
    // Sem isso, "não é de 2FA" manda a pessoa adivinhar qual QR da tela ela
    // pegou — que foi exatamente o que aconteceu.
    const r = lerOtpauth("https://pje.tjce.jus.br/pjeNgrau/login.seam?algo=1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detalhe).toContain("https://pje.tjce.jus.br");
  });
});
