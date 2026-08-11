-- Lixeira do SmartFlow: excluir um cenário deixa de apagar linha.
--
-- O `deletar` fazia DELETE em smartflow_passos + smartflow_cenarios. Quem
-- clicasse na lixeira do topo achando que removia UM bloco perdia o fluxo
-- inteiro, sem volta.
--
-- O delete passa a marcar `deletadoEmSF` e a zerar `ativoSF`. Zerar o ativo
-- é o que garante que nenhum caminho do motor dispare um cenário na lixeira:
-- todos os carregadores já filtram por `ativoSF = 1`.
ALTER TABLE smartflow_cenarios
  ADD COLUMN deletadoEmSF TIMESTAMP NULL DEFAULT NULL;
