# Spike — Motor Próprio de Monitoramento Jurídico

> Validação técnica de viabilidade antes do compromisso com o roadmap completo.
> Tudo aqui é **descartável**: se um PoC quebrar, código vai pro lixo. Se passar, vira base do adapter de produção.

## Por que existe

Hoje o Jurify tem integração Judit funcional (ainda não em produção real). O objetivo é construir motor próprio que substitua Judit + Jusbrasil — captura de movimentações em tempo real, monitoramento de novas ações por CPF/CNPJ, publicações DJE, mandados — sem depender de API de terceiro.

Antes de comprometer 5-6 meses construindo, este Spike prova (ou refuta) que cada peça crítica é viável. Saída: relatório técnico honesto com 🟢/🟡/🔴 por componente.

## Ambiente

**TUDO RODA EM STAGING.** Branch de trabalho: `claude/motor-proprio-spike` → PRs vão pra `develop` → deploy automático Railway staging via `.github/workflows/deploy.yml`.

Production permanece intocada até paridade comprovada e aprovação explícita.

## PoCs

| # | Pasta | Pergunta de pesquisa | Risco se falhar |
|---|---|---|---|
| 1 | `poc-1-pje-scraper/` | Adapter Playwright genérico cobre TRT2, TRT15, TJDFT, TJMG, TRF1 com latência <10s? | Precisa adapter por tribunal (×40 trabalho) |
| 2 | `poc-2-esaj-login/` | Login OAB+senha+TOTP via Playwright funciona em TJSP? Captcha bloqueia? | TJSP fica fora → mantém Judit pra TJSP |
| 3 | `poc-3-dje-parser/` | Download + parse de DJEN extrai publicações estruturadas? OCR Tesseract dá conta? | DJE inviável → perde detecção de novas ações |
| 4 | `poc-4-cross-reference/` | Dado um CPF, encontra publicações no DJE em <2s com falsos positivos aceitáveis? | Detecção de novas ações fica ruim |

## Como rodar

Cada PoC tem seu próprio `README.md` e `index.ts` standalone. Pré-requisitos comuns:

```bash
# Instalar dependências (na raiz do projeto)
pnpm install

# Instalar browsers do Playwright (usado em PoC 1, 2)
pnpm exec playwright install chromium

# Rodar um PoC específico (ex: PoC 1)
pnpm tsx scripts/spike-motor-proprio/poc-1-pje-scraper/index.ts
```

Cada PoC produz arquivos em `samples/` com timestamp pra inspeção manual.

## O que NÃO entra aqui

- Adapter de produção (vai pra `server/processos/adapters/` na Fase 1)
- Worker BullMQ (vai pra `server/workers/` na Fase 1)
- UI admin do cofre (essa MORA em `client/src/pages/admin/CofreCredenciais.tsx` desde o Dia 5 do Spike — é parte do produto final)
- Renomeação `judit_*` → `processos_*` (Sprint 1 oficial pós-Spike)

## Credenciais para PoC 2

PoC 2 (E-SAJ TJSP) precisa credencial real OAB+senha+2FA. A credencial é cadastrada via UI admin (`/admin/cofre-credenciais` em staging) e fica criptografada com AES-256-GCM no banco. O PoC lê do cofre — nunca de variável de ambiente ou hard-code.

## Cronograma

```
SEMANA 1 (sem credencial)
─────────────────────────────────────────────────
Dia 1  ▸ Setup, schema, tipos, README           ← AGORA
Dia 2  ▸ PoC 1 — TRT2
Dia 3  ▸ PoC 1 — TRT15, TJDFT, TJMG, TRF1
Dia 4  ▸ PoC 4 — Cross-reference
Dia 5  ▸ UI /admin/cofre-credenciais

SEMANA 2 (com credencial cadastrada)
─────────────────────────────────────────────────
Dia 6-8 ▸ PoC 3 — DJE parser + OCR + indexação
Dia 9-10 ▸ PoC 2 — E-SAJ login com 2FA
Dia 11   ▸ Relatório técnico consolidado
```

## Critérios de saída

Cada PoC reporta no relatório final:

- **🟢 Funciona em produção:** taxa sucesso ≥95%, latência dentro do alvo, próximos passos claros
- **🟡 Funciona com ressalva:** o que falta (proxy, captcha solver, OCR pago)
- **🔴 Não viável:** alternativa proposta

Decisão go/no-go/ajustes acontece após o Dia 11.

## Plano B: Judit

A integração Judit existente fica **intocada** durante todo o Spike. Se algum PoC retornar 🔴, ligamos Judit para aquela capacidade específica via feature flag por escritório (`usarJudit`/`usarMotorProprio`).
