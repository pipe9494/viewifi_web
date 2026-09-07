// Generates assets/apple-touch-icon.png (180x180) from the brand radar mark.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const S = 180;
const outPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'apple-touch-icon.png');
const buf = Buffer.alloc(S * S * 3);

const BG = [10, 14, 20], BLUE = [27, 152, 224], CYAN = [0, 229, 255], GREEN = [0, 230, 118];
const clamp = v => v < 0 ? 0 : v > 255 ? 255 : v;
const mix = (a, b, t) => a + (b - a) * t;
const c = S / 2;

for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    let r = BG[0], g = BG[1], b = BG[2];
    const dc = Math.hypot(x - c, y - c);

    // Two signal arcs (the brand mark), radii 52 and 76, upper half
    if (y <= c + 6) {
      for (const [R, col] of [[52, CYAN], [76, BLUE]]) {
        const d = Math.abs(dc - R);
        if (d < 4.5) {
          const a = (1 - d / 4.5) * 0.95;
          r = mix(r, col[0], a); g = mix(g, col[1], a); b = mix(b, col[2], a);
        }
      }
    }
    // Center dot
    if (dc < 13) {
      const a = 1 - dc / 13;
      r = mix(r, GREEN[0], a); g = mix(g, GREEN[1], a); b = mix(b, GREEN[2], a);
    }
    buf[(y * S + x) * 3] = clamp(r);
    buf[(y * S + x) * 3 + 1] = clamp(g);
    buf[(y * S + x) * 3 + 2] = clamp(b);
  }
}

function chunk(type, data) {
  const table = [];
  for (let n = 0; n < 256; n++) {
    let v = n;
    for (let k = 0; k < 8; k++) v = v & 1 ? 0xEDB88320 ^ (v >>> 1) : v >>> 1;
    table[n] = v >>> 0;
  }
  let crc = 0xFFFFFFFF;
  for (const byte of data) crc = table[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  const out = Buffer.alloc(8 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE((crc ^ 0xFFFFFFFF) >>> 0);
  return Buffer.concat([out, tail]);
}

const raw = Buffer.alloc((S * 3 + 1) * S);
for (let y = 0; y < S; y++) {
  raw[y * (S * 3 + 1)] = 0;
  buf.copy(raw, y * (S * 3 + 1) + 1, y * S * 3, (y + 1) * S * 3);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 2;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, png);
console.log(`wrote ${outPath} (${png.length} bytes)`);
