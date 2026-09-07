// Generates assets/og-image.png (1200x630) — Viewifi social card.
// Pure Node: writes a PNG with primitive pixel math (no dependencies).
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const W = 1200, H = 630;
const outPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'og-image.png');

// Palette (mirrors the app theme)
const BG = [10, 14, 20];
const SURFACE = [21, 26, 38];
const BLUE = [27, 152, 224];
const CYAN = [0, 229, 255];
const GREEN = [0, 230, 118];

const buf = Buffer.alloc(W * H * 3);

function put(x, y, r, g, b) {
  const i = (y * W + x) * 3;
  buf[i] = r; buf[i + 1] = g; buf[i + 2] = b;
}

const clamp = v => v < 0 ? 0 : v > 255 ? 255 : v;
const mix = (a, b, t) => a + (b - a) * t;

// Radar center-right, like the hero visual
const CX = 880, CY = 315, R = 300;

for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    // Base vertical gradient
    let r = mix(SURFACE[0], BG[0], y / H);
    let g = mix(SURFACE[1], BG[1], y / H);
    let b = mix(SURFACE[2], BG[2], y / H);

    // Blue glow top-left
    const d1 = Math.hypot(x - 150, y - 60) / 620;
    const t1 = Math.max(0, 1 - d1) ** 2 * 0.35;
    r = mix(r, BLUE[0], t1); g = mix(g, BLUE[1], t1); b = mix(b, BLUE[2], t1);

    // Cyan glow behind the radar
    const d2 = Math.hypot(x - CX, y - CY) / 560;
    const t2 = Math.max(0, 1 - d2) ** 2 * 0.22;
    r = mix(r, CYAN[0], t2); g = mix(g, CYAN[1], t2); b = mix(b, CYAN[2], t2);

    // Radar rings
    const dc = Math.hypot(x - CX, y - CY);
    for (let k = 1; k <= 3; k++) {
      const ring = Math.abs(dc - (R / 3) * k);
      if (ring < 1.4) {
        const a = (1 - ring / 1.4) * 0.28;
        r = mix(r, GREEN[0], a); g = mix(g, GREEN[1], a); b = mix(b, GREEN[2], a);
      }
    }

    // Radar sweep wedge (upper-left quadrant), fading with angle
    if (dc < R) {
      let ang = Math.atan2(y - CY, x - CX); // -PI..PI
      const target = -Math.PI * 0.75;
      let diff = ang - target;
      while (diff > Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;
      if (diff > 0 && diff < 1.1) {
        const a = (1 - diff / 1.1) ** 2 * 0.30 * (1 - dc / R * 0.5);
        r = mix(r, GREEN[0], a); g = mix(g, GREEN[1], a); b = mix(b, GREEN[2], a);
      }
      // Sweep edge
      if (Math.abs(diff) < 0.012) {
        const a = 0.85 * (1 - dc / R * 0.4);
        r = mix(r, GREEN[0], a); g = mix(g, GREEN[1], a); b = mix(b, GREEN[2], a);
      }
    }

    // Center dot
    if (dc < 12) {
      const a = 1 - dc / 12;
      r = mix(r, GREEN[0], a); g = mix(g, GREEN[1], a); b = mix(b, GREEN[2], a);
    }
    // Blips
    for (const [bx, by] of [[CX + 130, CY - 150], [CX - 180, CY + 90]]) {
      const db = Math.hypot(x - bx, y - by);
      if (db < 9) {
        const a = 0.9 * (1 - db / 9);
        r = mix(r, CYAN[0], a); g = mix(g, CYAN[1], a); b = mix(b, CYAN[2], a);
      }
    }

    put(x, y, clamp(r), clamp(g), clamp(b));
  }
}

// ---- Minimal PNG encoder ----
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crcTable = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  let crc = 0xFFFFFFFF;
  for (const byte of body) crc = crcTable[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE((crc ^ 0xFFFFFFFF) >>> 0);
  return Buffer.concat([len, body, crcBuf]);
}

const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y++) {
  raw[y * (W * 3 + 1)] = 0; // filter: none
  buf.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 2;  // color type: truecolor RGB

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, png);
console.log(`wrote ${outPath} (${png.length} bytes)`);
