-- Povoa o JuridFlow local com dados jurídicos plausíveis, para estudo de
-- tela e para o mockup navegável.
--
--   mariadb --default-character-set=utf8mb4 -uroot juridflow < povoar.sql
--
-- Use SEMPRE `--default-character-set=utf8mb4`. Sem isso a acentuação entra
-- quebrada ("petiÃ§Ã£o") e vira falso achado na captura.
--
-- IDEMPOTENTE: apaga o que ele mesmo criou antes de inserir. Rodar duas
-- vezes sem isso já deixou 20 contatos onde deviam ter 10.
--
-- Os vínculos são resolvidos por NOME, nunca por id fixo: o DELETE faz os
-- ids novos saírem de outra faixa, e referência fixa quebra a chave
-- estrangeira de `leads`.

SET @esc = 1; SET @dono = 1; SET @gestor = 2; SET @atend = 3;

DELETE FROM mensagens WHERE conversaIdMsg IN (SELECT id FROM conversas WHERE escritorioIdConv = @esc);
DELETE FROM conversas WHERE escritorioIdConv = @esc;
DELETE FROM canais_integrados WHERE escritorioId = @esc AND nomeCanal = 'WhatsApp do escritório';
DELETE FROM tarefas WHERE escritorioIdTarefa = @esc;
DELETE FROM eventos_processo WHERE escritorioId = @esc;
DELETE FROM motor_monitoramentos WHERE escritorio_id = @esc;
DELETE FROM asaas_cobrancas WHERE escritorioIdAsaasCob = @esc;
DELETE FROM kanban_cards WHERE escritorioIdKCard = @esc;
DELETE FROM kanban_colunas WHERE funilIdKC IN (SELECT id FROM kanban_funis WHERE escritorioIdKF = @esc);
DELETE FROM kanban_funis WHERE escritorioIdKF = @esc;
DELETE FROM leads WHERE escritorioIdLead = @esc;
DELETE FROM agendamentos WHERE escritorioId = @esc;

-- ── clientes ────────────────────────────────────────────────────────────
-- As 5 fichas do seed de staging ([E2E-SEED]) são reescritas com nome de
-- gente; as outras 5 entram novas. Assim nada depende de id.
UPDATE contatos SET nomeContato='Maria Aparecida Nogueira de Sousa', telefoneContato='(85) 99796-5706',
  emailContato='maria.nogueira@gmail.com', cpfCnpj='810.442.313-04', origemContato='whatsapp',
  estagioContato='cliente', responsavelIdContato=@dono, tagsContato='Trabalhista'
  WHERE escritorioIdContato=@esc AND nomeContato LIKE '%João Silva%';
UPDATE contatos SET nomeContato='Construtora Vale Verde Ltda', telefoneContato='(85) 3255-1180',
  emailContato='financeiro@valeverde.com.br', cpfCnpj='12.884.907/0001-70', origemContato='site',
  estagioContato='cliente', responsavelIdContato=@dono, tagsContato='Cível'
  WHERE escritorioIdContato=@esc AND nomeContato LIKE '%Maria Souza%';
UPDATE contatos SET nomeContato='Francisco Edilson Martins Rocha', telefoneContato='(85) 99120-3344',
  emailContato='edilson.rocha@outlook.com', cpfCnpj='045.771.203-11', origemContato='whatsapp',
  estagioContato='cliente', responsavelIdContato=@gestor, tagsContato='Previdenciário'
  WHERE escritorioIdContato=@esc AND nomeContato LIKE '%Pedro Lima%';
UPDATE contatos SET nomeContato='Antônia Gomes Vasconcelos', telefoneContato='(88) 99733-1201',
  emailContato=NULL, cpfCnpj=NULL, origemContato='whatsapp', estagioContato='lead',
  responsavelIdContato=NULL, tagsContato=NULL
  WHERE escritorioIdContato=@esc AND nomeContato LIKE '%Ana Costa%';
