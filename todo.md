# Project TODO

## Autenticação e RBAC
- [x] Tela de Login (email/senha + Google Sign-In)
- [x] Controle de acesso RBAC (Admin / Cliente)
- [x] Rota protegida para Admin (dashboard exclusivo)
- [x] Rota protegida para Cliente (dashboard próprio)
- [x] adminProcedure no backend para operações admin-only

## Fluxo de Onboarding e Planos
- [x] Schema de banco: tabela de planos e assinaturas
- [x] Verificação de assinatura ativa ao login do cliente
- [x] Tela de Escolha de Planos (obrigatória sem plano ativo)
- [x] Integração Stripe: checkout de planos pagos
- [x] Webhook Stripe: atualização automática do status do plano
- [x] Redirecionamento automático após pagamento confirmado

## Layout e Navegação
- [x] Layout responsivo com Sidebar
- [x] Menu Dashboard no sidebar
- [x] Menu dropdown Cálculos com submenus
- [x] Página placeholder: Bancário
- [x] Página placeholder: Imobiliário
- [x] Página placeholder: Trabalhista
- [x] Página placeholder: Tributário
- [x] Página placeholder: Previdenciário
- [x] Página placeholder: Atualização Monetária

## Design e UX
- [x] Tema visual neutro e funcional (cores, fontes, CSS global)
- [x] Responsividade mobile

## Testes
- [x] Testes vitest para rotas e lógica RBAC

## Bugs
- [x] Webhook Stripe timeout - endpoint /api/stripe/webhook não responde (context deadline exceeded)

## Bugs e Melhorias - Sprint 2
- [x] Bug: Navegação do utilizador com role "user" não funciona corretamente
- [x] Bug: Dashboard Admin está igual ao do user - precisa ser diferenciado
- [x] Melhoria: Dashboard Admin otimizado para gestão e acompanhamento de vendas
- [x] Melhoria: Admin não faz cálculos - remover menu Cálculos do layout Admin
- [x] Melhoria: Admin deve ver métricas de utilizadores, assinaturas e receita
- [x] Criar rotas backend para dados de administração (users, subscriptions, métricas)

## Bugs - Sprint 3
- [x] Bug: User não consegue navegar para nenhuma página (apenas role user, admin funciona)

## Motor de Cálculo Bancário - Revisão de Financiamento
- [x] Tipos compartilhados (shared/financiamento-types.ts)
- [x] Schema de banco: tabela taxas_medias_bacen
- [x] Engine puro: cálculo Tabela PRICE
- [x] Engine puro: cálculo SAC
- [x] Engine puro: cálculo SACRE
- [x] Engine puro: análise de abusividade (taxa vs média BACEN × 1.5)
- [x] Engine puro: detecção de anatocismo
- [x] Engine puro: verificação de tarifas ilegais (TAC, TEC, seguro)
- [x] Engine puro: verificação comissão de permanência cumulada
- [x] Engine puro: recálculo do contrato com taxa substitutiva
- [x] Integração BACEN: busca de taxas médias por modalidade
- [x] Integração BACEN: cache de taxas no banco local
- [x] Gerador de parecer técnico com fundamentação jurídica
- [x] Router tRPC: endpoint de cálculo de financiamento
- [x] Router tRPC: endpoint de busca de taxa média BACEN
- [x] Frontend: formulário de entrada de dados do contrato
- [x] Frontend: exibição de demonstrativo original vs recalculado
- [x] Frontend: exibição de análise de abusividade
- [x] Frontend: exibição de parecer técnico
- [x] Testes vitest: PRICE bate com HP 12c
- [x] Testes vitest: SAC amortização constante
- [x] Testes vitest: SACRE recálculo periódico
- [x] Testes vitest: detecção de abusividade
- [x] Testes vitest: detecção de anatocismo
- [x] Testes vitest: TAC pré/pós 2008
- [x] Testes vitest: comissão de permanência cumulada
- [x] Testes vitest: recálculo com diferenças corretas
- [x] Testes vitest: parecer contém fundamentação
- [x] Testes vitest: cenários de borda
- [x] Integração ao appRouter existente

