# PoC 2 — Login E-SAJ TJSP autenticado

## Pergunta de pesquisa

Login com OAB+senha+TOTP no E-SAJ do TJSP via Playwright funciona consistentemente? Sessão persiste por quantos dias antes de pedir relogin? Captcha aparece?

## Por que é o PoC mais arriscado

- TJSP é ~25% do volume processual brasileiro
- E-SAJ fechou consulta pública desde 2021 → exige login
- TJSP tem captcha agressivo (hCaptcha em alguns fluxos)
- 2FA TOTP é obrigatório desde 2023

Se este PoC falhar, **TJSP fica fora do motor próprio** e precisamos manter Judit (ou similar) para esse pedaço.

## Como rodar

Pré-requisito: credencial cadastrada via `/admin/cofre-credenciais` em staging (UI construída no Dia 5).

```bash
pnpm tsx scripts/spike-motor-proprio/poc-2-esaj-login/index.ts --credencial-id=<ID_DO_COFRE>
```

O PoC lê credencial do banco staging, faz login, abre 1 processo de teste, extrai movimentações, salva sessão (cookies criptografados em `cofre_sessoes`), faz logout limpo.

## Critério de sucesso

- 🟢 Login funciona, captcha ausente ou raro (<5% das tentativas), sessão persiste ≥24h
- 🟡 Login funciona, captcha frequente (precisa 2Captcha ~R$50/mês)
- 🔴 Captcha bloqueia consistentemente OU login falha mesmo com credencial correta

## Estado

`TODO` — implementação no Dia 9-10 do Spike (depende de credencial cadastrada).

## Segurança

- A credencial **NUNCA** entra como variável de ambiente nem em commit
- AES-256-GCM no banco staging (mesmo padrão do `admin_integracoes.apiKeyEncrypted`)
- 2FA secret (TOTP) também criptografado, com warning no UI explicando que é o "secret" da app autenticadora, não o código de 6 dígitos
- Logs do PoC mascaram credencial via `maskToken()` do `crypto-utils.ts`
