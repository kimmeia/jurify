SET @esc = 1; SET @dono = 1; SET @gestor = 2; SET @atend = 3;

-- ── clientes com nome de gente, no lugar dos [E2E-SEED] ──
UPDATE contatos SET nomeContato='Maria Aparecida Nogueira de Sousa', telefoneContato='(85) 99796-5706',
  emailContato='maria.nogueira@gmail.com', cpfCnpj='810.442.313-04', origemContato='whatsapp',
  estagioContato='cliente', responsavelIdContato=@dono, tagsContato='Trabalhista' WHERE id=1;
UPDATE contatos SET nomeContato='Construtora Vale Verde Ltda', telefoneContato='(85) 3255-1180',
  emailContato='financeiro@valeverde.com.br', cpfCnpj='12.884.907/0001-70', origemContato='site',
  estagioContato='cliente', responsavelIdContato=@dono, tagsContato='Cível' WHERE id=2;
UPDATE contatos SET nomeContato='Francisco Edilson Martins Rocha', telefoneContato='(85) 99120-3344',
  emailContato='edilson.rocha@outlook.com', cpfCnpj='045.771.203-11', origemContato='whatsapp',
  estagioContato='cliente', responsavelIdContato=@gestor, tagsContato='Previdenciário' WHERE id=3;
UPDATE contatos SET nomeContato='Antônia Gomes Vasconcelos', telefoneContato='(88) 99733-1201',
  emailContato=NULL, cpfCnpj=NULL, origemContato='whatsapp', estagioContato='lead',
  responsavelIdContato=NULL, tagsContato=NULL WHERE id=4;
UPDATE contatos SET nomeContato='Comércio de Peças Ipiranga ME', telefoneContato='(85) 3244-9090',
  emailContato='contato@pecasipiranga.com.br', cpfCnpj='33.109.554/0001-05', origemContato='manual',
  estagioContato='cliente', responsavelIdContato=@atend, tagsContato='Cível' WHERE id=5;

INSERT INTO contatos (escritorioIdContato,nomeContato,telefoneContato,emailContato,cpfCnpj,origemContato,estagioContato,responsavelIdContato,tagsContato,createdAtContato) VALUES
 (@esc,'José Ribamar da Silva Filho','(85) 98811-1508','ribamar.silva@gmail.com','702.338.115-88','whatsapp','cliente',@dono,'Consumidor',NOW()-INTERVAL 40 DAY),
 (@esc,'Laticínios Serra Azul S/A','(85) 3266-7010','juridico@serraazul.com.br','09.554.221/0001-33','site','cliente',@gestor,'Cível',NOW()-INTERVAL 120 DAY),
 (@esc,'Raimundo Nonato de Alencar','(85) 99455-2277','raimundo.alencar@gmail.com','338.201.774-90','telefone','cliente',@atend,'Trabalhista',NOW()-INTERVAL 15 DAY),
 (@esc,'Cleide Farias do Nascimento','(88) 99733-4412',NULL,NULL,'whatsapp','lead',NULL,NULL,NOW()-INTERVAL 2 DAY),
 (@esc,'Tirzah Barbosa de Lima','(85) 98811-1508',NULL,NULL,'whatsapp','lead',NULL,NULL,NOW()-INTERVAL 1 DAY);