UPDATE contatos SET nomeContato='Comércio de Peças Ipiranga ME', telefoneContato='(85) 3244-9090',
  emailContato='contato@pecasipiranga.com.br', cpfCnpj='33.109.554/0001-05', origemContato='manual',
  estagioContato='cliente', responsavelIdContato=@atend, tagsContato='Cível'
  WHERE escritorioIdContato=@esc AND nomeContato LIKE '%Carlos Pinto%';

DELETE FROM contatos WHERE escritorioIdContato=@esc AND nomeContato IN (
  'José Ribamar da Silva Filho','Laticínios Serra Azul S/A','Raimundo Nonato de Alencar',
  'Cleide Farias do Nascimento','Tirzah Barbosa de Lima');
INSERT INTO contatos (escritorioIdContato,nomeContato,telefoneContato,emailContato,cpfCnpj,origemContato,estagioContato,responsavelIdContato,tagsContato,createdAtContato) VALUES
 (@esc,'José Ribamar da Silva Filho','(85) 98811-1508','ribamar.silva@gmail.com','702.338.115-88','whatsapp','cliente',@dono,'Consumidor',NOW()-INTERVAL 40 DAY),
 (@esc,'Laticínios Serra Azul S/A','(85) 3266-7010','juridico@serraazul.com.br','09.554.221/0001-33','site','cliente',@gestor,'Cível',NOW()-INTERVAL 120 DAY),
 (@esc,'Raimundo Nonato de Alencar','(85) 99455-2277','raimundo.alencar@gmail.com','338.201.774-90','telefone','cliente',@atend,'Trabalhista',NOW()-INTERVAL 15 DAY),
 (@esc,'Cleide Farias do Nascimento','(88) 99733-4412',NULL,NULL,'whatsapp','lead',NULL,NULL,NOW()-INTERVAL 2 DAY),
 (@esc,'Tirzah Barbosa de Lima','(85) 98811-1508',NULL,NULL,'whatsapp','lead',NULL,NULL,NOW()-INTERVAL 1 DAY);

-- atalhos por nome, para o resto do arquivo não usar id fixo
SET @maria  = (SELECT id FROM contatos WHERE escritorioIdContato=@esc AND nomeContato='Maria Aparecida Nogueira de Sousa');
SET @vale   = (SELECT id FROM contatos WHERE escritorioIdContato=@esc AND nomeContato='Construtora Vale Verde Ltda');
SET @edilson= (SELECT id FROM contatos WHERE escritorioIdContato=@esc AND nomeContato='Francisco Edilson Martins Rocha');
SET @antonia= (SELECT id FROM contatos WHERE escritorioIdContato=@esc AND nomeContato='Antônia Gomes Vasconcelos');
SET @ipiranga=(SELECT id FROM contatos WHERE escritorioIdContato=@esc AND nomeContato='Comércio de Peças Ipiranga ME');
SET @ribamar= (SELECT id FROM contatos WHERE escritorioIdContato=@esc AND nomeContato='José Ribamar da Silva Filho');
SET @serra  = (SELECT id FROM contatos WHERE escritorioIdContato=@esc AND nomeContato='Laticínios Serra Azul S/A');
SET @raimundo=(SELECT id FROM contatos WHERE escritorioIdContato=@esc AND nomeContato='Raimundo Nonato de Alencar');
SET @cleide = (SELECT id FROM contatos WHERE escritorioIdContato=@esc AND nomeContato='Cleide Farias do Nascimento');
SET @tirzah = (SELECT id FROM contatos WHERE escritorioIdContato=@esc AND nomeContato='Tirzah Barbosa de Lima');

