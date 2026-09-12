-- "Sob medida" (slug `completo`) passa a entregar pelo menos o que o Escala
-- entrega. O cartão promete "Tudo do Escala, e mais", mas a 0217 só trocou
-- nome, textos e ordem — os limites ficaram na seed 0108: 5 atendentes de IA
-- contra 10 do Escala e JurisIA com cota 0 (módulo desligado).
--
-- Regra: cada limite vira o MAIOR entre o atual e o do Escala. NULL em
-- monitoramentos significa ilimitado e é preservado; nos tetos mensais da
-- 0221, NULL e 0 significam "sem limite" e também são preservados — igualar
-- ao Escala nunca pode virar restrição nova. Nada de preço, textos, ordem,
-- usuários ou armazenamento é tocado.
UPDATE planos SET
  max_conexoes_whatsapp = GREATEST(max_conexoes_whatsapp, 5),
  max_agentes_ia = GREATEST(max_agentes_ia, 10),
  max_monitoramentos_processos = CASE WHEN max_monitoramentos_processos IS NULL THEN NULL ELSE GREATEST(max_monitoramentos_processos, 2500) END,
  max_monitoramentos_cpf = CASE WHEN max_monitoramentos_cpf IS NULL THEN NULL ELSE GREATEST(max_monitoramentos_cpf, 150) END,
  creditos_calculos_mes = GREATEST(creditos_calculos_mes, 300),
  jurisia_mensagens_mes = GREATEST(jurisia_mensagens_mes, 200),
  max_consultas_processo_mes = CASE WHEN max_consultas_processo_mes IS NULL OR max_consultas_processo_mes = 0 THEN max_consultas_processo_mes ELSE GREATEST(max_consultas_processo_mes, 2500) END,
  max_buscas_documento_mes = CASE WHEN max_buscas_documento_mes IS NULL OR max_buscas_documento_mes = 0 THEN max_buscas_documento_mes ELSE GREATEST(max_buscas_documento_mes, 300) END,
  max_resumos_ia_mes = CASE WHEN max_resumos_ia_mes IS NULL OR max_resumos_ia_mes = 0 THEN max_resumos_ia_mes ELSE GREATEST(max_resumos_ia_mes, 400) END
WHERE slug = 'completo';

-- Módulos: cada módulo da cesta do Escala entra na do Sob medida se ainda não
-- estiver lá (a 0200 já deu a lista completa, mas o painel pode ter editado).
UPDATE planos SET modulos_liberados = IF(JSON_CONTAINS(modulos_liberados, JSON_QUOTE('dashboard')), modulos_liberados, JSON_ARRAY_APPEND(modulos_liberados, '$', 'dashboard')) WHERE slug = 'completo';
UPDATE planos SET modulos_liberados = IF(JSON_CONTAINS(modulos_liberados, JSON_QUOTE('configuracoes')), modulos_liberados, JSON_ARRAY_APPEND(modulos_liberados, '$', 'configuracoes')) WHERE slug = 'completo';
UPDATE planos SET modulos_liberados = IF(JSON_CONTAINS(modulos_liberados, JSON_QUOTE('atendimento')), modulos_liberados, JSON_ARRAY_APPEND(modulos_liberados, '$', 'atendimento')) WHERE slug = 'completo';
UPDATE planos SET modulos_liberados = IF(JSON_CONTAINS(modulos_liberados, JSON_QUOTE('clientes')), modulos_liberados, JSON_ARRAY_APPEND(modulos_liberados, '$', 'clientes')) WHERE slug = 'completo';
UPDATE planos SET modulos_liberados = IF(JSON_CONTAINS(modulos_liberados, JSON_QUOTE('kanban')), modulos_liberados, JSON_ARRAY_APPEND(modulos_liberados, '$', 'kanban')) WHERE slug = 'completo';
UPDATE planos SET modulos_liberados = IF(JSON_CONTAINS(modulos_liberados, JSON_QUOTE('agenda')), modulos_liberados, JSON_ARRAY_APPEND(modulos_liberados, '$', 'agenda')) WHERE slug = 'completo';
UPDATE planos SET modulos_liberados = IF(JSON_CONTAINS(modulos_liberados, JSON_QUOTE('processos')), modulos_liberados, JSON_ARRAY_APPEND(modulos_liberados, '$', 'processos')) WHERE slug = 'completo';
UPDATE planos SET modulos_liberados = IF(JSON_CONTAINS(modulos_liberados, JSON_QUOTE('calculos')), modulos_liberados, JSON_ARRAY_APPEND(modulos_liberados, '$', 'calculos')) WHERE slug = 'completo';
UPDATE planos SET modulos_liberados = IF(JSON_CONTAINS(modulos_liberados, JSON_QUOTE('agentes_ia')), modulos_liberados, JSON_ARRAY_APPEND(modulos_liberados, '$', 'agentes_ia')) WHERE slug = 'completo';
UPDATE planos SET modulos_liberados = IF(JSON_CONTAINS(modulos_liberados, JSON_QUOTE('financeiro')), modulos_liberados, JSON_ARRAY_APPEND(modulos_liberados, '$', 'financeiro')) WHERE slug = 'completo';
UPDATE planos SET modulos_liberados = IF(JSON_CONTAINS(modulos_liberados, JSON_QUOTE('contratos')), modulos_liberados, JSON_ARRAY_APPEND(modulos_liberados, '$', 'contratos')) WHERE slug = 'completo';
UPDATE planos SET modulos_liberados = IF(JSON_CONTAINS(modulos_liberados, JSON_QUOTE('smartflow')), modulos_liberados, JSON_ARRAY_APPEND(modulos_liberados, '$', 'smartflow')) WHERE slug = 'completo';
UPDATE planos SET modulos_liberados = IF(JSON_CONTAINS(modulos_liberados, JSON_QUOTE('relatorios')), modulos_liberados, JSON_ARRAY_APPEND(modulos_liberados, '$', 'relatorios')) WHERE slug = 'completo';
UPDATE planos SET modulos_liberados = IF(JSON_CONTAINS(modulos_liberados, JSON_QUOTE('comissoes')), modulos_liberados, JSON_ARRAY_APPEND(modulos_liberados, '$', 'comissoes')) WHERE slug = 'completo';
UPDATE planos SET modulos_liberados = IF(JSON_CONTAINS(modulos_liberados, JSON_QUOTE('ponto')), modulos_liberados, JSON_ARRAY_APPEND(modulos_liberados, '$', 'ponto')) WHERE slug = 'completo';
UPDATE planos SET modulos_liberados = IF(JSON_CONTAINS(modulos_liberados, JSON_QUOTE('backups')), modulos_liberados, JSON_ARRAY_APPEND(modulos_liberados, '$', 'backups')) WHERE slug = 'completo';
UPDATE planos SET modulos_liberados = IF(JSON_CONTAINS(modulos_liberados, JSON_QUOTE('jurisia')), modulos_liberados, JSON_ARRAY_APPEND(modulos_liberados, '$', 'jurisia')) WHERE slug = 'completo';
