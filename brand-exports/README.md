# Brand exports — JuridFlow

Assets de marca gerados a partir do wordmark canônico em
`client/src/pages/landing/Logo.tsx`.

## Arquivos

| Arquivo | Formato | Uso |
| --- | --- | --- |
| `juridflow-instagram-dark.png` | 1080×1080 | Post Instagram, fundo escuro (gradiente roxo do hero) |
| `juridflow-instagram-white.png` | 1080×1080 | Post Instagram, fundo branco |

## Especificação visual

- Fonte **Poppins** — "Jurid" ExtraBold (800), "Flow" SemiBold (600), `tracking-tight`.
- "Flow" em **violet-600 `#7C3AED`** (cor-assinatura, mantida nas duas versões).
- "Jurid": branco no fundo escuro, `#0b0b17` no fundo branco.
- Fundo escuro: gradiente radial `#1a1140 → #0d0a1c → #07060f`.
- Wordmark ~72% da largura, centralizado oticamente. Render 2× → reduzido (bordas nítidas).

## Regenerar

```bash
pip install Pillow
python3 generate-instagram-logo.py
```

O script baixa as fontes Poppins (OFL) num cache temporário na 1ª execução —
nenhuma fonte é versionada no repo.