-- ── Agenda ──────────────────────────────────────────────────────────────
INSERT INTO agendamentos (escritorioId,criadoPorId,responsavelId,tipoAgendamento,titulo,descricao,dataInicio,dataFim,diaInteiro,local,prioridade,statusAgendamento,contatoIdAgend,corHex,createdAtAgend) VALUES
 (@esc,@dono,@dono,'audiencia','Audiência de instrução','3ª Vara do Trabalho de Fortaleza',CURDATE()+INTERVAL 8 HOUR+INTERVAL 30 MINUTE,CURDATE()+INTERVAL 10 HOUR,0,'Fórum Autran Nunes — sala 204','critica','pendente',@maria,'#a8231b',NOW()),
 (@esc,@dono,@dono,'reuniao_comercial','Reunião — proposta de acordo','Construtora Vale Verde',CURDATE()+INTERVAL 10 HOUR,CURDATE()+INTERVAL 11 HOUR,0,'Escritório','normal','pendente',@vale,'#194b86',NOW()),
 (@esc,@dono,@gestor,'audiencia','Perícia médica','INSS — agência Centro',CURDATE()+INTERVAL 14 HOUR,CURDATE()+INTERVAL 15 HOUR,0,'INSS Centro','alta','pendente',@edilson,'#8a5a0b',NOW()),
 (@esc,@dono,@atend,'follow_up','Ligar para a cliente','Retorno do WhatsApp de ontem',CURDATE()+INTERVAL 16 HOUR+INTERVAL 30 MINUTE,CURDATE()+INTERVAL 17 HOUR,0,NULL,'normal','pendente',@antonia,'#6d7d8c',NOW()),
 (@esc,@dono,@gestor,'prazo_processual','Prazo: contestação','0056789-12.2024.8.06.0001',CURDATE()-INTERVAL 1 DAY+INTERVAL 12 HOUR,CURDATE()-INTERVAL 1 DAY+INTERVAL 13 HOUR,0,NULL,'critica','atrasado',@ribamar,'#a8231b',NOW()),
 (@esc,@dono,@gestor,'audiencia','Audiência de conciliação','Juizado Especial Cível',CURDATE()+INTERVAL 1 DAY+INTERVAL 9 HOUR,CURDATE()+INTERVAL 1 DAY+INTERVAL 10 HOUR,0,'Juizado Especial — Centro','alta','pendente',@raimundo,'#194b86',NOW()),
 (@esc,@dono,@atend,'reuniao_comercial','Assinatura de contrato','Comércio de Peças Ipiranga',CURDATE()+INTERVAL 1 DAY+INTERVAL 11 HOUR+INTERVAL 30 MINUTE,CURDATE()+INTERVAL 1 DAY+INTERVAL 12 HOUR,0,'Escritório','normal','pendente',@ipiranga,'#097245',NOW()),
 (@esc,@dono,@dono,'tarefa','Protocolar recurso inominado','Prazo fatal em 5 dias',CURDATE()+INTERVAL 2 DAY+INTERVAL 15 HOUR,CURDATE()+INTERVAL 2 DAY+INTERVAL 16 HOUR,0,NULL,'alta','pendente',@maria,'#8a5a0b',NOW());

-- ── Pipeline / leads (alimenta Atendimento e o Relatório Comercial) ─────
INSERT INTO leads (escritorioIdLead,contatoIdLead,responsavelIdLead,etapaFunil,valorEstimado,origemLead,probabilidade,createdAtLead,fechadoEmLead) VALUES
 (@esc,@maria,@dono,'fechado_ganho','12000','Indicação',100,NOW()-INTERVAL 35 DAY,NOW()-INTERVAL 30 DAY),
 (@esc,@vale,@dono,'fechado_ganho','48500','Google',100,NOW()-INTERVAL 60 DAY,NOW()-INTERVAL 52 DAY),
 (@esc,@edilson,@gestor,'fechado_ganho','7400','Indicação',100,NOW()-INTERVAL 20 DAY,NOW()-INTERVAL 12 DAY),
 (@esc,@ipiranga,@atend,'fechado_ganho','9800','Instagram',100,NOW()-INTERVAL 18 DAY,NOW()-INTERVAL 9 DAY),
 (@esc,@serra,@gestor,'fechado_ganho','95000','Site',100,NOW()-INTERVAL 90 DAY,NOW()-INTERVAL 80 DAY),
 (@esc,@antonia,@atend,'negociacao','3200','WhatsApp',60,NOW()-INTERVAL 6 DAY,NULL),
 (@esc,@cleide,@atend,'qualificado','5000','WhatsApp',40,NOW()-INTERVAL 2 DAY,NULL),
 (@esc,@tirzah,NULL,'novo',NULL,'WhatsApp',10,NOW()-INTERVAL 1 DAY,NULL),
 (@esc,@raimundo,@gestor,'proposta','14500','Indicação',70,NOW()-INTERVAL 4 DAY,NULL),
 (@esc,@ribamar,@dono,'fechado_perdido','6000','Google',0,NOW()-INTERVAL 25 DAY,NOW()-INTERVAL 14 DAY);