-- ── Agenda ──
INSERT INTO agendamentos (escritorioId,criadoPorId,responsavelId,tipoAgendamento,titulo,descricao,dataInicio,dataFim,diaInteiro,local,prioridade,statusAgendamento,contatoIdAgend,corHex,createdAtAgend) VALUES
 (@esc,@dono,@dono,'audiencia','Audiência de instrução','3ª Vara do Trabalho de Fortaleza',CURDATE()+INTERVAL 8 HOUR+INTERVAL 30 MINUTE,CURDATE()+INTERVAL 10 HOUR,0,'Fórum Autran Nunes — sala 204','critica','pendente',1,'#a8231b',NOW()),
 (@esc,@dono,@dono,'reuniao_comercial','Reunião — proposta de acordo','Construtora Vale Verde',CURDATE()+INTERVAL 10 HOUR,CURDATE()+INTERVAL 11 HOUR,0,'Escritório','normal','pendente',2,'#194b86',NOW()),
 (@esc,@dono,@gestor,'audiencia','Perícia médica','INSS — agência Centro',CURDATE()+INTERVAL 14 HOUR,CURDATE()+INTERVAL 15 HOUR,0,'INSS Centro','alta','pendente',3,'#8a5a0b',NOW()),
 (@esc,@dono,@atend,'follow_up','Ligar para a cliente','Retorno do WhatsApp de ontem',CURDATE()+INTERVAL 16 HOUR+INTERVAL 30 MINUTE,CURDATE()+INTERVAL 17 HOUR,0,NULL,'normal','pendente',4,'#6d7d8c',NOW()),
 (@esc,@dono,@gestor,'prazo_processual','Prazo: contestação','0056789-12.2024.8.06.0001',CURDATE()-INTERVAL 1 DAY+INTERVAL 12 HOUR,CURDATE()-INTERVAL 1 DAY+INTERVAL 13 HOUR,0,NULL,'critica','atrasado',6,'#a8231b',NOW()),
 (@esc,@dono,@gestor,'audiencia','Audiência de conciliação','Juizado Especial Cível',CURDATE()+INTERVAL 1 DAY+INTERVAL 9 HOUR,CURDATE()+INTERVAL 1 DAY+INTERVAL 10 HOUR,0,'Juizado Especial — Centro','alta','pendente',8,'#194b86',NOW()),
 (@esc,@dono,@atend,'reuniao_comercial','Assinatura de contrato','Comércio de Peças Ipiranga',CURDATE()+INTERVAL 1 DAY+INTERVAL 11 HOUR+INTERVAL 30 MINUTE,CURDATE()+INTERVAL 1 DAY+INTERVAL 12 HOUR,0,'Escritório','normal','pendente',5,'#097245',NOW()),
 (@esc,@dono,@dono,'tarefa','Protocolar recurso inominado','Prazo fatal em 5 dias',CURDATE()+INTERVAL 2 DAY+INTERVAL 15 HOUR,CURDATE()+INTERVAL 2 DAY+INTERVAL 16 HOUR,0,NULL,'alta','pendente',1,'#8a5a0b',NOW());

-- ── Pipeline / leads (alimenta Atendimento + Relatório Comercial) ──
INSERT INTO leads (escritorioIdLead,contatoIdLead,responsavelIdLead,etapaFunil,valorEstimado,origemLead,probabilidade,createdAtLead,fechadoEmLead) VALUES
 (@esc,1,@dono,'fechado_ganho','12000','Indicação',100,NOW()-INTERVAL 35 DAY,NOW()-INTERVAL 30 DAY),
 (@esc,2,@dono,'fechado_ganho','48500','Google',100,NOW()-INTERVAL 60 DAY,NOW()-INTERVAL 52 DAY),
 (@esc,3,@gestor,'fechado_ganho','7400','Indicação',100,NOW()-INTERVAL 20 DAY,NOW()-INTERVAL 12 DAY),
 (@esc,5,@atend,'fechado_ganho','9800','Instagram',100,NOW()-INTERVAL 18 DAY,NOW()-INTERVAL 9 DAY),
 (@esc,7,@gestor,'fechado_ganho','95000','Site',100,NOW()-INTERVAL 90 DAY,NOW()-INTERVAL 80 DAY),
 (@esc,4,@atend,'negociacao','3200','WhatsApp',60,NOW()-INTERVAL 6 DAY,NULL),
 (@esc,9,@atend,'qualificado','5000','WhatsApp',40,NOW()-INTERVAL 2 DAY,NULL),
 (@esc,10,NULL,'novo',NULL,'WhatsApp',10,NOW()-INTERVAL 1 DAY,NULL),
 (@esc,8,@gestor,'proposta','14500','Indicação',70,NOW()-INTERVAL 4 DAY,NULL),
 (@esc,6,@dono,'fechado_perdido','6000','Google',0,NOW()-INTERVAL 25 DAY,NOW()-INTERVAL 14 DAY);

-- ── Kanban ──
INSERT INTO kanban_funis (escritorioIdKF,nomeKF,descricaoKF,corKF,criadoPorKF,createdAtKF,prazoPadraoDiasKF)
 VALUES (@esc,'Produção de peças','Fluxo das petições do escritório','#194b86',@dono,NOW(),15);
