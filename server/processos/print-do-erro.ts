/**
 * A foto da falha, num lugar que sobrevive ao deploy.
 *
 * O adapter já fotografava a tela do tribunal quando a consulta falhava — e
 * gravava em `scripts/spike-motor-proprio/samples/screenshots/`, que é disco
 * efêmero do container. Nenhuma tela lia o caminho e o arquivo morria no
 * próximo deploy: o robô tirava a prova do que viu e a jogava fora. Quando o
 * portal muda de layout, essa foto é a diferença entre ver e adivinhar.
 *
 * A divisão de tarefa é de propósito: o adapter não sabe de escritório nenhum
 * (é código de spike, sem tenancy), então quem CONHECE o dono do monitoramento
 * é que move o arquivo pra dentro do volume, na pasta do escritório. O arquivo
 * de origem continua sendo escrito onde sempre foi — nada mudou lá.
 */

import { createLogger } from "../_core/logger";

const log = createLogger("print-do-erro");

/** Uma pasta por escritório, como o resto de `/uploads`. */
export function pastaDoPrint(escritorioId: number): string {
  return `monitor-erros/escritorio_${escritorioId}`;
}

/**
 * Nome de arquivo seguro: o nome de origem carrega CNJ e carimbo de tempo, e é
 * o que liga a foto ao erro. Qualquer coisa fora do conjunto conhecido cai
 * fora — o nome entra numa URL e num caminho de disco.
 */
export function nomeSeguroDePrint(caminhoOrigem: string): string {
  const base = caminhoOrigem.split(/[\\/]/).pop() ?? "";
  const limpo = base.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "");
  return limpo.endsWith(".png") ? limpo : `${limpo || "print"}.png`;
}

/**
 * Move a foto pro volume e devolve a URL `/uploads/...`, ou null.
 *
 * Nunca lança: um problema de disco não pode derrubar o ciclo do cron, que
 * ainda tem o erro de verdade pra registrar. Sem foto, devolve null e o
 * monitoramento segue com o texto do erro, como antes.
 */
export async function guardarPrintDoErro(
  escritorioId: number,
  caminhoOrigem: string | null | undefined,
): Promise<string | null> {
  if (!caminhoOrigem) return null;
  try {
    const fs = await import("node:fs");
    const path = await import("node:path");
    if (!fs.existsSync(caminhoOrigem)) return null;

    const pasta = pastaDoPrint(escritorioId);
    const destinoDir = path.resolve(`./uploads/${pasta}`);
    fs.mkdirSync(destinoDir, { recursive: true });

    const nome = nomeSeguroDePrint(caminhoOrigem);
    const destino = path.join(destinoDir, nome);
    // `rename` falha entre dispositivos diferentes (o volume é outro mount):
    // copiar e apagar é o caminho que funciona nos dois casos.
    fs.copyFileSync(caminhoOrigem, destino);
    fs.rmSync(caminhoOrigem, { force: true });

    return `/uploads/${pasta}/${nome}`;
  } catch (err) {
    log.warn(
      { escritorioId, err: err instanceof Error ? err.message : String(err) },
      "não foi possível guardar a foto do erro — o monitoramento segue com o texto",
    );
    return null;
  }
}