## Correções Motor Bancário - Sprint 4
- [x] Bug: API BACEN retornando taxa errada (séries temporais incorretas)
- [x] Bug: Falta verificação de equivalência taxa mensal/anual e capitalização diária
- [x] Melhoria: Tarifas/custos acessórios devem ter opção "financiado" e somar ao valor financiado
- [x] Bug: Encargos de mora não verificam limites legais (multa >2% e juros moratórios >1%)
- [x] Bug: Verificar cada série temporal BACEN sendo usada
- [x] Bug: Análise do cálculo contém vários erros - revisão completa
- [x] Melhoria: Sistema de créditos - desconto automático ao clicar em Calcular

## Exportação PDF - Parecer Técnico Bancário
- [x] Endpoint Express para gerar PDF do parecer técnico (POST /api/export/parecer-pdf)
- [x] Geração de PDF com demonstrativos (original vs recalculado)
- [x] Cabeçalho profissional com protocolo e data
- [x] Botão de download PDF no frontend Bancário
- [x] Formatação jurídica adequada para uso em processos

## Módulo de Cálculo Trabalhista
- [x] Tipos compartilhados (shared/trabalhista-types.ts)
- [x] Engine puro: cálculo de horas extras (50%, 100%, noturnas)
- [x] Engine puro: adicional noturno
- [x] Engine puro: verbas rescisórias (aviso prévio, 13º, férias proporcionais)
- [x] Engine puro: FGTS + multa 40%
- [x] Engine puro: multa art. 467 e 477 CLT
- [x] Engine puro: DSR sobre horas extras
- [x] Engine puro: reflexos em verbas (13º, férias, FGTS)
- [ ] Engine puro: atualização monetária (IPCA-E/SELIC pós EC 113)
- [x] Gerador de parecer técnico trabalhista
- [x] Router tRPC: endpoint de cálculo trabalhista
- [x] Frontend: formulário de entrada de dados trabalhistas
- [x] Frontend: exibição de resultados e demonstrativos
- [x] Frontend: exportação PDF do parecer trabalhista
- [x] Testes vitest para engine trabalhista (50 testes passando)
- [x] Integração ao appRouter existente

## Correções de Testes v3-fix
- [x] Corrigir teste round2(1.005) - comportamento toFixed JS padrão
- [x] Corrigir teste calcularGauss (renomeado de calcularJurosSimples no v3)
- [x] Corrigir teste anatocismo Súmula 541 - NÃO sobrescreve expressoPactuado
- [x] Corrigir teste diferencaJuros - Gauss gera mais juros que PRICE com taxa alta
- [x] Corrigir teste parecer "DO RECÁLCULO" (v3 usa este formato)
- [x] Corrigir teste parecer "p. único" (v3 usa esta abreviação)
- [x] Todos os 139 testes passando (5 ficheiros de teste)

## Próximos Módulos (Pendentes)
- [x] Módulo Imobiliário: engine, router, frontend, testes
- [ ] Módulo Tributário: engine, router, frontend, testes
- [ ] Módulo Previdenciário: engine, router, frontend, testes
- [x] Módulo Cálculos Diversos (antigo Atualização Monetária): engine, router, frontend, testes

## Melhorias Dashboard do Utilizador
- [x] Schema de banco: tabela de histórico de cálculos (calculos_historico)
- [x] Schema de banco: tabela de créditos do utilizador (user_credits)
- [x] Backend: endpoint para buscar estatísticas de uso do utilizador
- [x] Backend: endpoint para buscar histórico de cálculos recentes
- [x] Backend: endpoint para buscar/atualizar créditos do utilizador
- [x] Backend: registar cálculo no histórico ao realizar (bancário + trabalhista)
- [x] Frontend: cards com estatísticas de uso (total cálculos, pareceres gerados, módulos usados, créditos)
- [x] Frontend: seção de histórico de cálculos recentes (últimos 5 com data e valor)
- [x] Frontend: indicador de créditos com barra de progresso e botão upgrade
- [x] Frontend: recomendações contextuais de plano (banner upgrade para plano Básico)
- [x] Frontend: atalhos rápidos para Bancário e Trabalhista diretamente do dashboard

