-- Segunda variante da casca do PJe que virou "teor": a página de ajuda e
-- acessibilidade ("Atalhos do sistema", "alt+1 Menu de navegação", "O Pje é
-- um sistema de tramitação…"). Em cima dela a IA escreveu "o pedido foi
-- julgado improcedente" e carimbou a sentença como DESFAVORÁVEL ao cliente —
-- veredito inventado sobre atalhos de teclado.
--
-- Mesmo tratamento da 0195: apaga o teor falso, a análise construída em cima
-- e a sugestão de prazo pendente que saiu dela.

UPDATE eventos_processo
SET
  teor = NULL,
  teorStatus = 'pendente',
  teorErro = 'Descartado: o tribunal devolveu a página de ajuda, não o documento.',
  teorObtidoEm = NULL,
  teorUrl = NULL,
  resumo_ia = NULL,
  desfechoEvento = NULL,
  analiseJson = NULL
WHERE teor IS NOT NULL
  AND (
    LOWER(teor) LIKE '%atalhos do sistema%'
    OR teor LIKE '%O Pje é um sistema de tramitação%'
    OR teor LIKE '%alt+1 Menu de navega%'
  );

DELETE ps FROM prazos_sugeridos ps
JOIN eventos_processo ev ON ev.id = ps.evento_id
WHERE ps.status = 'pendente'
  AND ev.teorErro = 'Descartado: o tribunal devolveu a página de ajuda, não o documento.';
