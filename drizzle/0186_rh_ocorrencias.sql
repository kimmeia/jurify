-- Conduta e faltas: o registro do que aconteceu com cada pessoa.
--
-- Tabela de LOG, e não uma coluna em ponto_dias, por duas razões:
--
--  1. o mesmo dia pode ter mais de um registro (faltou E levou advertência), e
--     coluna única obrigaria a escolher qual sobrevive;
--  2. conduta existe em dia que o ponto nem tem linha — elogio de sexta não
--     depende de a pessoa ter logado.
--
-- `aprovadoPor`/`aprovadoEm` são só do atestado: é o único motivo que não
-- abona sozinho, porque abonar sem alguém ter olhado o documento é abonar por
-- omissão. Os outros motivos já são a decisão do gestor no ato de registrar.
--
-- Sem UNIQUE em (colaborador, dia) de propósito — ver (1). A prevalência entre
-- ocorrências do mesmo dia é resolvida no cálculo, em `shared/ocorrencias`.

CREATE TABLE IF NOT EXISTS rh_ocorrencias (
  id INT AUTO_INCREMENT PRIMARY KEY,
  escritorioIdOcor INT NOT NULL,
  colaboradorIdOcor INT NOT NULL,
  -- Dia civil no fuso do escritório (YYYY-MM-DD), igual ao de ponto_dias: os
  -- dois são lidos lado a lado no espelho e precisam casar como texto.
  diaOcor VARCHAR(10) NOT NULL,

  tipoOcor ENUM('falta','advertencia','elogio','observacao') NOT NULL,
  -- Só faz sentido em falta. NULL nos demais tipos.
  motivoOcor ENUM('atestado','justificada','injustificada','folga','ferias','licenca') NULL DEFAULT NULL,
  descricaoOcor VARCHAR(500) NULL DEFAULT NULL,

  -- Atestado anexado pelo gestor (caminho em /uploads/escritorio_<id>/...).
  atestadoUrlOcor VARCHAR(500) NULL DEFAULT NULL,
  atestadoNomeOcor VARCHAR(255) NULL DEFAULT NULL,

  aprovadoPorOcor INT NULL DEFAULT NULL,
  aprovadoEmOcor TIMESTAMP NULL DEFAULT NULL,

  registradoPorOcor INT NOT NULL,

  createdAtOcor TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAtOcor TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  KEY idx_ocor_colab_dia (colaboradorIdOcor, diaOcor),
  KEY idx_ocor_esc_dia (escritorioIdOcor, diaOcor)
);