-- ── Kanban ──────────────────────────────────────────────────────────────
INSERT INTO kanban_funis (escritorioIdKF,nomeKF,descricaoKF,corKF,criadoPorKF,createdAtKF,prazoPadraoDiasKF)
 VALUES (@esc,'Produção de peças','Fluxo das petições do escritório','#194b86',@dono,NOW(),15);
SET @f = LAST_INSERT_ID();
INSERT INTO kanban_colunas (funilIdKC,nomeKC,corKC,ordemKC,createdAtKC,tipoKC) VALUES
 (@f,'A fazer','#6d7d8c',0,NOW(),'normal'),(@f,'Em produção','#194b86',1,NOW(),'normal'),
 (@f,'Revisão','#8a5a0b',2,NOW(),'normal'),(@f,'Protocolado','#097245',3,NOW(),'conclusao');
SET @c1=(SELECT id FROM kanban_colunas WHERE funilIdKC=@f AND ordemKC=0);
SET @c2=(SELECT id FROM kanban_colunas WHERE funilIdKC=@f AND ordemKC=1);
SET @c3=(SELECT id FROM kanban_colunas WHERE funilIdKC=@f AND ordemKC=2);
SET @c4=(SELECT id FROM kanban_colunas WHERE funilIdKC=@f AND ordemKC=3);
INSERT INTO kanban_cards (escritorioIdKCard,colunaIdKCard,tituloKCard,descricaoKCard,cnjKCard,clienteIdKCard,responsavelIdKCard,prioridadeKCard,prazoKCard,tagsKCard,ordemKCard,createdAtKCard,atrasadoKCard,valorEstimadoKCard) VALUES
 (@esc,@c1,'Contestação — Vale Verde','Prazo de 15 dias, citação em 02/09','0034521-89.2023.8.06.0170',@vale,@dono,'alta',CURDATE()+INTERVAL 5 DAY,'Cível, Contestação',0,NOW(),0,4850.00),
 (@esc,@c1,'Recurso inominado','Sentença parcialmente procedente','0056789-12.2024.8.06.0001',@ribamar,@gestor,'alta',CURDATE()-INTERVAL 1 DAY,'Consumidor',1,NOW(),1,1850.00),
 (@esc,@c2,'Petição inicial — aposentadoria','Documentação completa','1004567-22.2025.4.01.3100',@edilson,@gestor,'media',CURDATE()+INTERVAL 9 DAY,'Previdenciário',0,NOW(),0,7400.00),
 (@esc,@c2,'Réplica','Aguardando documentos do cliente','0812345-67.2024.8.06.0001',@maria,@dono,'media',CURDATE()+INTERVAL 3 DAY,'Trabalhista',1,NOW(),0,NULL),
 (@esc,@c3,'Memoriais','Revisão do sócio','0091234-56.2023.8.06.0001',@serra,@dono,'baixa',CURDATE()+INTERVAL 12 DAY,'Cível',0,NOW(),0,NULL),
 (@esc,@c4,'Embargos de declaração','Protocolado em 08/09','0700891-45.2024.8.06.0064',@raimundo,@atend,'media',CURDATE()-INTERVAL 3 DAY,'Cível',0,NOW(),0,NULL);

