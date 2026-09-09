/**
 * Reexporta o semeador de escritório descartável.
 *
 * A implementação mora em `server/admin/jornada/escritorio-descartavel.ts`
 * porque o robô de jornada roda a partir do SERVIDOR (botão no painel admin,
 * e cron), não só do Playwright em terminal. Servidor de produção importando
 * arquivo de `tests/` funcionaria — até o dia em que o build podasse a pasta,
 * e aí o botão quebraria em produção com a suíte local passando.
 *
 * Este arquivo continua existindo porque os specs importam por aqui há
 * tempo, e mover import de doze arquivos não melhora nada.
 */

export {
  TEST_PASSWORD,
  seedTestEscritorio,
  teardownTestEscritorio,
  teardownStaleTestEscritorios,
} from "../../../server/admin/jornada/escritorio-descartavel";
