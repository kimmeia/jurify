import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  modeloAnthropicSemSampling,
  modeloAnthropicPensaPorPadrao,
  montarBodyAnthropic,
  modeloAnthropicVigente,
  textoDaRespostaAnthropic,
  PENSAMENTO_TOKEN_BUFFER,
} from "./anthropic-http";

describe("modeloAnthropicSemSampling", () => {
  it("Opus 4.7+ e toda a família 5 recusam temperature", () => {
    for (const m of [
      "claude-opus-4-7", "claude-opus-4-8", "claude-opus-4-7-20260301",
      "claude-opus-5", "claude-sonnet-5", "claude-sonnet-5-20260601",
      "claude-fable-5-1", "claude-mythos-5-1", "CLAUDE-OPUS-5",
    ]) {
      expect(modeloAnthropicSemSampling(m), m).toBe(true);
    }
  });

  it("Sonnet 4.x, Haiku 4.5, Claude 3.x e OpenAI continuam aceitando", () => {
    for (const m of [
      "claude-sonnet-4-6", "claude-sonnet-4-20250514", "claude-haiku-4-5-20251001",
      "claude-opus-4-6", "claude-3-5-sonnet-20241022", "gpt-4o", "gpt-5.5", "", null, undefined,
    ]) {
      expect(modeloAnthropicSemSampling(m), String(m)).toBe(false);
    }
  });
});

describe("modeloAnthropicPensaPorPadrao", () => {
  it("só a família 5 pensa sem pedir", () => {
    for (const m of ["claude-opus-5", "claude-sonnet-5", "claude-fable-5-1"]) {
      expect(modeloAnthropicPensaPorPadrao(m), m).toBe(true);
    }
    for (const m of ["claude-opus-4-7", "claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5-20251001", null]) {
      expect(modeloAnthropicPensaPorPadrao(m), String(m)).toBe(false);
    }
  });
});

describe("modeloAnthropicVigente", () => {
  it("modelo retirado vira o substituto oficial; ativo fica como está", () => {
    expect(modeloAnthropicVigente("claude-sonnet-4-20250514")).toBe("claude-sonnet-4-6");
    expect(modeloAnthropicVigente("claude-opus-4-20250514")).toBe("claude-opus-4-8");
    expect(modeloAnthropicVigente("claude-3-5-haiku-20241022")).toBe("claude-haiku-4-5-20251001");
    for (const m of ["claude-sonnet-4-6", "claude-haiku-4-5-20251001", "claude-opus-4-7", "claude-opus-5"]) {
      expect(modeloAnthropicVigente(m)).toBe(m);
    }
  });
});

describe("montarBodyAnthropic", () => {
  const messages = [{ role: "user", content: "oi" }];

  it("agente gravado com Sonnet 4 (retirado) sai como Sonnet 4.6, mantendo temperature", () => {
    const body = montarBodyAnthropic({ model: "claude-sonnet-4-20250514", messages, maxTokens: 800, temperatura: 0.5 });
    expect(body.model).toBe("claude-sonnet-4-6");
    expect(body.temperature).toBe(0.5);
  });

  it("substituto que recusa sampling também perde o temperature", () => {
    const body = montarBodyAnthropic({ model: "claude-opus-4-20250514", messages, maxTokens: 800, temperatura: 0.5 });
    expect(body.model).toBe("claude-opus-4-8");
    expect(body.temperature).toBeUndefined();
  });

  it("Haiku 4.5: manda temperature e max_tokens como vieram", () => {
    const body = montarBodyAnthropic({ model: "claude-haiku-4-5-20251001", system: "s", messages, maxTokens: 500, temperatura: 0.7 });
    expect(body).toEqual({ model: "claude-haiku-4-5-20251001", system: "s", messages, max_tokens: 500, temperature: 0.7 });
  });

  it("Opus 4.7: SEM temperature, max_tokens sem folga, sem output_config", () => {
    const body = montarBodyAnthropic({ model: "claude-opus-4-7", system: "s", messages, maxTokens: 1200, temperatura: 0.3 });
    expect(body.temperature).toBeUndefined();
    expect(body.max_tokens).toBe(1200);
    expect(body.output_config).toBeUndefined();
    expect(body.thinking).toBeUndefined();
  });

  it("Opus 5: sem temperature, folga no teto e effort low", () => {
    const body = montarBodyAnthropic({ model: "claude-opus-5", system: "s", messages, maxTokens: 500, temperatura: 0.7 });
    expect(body.temperature).toBeUndefined();
    expect(body.max_tokens).toBe(500 + PENSAMENTO_TOKEN_BUFFER);
    expect(body.output_config).toEqual({ effort: "low" });
  });

  it("tira temperature/top_p/top_k vindos em extra quando o modelo recusa sampling", () => {
    const body = montarBodyAnthropic({ model: "claude-opus-4-7", messages, extra: { temperature: 0.5, top_p: 0.9, top_k: 40 } });
    expect(body.temperature).toBeUndefined();
    expect(body.top_p).toBeUndefined();
    expect(body.top_k).toBeUndefined();
    const ok = montarBodyAnthropic({ model: "claude-sonnet-4-6", messages, extra: { top_p: 0.9 } });
    expect(ok.top_p).toBe(0.9);
  });

  it("quem já manda thinking/output_config em extra tem a escolha respeitada", () => {
    const body = montarBodyAnthropic({
      model: "claude-sonnet-5", messages, maxTokens: 800,
      extra: { thinking: { type: "disabled" }, output_config: { effort: "high" } },
    });
    expect(body.max_tokens).toBe(800);
    expect(body.output_config).toEqual({ effort: "high" });
    expect(body.thinking).toEqual({ type: "disabled" });
  });

  it("sem system e sem temperatura não inventa chave", () => {
    const body = montarBodyAnthropic({ model: "claude-haiku-4-5-20251001", messages, maxTokens: 10 });
    expect("system" in body).toBe(false);
    expect("temperature" in body).toBe(false);
  });

  it("repassa tools/tool_choice de extra", () => {
    const tools = [{ name: "x", input_schema: { type: "object" } }];
    const body = montarBodyAnthropic({
      model: "claude-haiku-4-5-20251001", messages, maxTokens: 10, temperatura: 0,
      extra: { tools, tool_choice: { type: "tool", name: "x" } },
    });
    expect(body.tools).toBe(tools);
    expect(body.tool_choice).toEqual({ type: "tool", name: "x" });
    expect(body.temperature).toBe(0);
  });
});