-- ── Financeiro (cobranças manuais) ──────────────────────────────────────
INSERT INTO asaas_cobrancas (escritorioIdAsaasCob,contatoIdAsaasCob,valorAsaas,vencimentoAsaas,formaPagAsaas,statusAsaasCob,descricaoAsaas,dataPagamentoAsaas,atendenteIdAsaasCob,createdAtAsaasCob,origemAsaasCob,parcelaAtual,parcelaTotal) VALUES
 (@esc,@maria,'2000.00',DATE_FORMAT(CURDATE()+INTERVAL 9 DAY,'%Y-%m-%d'),'PIX','PENDING','Honorários — parcela 4/6',NULL,@dono,NOW(),'manual',4,6),
 (@esc,@vale,'4850.00',DATE_FORMAT(CURDATE()+INTERVAL 4 DAY,'%Y-%m-%d'),'BOLETO','PENDING','Honorários — parcela 8/10',NULL,@dono,NOW(),'manual',8,10),
 (@esc,@ribamar,'1850.00',DATE_FORMAT(CURDATE()-INTERVAL 13 DAY,'%Y-%m-%d'),'PIX','OVERDUE','Acordo — parcela 2/4',NULL,@dono,NOW(),'manual',2,4),
 (@esc,@antonia,'1600.00',DATE_FORMAT(CURDATE()-INTERVAL 10 DAY,'%Y-%m-%d'),'BOLETO','OVERDUE','Entrada do acordo',NULL,@atend,NOW(),'manual',1,2),
 (@esc,@ipiranga,'1200.00',DATE_FORMAT(CURDATE()-INTERVAL 1 DAY,'%Y-%m-%d'),'PIX','RECEIVED','Consultoria mensal',DATE_FORMAT(CURDATE()-INTERVAL 2 DAY,'%Y-%m-%d'),@atend,NOW(),'manual',NULL,NULL),
 (@esc,@raimundo,'900.00',DATE_FORMAT(CURDATE()+INTERVAL 14 DAY,'%Y-%m-%d'),'PIX','PENDING','Honorários — parcela 1/3',NULL,@gestor,NOW(),'manual',1,3),
 (@esc,@serra,'9500.00',DATE_FORMAT(CURDATE()-INTERVAL 5 DAY,'%Y-%m-%d'),'TRANSFERENCIA','RECEIVED','Honorários — parcela 12/12',DATE_FORMAT(CURDATE()-INTERVAL 5 DAY,'%Y-%m-%d'),@gestor,NOW(),'manual',12,12);

