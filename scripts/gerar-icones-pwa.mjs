/**
 * Gera os ícones do PWA do JuridFlow a partir da geometria do "J." (opção A
 * aprovada: J branco + ponto lilás sobre gradiente violeta→índigo).
 *
 * Sem dependências nativas: rasteriza por supersampling (antialias) e
 * codifica PNG com o zlib do próprio Node. Roda 1× pra produzir os assets;
 * o resultado é commitado em client/public/ (nada disso roda em produção).
 *
 *   node scripts/gerar-icones-pwa.mjs
 */
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "client", "public");

// ── Paleta da marca ──────────────────────────────────────────────────────────
const G1 = [124, 58, 237]; // #7c3aed violet-600
const G2 = [79, 70, 229];  // #4f46e5 indigo-600
const BRANCO = [255, 255, 255];
const LILAS = [196, 181, 253]; // #c4b5fd violet-300

// ── Geometria do glifo (coords normalizadas 0..1), centralizada ──────────────
const DX = -0.03; // desloca o conjunto J+ponto pro centro óptico
const W = 0.135;          // espessura do traço
const X = 0.60 + DX;      // haste
const Y_TOP = 0.26, Y_BASE = 0.60;
const R = 0.14;           // raio do gancho
const C = [X - R, Y_BASE]; // centro do arco do gancho
const PONTO = [0.745 + DX, 0.64, 0.072]; // cx, cy, r

function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
function noJ(px, py) {
  if (distSeg(px, py, X, Y_TOP, X, Y_BASE) <= W / 2) return true;          // haste (cápsula)
  if (py >= C[1] && Math.abs(Math.hypot(px - C[0], py - C[1]) - R) <= W / 2) return true; // gancho
  if (Math.hypot(px - (X - 2 * R), py - Y_BASE) <= W / 2) return true;     // cap esquerdo
  return false;
}
function noPonto(px, py) {
  return Math.hypot(px - PONTO[0], py - PONTO[1]) <= PONTO[2];
}
// Squircle (superelipse n=4). fullBleed ignora e preenche tudo.
function noFundo(px, py, fullBleed) {
  if (fullBleed) return true;
  const u = Math.abs((px - 0.5) / 0.5), v = Math.abs((py - 0.5) / 0.5);
  return Math.pow(u, 4) + Math.pow(v, 4) <= 1;
}

/** Cor RGBA (0..255) de um subponto normalizado. */
function corSub(nx, ny, fullBleed) {
  if (noPonto(nx, ny)) return [...LILAS, 255];
  if (noJ(nx, ny)) return [...BRANCO, 255];
  if (noFundo(nx, ny, fullBleed)) {
    const t = Math.max(0, Math.min(1, (nx + ny) / 2)); // gradiente 135°
    return [
      Math.round(G1[0] + (G2[0] - G1[0]) * t),
      Math.round(G1[1] + (G2[1] - G1[1]) * t),
      Math.round(G1[2] + (G2[2] - G1[2]) * t),
      255,
    ];
  }
  return [0, 0, 0, 0];
}

function rasterizar(size, fullBleed) {
  const SS = 3; // supersampling 3×3 por pixel
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const nx = (x + (sx + 0.5) / SS) / size;
          const ny = (y + (sy + 0.5) / SS) / size;
          const [cr, cg, cb, ca] = corSub(nx, ny, fullBleed);
          // pré-multiplica pelo alpha pra média correta nas bordas
          r += cr * ca; g += cg * ca; b += cb * ca; a += ca;
        }
      }
      const n = SS * SS;
      const af = a / n;
      const i = (y * size + x) * 4;
      buf[i] = af > 0 ? Math.round(r / a) : 0;
      buf[i + 1] = af > 0 ? Math.round(g / a) : 0;
      buf[i + 2] = af > 0 ? Math.round(b / a) : 0;
      buf[i + 3] = Math.round(af);
    }
  }
  return buf;
}

// ── Encoder PNG (RGBA, sem deps) ─────────────────────────────────────────────
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const tb = Buffer.from(type, "ascii");
  const crcb = Buffer.alloc(4); crcb.writeUInt32BE(crc32(Buffer.concat([tb, data])), 0);
  return Buffer.concat([len, tb, data, crcb]);
}
function png(size, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit, RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filtro none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}
function gerarPng(nome, size, fullBleed) {
  writeFileSync(path.join(OUT, nome), png(size, rasterizar(size, fullBleed)));
  console.log(`  ✓ ${nome} (${size}×${size}${fullBleed ? ", full-bleed" : ""})`);
}

// ── SVG master (vetorial — favicon e ícone "any") ────────────────────────────
function svg(fullBleed) {
  const r = fullBleed ? 0 : 118; // rx do squircle em 512
  const s = 512;
  const sc = (v) => (v * s).toFixed(1);
  const hookEndX = (X - 2 * R) * s;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}" width="${s}" height="${s}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#7c3aed"/><stop offset="1" stop-color="#4f46e5"/>
  </linearGradient></defs>
  <rect width="${s}" height="${s}" rx="${r}" fill="${fullBleed ? "url(#g)" : "url(#g)"}"/>
  <path d="M ${sc(X)} ${sc(Y_TOP)} L ${sc(X)} ${sc(Y_BASE)} A ${sc(R)} ${sc(R)} 0 0 1 ${hookEndX.toFixed(1)} ${sc(Y_BASE)}"
    fill="none" stroke="#ffffff" stroke-width="${sc(W)}" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="${sc(PONTO[0])}" cy="${sc(PONTO[1])}" r="${sc(PONTO[2])}" fill="#c4b5fd"/>
</svg>`;
}

console.log("Gerando ícones do PWA…");
gerarPng("pwa-192.png", 192, false);
gerarPng("pwa-512.png", 512, false);
gerarPng("pwa-maskable-512.png", 512, true);
gerarPng("apple-touch-icon.png", 180, true);
gerarPng("favicon-32.png", 32, false);
gerarPng("favicon-16.png", 16, false);
writeFileSync(path.join(OUT, "icon.svg"), svg(false));
writeFileSync(path.join(OUT, "favicon.svg"), svg(false));
console.log("  ✓ icon.svg / favicon.svg");
console.log("Pronto.");
