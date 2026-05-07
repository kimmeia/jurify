# PoC 1 — Scraper PJe (Consulta Pública)

## Pergunta de pesquisa

Um único adapter Playwright genérico consegue extrair capa + movimentações de **TRT2, TRT15, TJDFT, TJMG, TRF1** com latência <10s por processo, ou cada tribunal exige adapter dedicado?

## Hipótese

PJe é uma plataforma única (CNJ) com forks por tribunal. URL e DOM têm padrões parecidos. Esperamos que ~80% do código seja compartilhado, com adapters finos por tribunal só pra resolver diferenças cosméticas (selectors específicos).

## Estado da implementação

| Adapter | Status | Notas |
|---|---|---|
| TRT2 | ✅ implementado | Adapter de referência — Playwright + JSF/RichFaces selectors |
| TRT15 | ✅ implementado | Herda do TRT2, override só na URL — testa hipótese da reutilização |
| TJDFT | 🟡 placeholder | Implementação Dia 3 — também é PJe |
| TJMG | 🟡 placeholder | Implementação Dia 3 — também é PJe |
| TRF1 | 🟡 placeholder | Implementação Dia 3 — também é PJe |

## Como rodar

### Pré-requisitos
```bash
# Browsers do Playwright (uma vez por máquina)
pnpm exec playwright install chromium
```

### Rodar contra todos os tribunais com CNJs reais
```bash
SPIKE_CNJS_TRT2='1234567-89.2024.5.02.0001,2345678-90.2024.5.02.0002' \
SPIKE_CNJS_TRT15='...' \
pnpm tsx scripts/spike-motor-proprio/poc-1-pje-scraper/index.ts
```

### Rodar apenas um tribunal
```bash
SPIKE_TRIBUNAIS=trt2 \
SPIKE_CNJS_TRT2='1234567-89.2024.5.02.0001' \
pnpm tsx scripts/spike-motor-proprio/poc-1-pje-scraper/index.ts
```

### Rodar com Sentry instrumentado
```bash
SENTRY_DSN_BACKEND='https://...@sentry.io/...' \
SPIKE_CNJS_TRT2='...' \
pnpm tsx scripts/spike-motor-proprio/poc-1-pje-scraper/index.ts
```

## Outputs

Cada execução produz dois arquivos em `samples/`:

```
samples/poc-1-{timestamp}.json        ← raspagens completas (capa + movs)
samples/poc-1-{timestamp}-stats.json  ← estatísticas agregadas por tribunal
samples/screenshots/                   ← screenshots de erros (debug)
```

E imprime um resumo no console:

```
[poc-1] ═══════════════════════════════════════════════════════
[poc-1] RESUMO
[poc-1] ═══════════════════════════════════════════════════════
[poc-1] [OK] TRT2   3/3 ok (100%) — lat médio 6800ms, p95 8200ms
[poc-1] [!!] TRT15  2/3 ok (66.7%) — lat médio 7500ms, p95 9100ms
[poc-1]        erros: cnj_nao_encontrado=1
[poc-1] [—]  TJDFT  0/0 ok (0%) — placeholder
[poc-1] ═══════════════════════════════════════════════════════
```

## Critério de sucesso

- 🟢 ≥4 dos 5 tribunais funcionam, latência média <10s, sem captcha
- 🟡 3 tribunais funcionam, captcha esporádico (precisa solver)
- 🔴 ≤2 funcionam ou captcha consistente bloqueia

## Arquitetura

```
poc-1-pje-scraper/
  ├─ adapters/
  │  ├─ base.ts          ← interface ScraperTribunalAdapter
  │  ├─ trt2.ts          ← implementação Playwright completa
  │  ├─ trt15.ts         ← extends TRT2 (override URL)
  │  └─ placeholders.ts  ← stubs pra TJDFT/TJMG/TRF1
  └─ index.ts            ← orquestrador (loop sobre tribunais × CNJs)

../lib/
  ├─ types-spike.ts        ← contratos (ProcessoCapa, Movimentacao, ResultadoScraper)
  ├─ parser-utils.ts       ← normalização CNJ/datas/valores BRL
  ├─ playwright-helpers.ts ← browser pool, retry, screenshot, captcha detect
  ├─ sentry-spike.ts       ← instrumentação Sentry específica do Spike
  └─ cnjs-publicos.ts      ← CNJs de teste configuráveis via env
```

## Observações importantes

- **Adapter NUNCA lança exceção** — qualquer erro vira `ResultadoScraper { ok: false, categoriaErro }`. Permite ao orquestrador agregar estatísticas sem try/catch em cada chamada.
- **Latência inclui setup do Playwright** (~2-3s overhead pra browser context). Latência líquida da raspagem em si tipicamente é <5s.
- **Screenshots em erro** vão pra `samples/screenshots/` — útil pra debugar selectors quebrados sem precisar rodar localmente.
- **Sentry detecta apenas falhas finais** (após esgotar retries) — evita inflar volume com erros transientes.
- **Sleep de 1.5s entre consultas no mesmo tribunal** — comportamento educado, evita rate limit.

## O que vem no Dia 3

1. Implementar TJDFT, TJMG, TRF1 (substituindo placeholders)
2. Identificar diferenças entre tribunais → consolidar em classe base `PJeScraperBase` se viável
3. Coletar 3-5 CNJs reais por tribunal
4. Rodar bateria completa em ambiente staging Railway
5. Atualizar este README com vereditos finais
