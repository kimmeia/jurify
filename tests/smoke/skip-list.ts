/**
 * Lista de procedures que o smoke automático NÃO chama.
 *
 * Razões aceitáveis pra entrar aqui:
 *   - Efeito colateral irreversível (envia email/SMS real, escreve disco,
 *     cobra cartão, dispara webhook).
 *   - Precisa de dado externo válido (idToken Google, JWT externo).
 *   - Mutations destrutivas que não dá pra rodar repetido.
 *
 * Cada entrada deve ter motivo curto. Quando o smoke detectar uma
 * procedure nova que precisa ir pra skip, adicione aqui em vez de
 * arrumar o teste.
 */

export const SMOKE_SKIP: Record<string, string> = {
  // Auth
  "auth.signup": "cria user real — testado em E2E (signup.spec.ts)",
  "auth.loginGoogle": "precisa idToken do Google válido",
  "auth.logout": "destrói cookie de sessão do caller — quebraria os próximos",

  // Upload — escreve disco
  "upload.enviar": "escreve arquivo em disco — testado em E2E (upload.spec.ts)",
  "upload.excluir": "destrutivo, depende de arquivo existente",

  // Billing — efeito real
  "asaas.criarAssinatura": "cria assinatura real no Asaas",
  "asaas.cancelarAssinatura": "destrutivo",
  "asaas.processarRetomar": "fluxo de retomada com efeito externo",

  // Webhooks — não são procedures (são endpoints REST)
  // Não precisam estar aqui, mas anotamos por clareza:
  // "asaas.processarWebhook" — não é tRPC

  // Admin — destrutivos
  "admin.bloquear": "destrutivo, marca user bloqueado",
  "admin.suspender": "destrutivo, marca escritório suspenso",
  "admin.impersonar": "muda contexto de auth — quebra os próximos testes",
  "admin.deletarUsuario": "destrutivo absoluto",
  "admin.deletarEscritorio": "destrutivo absoluto",
  "admin.resetarSenha": "envia email real",

  // SmartFlow — pode disparar workers
  "smartflow.executar": "dispara worker assíncrono",
  "smartflow.executarFluxo": "idem",

  // Roadmap admin — depende de id válido
  "roadmap.atualizarStatus": "precisa item existente — coberto em E2E",

  // Convites — manda email real
  "configuracoes.convidarColaborador": "envia email real",
  "permissoes.convidarColaborador": "envia email real",
};

export function isSkipped(procedurePath: string): boolean {
  return procedurePath in SMOKE_SKIP;
}

export function motivoSkip(procedurePath: string): string | undefined {
  return SMOKE_SKIP[procedurePath];
}