-- ── Processos: monitoramentos ───────────────────────────────────────────
-- `tribunal` é NOT NULL: até o monitoramento por CPF precisa de um valor.
INSERT INTO motor_monitoramentos (escritorio_id,criado_por,tipo_monitoramento,search_type,search_key,apelido,tribunal,status,recurrence_horas,ultima_consulta_em,ultima_movimentacao_em,ultima_movimentacao_texto,total_atualizacoes,created_at,updated_at,subiu_2grau) VALUES
 (@esc,@dono,'movimentacoes','lawsuit_cnj','0812345-67.2024.8.06.0001','Maria Aparecida Nogueira de Sousa','tjce','ativo',24,NOW()-INTERVAL 2 HOUR,NOW()-INTERVAL 2 HOUR,'Juntada de petição — recurso inominado da parte autora',14,NOW()-INTERVAL 60 DAY,NOW(),1),
 (@esc,@dono,'movimentacoes','lawsuit_cnj','0034521-89.2023.8.06.0170','Construtora Vale Verde Ltda','tjce','ativo',24,NOW()-INTERVAL 1 DAY,NOW()-INTERVAL 1 DAY,'Despacho: cite-se a parte requerida',9,NOW()-INTERVAL 90 DAY,NOW(),0),
 (@esc,@gestor,'movimentacoes','lawsuit_cnj','1004567-22.2025.4.01.3100','Francisco Edilson Martins Rocha','trf1','erro',24,NOW()-INTERVAL 12 DAY,NOW()-INTERVAL 12 DAY,NULL,3,NOW()-INTERVAL 30 DAY,NOW(),0),
 (@esc,@atend,'movimentacoes','lawsuit_cnj','0700891-45.2024.8.06.0064','Antônia Gomes Vasconcelos','tjce','pausado',24,NULL,NULL,NULL,0,NOW()-INTERVAL 10 DAY,NOW(),0),
 (@esc,@dono,'movimentacoes','lawsuit_cnj','0056789-12.2024.8.06.0001','José Ribamar da Silva Filho','tjce','ativo',24,NOW()-INTERVAL 3 DAY,NOW()-INTERVAL 3 DAY,'Sentença publicada — procedente em parte',21,NOW()-INTERVAL 150 DAY,NOW(),0),
 (@esc,@gestor,'movimentacoes','lawsuit_cnj','0091234-56.2023.8.06.0001','Laticínios Serra Azul S/A','tjce','ativo',24,NOW()-INTERVAL 6 DAY,NOW()-INTERVAL 6 DAY,'Conclusos para julgamento — 3ª Câmara de Direito Privado',33,NOW()-INTERVAL 200 DAY,NOW(),1),
 (@esc,@dono,'novas_acoes','cpf','810.442.313-04','Maria Aparecida — novas ações','tjce','ativo',24,NOW()-INTERVAL 5 HOUR,NULL,NULL,0,NOW()-INTERVAL 30 DAY,NOW(),0);

UPDATE motor_monitoramentos SET ultimo_erro='Login falhou no tribunal — senha do Cofre recusada'
  WHERE escritorio_id=@esc AND status='erro';

-- ── Movimentações (a lista principal da tela Processos) ─────────────────
-- `hashDedup` é NOT NULL sem default.
INSERT INTO eventos_processo (monitoramentoId,escritorioId,tipoEvento,dataEvento,fonteEvento,conteudo,cnjAfetado,hashDedup,lido,alertaEnviado,createdAtEvento,relevanciaEvento,resolucaoEvento,poloClienteEvento)
SELECT m.id,@esc,e.tipo,e.quando,'pje',e.txt,m.search_key,SHA2(CONCAT(m.id,e.txt),256),e.lido,0,e.quando,e.rel,'pendente','passivo'
FROM motor_monitoramentos m JOIN (
  SELECT '0812345-67.2024.8.06.0001' cnj,'movimentacao' tipo, NOW()-INTERVAL 2 HOUR quando,'Juntada de petição — recurso inominado da parte autora' txt,0 lido,'relevante' rel UNION ALL
  SELECT '0812345-67.2024.8.06.0001','despacho', NOW()-INTERVAL 3 DAY,'Vista dos autos à parte contrária pelo prazo legal',0,'rotina' UNION ALL
  SELECT '0034521-89.2023.8.06.0170','citacao', NOW()-INTERVAL 1 DAY,'Despacho: cite-se a parte requerida',0,'relevante' UNION ALL
  SELECT '0056789-12.2024.8.06.0001','sentenca', NOW()-INTERVAL 3 DAY,'Sentença publicada — procedente em parte. Prazo recursal em curso.',0,'relevante' UNION ALL
  SELECT '0056789-12.2024.8.06.0001','publicacao_dje', NOW()-INTERVAL 8 DAY,'Publicação no DJe — intimação das partes',0,'rotina' UNION ALL
  SELECT '0091234-56.2023.8.06.0001','movimentacao', NOW()-INTERVAL 6 DAY,'Conclusos para julgamento — 3ª Câmara de Direito Privado',0,'rotina' UNION ALL
  SELECT '0091234-56.2023.8.06.0001','audiencia', NOW()-INTERVAL 20 DAY,'Audiência de conciliação realizada — sem acordo',1,'relevante'
) e ON e.cnj = m.search_key
WHERE m.escritorio_id = @esc;

