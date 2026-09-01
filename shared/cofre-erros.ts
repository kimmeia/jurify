/**
 * Traduz o erro cru de um login de tribunal para uma frase que o operador
 * entende.
 *
 * O texto que o scraper grava é diagnóstico de verdade — traz o realm do
 * Keycloak, os inputs que achou na página, a URL com os parâmetros de sessão.
 * Isso é ouro pra achar a causa, e por isso continua guardado inteiro. Só que
 * jogado na grade ele vira um paredão de dez linhas por card e a tela deixa de
 * ser legível justamente quando mais precisa ser: na hora em que dez estados
 * estão vermelhos e é preciso decidir qual atacar primeiro.
 *
 * Aqui só o RESUMO é escolhido. O cru continua disponível pra quem abrir o
 * detalhe.
 */

export interface ResumoErroCofre {
  /** Uma linha, em português, sobre o que aconteceu. */
  resumo: string;
  /** O que fazer a respeito. Vazio quando não há ação óbvia. */
  acao: string;
}

const REGRAS: Array<{ teste: RegExp; resumo: string; acao: string }> = [
  {
    // O caso mais comum e o mais enganoso: o endereço está certo, o portal
    // respondeu, e ele recusou a credencial.
    teste: /usu[áa]rio ou senha inv[áa]lid|invalid user|credenciais? inv[áa]lid/i,
    resumo: "O portal recusou o usuário ou a senha.",
    // O caso mais comum não é senha errada: é ainda não ter cadastro naquele
    // tribunal. Dizer só "senha inválida" manda procurar defeito onde não tem.
    acao: "Confirme se você já tem cadastro neste tribunal — o login do PJe é por tribunal.",
  },
  {
    teste: /ERR_NAME_NOT_RESOLVED|ENOTFOUND|getaddrinfo/i,
    resumo: "O endereço do portal não existe.",
    acao: "É a cobertura que precisa de ajuste, não a sua credencial.",
  },
  {
    teste: /\b404\b|not found/i,
    resumo: "O endereço respondeu 404 — a página mudou de lugar.",
    acao: "É a cobertura que precisa de ajuste, não a sua credencial.",
  },
  {
    teste: /timeout|timed out|ETIMEDOUT|excedeu.*tempo|\b30000ms\b/i,
    resumo: "O portal não respondeu a tempo.",
    acao: "Costuma ser instabilidade do tribunal — vale tentar de novo mais tarde.",
  },
  {
    teste: /ECONNREFUSED|ECONNRESET|socket hang up/i,
    resumo: "A conexão com o portal caiu.",
    acao: "Costuma ser instabilidade do tribunal — vale tentar de novo mais tarde.",
  },
  {
    teste: /captcha|recaptcha|hcaptcha/i,
    resumo: "O portal pediu captcha.",
    acao: "Logins seguidos disparam isso; espere um pouco antes de testar de novo.",
  },
  {
    teste: /bloquead|lockout|conta.*desabilitad|temporariamente indispon[íi]vel para este usu/i,
    resumo: "O portal bloqueou a conta temporariamente.",
    acao: "Pare de testar este tribunal por algumas horas.",
  },
  {
    teste: /2fa|totp|c[óo]digo de verifica|autentica[çc][ãa]o em dois/i,
    resumo: "O portal pediu o código de dois fatores e ele não foi aceito.",
    acao: "Refaça o cadastro do 2FA desta credencial.",
  },
  {
    teste: /certificad|SSL|TLS/i,
    resumo: "O portal apresentou um certificado que o robô não aceitou.",
    acao: "",
  },
  {
    teste: /2º grau.*n[ãa]o.*mapead|endere[çc]o.*n[ãa]o.*mapead/i,
    resumo: "O endereço deste portal ainda não foi mapeado.",
    acao: "É a cobertura que precisa crescer, não a sua credencial.",
  },
];

/** Primeira frase do texto cru, pra quando nenhuma regra bate. */
function primeiraFrase(raw: string): string {
  const limpo = raw.replace(/\s+/g, " ").trim();
  const corte = limpo.search(/[.!?](\s|$)/);
  const frase = corte > 0 ? limpo.slice(0, corte + 1) : limpo;
  return frase.length > 120 ? `${frase.slice(0, 117)}…` : frase;
}

export function resumirErroCofre(raw: string | null | undefined): ResumoErroCofre | null {
  if (!raw || !raw.trim()) return null;
  for (const r of REGRAS) {
    if (r.teste.test(raw)) return { resumo: r.resumo, acao: r.acao };
  }
  return { resumo: primeiraFrase(raw), acao: "" };
}
