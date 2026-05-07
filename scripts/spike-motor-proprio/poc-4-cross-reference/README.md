# PoC 4 — Cross-reference CPF/CNPJ × Publicações DJE

## Pergunta de pesquisa

Dado um CPF/CNPJ de cliente cadastrado, conseguimos encontrar publicações no DJE indexado em <2s, com taxa de falsos positivos aceitável?

## Por que importa

Esta é a peça que vira detecção de "alguém entrou com ação contra meu cliente". Performance e precisão são críticas — falsos positivos viram alertas-spam que matam confiança no produto.

## Estratégia

1. Banco staging recebe ~100 publicações sintéticas + ~10 reais extraídas no PoC 3
2. MySQL FULLTEXT INDEX no `texto` da `dje_publicacoes`
3. Hash determinístico do CPF/CNPJ pra busca exata (LGPD: não armazenamos CPF cru — só hash)
4. Busca híbrida: hash exato + match no FULLTEXT por nome
5. Score de confiança baseado em quantos campos batem

## Como rodar

```bash
pnpm tsx scripts/spike-motor-proprio/poc-4-cross-reference/index.ts
```

Roda em ciclo: insere publicações sintéticas, faz buscas, mede latência e precisão (recall + precision contra ground truth).

## Critério de sucesso

- 🟢 latência <2s para 100k publicações indexadas, precision ≥95%, recall ≥98%
- 🟡 latência 2-5s ou precision/recall 85-95%
- 🔴 latência >5s ou precision <85% (falsos positivos demais → ruído pro usuário)

## Estado

`TODO` — implementação no Dia 4 do Spike.