SET @f = LAST_INSERT_ID();
INSERT INTO kanban_colunas (funilIdKC,nomeKC,corKC,ordemKC,createdAtKC,tipoKC) VALUES
 (@f,'A fazer','#6d7d8c',0,NOW(),'normal'),(@f,'Em produção','#194b86',1,NOW(),'normal'),
 (@f,'Revisão','#8a5a0b',2,NOW(),'normal'),(@f,'Protocolado','#097245',3,NOW(),'conclusao');
SET @c1=@f*0+(SELECT id FROM kanban_colunas WHERE funilIdKC=@f AND ordemKC=0);
SET @c2=(SELECT id FROM kanban_colunas WHERE funilIdKC=@f AND ordemKC=1);
SET @c3=(SELECT id FROM kanban_colunas WHERE funilIdKC=@f AND ordemKC=2);
SET @c4=(SELECT id FROM kanban_colunas WHERE funilIdKC=@f AND ordemKC=3);
INSERT INTO kanban_cards (escritorioIdKCard,colunaIdKCard,tituloKCard,descricaoKCard,cnjKCard,clienteIdKCard,responsavelIdKCard,prioridadeKCard,prazoKCard,tagsKCard,ordemKCard,createdAtKCard,atrasadoKCard,valorEstimadoKCard) VALUES
 (@esc,@c1,'Contestação — Vale Verde','Prazo de 15 dias, citação em 02/09','0034521-89.2023.8.06.0170',2,@dono,'alta',CURDATE()+INTERVAL 5 DAY,'Cível, Contestação',0,NOW(),0,4850.00),
 (@esc,@c1,'Recurso inominado','Sentença parcialmente procedente','0056789-12.2024.8.06.0001',6,@gestor,'alta',CURDATE()-INTERVAL 1 DAY,'Consumidor',1,NOW(),1,1850.00),
 (@esc,@c2,'Petição inicial — aposentadoria','Documentação completa','1004567-22.2025.4.01.3100',3,@gestor,'media',CURDATE()+INTERVAL 9 DAY,'Previdenciário',0,NOW(),0,7400.00),
 (@esc,@c2,'Réplica','Aguardando documentos do cliente','0812345-67.2024.8.06.0001',1,@dono,'media',CURDATE()+INTERVAL 3 DAY,'Trabalhista',1,NOW(),0,NULL),
 (@esc,@c3,'Memoriais','Revisão do sócio','0091234-56.2023.8.06.0001',7,@dono,'baixa',CURDATE()+INTERVAL 12 DAY,'Cível',0,NOW(),0,NULL),
 (@esc,@c4,'Embargos de declaração','Protocolado em 08/09','0700891-45.2024.8.06.0064',8,@atend,'media',CURDATE()-INTERVAL 3 DAY,'Cível',0,NOW(),0,NULL);

-- ── Financeiro (cobranças manuais) ──
INSERT INTO asaas_cobrancas (escritorioIdAsaasCob,contatoIdAsaasCob,valorAsaas,vencimentoAsaas,formaPagAsaas,statusAsaasCob,descricaoAsaas,dataPagamentoAsaas,atendenteIdAsaasCob,createdAtAsaasCob,origemAsaasCob,parcelaAtual,parcelaTotal) VALUES
 (@esc,1,'2000.00',DATE_FORMAT(CURDATE()+INTERVAL 9 DAY,'%Y-%m-%d'),'PIX','PENDING','Honorários — parcela 4/6',NULL,@dono,NOW(),'manual',4,6),
 (@esc,2,'4850.00',DATE_FORMAT(CURDATE()+INTERVAL 4 DAY,'%Y-%m-%d'),'BOLETO','PENDING','Honorários — parcela 8/10',NULL,@dono,NOW(),'manual',8,10),
 (@esc,6,'1850.00',DATE_FORMAT(CURDATE()-INTERVAL 13 DAY,'%Y-%m-%d'),'PIX','OVERDUE','Acordo — parcela 2/4',NULL,@dono,NOW(),'manual',2,4),
 (@esc,4,'1600.00',DATE_FORMAT(CURDATE()-INTERVAL 10 DAY,'%Y-%m-%d'),'BOLETO','OVERDUE','Entrada do acordo',NULL,@atend,NOW(),'manual',1,2),
 (@esc,5,'1200.00',DATE_FORMAT(CURDATE()-INTERVAL 1 DAY,'%Y-%m-%d'),'PIX','RECEIVED','Consultoria mensal',DATE_FORMAT(CURDATE()-INTERVAL 2 DAY,'%Y-%m-%d'),@atend,NOW(),'manual',NULL,NULL),
 (@esc,8,'900.00',DATE_FORMAT(CURDATE()+INTERVAL 14 DAY,'%Y-%m-%d'),'PIX','PENDING','Honorários — parcela 1/3',NULL,@gestor,NOW(),'manual',1,3),
 (@esc,7,'9500.00',DATE_FORMAT(CURDATE()-INTERVAL 5 DAY,'%Y-%m-%d'),'TRANSFERENCIA','RECEIVED','Honorários — parcela 12/12',DATE_FORMAT(CURDATE()-INTERVAL 5 DAY,'%Y-%m-%d'),@gestor,NOW(),'manual',12,12);