## Exportação PDF - Parecer Técnico Trabalhista
- [x] Verificar e adaptar endpoint /api/export/parecer-pdf para aceitar parecer trabalhista
- [x] Botão "Exportar PDF" na aba de Rescisão (após calcular)
- [x] Botão "Exportar PDF" na aba de Horas Extras (após calcular)
- [x] Feedback visual (loading spinner + toast descritivo) durante geração do PDF

## Módulo FGTS - Aba Dedicada no Trabalhista
- [x] Engine puro: cálculo do FGTS por período (8% sobre salário + horas extras + adicionais)
- [x] Engine puro: multa rescisória (40% ou 20%) sobre saldo total
- [x] Engine puro: juros de 3% a.a. sobre saldo FGTS (TR simplificada)
- [x] Tipos de entrada/saída para FGTS no engine
- [x] Endpoint tRPC: trpc.trabalhista.calcularFGTS
- [x] Frontend: aba "FGTS" no módulo Trabalhista com tabela de períodos
- [x] Frontend: campos por período (mês/ano, salário, horas extras, adicionais)
- [x] Frontend: exibição de resultados com saldo total, multa e total a receber
- [x] Frontend: exportação PDF do parecer FGTS
- [x] Remover campo saldoFGTS da aba Rescisão (mantido FGTS estimado no resultado)
- [x] Desconto de 1 crédito por cálculo (rescisão, horas extras, FGTS)
- [x] Testes vitest: 13 testes para engine-fgts (todos passando)

## Melhoria Frontend Módulo Bancário
- [x] Wizard multi-step: Step 1 (seleção visual da modalidade com cards coloridos), Step 2 (dados do contrato + opcionais colapsáveis), Step 3 (confirmação), Step 4 (resultado)
- [x] StepIndicator visual com bolinhas numeradas e cores (azul concluído, foreground ativo, muted futuro)
- [x] Cards de seleção de modalidade com ícone, cor, descrição (7 modalidades: Pessoal, Veículos, Imobiliário, Cartão, Cheque Especial, Capital de Giro, Leasing)
- [x] Campos opcionais em Collapsible com ChevronRight/ChevronDown (tarifas + encargos mora)
- [x] Resultado: Card destaque com gradiente (vermelho se pago a mais, verde se regular) + protocolo + botão novo cálculo
- [x] Resultado: Cards resumo (grid 4 colunas: irregularidades, diferença juros, CET, repetição indébito)
- [x] Resultado: Tabs detalhamento (Análise/Demonstrativos/Comparativo/Parecer) preservadas
- [x] Exportação PDF com loading state (spinner + toast descritivo + nome do ficheiro)
- [x] Layout max-w-4xl mx-auto consistente com Trabalhista
- [x] Consumo de crédito já integrado (router-financiamento.ts)

## Ajustes Módulo Bancário
- [x] Remover modalidade "Imobiliário" dos cards de seleção (será usado no módulo Imobiliário dedicado)

## Bug Fix - Modalidades Bancário
- [x] Corrigir valores de modalidadeCredito no frontend para corresponder ao schema Zod do backend (financiamento_veiculos→financiamento_veiculo, leasing removido, consignado adicionado)

## Bug Fix - Exportação PDF
- [x] Investigar e corrigir erro ao clicar em "Exportar PDF" no parecer técnico (substituiu weasyprint por PDFKit Node.js puro, corrigiu bullet points e blockquotes)

## Melhoria Bancário - PF/PJ Veículos
- [x] Adicionar tipo TipoPessoa ("fisica" | "juridica") aos tipos compartilhados
- [x] Criar mapa SGS separado para PJ em veículos (série 20752 PJ vs 20749 PF)
- [x] Criar helper getCodigoSgs(modalidade, tipoPessoa) para resolver a série correta
- [x] Propagar tipoPessoa pelo bcb-taxas-medias.ts e db-taxas-medias.ts
- [x] Adicionar tipoPessoa ao schema Zod do router-financiamento.ts
- [x] Frontend: seleção PF/PJ com cards visuais quando modalidade é Veículos (Step 1)
- [x] Frontend: mostrar tipo de pessoa (PF/PJ) na tela de confirmação (Step 3)

