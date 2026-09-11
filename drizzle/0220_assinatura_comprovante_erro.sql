-- Por que o comprovante (PDF carimbado) não foi gerado.
--
-- Assinar registra a assinatura mesmo quando o carimbo falha — o cliente
-- assinou de verdade, a falha é nossa e recusar seria pior para quem assina.
-- Só que o motivo vivia no log: na ficha o documento aparecia com o mesmo selo
-- verde de um documento com comprovante, e ninguém tinha como saber a
-- diferença. Aqui o motivo fica junto do registro, a tela mostra o estado real
-- e o botão "Gerar comprovante" limpa o campo quando consegue refazer.
--
-- NULL = nunca falhou (o caso de todos os registros antigos, inclusive os que
-- estão sem PDF: para esses a tela deriva o estado pelos dados, não por aqui).
ALTER TABLE assinaturas_digitais
  ADD COLUMN comprovanteErro TEXT DEFAULT NULL;
