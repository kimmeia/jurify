import { describe, it, expect } from "vitest";
import { mimeDoNome } from "../juridico/leitura-documento";

describe("mimeDoNome", () => {
  it("detecta tipos por extensão", () => {
    expect(mimeDoNome("Contrato.pdf")).toBe("application/pdf");
    expect(mimeDoNome("peticao.DOCX")).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(mimeDoNome("rg_cliente.jpg")).toBe("image/jpeg");
    expect(mimeDoNome("print.PNG")).toBe("image/png");
    expect(mimeDoNome("notas.txt")).toBe("text/plain");
  });

  it("desconhecido → octet-stream", () => {
    expect(mimeDoNome("arquivo.xyz")).toBe("application/octet-stream");
    expect(mimeDoNome("semextensao")).toBe("application/octet-stream");
  });
});
