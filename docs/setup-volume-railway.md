# Volume persistente Railway pra /uploads do service `jurify`

## Problema

O service `jurify` (a aplicação Node) **não tem volume montado por padrão**.
A pasta `./uploads/` dentro do container é destruída a cada deploy.

Isso quebra:
- Modelos DOCX uploadados em `/modelos`
- PDFs gerados a partir de modelos (`gerarComoAssinatura`)
- PNGs e PDFs estampados das assinaturas digitais
- Documentos dos agentes IA em `/admin`

O banco mantém os paths (`documentoUrl`, `documentoAssinadoUrl`,
`assinaturaImagemUrl`...), mas os arquivos no disco somem — resultado:
**404 ao tentar baixar**.

> O volume `mysql-volume` que já aparece no painel é do service **MySQL**
> (guarda os dados do banco). Não cobre uploads do app.

## Setup (~3 min)

1. **Painel Railway** → projeto `SaaS Jurídico` → environment
   `staging` → clicar no service **`jurify`** (NÃO no MySQL).
2. Aba **Settings** → seção **Volumes** → **+ New Volume**:
   - **Mount path**: `/app/uploads`
   - **Size**: 10 GB (mínimo; aumenta no painel quando lotar)
   - Nome sugerido: `jurify-uploads`
   - Confirmar criação.
3. Aba **Variables** → **+ New Variable**:
   - Key: `UPLOADS_PERSISTENT`
   - Value: `1`
4. Railway faz redeploy automático com o volume montado.

Repetir o mesmo procedimento no environment `production` quando promover
mudanças pra lá.

## Validar

Após o redeploy, nos logs do boot deve aparecer:

```
[boot] uploads/ ok { uploadsDir: '/app/uploads' }
```

(em vez do warn `"uploads/ sem volume persistente declarado"` que aparecia
antes).

Pra validar fim a fim:

1. Uploadar um modelo DOCX em `/modelos`
2. Gerar contrato → "Enviar pra assinatura"
3. Assinar no celular (`/assinar/:token`)
4. Baixar PDF assinado — OK
5. **Forçar novo deploy** (push de qualquer mudança trivial)
6. Após o redeploy, baixar de novo o PDF assinado — **ainda OK** (volume
   persistiu).

## Importante

- O volume **começa vazio** — arquivos anteriores (modelos DOCX, assinaturas
  geradas antes do volume) **não voltam**. Precisa re-uploadar modelos e
  regerar assinaturas pendentes.
- Volume é **acoplado ao service Railway**. Se duplicar o service `jurify`
  ou migrar pra outro provider, precisa re-montar manualmente.
- Backup: Railway não faz backup automático de volumes. Pra produção,
  considerar snapshot periódico via cron ou migrar pra S3 (vendor-neutral,
  com versionamento nativo).

## Migração futura pra S3

Quando a aplicação crescer (multi-instância, CDN, multi-region), o caminho
recomendado é migrar uploads pra S3:

- Vendor-neutral (AWS, Backblaze B2, Cloudflare R2 — qualquer API S3-compat)
- Versionamento nativo (recupera arquivo deletado por engano)
- Acoplamento zero com o host da aplicação
- ~$0.50/mês pra volume baixo

A dep `@aws-sdk/client-s3` já está no `package.json`. Helper
`server/_core/s3-storage.ts` ainda não foi criado — PR futuro.

## Tamanho estimado de uso

Pra calibrar o tamanho do volume:

- 1 modelo DOCX ≈ 50–200 KB
- 1 PDF gerado (sem estampa) ≈ 30–500 KB
- 1 PNG de assinatura manuscrita ≈ 5–30 KB
- 1 PDF estampado (com página de certificado) ≈ 50–600 KB

10 GB cobrem ~30k a 100k assinaturas. Recomendação: começa com 10 GB e
aumenta quando atingir 70% de uso (monitorável no painel Railway).
