/**
 * generate-icons.js
 * =================
 * Build ARIS Open application icons (PNG + ICO) with zero external
 * dependencies, using only node:zlib + node:fs.  Emits a 256x256 logo:
 * rounded dark tile with a blue diamond + white checkmark, plus a 64x64
 * variant for the toolbar/about.  Writes assets/icon.png and assets/icon.ico
 * (the ICO is a single 256x256 PNG-in-ICO container, valid on Win 8+ and
 * accepted by electron-builder).
 *
 * Usage:  node scripts/generate-icons.js
 */
import zlib from 'node:zlib';
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'assets');

// ---------------------------------------------------------------------------
//  Minimal PNG encoder (RGBA8)
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}
function encodePNG(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type: RGBA
  // build raw scanlines (filter byte 0 prefix each row)
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4)
      .copy(raw, y * (width * 4 + 1) + 1);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
//  Logo painter — 256x256 rounded dark tile, blue diamond, white check
// ---------------------------------------------------------------------------
function lerp(a, b, t) { return a + (b - a) * t; }
function hexToRGB(h) {
  h = h.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function makeLogo(size) {
  const px = new Uint8ClampedArray(size * size * 4);
  const r = size * 0.14;              // rounded-corner radius
  const BG = hexToRGB('#141b26');
  const EDGE = hexToRGB('#2b3950');

  // diamond geometry (centered)
  const cx = size / 2, cy = size / 2;
  const dia = size * 0.34;           // half-diagonal of the blue diamond
  const diaFill = hexToRGB('#4d8cff');
  const diaEdge = hexToRGB('#7ab0ff');
  const check = hexToRGB('#eaf2ff');

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let o = (y * size + x) * 4;

      // rounded-rect SDF
      const dx = x - r, dy = y - r;
      const dxr = Math.max(0, Math.max(cx - size / 2 - dx, dx - (size - 2 * r - (size / 2 - cx) - (0))));
      // simpler: distance to rounded rect via box test
      const bx = Math.max(r, Math.min(size - r, x));
      const by = Math.max(r, Math.min(size - r, y));
      const dRect = Math.hypot(x - bx, y - by);
      if (dRect > r) { px[o + 3] = 0; continue; }   // outside → transparent

      // base fill with subtle vertical gradient
      const g = 0.85 + 0.15 * (y / size);
      let R = BG[0] * g, G = BG[1] * g, B = BG[2] * g;
      const a = 255;

      // edge glow near border
      const border = r - dRect;                    // 0 at edge, up to r inside
      if (border < 2.2) {
        const t = 1 - border / 2.2;
        R = lerp(R, EDGE[0], t * 0.9);
        G = lerp(G, EDGE[1], t * 0.9);
        B = lerp(B, EDGE[2], t * 0.9);
      }

      // diamond: |dx|+|dy| <= dia
      const mx = Math.abs(x - cx), my = Math.abs(y - cy);
      const inDia = (mx + my) <= dia;
      const onDiaEdge = inDia && (mx + my) > dia - size * 0.035;
      if (inDia) {
        const depth = 1 - (mx + my) / dia;          // 0 at edge → 1 at center
        const t = 0.75 + 0.25 * (1 - depth);        // slightly darker toward center
        R = lerp(diaFill[0], diaEdge[0], t * 0.35);
        G = lerp(diaFill[1], diaEdge[1], t * 0.35);
        B = lerp(diaFill[2], diaEdge[2], t * 0.35);
      }

      // white checkmark inside diamond (two strokes)
      const s = size;
      const p1x = cx - dia * 0.42, p1y = cy + dia * 0.02;
      const p2x = cx - dia * 0.10, p2y = cy + dia * 0.34;
      const p3x = cx + dia * 0.44, p3y = cy - dia * 0.30;
      const thick = size * 0.085;
      function seg(px1, py1, px2, py2, X, Y) {
        const vx = px2 - px1, vy = py2 - py1;
        const wx = X - px1, wy = Y - py1;
        const len2 = vx * vx + vy * vy;
        let t = (wx * vx + wy * vy) / len2;
        t = Math.max(0, Math.min(1, t));
        const clx = px1 + t * vx, cly = py1 + t * vy;
        return Math.hypot(X - clx, Y - cly);
      }
      const nearCheck =
        (seg(p1x, p1y, p2x, p2y, x, y) < thick && inDia) ||
        (seg(p2x, p2y, p3x, p3y, x, y) < thick && inDia);
      if (nearCheck) {
        R = check[0]; G = check[1]; B = check[2];
      }

      px[o] = R; px[o + 1] = G; px[o + 2] = B; px[o + 3] = inDia || true ? a : 0;
    }
  }
  return Buffer.from(px.buffer);
}

// ---------------------------------------------------------------------------
//  ICO container: header + 1 directory entry + PNG (256x256)
// ---------------------------------------------------------------------------
function makeICO(pngBuf, size) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);        // reserved
  header.writeUInt16LE(1, 2);       // type: icon
  header.writeUInt16LE(1, 4);       // count: 1
  const entry = Buffer.alloc(16);
  entry[0] = size >= 256 ? 0 : size;       // width  (0 → 256, but we keep 0 for the big ico)
  entry[1] = size >= 256 ? 0 : size;       // height (0 → 256; electron-builder scales)
  entry[2] = 0;                     // colour count
  entry[3] = 0;                     // reserved
  entry.writeUInt16LE(1, 4);        // planes
  entry.writeUInt16LE(32, 6);       // bpp
  entry.writeUInt32LE(pngBuf.length, 8); // bytes in resource
  entry.writeUInt32LE(22, 12);      // offset (6 + 16)
  return Buffer.concat([header, entry, pngBuf]);
}

// ---------------------------------------------------------------------------
async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const S = 1024;                              // high-res master (mac icns / favicon)
  const png = encodePNG(S, S, makeLogo(S));
  const ico = makeICO(encodePNG(256, 256, makeLogo(256)), 256); // ICO entries max at 256
  await fs.writeFile(join(OUT_DIR, 'icon.png'), png);
  await fs.writeFile(join(OUT_DIR, 'icon.ico'), ico);

  // small 64x64 for in-app/about (optional)
  const small = encodePNG(64, 64, makeLogo(64));
  await fs.writeFile(join(OUT_DIR, 'icon-64.png'), small);

  console.log('✓ wrote assets/icon.png   (' + png.length + ' bytes)');
  console.log('✓ wrote assets/icon.ico   (' + ico.length + ' bytes)');
  console.log('✓ wrote assets/icon-64.png (' + small.length + ' bytes)');
}

main().catch(e => { console.error(e); process.exit(1); });
