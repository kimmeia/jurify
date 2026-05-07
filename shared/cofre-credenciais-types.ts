/**
 * Tipos compartilhados entre frontend e backend para o Cofre de Credenciais
 * próprio do motor de monitoramento jurídico.
 *
 * O cofre armazena credenciais (CPF/OAB + senha + 2FA) que advogados/escritórios
 * autorizam o Jurify a usar para acessar sistemas de tribunal autenticados
 * (E-SAJ TJSP, PJe restrito, Eproc) e capturar processos em segredo de justiça
 * ou que exigem login.
 *
 * Segurança:
 *  - Credencial é criptografada com AES-256-GCM (mesmo padrão de
 *    server/escritorio/crypto-utils.ts)
 *  - Backend NUNCA retorna senha em claro — só os campos `username` e `apelido`
 *    aparecem em API responses
 *  - 2FA secret (TOTP) também é criptografado e usado server-side; nunca exposto
 *  - Frontend recebe apenas `usernameMascarado` (ex: "12345678***...") via maskToken()
 */

/**
 * Sistemas de tribunal suportados pelo cofre.
 *
 * Convenção de nomenclatura: `{plataforma}_{aliasTribunal}` ou
 * `{plataforma}_*` para credencial-coringa que serve em vários tribunais
 * da mesma plataforma.
 *
 * Exemplos:
 *  - "esaj_tjsp": E-SAJ do TJ-SP
 *  - "pje_restrito_trt2": PJe restrito (não consulta pública) do TRT-SP
 *  - "eproc_trf4": Eproc do TRF-4
 *  - "esaj_*": credencial que funciona em qualquer E-SAJ (curinga)
 */
export type SistemaCofre =
  | "esaj_tjsp"
  | "esaj_tjsc"
  | "esaj_tjba"
  | "esaj_tjce"
  | "esaj_tjam"
  | "esaj_tjac"
  | "esaj_tjto"
  | "esaj_tjms"
  | "esaj_tjal"
  | "esaj_*"
  | "pje_restrito_trt1"
  | "pje_restrito_trt2"
  | "pje_restrito_trt15"
  | "pje_restrito_*"
  | "eproc_trf2"
  | "eproc_trf4"
  | "eproc_*";

/**
 * Status do ciclo de vida da credencial.
 *
 * Transições válidas:
 *   validando → ativa | erro
 *   ativa → erro | expirada | removida
 *   erro → ativa (após reentrada bem-sucedida) | removida
 *   expirada → ativa (após reentrada) | removida
 *   removida → (terminal — soft delete pra auditoria)
 */
export type StatusCredencial =
  | "validando"
  | "ativa"
  | "erro"
  | "expirada"
  | "removida";

/**
 * Input para cadastrar uma credencial nova via /admin/cofre-credenciais.
 * O backend valida via login real no tribunal antes de marcar como `ativa`.
 */
export interface CofreCredencialInput {
  sistema: SistemaCofre;
  /** Label amigável: ex "Dr. João Silva — TJSP" */
  apelido: string;
  /** CPF (com ou sem máscara) ou número OAB */
  username: string;
  /** Senha do tribunal — vai pro AES-256-GCM antes de tocar disco */
  password: string;
  /**
   * Secret TOTP da app autenticadora (ex: Google Authenticator).
   * É a string base32 de ~16 caracteres exibida quando o tribunal
   * mostra o QR code do 2FA — NÃO é o código de 6 dígitos.
   *
   * Opcional: se o tribunal não exigir 2FA ou se a credencial usar
   * outro método (ex: SMS — não suportado), deixa null.
   */
  totpSecret?: string;
}

/**
 * Representação de credencial que o frontend recebe via API.
 * NUNCA inclui senha ou TOTP secret — só metadados seguros.
 */
