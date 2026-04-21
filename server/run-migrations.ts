/**
 * Script de migração — executa via Node.js usando a conexão do próprio app.
 * 
 * Uso: node --import tsx server/run-migrations.ts
 * Ou:  npx tsx server/run-migrations.ts
 */

import "dotenv/config";
import mysql from "mysql2/promise";

const SQLS = [
  // 1. Colunas novas em colaboradores
  "ALTER TABLE colaboradores ADD COLUMN IF NOT EXISTS ultimaAtividade TIMESTAMP AFTER recebeLeadsAutomaticos",
  "ALTER TABLE colaboradores ADD COLUMN IF NOT EXISTS ultimaDistribuicao TIMESTAMP AFTER ultimaAtividade",
  "ALTER TABLE colaboradores ADD COLUMN IF NOT EXISTS cargoPersonalizadoId INT AFTER cargo",
  
  // 2. Tabela agentes_ia
  `CREATE TABLE IF NOT EXISTS agentes_ia (id INT AUTO_INCREMENT PRIMARY KEY, escritorioId INT NOT NULL, nome VARCHAR(128) NOT NULL, descricao VARCHAR(512), modelo VARCHAR(64) NOT NULL DEFAULT 'gpt-4o-mini', prompt TEXT NOT NULL, ativo BOOLEAN NOT NULL DEFAULT false, canalId INT, openaiApiKey TEXT, apiKeyIv VARCHAR(64), apiKeyTag VARCHAR(64), maxTokens INT NOT NULL DEFAULT 500, temperatura VARCHAR(10) NOT NULL DEFAULT '0.70', createdAtAgente TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL, updatedAtAgente TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL, INDEX idx_agente_escritorio (escritorioId))`,
  
  // 3. Tabela cliente_arquivos
  `CREATE TABLE IF NOT EXISTS cliente_arquivos (id INT AUTO_INCREMENT PRIMARY KEY, escritorioId INT NOT NULL, contatoId INT NOT NULL, nome VARCHAR(255) NOT NULL, tipo VARCHAR(64), tamanho INT, url TEXT NOT NULL, uploadPor INT, createdAtArquivo TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL, INDEX idx_arquivos_contato (contatoId), INDEX idx_arquivos_escritorio (escritorioId))`,
  
  // 4. Tabela cliente_anotacoes
  `CREATE TABLE IF NOT EXISTS cliente_anotacoes (id INT AUTO_INCREMENT PRIMARY KEY, escritorioId INT NOT NULL, contatoId INT NOT NULL, titulo VARCHAR(255), conteudo TEXT NOT NULL, criadoPor INT, createdAtAnotacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL, updatedAtAnotacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL, INDEX idx_anotacoes_contato (contatoId), INDEX idx_anotacoes_escritorio (escritorioId))`,
  
  // 5. Tabela assinaturas_digitais
  `CREATE TABLE IF NOT EXISTS assinaturas_digitais (id INT AUTO_INCREMENT PRIMARY KEY, escritorioId INT NOT NULL, contatoId INT NOT NULL, titulo VARCHAR(255) NOT NULL, descricao VARCHAR(512), statusAssinatura ENUM('pendente','enviado','visualizado','assinado','recusado','expirado') NOT NULL DEFAULT 'pendente', documentoUrl TEXT, documentoAssinadoUrl TEXT, assinantNome VARCHAR(255), assinantEmail VARCHAR(320), assinantTelefone VARCHAR(20), tokenAssinatura VARCHAR(128) UNIQUE, enviadoPor INT, enviadoAt TIMESTAMP, visualizadoAt TIMESTAMP, assinadoAt TIMESTAMP, ipAssinatura VARCHAR(45), expiracaoAt TIMESTAMP, createdAtAssinatura TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL, updatedAtAssinatura TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL, INDEX idx_assinatura_contato (contatoId), INDEX idx_assinatura_escritorio (escritorioId), INDEX idx_assinatura_token (tokenAssinatura))`,
  
  // 6. Tabela cargos_personalizados
  `CREATE TABLE IF NOT EXISTS cargos_personalizados (id INT AUTO_INCREMENT PRIMARY KEY, escritorioId INT NOT NULL, nome VARCHAR(64) NOT NULL, descricao VARCHAR(255), cor VARCHAR(20) DEFAULT '#6366f1', isDefault BOOLEAN NOT NULL DEFAULT false, createdAtCargo TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL, updatedAtCargo TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL, INDEX idx_cargos_escritorio (escritorioId), UNIQUE KEY uq_cargo_nome_escritorio (escritorioId, nome))`,
  
  // 7. Tabela permissoes_cargo
  `CREATE TABLE IF NOT EXISTS permissoes_cargo (id INT AUTO_INCREMENT PRIMARY KEY, cargoId INT NOT NULL, modulo VARCHAR(32) NOT NULL, ver_todos BOOLEAN NOT NULL DEFAULT false, ver_proprios BOOLEAN NOT NULL DEFAULT false, criar BOOLEAN NOT NULL DEFAULT false, editar BOOLEAN NOT NULL DEFAULT false, excluir BOOLEAN NOT NULL DEFAULT false, INDEX idx_permissoes_cargo (cargoId), UNIQUE KEY uq_permissao_modulo (cargoId, modulo))`,
  
  // 8. Tabela tarefas
  `CREATE TABLE IF NOT EXISTS tarefas (id INT AUTO_INCREMENT PRIMARY KEY, escritorioIdTarefa INT NOT NULL, contatoIdTarefa INT, processoIdTarefa INT, responsavelIdTarefa INT, criadoPorTarefa INT NOT NULL, tituloTarefa VARCHAR(255) NOT NULL, descricaoTarefa TEXT, statusTarefa ENUM('pendente','em_andamento','concluida','cancelada') NOT NULL DEFAULT 'pendente', prioridadeTarefa ENUM('baixa','normal','alta','urgente') NOT NULL DEFAULT 'normal', dataVencimento TIMESTAMP, concluidaAt TIMESTAMP, createdAtTarefa TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL, updatedAtTarefa TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL, INDEX idx_tarefas_escritorio (escritorioIdTarefa), INDEX idx_tarefas_contato (contatoIdTarefa), INDEX idx_tarefas_responsavel (responsavelIdTarefa), INDEX idx_tarefas_status (statusTarefa), INDEX idx_tarefas_vencimento (dataVencimento))`,

  // 9. Tabela admin_integracoes (Judit.IO, Escavador, etc.)
  `CREATE TABLE IF NOT EXISTS admin_integracoes (id INT AUTO_INCREMENT PRIMARY KEY, provedor VARCHAR(64) NOT NULL, nomeExibicao VARCHAR(128) NOT NULL, apiKeyEncrypted TEXT, apiKeyIv VARCHAR(64), apiKeyTag VARCHAR(64), statusIntegracao ENUM('conectado','desconectado','erro') NOT NULL DEFAULT 'desconectado', ultimoTeste TIMESTAMP NULL, mensagemErro VARCHAR(512), configJson TEXT, webhookUrl VARCHAR(512), webhookSecret VARCHAR(128), createdAtInteg TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL, updatedAtInteg TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL, UNIQUE KEY admin_integracoes_provedor_unique (provedor))`,

  // 10. Tabela judit_monitoramentos
  `CREATE TABLE IF NOT EXISTS judit_monitoramentos (id INT AUTO_INCREMENT PRIMARY KEY, trackingId VARCHAR(128) NOT NULL, searchType VARCHAR(32) NOT NULL, searchKey VARCHAR(128) NOT NULL, recurrence INT NOT NULL DEFAULT 1, statusJudit ENUM('created','updating','updated','paused','deleted') NOT NULL DEFAULT 'created', apelidoJudit VARCHAR(255), clienteUserId INT, tribunalJudit VARCHAR(16), nomePartes VARCHAR(512), ultimaMovJudit TEXT, ultimaMovDataJudit VARCHAR(32), totalAtualizacoes INT NOT NULL DEFAULT 0, withAttachments BOOLEAN NOT NULL DEFAULT false, createdAtJuditMon TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL, updatedAtJuditMon TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL, UNIQUE KEY judit_mon_tracking_unique (trackingId), INDEX judit_mon_search_key (searchKey), INDEX judit_mon_status (statusJudit), INDEX judit_mon_cliente (clienteUserId))`,

  // 11. Tabela judit_respostas
  `CREATE TABLE IF NOT EXISTS judit_respostas (id INT AUTO_INCREMENT PRIMARY KEY, monitoramentoId INT NOT NULL, responseId VARCHAR(128), requestIdJudit VARCHAR(128), responseType VARCHAR(64) NOT NULL, responseDataJudit TEXT, cachedResponse BOOLEAN DEFAULT false, stepsCountJudit INT DEFAULT 0, createdAtJuditResp TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL, INDEX judit_resp_mon (monitoramentoId), INDEX judit_resp_created (createdAtJuditResp))`,

  // 12. Tabela asaas_config (API key por escritório)
  `CREATE TABLE IF NOT EXISTS asaas_config (id INT AUTO_INCREMENT PRIMARY KEY, escritorioIdAsaas INT NOT NULL, apiKeyEncryptedAsaas TEXT, apiKeyIvAsaas VARCHAR(64), apiKeyTagAsaas VARCHAR(64), modoAsaas ENUM('sandbox','producao') NOT NULL DEFAULT 'producao', statusAsaas ENUM('conectado','desconectado','erro') NOT NULL DEFAULT 'desconectado', webhookTokenAsaas VARCHAR(128), ultimoTesteAsaas TIMESTAMP NULL, mensagemErroAsaas VARCHAR(512), saldoAsaas VARCHAR(32), createdAtAsaasConfig TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL, updatedAtAsaasConfig TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL, UNIQUE KEY asaas_config_escritorio (escritorioIdAsaas))`,

  // 13. Tabela asaas_clientes (vínculo contato ↔ cliente Asaas)
  `CREATE TABLE IF NOT EXISTS asaas_clientes (id INT AUTO_INCREMENT PRIMARY KEY, escritorioIdAsaasCli INT NOT NULL, contatoIdAsaas INT NOT NULL, asaasCustomerId VARCHAR(64) NOT NULL, cpfCnpjAsaas VARCHAR(18) NOT NULL, nomeAsaasCli VARCHAR(255), sincronizadoEmAsaas TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL, INDEX asaas_cli_escritorio (escritorioIdAsaasCli), INDEX asaas_cli_contato (contatoIdAsaas), INDEX asaas_cli_cpf (cpfCnpjAsaas))`,

  // 14. Tabela asaas_cobrancas (espelho local de cobranças)
  `CREATE TABLE IF NOT EXISTS asaas_cobrancas (id INT AUTO_INCREMENT PRIMARY KEY, escritorioIdAsaasCob INT NOT NULL, contatoIdAsaasCob INT, asaasPaymentId VARCHAR(64) NOT NULL, asaasCustomerIdCob VARCHAR(64) NOT NULL, valorAsaas VARCHAR(20) NOT NULL, valorLiquidoAsaas VARCHAR(20), vencimentoAsaas VARCHAR(10) NOT NULL, formaPagAsaas ENUM('BOLETO','CREDIT_CARD','PIX','UNDEFINED') NOT NULL, statusAsaasCob VARCHAR(64) NOT NULL, descricaoAsaas VARCHAR(512), invoiceUrlAsaas TEXT, bankSlipUrlAsaas TEXT, pixQrCodePayload TEXT, dataPagamentoAsaas VARCHAR(10), externalRefAsaas VARCHAR(255), createdAtAsaasCob TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL, updatedAtAsaasCob TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL, INDEX asaas_cob_escritorio (escritorioIdAsaasCob), INDEX asaas_cob_contato (contatoIdAsaasCob), INDEX asaas_cob_status (statusAsaasCob))`,

  // 15. Tabela mensagem_templates (respostas rapidas)
  `CREATE TABLE IF NOT EXISTS mensagem_templates (id INT AUTO_INCREMENT PRIMARY KEY, escritorioIdTpl INT NOT NULL, tituloTpl VARCHAR(100) NOT NULL, conteudoTpl TEXT NOT NULL, categoriaTpl ENUM('saudacao','cobranca','agendamento','juridico','encerramento','outro') DEFAULT 'outro' NOT NULL, atalhoTpl VARCHAR(20), criadoPorTpl INT NOT NULL, createdAtTpl TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL, INDEX tpl_escritorio (escritorioIdTpl))`,

  // 16. Tabela judit_creditos (saldo por escritorio)
  `CREATE TABLE IF NOT EXISTS judit_creditos (id INT AUTO_INCREMENT PRIMARY KEY, escritorioIdJCred INT NOT NULL, saldoJCred INT DEFAULT 0 NOT NULL, totalCompradoJCred INT DEFAULT 0 NOT NULL, totalConsumidoJCred INT DEFAULT 0 NOT NULL, updatedAtJCred TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL, UNIQUE INDEX jcred_escritorio (escritorioIdJCred))`,

  // 17. Tabela judit_transacoes (log de consumo/compra)
  `CREATE TABLE IF NOT EXISTS judit_transacoes (id INT AUTO_INCREMENT PRIMARY KEY, escritorioIdJTx INT NOT NULL, tipoJTx ENUM('compra','consumo','bonus','estorno') NOT NULL, quantidadeJTx INT NOT NULL, saldoAnteriorJTx INT NOT NULL, saldoDepoisJTx INT NOT NULL, operacaoJTx VARCHAR(64) NOT NULL, detalhesJTx VARCHAR(512), userIdJTx INT NOT NULL, createdAtJTx TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL, INDEX jtx_escritorio (escritorioIdJTx), INDEX jtx_tipo (tipoJTx))`,

  // 18. asaas_clientes: flag `primarioAsaasCli` — suporta múltiplos customers
  //     do Asaas vinculados ao mesmo contato do CRM (Asaas permite duplicatas
  //     com o mesmo CPF). Só o primário é usado ao criar novas cobranças.
  "ALTER TABLE asaas_clientes ADD COLUMN IF NOT EXISTS primarioAsaasCli TINYINT(1) NOT NULL DEFAULT 1 AFTER nomeAsaasCli",
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("❌ DATABASE_URL não encontrada no .env");
    process.exit(1);
  }

  console.log("🔌 Conectando ao banco...");
  const connection = await mysql.createConnection(url);

  console.log("🚀 Executando migrations...\n");
  let ok = 0;
  let err = 0;

  for (let i = 0; i < SQLS.length; i++) {
    const sql = SQLS[i];
    const label = sql.slice(0, 60).replace(/\s+/g, " ");
    try {
      await connection.execute(sql);
      console.log(`  ✅ ${i + 1}/${SQLS.length} ${label}...`);
      ok++;
    } catch (e: any) {
      if (e.message?.includes("Duplicate column") || e.message?.includes("already exists")) {
        console.log(`  ⏭️  ${i + 1}/${SQLS.length} Já existe, pulando`);
        ok++;
      } else {
        console.error(`  ❌ ${i + 1}/${SQLS.length} ERRO: ${e.message}`);
        err++;
      }
    }
  }

  await connection.end();
  console.log(`\n✅ Concluído: ${ok} ok, ${err} erros`);
  process.exit(err > 0 ? 1 : 0);
}

main();
