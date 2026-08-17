/**
 * O que o QR de 2FA precisa dizer pra ser aceito.
 *
 * O caminho feliz é o menos interessante aqui. O que estes testes protegem é
 * a recusa: um QR fora do padrão de geração do cofre gravaria um segredo que
 * nunca produz o código certo, e o sintoma seria o login falhando com
 * "código inválido" pra sempre — sem nada na tela ligando uma coisa à outra.
 */

import { describe, expect, it } from "vitest";
import { lerOtpauth, TOTP_PADRAO } from "../../shared/otpauth";

const uri = (extra = "") =>
  `otpauth://totp/PJe:38828%40oab-ce?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=PJe${extra}`;

describe("QR válido", () => {
  it("devolve o código, o emissor e a conta", () => {
    const r = lerOtpauth(uri());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dados.secret).toBe("JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP");
    expect(r.dados.emissor).toBe("PJe");
    // A conta serve pra conferir que o print é da pessoa certa antes de
    // salvar — com dois advogados cadastrados, é o que evita gravar o código
    // de um no cadastro do outro.
    expect(r.dados.conta).toBe("38828@oab-ce");
  });

  it("aceita o código com espaços e minúsculas", () => {
    const r = lerOtpauth("otpauth://totp/PJe?secret=jbsw%20y3dp%20ehpk%203pxp%20jbsw%20y3dp");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.dados.secret).toBe("JBSWY3DPEHPK3PXPJBSWY3DP");
  });

  it("aceita rótulo sem emissor", () => {
    const r = lerOtpauth("otpauth://totp/38828?secret=JBSWY3DPEHPK3PXPJBSWY3DP");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.dados.emissor).toBeNull();
      expect(r.dados.conta).toBe("38828");
    }
  });

  it("os parâmetros padrão explícitos continuam valendo", () => {
    const r = lerOtpauth(uri("&algorithm=SHA1&digits=6&period=30"));
    expect(r.ok).toBe(true);
  });

  it("SHA-1 com hífen é o mesmo SHA1", () => {
    expect(lerOtpauth(uri("&algorithm=SHA-1")).ok).toBe(true);
  });
});

describe("o que precisa ser recusado", () => {
  it("QR que não é de 2FA", () => {
    const r = lerOtpauth("https://pje.tjce.jus.br/algum-link");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("nao_e_otpauth");
  });

  it("QR de contador (HOTP), que o cofre não gera", () => {
    const r = lerOtpauth("otpauth://hotp/PJe?secret=JBSWY3DPEHPK3PXPJBSWY3DP&counter=1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("nao_e_totp");
  });

  it("sem secret", () => {
    const r = lerOtpauth("otpauth://totp/PJe?issuer=PJe");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("sem_secret");
  });

  it("secret que não é base32", () => {
    const r = lerOtpauth("otpauth://totp/PJe?secret=nao-e-base32-de-jeito-nenhum!!");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("secret_invalido");
  });

  it("secret curto demais pra ser real", () => {
    const r = lerOtpauth("otpauth://totp/PJe?secret=JBSWY3DP");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("secret_invalido");
  });

  it("algoritmo fora do padrão", () => {
    // O cofre guarda só o segredo: não há onde anotar SHA256, e o código
    // sairia errado toda vez.
    const r = lerOtpauth(uri("&algorithm=SHA256"));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.motivo).toBe("fora_do_padrao");
      expect(r.detalhe).toContain("SHA256");
    }
  });

  it("número de dígitos fora do padrão", () => {
    const r = lerOtpauth(uri("&digits=8"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detalhe).toContain("8 dígitos");
  });

  it("período fora do padrão", () => {
    const r = lerOtpauth(uri("&period=60"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detalhe).toContain("60s");
  });

  it("texto vazio ou lixo não quebra", () => {
    expect(lerOtpauth("").ok).toBe(false);
    expect(lerOtpauth("   ").ok).toBe(false);
    expect(lerOtpauth("otpauth://").ok).toBe(false);
  });
});

describe("o padrão declarado", () => {
  it("é o que a geração do cofre assume", () => {
    // Se `gerarCodigoTotp` mudar de configuração, este teste é o lembrete de
    // que a régua de aceitação do QR tem que mudar junto.
    expect(TOTP_PADRAO).toEqual({ algoritmo: "SHA1", digitos: 6, periodo: 30 });
  });
});
