/**
 * Áudio pra WhatsApp Cloud API.
 *
 * A Cloud API só aceita áudio em aac/amr/mp3/mp4(m4a)/ogg(opus). O navegador
 * grava nota de voz em webm/opus (Chrome/Edge) — formato que a Meta REJEITA.
 * Como o codec já é Opus, basta re-encodar pra ogg/opus MONO (o que a Meta
 * trata como nota de voz tocável, com ondulação). Safari (mp4/aac) e Firefox
 * (ogg/opus) já vêm compatíveis e passam direto, sem rodar ffmpeg.
 */

import { spawn } from "child_process";
import path from "path";

/** Extensões que a Cloud API aceita sem conversão → mime declarado pra Meta. */
const PASSTHROUGH: Record<string, string> = {
  ogg: "audio/ogg",
  oga: "audio/ogg",
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  mp3: "audio/mpeg",
  aac: "audio/aac",
  amr: "audio/amr",
};

export interface FormatoAudioCloud {
  /** Precisa rodar ffmpeg antes de subir? */
  converter: boolean;
  /** Mime que será declarado pra Meta. */
  mime: string;
}

/**
 * Decide, a partir do nome/extensão do arquivo gravado, se precisa converter
 * pra Cloud API e qual o formato-alvo. Pure — testável sem ffmpeg.
 */
export function decidirFormatoAudioCloud(filename: string): FormatoAudioCloud {
  const ext = path.extname(filename).slice(1).toLowerCase();
  if (PASSTHROUGH[ext]) return { converter: false, mime: PASSTHROUGH[ext] };
  return { converter: true, mime: "audio/ogg" };
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("error", reject); // ffmpeg ausente no PATH
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg saiu com código ${code}: ${stderr.slice(-400)}`));
    });
  });
}

/**
 * Garante que o áudio em `absPath` está num formato que a Cloud API aceita.
 * Formatos compatíveis passam direto; o resto (webm, wav, ...) é convertido
 * pra ogg/opus mono num arquivo irmão `<base>.cloud.ogg`.
 */
export async function prepararAudioParaCloud(
  absPath: string,
): Promise<{ path: string; mime: string }> {
  const { converter, mime } = decidirFormatoAudioCloud(absPath);
  if (!converter) return { path: absPath, mime };

  const saida = absPath.replace(/\.[^.]+$/, "") + ".cloud.ogg";
  await runFfmpeg([
    "-y", "-i", absPath,
    "-vn",              // descarta trilha de vídeo que o container webm possa carregar
    "-c:a", "libopus",
    "-ac", "1",         // mono — exigência da Meta pra ogg/opus
    "-b:a", "32k",
    "-f", "ogg",
    saida,
  ]);
  return { path: saida, mime: "audio/ogg" };
}
