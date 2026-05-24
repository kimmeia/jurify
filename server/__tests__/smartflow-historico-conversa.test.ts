import { describe, it, expect } from "vitest";
import {
  montarHistoricoMensagens,
  type MensagemHistoricoRaw,
} from "../smartflow/historico-conversa";

// rows vêm do banco em ordem novo→antigo (ORDER BY createdAt DESC).
function row(
  direcao: "entrada" | "saida",
  conteudo: string | null,
  tipo = "texto",
): MensagemHistoricoRaw {
  return { direcao, conteudo, tipo };
}

describe("montarHistoricoMensagens", () => {
  it("mapeia direcao→role e devolve em ordem cronológica (antigo→novo)", () => {
    const rows = [
      row("saida", "Como posso ajudar?"),
      row("entrada", "Quero saber do meu processo"),
    ];
    const hist = montarHistoricoMensagens(rows, "mensagem nova que não existe nas rows");
    expect(hist).toEqual([
      { role: "user", content: "Quero saber do meu processo" },
      { role: "assistant", content: "Como posso ajudar?" },
    ]);
  });

  it("remove a mensagem atual (já salva antes do fluxo) pra não duplicar", () => {
    const rows = [
      row("entrada", "oi de novo"), // <- a atual (mais recente)
      row("saida", "Olá! Como posso ajudar?"),
      row("entrada", "oi"),
    ];
    const hist = montarHistoricoMensagens(rows, "oi de novo");
    expect(hist).toEqual([
      { role: "user", content: "oi" },
      { role: "assistant", content: "Olá! Como posso ajudar?" },
    ]);
  });

  it("ignora mensagens de sistema e conteúdo vazio", () => {
    const rows = [
      row("saida", "resposta"),
      row("saida", "transferido para humano", "sistema"),
      row("entrada", null),
      row("entrada", "   "),
      row("entrada", "pergunta válida"),
    ];
    const hist = montarHistoricoMensagens(rows, "atual");
    expect(hist).toEqual([
      { role: "user", content: "pergunta válida" },
      { role: "assistant", content: "resposta" },
    ]);
  });

  it("tira o marcador [media:...] e pula mídia sem legenda", () => {
    const rows = [
      row("entrada", "olha isso\n[media:https://x.com/a.jpg]"),
      row("entrada", "[media:https://x.com/audio.ogg]"),
    ];
    const hist = montarHistoricoMensagens(rows, "atual");
    expect(hist).toEqual([{ role: "user", content: "olha isso" }]);
  });

  it("respeita o limite (as N mais recentes, em ordem cronológica)", () => {
    // rows em novo→antigo: m29 (mais recente) ... m0 (mais antiga)
    const rows: MensagemHistoricoRaw[] = [];
    for (let i = 29; i >= 0; i--) rows.push(row("entrada", `m${i}`));
    const hist = montarHistoricoMensagens(rows, "atual", 5);
    expect(hist).toHaveLength(5);
    // as 5 mais recentes (m25..m29), devolvidas do mais antigo pro mais novo
    expect(hist.map((m) => m.content)).toEqual(["m25", "m26", "m27", "m28", "m29"]);
  });

  it("lista vazia → histórico vazio", () => {
    expect(montarHistoricoMensagens([], "qualquer")).toEqual([]);
  });

  it("não quebra quando a mensagem atual não está nas rows", () => {
    const rows = [row("entrada", "a"), row("saida", "b")];
    const hist = montarHistoricoMensagens(rows, "mensagem inexistente");
    expect(hist).toEqual([
      { role: "assistant", content: "b" },
      { role: "user", content: "a" },
    ]);
  });
});
