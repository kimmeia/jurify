# PoC 1 — Scraper PJe (Consulta Pública)

## Pergunta de pesquisa

Um único adapter Playwright genérico consegue extrair capa + movimentações de **TRT2, TRT15, TJDFT, TJMG, TRF1** com latência <10s por processo, ou cada tribunal exige adapter dedicado?

## Hipótese

PJe é uma plataforma única (CNJ) com forks por tribunal. URL e DOM têm padrões parecidos. Esperamos que ~80% do código seja compartilhado, com adapters finos por tribunal só pra resolver diferenças cosméticas (selectors específicos).

## Como rodar

```bash
pnpm tsx scripts/spike-motor-proprio/poc-1-pje-scraper/index.ts
```

Outputs vão para `../samples/poc-1-{timestamp}.json`.

## Critério de sucesso

- 🟢 ≥4 dos 5 tribunais funcionam, latência média <10s, sem captcha
- 🟡 3 tribunais funcionam, captcha esporádico (precisa solver)
- 🔴 ≤2 funcionam ou captcha consistente bloqueia

## Estado

`TODO` — implementação no Dia 2-3 do Spike.
