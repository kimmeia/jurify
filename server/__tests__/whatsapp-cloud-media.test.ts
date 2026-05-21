import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import os from "os";

vi.mock("axios", () => ({
  default: {
    get: vi.fn(),
  },
}));

import axios from "axios";
import { baixarMidiaCloudApi, __testing__ } from "../integracoes/whatsapp-cloud-media";

describe("whatsapp-cloud-media", () => {
  describe("extDoMime", () => {
    it("mapeia mime conhecido para extensão", () => {
      expect(__testing__.extDoMime("image/jpeg")).toBe("jpg");
      expect(__testing__.extDoMime("application/pdf")).toBe("pdf");
      expect(__testing__.extDoMime("audio/ogg")).toBe("ogg");
    });

    it("usa extensão do nome original quando mime é desconhecido", () => {
      expect(__testing__.extDoMime("application/octet-stream", "contrato.docx")).toBe("docx");
    });

    it("fallback pra .bin", () => {
      expect(__testing__.extDoMime("foo/bar")).toBe("bin");
    });
  });

  describe("baixarMidiaCloudApi", () => {
    const tmpDir = path.join(os.tmpdir(), `cloud-media-test-${Date.now()}`);
    const cwdOriginal = process.cwd();

    beforeEach(async () => {
      vi.clearAllMocks();
      await fs.mkdir(tmpDir, { recursive: true });
      process.chdir(tmpDir);
    });

    afterEach(async () => {
      process.chdir(cwdOriginal);
      await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it("retorna null sem mediaId ou accessToken", async () => {
      expect(await baixarMidiaCloudApi({
        mediaId: "",
        accessToken: "x",
        escritorioId: 1,
        canalId: 1,
      })).toBeNull();
      expect(await baixarMidiaCloudApi({
        mediaId: "abc",
        accessToken: "",
        escritorioId: 1,
        canalId: 1,
      })).toBeNull();
    });

    it("baixa, salva em disco e retorna path público", async () => {
      const mockedAxios = vi.mocked(axios);
      mockedAxios.get
        .mockResolvedValueOnce({ data: { url: "https://lookaside.fb.com/abc", mime_type: "image/jpeg" } })
        .mockResolvedValueOnce({ data: new ArrayBuffer(42) });

      const result = await baixarMidiaCloudApi({
        mediaId: "9236024173",
        accessToken: "EAA-token",
        escritorioId: 7,
        canalId: 12,
      });

      expect(result).not.toBeNull();
      expect(result!.url).toBe("/uploads/whatsapp-cloud/7/canal_12/9236024173.jpg");
      expect(result!.mime).toBe("image/jpeg");
      expect(result!.bytes).toBe(42);

      const saved = await fs.readFile(path.join(tmpDir, "uploads", "whatsapp-cloud", "7", "canal_12", "9236024173.jpg"));
      expect(saved.length).toBe(42);

      expect(mockedAxios.get).toHaveBeenNthCalledWith(
        1,
        "https://graph.facebook.com/v21.0/9236024173",
        expect.objectContaining({
          headers: { Authorization: "Bearer EAA-token" },
        }),
      );
      expect(mockedAxios.get).toHaveBeenNthCalledWith(
        2,
        "https://lookaside.fb.com/abc",
        expect.objectContaining({
          headers: { Authorization: "Bearer EAA-token" },
          responseType: "arraybuffer",
        }),
      );
    });

    it("retorna null quando Meta não devolve URL", async () => {
      const mockedAxios = vi.mocked(axios);
      mockedAxios.get.mockResolvedValueOnce({ data: { mime_type: "image/jpeg" } });
      const result = await baixarMidiaCloudApi({
        mediaId: "xyz",
        accessToken: "tk",
        escritorioId: 1,
        canalId: 1,
      });
      expect(result).toBeNull();
    });

    it("retorna null e não joga quando axios estoura", async () => {
      const mockedAxios = vi.mocked(axios);
      mockedAxios.get.mockRejectedValueOnce(new Error("network down"));
      const result = await baixarMidiaCloudApi({
        mediaId: "xyz",
        accessToken: "tk",
        escritorioId: 1,
        canalId: 1,
      });
      expect(result).toBeNull();
    });

    it("usa nomeOriginal pra inferir extensão de docs", async () => {
      const mockedAxios = vi.mocked(axios);
      mockedAxios.get
        .mockResolvedValueOnce({ data: { url: "https://x.fb.com/y", mime_type: "application/octet-stream" } })
        .mockResolvedValueOnce({ data: new ArrayBuffer(8) });

      const result = await baixarMidiaCloudApi({
        mediaId: "doc1",
        accessToken: "tk",
        escritorioId: 1,
        canalId: 1,
        nomeOriginal: "contrato.docx",
      });

      expect(result!.url).toBe("/uploads/whatsapp-cloud/1/canal_1/doc1.docx");
    });
  });
});