-- ── Atendimento: canal, conversas e mensagens ───────────────────────────
-- Sem isso a tela mais usada do sistema aparece vazia no mockup — e tela
-- vazia esconde defeito (foi assim que quatro telas "não rolavam de lado").
INSERT INTO canais_integrados (escritorioId,tipoCanal,nomeCanal,statusCanal,telefoneCanal,ultimaSyncCanal,padraoEnvio,createdAtCanal)
 VALUES (@esc,'whatsapp_api','WhatsApp do escritório','conectado','5585991080343',NOW(),1,NOW());
SET @canal = LAST_INSERT_ID();

INSERT INTO conversas (escritorioIdConv,contatoIdConv,canalIdConv,atendenteIdConv,statusConv,prioridadeConv,assuntoConv,chatIdExterno,ultimaMensagemAt,ultimaMensagemPreview,atendimentoIniciadoEmConv,createdAtConv) VALUES
 (@esc,@tirzah,@canal,NULL,'aguardando','normal',NULL,'558588111508',NOW()-INTERVAL 4 MINUTE,'Boa tarde! Vi o anúncio de vocês, queria falar sobre uma rescisão',NOW()-INTERVAL 9 MINUTE,NOW()-INTERVAL 9 MINUTE),
 (@esc,@cleide,@canal,@atend,'em_atendimento','alta','Auxílio-doença negado','558897334412',NOW()-INTERVAL 21 MINUTE,'Então eu levo os exames amanhã de manhã?',NOW()-INTERVAL 2 HOUR,NOW()-INTERVAL 2 HOUR),
 (@esc,@maria,@canal,@dono,'em_atendimento','normal','Audiência de instrução','558597965706',NOW()-INTERVAL 1 HOUR,'Dra., confirmo presença na audiência de amanhã',NOW()-INTERVAL 3 HOUR,NOW()-INTERVAL 3 HOUR),
 (@esc,@antonia,@canal,@atend,'aguardando','urgente','Entrada do acordo em atraso','558897331201',NOW()-INTERVAL 35 MINUTE,'Consigo pagar na sexta, pode ser?',NOW()-INTERVAL 50 MINUTE,NOW()-INTERVAL 50 MINUTE),
 (@esc,@edilson,@canal,@gestor,'resolvido','normal','Perícia do INSS','558599120344',NOW()-INTERVAL 1 DAY,'Obrigado, doutor! Até amanhã então',NOW()-INTERVAL 1 DAY,NOW()-INTERVAL 1 DAY),
 (@esc,@ribamar,@canal,@dono,'em_atendimento','alta','Sentença — recurso','558598111508',NOW()-INTERVAL 2 HOUR,'Eu quero recorrer sim, o valor ficou muito baixo',NOW()-INTERVAL 5 HOUR,NOW()-INTERVAL 5 HOUR);

SET @cv_tirzah = (SELECT id FROM conversas WHERE escritorioIdConv=@esc AND contatoIdConv=@tirzah LIMIT 1);
SET @cv_cleide = (SELECT id FROM conversas WHERE escritorioIdConv=@esc AND contatoIdConv=@cleide LIMIT 1);
SET @cv_maria  = (SELECT id FROM conversas WHERE escritorioIdConv=@esc AND contatoIdConv=@maria  LIMIT 1);
SET @cv_antonia= (SELECT id FROM conversas WHERE escritorioIdConv=@esc AND contatoIdConv=@antonia LIMIT 1);
SET @cv_ribamar= (SELECT id FROM conversas WHERE escritorioIdConv=@esc AND contatoIdConv=@ribamar LIMIT 1);