export interface CofreCredencialView {
  id: number;
  escritorioId: number;
  sistema: SistemaCofre;
  apelido: string;
  /** Username mascarado: "12345678***...90" via maskToken() */
  usernameMascarado: string;
  /** Indica se foi cadastrado um TOTP secret — sem revelar o secret */
  tem2fa: boolean;
  status: StatusCredencial;
  ultimoLoginSucessoEm: string | null;
  ultimoErro: string | null;
  criadoEm: string;
  atualizadoEm: string;
}

/**
 * Resultado de uma tentativa de login real, retornado pelo backend
 * quando admin clica em "Validar credencial" na UI.
 */
export interface ResultadoValidacaoCredencial {
  ok: boolean;
  mensagem: string;
  /** Tempo em ms que o login real levou — útil pra dashboard de saúde */
  latenciaMs?: number;
  /** Detalhes técnicos para debug (vão pro Sentry, não pro usuário final) */
  detalhes?: string;
}

/**
 * Mapa de label e descrição por sistema — usado pelo frontend pra renderizar
 * select de sistema com texto legível em vez do enum cru.
 */
export const SISTEMAS_COFRE_LABELS: Record<SistemaCofre, { label: string; descricao: string }> = {
  esaj_tjsp: { label: "E-SAJ TJSP", descricao: "Tribunal de Justiça de São Paulo (autenticado)" },
  esaj_tjsc: { label: "E-SAJ TJSC", descricao: "Tribunal de Justiça de Santa Catarina (autenticado)" },
  esaj_tjba: { label: "E-SAJ TJBA", descricao: "Tribunal de Justiça da Bahia (autenticado)" },
  esaj_tjce: { label: "E-SAJ TJCE", descricao: "Tribunal de Justiça do Ceará (autenticado)" },
  esaj_tjam: { label: "E-SAJ TJAM", descricao: "Tribunal de Justiça do Amazonas (autenticado)" },
  esaj_tjac: { label: "E-SAJ TJAC", descricao: "Tribunal de Justiça do Acre (autenticado)" },
  esaj_tjto: { label: "E-SAJ TJTO", descricao: "Tribunal de Justiça do Tocantins (autenticado)" },
  esaj_tjms: { label: "E-SAJ TJMS", descricao: "Tribunal de Justiça do Mato Grosso do Sul (autenticado)" },
  esaj_tjal: { label: "E-SAJ TJAL", descricao: "Tribunal de Justiça de Alagoas (autenticado)" },
  "esaj_*": { label: "E-SAJ — qualquer", descricao: "Credencial coringa para qualquer tribunal E-SAJ" },
  pje_restrito_trt1: { label: "PJe TRT1", descricao: "TRT 1ª Região (Rio de Janeiro) — área restrita" },
  pje_restrito_trt2: { label: "PJe TRT2", descricao: "TRT 2ª Região (São Paulo) — área restrita" },
  pje_restrito_trt15: { label: "PJe TRT15", descricao: "TRT 15ª Região (Campinas) — área restrita" },
  "pje_restrito_*": { label: "PJe — qualquer", descricao: "Credencial coringa para PJe restrito" },
  eproc_trf2: { label: "Eproc TRF2", descricao: "TRF 2ª Região (RJ/ES) — Eproc" },
  eproc_trf4: { label: "Eproc TRF4", descricao: "TRF 4ª Região (RS/SC/PR) — Eproc" },
  "eproc_*": { label: "Eproc — qualquer", descricao: "Credencial coringa para Eproc" },
};

/**
 * Validações de input compartilhadas entre frontend (form) e backend (zod).
 * Centralizadas aqui pra evitar divergência.
 */
export const COFRE_VALIDACOES = {
  apelidoMinLen: 3,
  apelidoMaxLen: 100,
  usernameMinLen: 4,
  usernameMaxLen: 64,
  passwordMinLen: 4,
  passwordMaxLen: 128,
  /** Secret TOTP base32 — geralmente 16 ou 32 caracteres, mas aceitamos 8-128 */
  totpSecretMinLen: 8,
  totpSecretMaxLen: 128,
} as const;
