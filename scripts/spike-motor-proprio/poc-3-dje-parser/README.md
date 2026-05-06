# PoC 3 — DJE/DJEN Parser

## Pergunta de pesquisa

Conseguimos baixar o DJEN (Diário da Justiça Eletrônico Nacional do CNJ) e o DJE-TJSP de um dia, parsear os PDFs com `pdf-parse`, recorrer a OCR Tesseract quando o PDF for imagem, e extrair publicações estruturadas (CNJ, partes, advogados, conteúdo) com qualidade aceitável?

## Por que importa

DJE é a fonte que conta prazo legal. Quando alguém entra com ação contra um cliente, a citação aparece no DJE. Detecção de "nova ação contra CPF" depende disso.

## Fontes a testar

1. **DJEN** (CNJ unificado) — https://comunicaapi.pje.jus.br/api/v1/comunicacao
2. **DJE-TJSP** — https://dje.tjsp.jus.br/cdje/index.do
3. **DJE-TRT2** — https://www.trt2.jus.br/diario-eletronico

## Como rodar

```bash
pnpm tsx scripts/spike-motor-proprio/poc-3-dje-parser/index.ts --data=2026-05-05
```

Output: `samples/poc-3-{tribunal}-{data}.json` com publicações estruturadas + métricas (tempo download, tempo parse, % com OCR, falsos negativos identificados).

## Critério de sucesso

- 🟢 ≥95% das publicações com CNJ extraído corretamente, OCR <30s/página, custo zero
- 🟡 80-95% acurácia, OCR lento (precisa Textract pago ~R$0.005/página)
- 🔴 <80% acurácia ou volume DJE-TJSP inviável (>1h pra processar 1 dia)

## Estado

`TODO` — implementação no Dia 6-8 do Spike.