-- ── Processos: monitoramentos + movimentações ──
INSERT INTO motor_monitoramentos (escritorio_id,criado_por,tipo_monitoramento,search_type,search_key,apelido,tribunal,status,recurrence_horas,ultima_consulta_em,ultima_movimentacao_em,ultima_movimentacao_texto,total_atualizacoes,created_at,updated_at,subiu_2grau) VALUES
 (@esc,@dono,'movimentacoes','lawsuit_cnj','0812345-67.2024.8.06.0001','Maria Aparecida Nogueira de Sousa','tjce','ativo',24,NOW()-INTERVAL 2 HOUR,NOW()-INTERVAL 2 HOUR,'Juntada de petição — recurso inominado da parte autora',14,NOW()-INTERVAL 60 DAY,NOW(),1),
 (@esc,@dono,'movimentacoes','lawsuit_cnj','0034521-89.2023.8.06.0170','Construtora Vale Verde Ltda','tjce','ativo',24,NOW()-INTERVAL 1 DAY,NOW()-INTERVAL 1 DAY,'Despacho: cite-se a parte requerida',9,NOW()-INTERVAL 90 DAY,NOW(),0),
 (@esc,@gestor,'movimentacoes','lawsuit_cnj','1004567-22.2025.4.01.3100','Francisco Edilson Martins Rocha','trf1','erro',24,NOW()-INTERVAL 12 DAY,NOW()-INTERVAL 12 DAY,NULL,3,NOW()-INTERVAL 30 DAY,NOW(),0),
 (@esc,@atend,'movimentacoes','lawsuit_cnj','0700891-45.2024.8.06.0064','Antônia Gomes Vasconcelos','tjce','pausado',24,NULL,NULL,NULL,0,NOW()-INTERVAL 10 DAY,NOW(),0),
 (@esc,@dono,'movimentacoes','lawsuit_cnj','0056789-12.2024.8.06.0001','José Ribamar da Silva Filho','tjce','ativo',24,NOW()-INTERVAL 3 DAY,NOW()-INTERVAL 3 DAY,'Sentença publicada — procedente em parte',21,NOW()-INTERVAL 150 DAY,NOW(),0),
 (@esc,@gestor,'movimentacoes','lawsuit_cnj','0091234-56.2023.8.06.0001','Laticínios Serra Azul S/A','tjce','ativo',24,NOW()-INTERVAL 6 DAY,NOW()-INTERVAL 6 DAY,'Conclusos para julgamento — 3ª Câmara de Direito Privado',33,NOW()-INTERVAL 200 DAY,NOW(),1),
 (@esc,@dono,'novas_acoes','cpf','810.442.313-04','Maria Aparecida — novas ações',NULL,'ativo',24,NOW()-INTERVAL 5 HOUR,NULL,NULL,0,NOW()-INTERVAL 30 DAY,NOW(),0);

UPDATE motor_monitoramentos SET ultimo_erro='Login falhou no tribunal — senha do Cofre recusada' WHERE status='erro';
