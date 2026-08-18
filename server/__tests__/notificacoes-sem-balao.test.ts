/**
 * Notificação em tempo real não interrompe quem está trabalhando.
 *
 * Cada mensagem de WhatsApp recebida virava um balão sobre a tela. Quem está
 * lendo uma decisão ou conferindo um prazo era interrompido por algo que já
 * estava contado no sino — e o balão ainda cobria justamente o canto onde o
 * conteúdo aparece.
 *
 * A informação não se perde: a notificação continua entrando na lista e no
 * contador, que é onde ela é procurada quando interessa. O que sai é só a
 * interrupção.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const hook = readFileSync(
  join(__dirname, "..", "..", "client", "src", "hooks", "useNotificacoes.ts"),
  "utf8",
);

describe("notificações em tempo real", () => {
  it("não abre balão", () => {
    expect(hook).not.toContain("toast(");
    expect(hook, "o import sobrando volta a tentar").not.toContain('from "sonner"');
  });

  it("continua alimentando o sino", () => {
    // É o que torna a remoção segura: nada deixa de ser registrado.
    expect(hook).toContain("setNaoLidas(prev => prev + 1)");
    expect(hook).toContain("setNotificacoes(prev => [data, ...prev]");
  });

  it("continua avisando as telas que escutam", () => {
    // Processos e a UI de chamada dependem deste evento pra se atualizar sem
    // abrir SSE próprio.
    expect(hook).toContain('new CustomEvent("jurify:notif"');
  });

  it("evento silencioso continua fora da contagem", () => {
    // Progresso de atualização e sinalização de chamada alimentam só quem
    // escuta o window — entrar no contador encheria o sino de ruído.
    expect(hook).toContain('data.dados?.kind === "atualizacao_progresso"');
    expect(hook).toContain('data.dados?.kind === "sinalizacao_chamada"');
  });
});