## Correções Módulo Bancário - Sprint 5
- [x] Bug: Verificação da parcela declarada (R$ informado vs R$ calculado) — card amarelo no resultado com divergência
- [x] Bug: PDF gerado com erros de enquadramento — reescrito com PDFKit, tabelas proporcionais, sem páginas em branco
- [x] Bug: Parecer técnico confuso — reescrito com seções numeradas, texto direto, comparativo 4 cenários
- [x] Bug: Série temporal em cache retornando valores errados — validação rigorosa (0.01-15% mensal), cache limpo
- [x] Validação: Não aceitar datas futuras no campo dataContrato (barrar cálculo no frontend e backend)
- [x] Validação: Se dado BACEN não existe para a data, retornar mensagem clara ("dado não disponível")
- [x] Reformular comparativo: 4 cálculos (taxa contrato PRICE/GAUSS + média BACEN PRICE/GAUSS)
- [x] Comparativo resumido: tabela com cenário, taxa mensal, parcela, total pago, capitalizado (sim/não)

## Correções Motor Bancário - Sprint 6 (Precisão)
- [x] Bug: Demonstrativo Gauss com flutuação incorreta do saldo devedor — reescrito com amortização em PA (fórmula académica validada)
- [x] Bug: Comparativo dizia Gauss mais caro — corrigido, Gauss SEMPRE gera menos juros que PRICE
- [x] Revisão completa: PRICE validado (PMT=1800.30 para K=50000, i=2.5%, n=48)
- [x] Revisão completa: SAC validado (amortização constante, saldo final zero)
- [x] Revisão completa: SACRE validado (recálculo periódico, parcelas quase constantes)
- [x] Revisão completa: Gauss validado com artigo académico (PMT=3695.32 para K=50000, i=1.5%, n=15)
- [x] Revisão completa: comparativo 4 cenários correto (Contrato PRICE/GAUSS + BACEN PRICE/GAUSS)
- [x] Revisão completa: lógica de recálculo correta (diferença positiva = economia para consumidor)
- [x] Testes atualizados: 155 testes passando (novos testes de saldo decrescente, PA, artigo académico)

## Compartilhamento de Parecer PDF
- [x] Backend: endpoint para gerar PDF, fazer upload ao S3 e retornar URL pública (POST /api/export/parecer-pdf/share)
- [x] Frontend Bancário: botões de compartilhar por E-mail e WhatsApp
- [x] Frontend Trabalhista: botões de compartilhar por E-mail e WhatsApp (Rescisão e Horas Extras)
- [x] Feedback visual durante geração do link (loading state + toasts)
- [x] Testes vitest: 13 testes para helpers de compartilhamento (168 testes total)

## Módulo de Cálculo Imobiliário
- [x] Pesquisa aprofundada: fórmulas PRICE/SAC imobiliário, MIP, DFI, taxa administração, indexadores (TR, IPCA, IGPM, IPC)
- [x] Tipos compartilhados (shared/imobiliario-types.ts)
- [x] Engine puro: cálculo PRICE com correção monetária (PMT recalculado mensalmente sobre saldo corrigido)
- [x] Engine puro: cálculo SAC com correção monetária (amortização constante + correção do saldo)
- [x] Engine puro: cálculo MIP (Morte e Invalidez Permanente) — tabela por faixa etária
- [x] Engine puro: cálculo DFI (Danos Físicos ao Imóvel) — incide sobre valor do imóvel
- [x] Engine puro: taxa de administração (valor fixo mensal)
- [x] Engine puro: aplicação de indexadores (TR, IPCA, IGPM, IPC, Poupança, Nenhum)
- [x] Engine puro: análise de abusividade (taxa vs média BACEN × 1.5)
- [x] Engine puro: recálculo do contrato com taxa substitutiva (média BACEN ou manual)
- [x] Engine puro: verificação de capitalização indevida (anatocismo)
- [x] Gerador de parecer técnico imobiliário com fundamentação jurídica (7 seções)
- [x] Router tRPC: endpoint de cálculo imobiliário (trpc.imobiliario.calcular)
- [x] Frontend: formulário wizard 4 steps (Dados Imóvel → Contrato → Confirmação → Resultado)
- [x] Frontend: exibição de demonstrativo original vs recalculado (11 colunas com MIP/DFI/Correção)
- [x] Frontend: exibição de análise de abusividade (taxa, seguros, indexador, irregularidades)
- [x] Frontend: exibição de parecer técnico com Streamdown
- [x] Frontend: exportação PDF + compartilhamento E-mail/WhatsApp
- [x] Testes vitest: 69 testes engine + 11 testes parecer/integração (80 testes total)
- [x] Integração ao appRouter existente