INSERT INTO mensagens (conversaIdMsg,remetenteIdMsg,direcaoMsg,tipoMsg,conteudoMsg,statusMsg,createdAtMsg,origemMsg) VALUES
 (@cv_tirzah,NULL,'entrada','texto','Boa tarde! Vi o anúncio de vocês, queria falar sobre uma rescisão','lida',NOW()-INTERVAL 4 MINUTE,'whatsapp'),
 (@cv_cleide,NULL,'entrada','texto','Doutor, o INSS negou meu auxílio-doença. Recebi a carta hoje.','lida',NOW()-INTERVAL 2 HOUR,'whatsapp'),
 (@cv_cleide,3,'saida','texto','Boa tarde, Cleide. Me manda foto da carta de negativa e dos seus exames, por favor.','lida',NOW()-INTERVAL 100 MINUTE,'whatsapp'),
 (@cv_cleide,NULL,'entrada','texto','Então eu levo os exames amanhã de manhã?','lida',NOW()-INTERVAL 21 MINUTE,'whatsapp'),
 (@cv_maria,NULL,'entrada','texto','Dra., confirmo presença na audiência de amanhã','lida',NOW()-INTERVAL 1 HOUR,'whatsapp'),
 (@cv_maria,1,'saida','texto','Perfeito, Maria. Chegue 30 minutos antes, no Fórum Autran Nunes, sala 204.','entregue',NOW()-INTERVAL 55 MINUTE,'whatsapp'),
 (@cv_antonia,NULL,'entrada','texto','Consigo pagar na sexta, pode ser?','lida',NOW()-INTERVAL 35 MINUTE,'whatsapp'),
 (@cv_ribamar,NULL,'entrada','texto','Eu quero recorrer sim, o valor ficou muito baixo','lida',NOW()-INTERVAL 2 HOUR,'whatsapp');

-- ── Tarefas ─────────────────────────────────────────────────────────────
INSERT INTO tarefas (escritorioIdTarefa,contatoIdTarefa,responsavelIdTarefa,criadoPorTarefa,tituloTarefa,descricaoTarefa,statusTarefa,prioridadeTarefa,dataVencimento,concluidaAt,createdAtTarefa) VALUES
 (@esc,@vale,@dono,@dono,'Juntar procuração assinada da Vale Verde','Escaneada, frente e verso','pendente','alta',CURDATE()+INTERVAL 1 DAY,NULL,NOW()-INTERVAL 2 DAY),
 (@esc,@ribamar,@gestor,@dono,'Calcular valor do recurso inominado','Conferir o teto do Juizado','em_andamento','urgente',CURDATE(),NULL,NOW()-INTERVAL 1 DAY),
 (@esc,@edilson,@gestor,@gestor,'Pedir laudo do ortopedista','Dr. Marcos — clínica do Centro','pendente','normal',CURDATE()+INTERVAL 3 DAY,NULL,NOW()-INTERVAL 4 DAY),
 (@esc,@maria,@dono,@dono,'Preparar perguntas das testemunhas','Audiência de instrução','em_andamento','alta',CURDATE()+INTERVAL 1 DAY,NULL,NOW()-INTERVAL 3 DAY),
 (@esc,@antonia,@atend,@atend,'Cobrar entrada do acordo','Venceu há 10 dias','pendente','urgente',CURDATE()-INTERVAL 2 DAY,NULL,NOW()-INTERVAL 12 DAY),
 (@esc,@ipiranga,@atend,@dono,'Enviar contrato de consultoria','Modelo novo, com cláusula de reajuste','concluida','normal',CURDATE()-INTERVAL 5 DAY,NOW()-INTERVAL 5 DAY,NOW()-INTERVAL 9 DAY),
 (@esc,@serra,@dono,@gestor,'Protocolar memoriais','Revisado pelo sócio','concluida','alta',CURDATE()-INTERVAL 1 DAY,NOW()-INTERVAL 1 DAY,NOW()-INTERVAL 6 DAY);
