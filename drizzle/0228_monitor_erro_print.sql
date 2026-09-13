-- A foto que o robô tira quando a consulta falha para de ser jogada fora.
--
-- `tirarScreenshotErro` já existia e já fotografava a tela do tribunal no
-- instante da falha, mas gravava em `scripts/spike-motor-proprio/samples/
-- screenshots/` — disco efêmero do container, fora do volume do Railway, e
-- nenhuma tela lia o caminho. Ou seja: a única prova do que o portal mostrou
-- morria no próximo deploy.
--
-- Isso custou caro em 13/09: o dono relatou "o processo apareceu na busca, mas
-- a página dele não abriu" e não havia como ver a tela — o diagnóstico saiu de
-- leitura de código, não de evidência.
--
-- A coluna guarda a URL `/uploads/monitor-erros/escritorio_<id>/<arquivo>.png`
-- (servida com sessão + checagem de escritório, como o resto de /uploads).
-- NULL é o estado normal: só existe enquanto há erro, e sucesso limpa.
ALTER TABLE motor_monitoramentos
  ADD COLUMN ultimo_erro_print_url VARCHAR(500) DEFAULT NULL;