## Módulo Cálculos Diversos (antigo Atualização Monetária)
- [x] Renomear menu "Atualização Monetária" para "Cálculos Diversos" no sidebar, dashboard e home
- [x] Calculadora de Conversão de Taxas (mensal↔anual, nominal↔efetiva, base dias corridos/úteis)
- [x] Taxa Real (Equação de Fisher) — desconto de inflação
- [x] Atualização Monetária por Índices (IPCA, IGPM, INPC, IPCA-E, SELIC, TR, CDI, Poupança) via API SGS/BCB em tempo real
- [x] Atualização Monetária: juros de mora e multa moratória opcionais
- [x] Calculadora de Juros Simples e Compostos com evolução período a período
- [x] Calculadora de Prazo Prescricional (Civil, Trabalhista, Tributário, Consumidor, Penal) com suspensões
- [x] Engine puro: conversão de taxas, Fisher, juros, atualização monetária, prazos prescricionais
- [x] Testes vitest: 62 testes engine + 12 testes router (74 testes total, 322 no projeto)
- [x] Frontend: interface com 4 abas (Conversão de Taxas, Juros, Atualização Monetária, Prazos)
- [x] Integração ao appRouter existente (trpc.calculosDiversos.*)
- [x] Ferramentas gratuitas (não consomem créditos) — badge verde no header

## Bug Fix - Créditos ao Fazer Upgrade
- [x] Bug: ao fazer upgrade de plano, créditos do novo plano substituem os restantes em vez de somar
- [x] Corrigir lógica no backend para somar créditos do novo plano aos créditos restantes
- [x] Testes vitest: 8 testes de upgrade de créditos (idempotência, soma, avulsos, etc.)

## Bug Fix - Downgrade de Plano
- [x] Investigar fluxo completo de upgrade/downgrade (frontend → backend → webhook → créditos)
- [x] Bug: downgrade de plano não funcionava (créditos ficavam inflados do plano anterior)
- [x] Corrigir lógica: campo currentPlanId na tabela user_credits para detectar mudança de plano
- [x] Lógica justa: upgrade E downgrade somam créditos restantes + novos do plano (idempotente)
- [x] Testes vitest: 14 testes (4 upgrade + 4 downgrade + 6 idempotência/especiais), 336 total

## Módulo Monitoramento de Processos
- [x] Pesquisa: API Pública do DataJud (CNJ) — chave pública, endpoints por tribunal
- [x] Schema de banco: tabelas processos_monitorados + movimentacoes_processo com userId obrigatório
- [x] Segurança: todas as queries filtradas por ctx.user.id (8 endpoints com dupla verificação)
- [x] Segurança: 34 testes (validação CNJ, mapeamento tribunais, isolamento por userId)
- [x] Backend: CRUD completo (adicionar, listar, detalhe, atualizar, alterar status, apelido, remover)
- [x] Backend: consulta automática de movimentações via API DataJud + cache local
- [x] Backend: detecção de novas movimentações (marcadas como não lidas)
- [x] Frontend: página de monitoramento com lista, filtros por status, timeline de movimentações
- [x] Frontend: formulário para adicionar processo por número CNJ com formatação automática
- [x] Acesso: admin/desenvolvedor tem acesso funcional completo (devOnlyProcedure)
- [x] Acesso: utilizador normal vê tela "Em Desenvolvimento" com badge informativo
- [x] Menu lateral: entrada "Processos" com ícone FileSearch abaixo de "Cálculos"
- [x] 370 testes passando no total

