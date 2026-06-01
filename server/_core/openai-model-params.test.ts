import { describe, it, expect } from "vitest";
import { isModeloOpenAIRaciocinio, montarBodyOpenAIChat } from "./openai-model-params";

describe("isModeloOpenAIRaciocinio", () => {
  it("reconhece a família GPT-5 e a série o*", () => {
    for (const m of ["gpt-5", "gpt-5.1", "gpt-5.2", "gpt-5.5", "o1", "o3-mini", "GPT-5.5"]) {
      expect(isModeloOpenAIRaciocinio(m)).toBe(true);
    }
  });

  it("não marca GPT-4/3.5 nem Claude", () => {
    for (const m of ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-3.5-turbo", "claude-opus-4-7", "", null, undefined]) {
      expect(isModeloOpenAIRaciocinio(m)).toBe(false);
    }
  });
});

describe("montarBodyOpenAIChat", () => {
  const messages = [{ role: "user", content: "oi" }];

  it("GPT-4o: usa max_tokens + temperature (params antigos)", () => {
    const body = montarBodyOpenAIChat({ model: "gpt-4o", messages, maxTokens: 800, temperatura: 0.7 });
    expect(body.max_tokens).toBe(800);
    expect(body.temperature).toBe(0.7);
    expect(body.max_completion_tokens).toBeUndefined();
    expect(body.reasoning_effort).toBeUndefined();
  });

  it("GPT-5.5: max_completion_tokens com folga, sem temperature, reasoning_effort low", () => {
    const body = montarBodyOpenAIChat({ model: "gpt-5.5", messages, maxTokens: 800, temperatura: 0.7 });
    expect(body.max_completion_tokens).toBe(2800);
    expect(body.max_tokens).toBeUndefined();
    expect(body.temperature).toBeUndefined();
    expect(body.reasoning_effort).toBe("low");
  });

  it("repassa campos extras (tools/tool_choice) e mantém reasoning_effort", () => {
    const tools = [{ type: "function", function: { name: "x" } }];
    const body = montarBodyOpenAIChat({
      model: "gpt-5",
      messages,
      maxTokens: 100,
      extra: { tools, tool_choice: "auto" },
    });
    expect(body.tools).toBe(tools);
    expect(body.tool_choice).toBe("auto");
    expect(body.reasoning_effort).toBe("low");
    expect(body.max_completion_tokens).toBe(2100);
  });
});