describe("textoDaRespostaAnthropic", () => {
  it("bloco sem type (formato dos mocks antigos) continua lido", () => {
    expect(textoDaRespostaAnthropic({ content: [{ text: "  Sentença procedente.  " }] })).toBe("Sentença procedente.");
  });

  it("raciocínio antes do texto não engole a resposta", () => {
    const data = { content: [{ type: "thinking", thinking: "" }, { type: "text", text: "resposta" }] };
    expect(textoDaRespostaAnthropic(data)).toBe("resposta");
  });

  it("junta vários blocos de texto e ignora tool_use", () => {
    const data = { content: [{ type: "text", text: "a" }, { type: "tool_use", name: "x", input: {} }, { type: "text", text: "b" }] };
    expect(textoDaRespostaAnthropic(data)).toBe("a\nb");
  });

  it("resposta sem content vira string vazia, nunca lança", () => {
    for (const d of [null, undefined, {}, { content: "x" }, { content: [null, { type: "text" }] }]) {
      expect(textoDaRespostaAnthropic(d)).toBe("");
    }
  });
});

/**
 * Amarra: temperature só viaja pelo helper, e ninguém lê `content[0]` direto.
 * Foi assim que o Atendente IA quebrou — um caller mandando temperature pro
 * Opus 4.7 fora de qualquer helper.
 */
describe("todo caller da Anthropic passa pelo helper", () => {
  const raiz = path.resolve(__dirname, "..");
  const todos: string[] = [];
  const andar = (dir: string) => {
    for (const nome of fs.readdirSync(dir)) {
      const p = path.join(dir, nome);
      if (fs.statSync(p).isDirectory()) { if (nome !== "node_modules") andar(p); continue; }
      if (!p.endsWith(".ts") || p.endsWith(".test.ts") || p.endsWith(".d.ts")) continue;
      todos.push(p);
    }
  };
  andar(raiz);
  const arquivos = todos.filter((p) => fs.readFileSync(p, "utf8").includes("api.anthropic.com"));

  it("encontrou os callers (senão a amarra está vazia)", () => {
    expect(arquivos.length).toBeGreaterThanOrEqual(10);
  });

  it("quem manda temperature monta o corpo com montarBodyAnthropic", () => {
    for (const p of arquivos) {
      const src = fs.readFileSync(p, "utf8");
      if (/\btemperature\b/.test(src)) {
        expect(src, p).toContain("montarBodyAnthropic(");
      }
    }
  });

  it("nenhum arquivo do servidor usa um modelo retirado como padrão", () => {
    for (const p of todos) {
      const src = fs.readFileSync(p, "utf8");
      if (p.endsWith("anthropic-http.ts")) continue;
      // a lista de modelos aceitos pelo painel PODE conter o antigo (agente gravado
      // continua válido; o helper troca na chamada) — o que não pode é ele ser padrão
      expect(src, p).not.toMatch(/(\|\||default\(|model:)\s*"(claude-sonnet-4-20250514|claude-opus-4-20250514|claude-3-[^"]*)"/);
    }
  });

  it("ninguém lê content[0] da resposta da Anthropic", () => {
    for (const p of arquivos) {
      const src = fs.readFileSync(p, "utf8");
      expect(src, p).not.toMatch(/content\??\.?\[0\]/);
    }
  });
});