## Cadastro de OAB e Busca por OAB
- [x] Pesquisar API DataJud: busca por OAB não disponível (LGPD) — validação manual de nome
- [x] Schema: tabela oabs_advogado (userId, numero, uf, nomeTitular, tipo, cadastradaPorAdmin, status)
- [x] Segurança: validação de nome (primeiro + último nome normalizado, sem acentos/preposições)
- [x] Segurança: admin pode cadastrar OABs de terceiros (bypass da validação de nome)
- [x] Backend: CRUD de OABs (cadastrar, listar, remover, alterar status)
- [ ] Backend: buscar processos por OAB (futuro — requer API Escavador paga)
- [ ] Backend: importar processos encontrados por OAB para monitoramento (futuro)
- [x] Frontend: aba "Minhas OABs" na página de Processos com dialog de cadastro
- [x] Frontend: validação visual de nome em tempo real (verde/amarelo)
- [x] Testes: 24 testes de segurança e isolamento para OAB

## Sistema de Notificações
- [x] Schema: tabela notificacoes (userId, titulo, mensagem, tipo, processoId, lida)
- [x] Backend: helper criarNotificacao() exportável para uso por outros módulos
- [x] Backend: CRUD de notificações (listar, contar, marcar lida, marcar todas, apagar, limpar lidas)
- [ ] Backend: verificação periódica de novas movimentações (futuro — cron job)
- [x] Frontend: sino de notificações no header (desktop + mobile) com badge de contagem
- [x] Frontend: popover com lista, marcar lida, apagar, navegação contextual
- [x] Polling automático a cada 60s para verificar novas notificações
- [x] 394 testes passando no total

## Bug Fix - Movimentações DataJud
- [ ] Investigar: processo 0076233-35.2025.4.05.8100 mostra última movimentação de 26/12/2025, mas tem movimentações mais recentes
- [ ] Corrigir consulta DataJud para trazer todas as movimentações (incluindo recentes)
- [ ] Melhorar exibição das movimentações: muito genérico, dificulta entendimento
- [ ] Adicionar mais detalhes nas movimentações (complementos, tipo, descrição expandida)

## Etapa 2 — Integração Cal.com (Agendamento Online)
- [x] Tipos compartilhados Cal.com (shared/calcom-types.ts)
- [x] CalcomClient: cliente da API v1 (testar, eventTypes, slots, bookings)
- [x] Router tRPC: calcom.testarConexao, salvarConfig, eventTypes, slots, criarBooking, cancelarBooking, bookings
- [x] Webhook Express: POST /api/webhooks/calcom (BOOKING_CREATED, CANCELLED, RESCHEDULED, COMPLETED)
- [x] Integração ao appRouter (trpc.calcom.*)
- [x] Registro do webhook no Express server (server/_core/index.ts)
- [x] Frontend: CalcomConfig.tsx — componente de config (API key, URL, duração, event types, bookings)
- [x] Testes vitest: 11 testes CalcomClient + CalcomTypes
- [x] Página Agendamento reescrita: calendário mensal, lista, próximos, contadores, CRUD completo
- [x] Dialog criar compromisso: tipo, título, data/hora, prioridade, descrição
- [x] AgendamentoCard com concluir/excluir inline

## Etapa 3 — WhatsApp Baileys (Conexão via QR Code)
- [x] Tipos compartilhados WhatsApp (shared/whatsapp-types.ts)
- [x] WhatsApp Session Manager: singleton gerenciador de sessões Baileys
- [x] Sessão com QR Code, reconexão automática exponencial, logout/desconexão
- [x] Recepção de mensagens (texto, imagem, vídeo, áudio, documento, sticker, localização, contato)
- [x] Envio de mensagens (texto, imagem, documento, áudio)
- [x] WhatsApp Message Handler: ponte Baileys → CRM (auto-cria contato, conversa, salva mensagem)
- [x] Router tRPC: whatsapp.iniciarSessao, desconectarSessao, statusSessao, enviarMensagem, sessoes
- [x] Integração ao appRouter (trpc.whatsapp.*)
- [x] Frontend: WhatsappQR.tsx — componente QR com polling, status, conectar/desconectar
- [x] Testes vitest: 26 testes (jid/phone, formatação, status, labels, tipos, session manager)
- [x] Total: 37 novos testes (395 total no projeto, 358 passando + 4 pré-existentes falhando)
