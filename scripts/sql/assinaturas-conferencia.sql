-- Conferência de assinaturas: o que EXISTE gravado em cada documento.
--
-- Só leitura. Roda no console do banco (Railway → MySQL → Query) e responde a
-- pergunta "esse documento foi mesmo assinado?" sem depender de tela nenhuma.
--
-- Como ler o resultado:
--   assinou_de_verdade = SIM  → tem desenho e/ou IP: alguém passou pelo
--                               /assinar/:token. Se o comprovante estiver
--                               vazio, o que falhou foi só o carimbo do PDF.
--   assinou_de_verdade = NAO  → está marcado como assinado e não há nenhum
--                               vestígio de quem assinou. Isso não deveria
--                               existir: me chame com esta linha.
--
-- `assinante_nome` NÃO serve de prova: ele é pré-preenchido com o nome do
-- contato quando o documento é criado, antes de existir qualquer assinatura.

SELECT
  a.id,
  a.titulo,
  c.nome                                        AS cliente,
  a.statusAssinatura                            AS status,
  a.assinadoAt,
  a.assinantNome                                AS assinante_nome_prepreenchido,
  CASE WHEN a.assinanteCpf IS NULL OR a.assinanteCpf = '' THEN 'nao' ELSE 'sim' END AS tem_cpf,
  a.ipAssinatura                                AS ip,
  CASE WHEN a.assinaturaImagemUrl IS NULL OR a.assinaturaImagemUrl = '' THEN 'nao' ELSE 'sim' END AS tem_desenho,
  CASE WHEN a.documentoAssinadoUrl IS NULL OR a.documentoAssinadoUrl = '' THEN 'nao' ELSE 'sim' END AS tem_comprovante,
  a.comprovanteErro                             AS motivo_sem_comprovante,
  CASE WHEN a.documentoUrl LIKE '/uploads/%' THEN 'arquivo nosso' ELSE 'link externo' END AS origem_documento,
  CASE
    WHEN (a.assinaturaImagemUrl IS NOT NULL AND a.assinaturaImagemUrl <> '')
      OR (a.ipAssinatura IS NOT NULL AND a.ipAssinatura <> '')
    THEN 'SIM' ELSE 'NAO'
  END                                           AS assinou_de_verdade,
  a.createdAtAssinatura                         AS criado_em
FROM assinaturas_digitais a
LEFT JOIN contatos c ON c.id = a.contatoId
WHERE a.statusAssinatura = 'assinado'
ORDER BY a.assinadoAt DESC;

-- Só os problemáticos (os que a ficha passa a mostrar em âmbar ou vermelho):
--
-- SELECT id, titulo, assinadoAt, comprovanteErro
-- FROM assinaturas_digitais
-- WHERE statusAssinatura = 'assinado'
--   AND (documentoAssinadoUrl IS NULL OR documentoAssinadoUrl = '')
-- ORDER BY assinadoAt DESC;
