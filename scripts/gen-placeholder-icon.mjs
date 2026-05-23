#!/usr/bin/env node
// Pure-Node placeholder icon generator. No deps. Produces square RGBA PNGs.
// Replace by running `pnpm --filter @astro-plan/desktop exec tauri icon <source>`
// once a real brand asset exists.

import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const iconsDir = resolve(here, '../apps/desktop/src-tauri/icons');

const BG = [0x0d, 0x13, 0x2a, 0xff];
const FG = [0xe6, 0xed, 0xff, 0xff];
const ACCENT = [0x7c, 0xa0, 0xff, 0xff];

const FONT_A = [
  '..XXXXXX..',
  '.XX....XX.',
  'XX......XX',
  'XX......XX',
  'XXXXXXXXXX',
  'XXXXXXXXXX',
  'XX......XX',
  'XX......XX',
  'XX......XX',
  'XX......XX',
];

function blend(out, x, y, w, h, color) {
  if (x < 0 || y < 0 || x >= w || y >= h) return;
  const i = (y * w + x) * 4;
  out[i] = color[0];
  out[i + 1] = color[1];
  out[i + 2] = color[2];
  out[i + 3] = color[3];
}

function disc(out, w, h, cx, cy, r, color) {
  const r2 = r * r;
  const inner = (r - 1.5) * (r - 1.5);
  for (let y = Math.max(0, cy - r); y < Math.min(h, cy + r); y++) {
    for (let x = Math.max(0, cx - r); x < Math.min(w, cx + r); x++) {
      const d = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      if (d <= r2) {
        if (d >= inner) {
          const t = (r2 - d) / (r2 - inner);
          const a = Math.round(color[3] * Math.min(1, t));
          const i = (y * w + x) * 4;
          const src = [color[0], color[1], color[2], a];
          const af = src[3] / 255;
          out[i] = Math.round(src[0] * af + out[i] * (1 - af));
          out[i + 1] = Math.round(src[1] * af + out[i + 1] * (1 - af));
          out[i + 2] = Math.round(src[2] * af + out[i + 2] * (1 - af));
          out[i + 3] = 255;
        } else {
          blend(out, x, y, w, h, color);
        }
      }
    }
  }
}

function drawGlyph(out, w, h, glyph, cx, cy, scale, color) {
  const gh = glyph.length;
  const gw = glyph[0].length;
  const x0 = Math.round(cx - (gw * scale) / 2);
  const y0 = Math.round(cy - (gh * scale) / 2);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      if (glyph[gy][gx] !== 'X') continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          blend(out, x0 + gx * scale + dx, y0 + gy * scale + dy, w, h, color);
        }
      }
    }
  }
}

function makeRGBA(size) {
  const buf = Buffer.alloc(size * size * 4);
  for (let i = 0; i < buf.length; i += 4) {
    buf[i] = BG[0];
    buf[i + 1] = BG[1];
    buf[i + 2] = BG[2];
    buf[i + 3] = 0xff;
  }
  const cx = size / 2;
  const cy = size / 2;
  // Faint outer ring (telescope aperture suggestion)
  const ringR = Math.round(size * 0.42);
  disc(buf, size, size, Math.round(cx), Math.round(cy), ringR, [...ACCENT.slice(0, 3), 0x20]);
  disc(buf, size, size, Math.round(cx), Math.round(cy), ringR - Math.max(2, size / 64), BG);
  // Small "star" specks
  const speckColor = [...FG.slice(0, 3), 0xa0];
  const specks = [
    [0.18, 0.22, 0.012],
    [0.82, 0.28, 0.008],
    [0.14, 0.74, 0.006],
    [0.78, 0.78, 0.014],
    [0.5, 0.12, 0.006],
    [0.88, 0.5, 0.005],
  ];
  for (const [fx, fy, fr] of specks) {
    disc(buf, size, size, Math.round(fx * size), Math.round(fy * size), Math.max(1, Math.round(fr * size)), speckColor);
  }
  // Monogram "A"
  const scale = Math.max(1, Math.round(size / 28));
  drawGlyph(buf, size, size, FONT_A, cx, cy, scale, FG);
  return buf;
}

// PNG encoder
function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })());
  c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

function encodePNG(rgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  // raw scanlines with filter 0
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = deflateSync(raw, { level: 9 });
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

mkdirSync(iconsDir, { recursive: true });
for (const [name, size] of [
  ['32x32.png', 32],
  ['128x128.png', 128],
  ['128x128@2x.png', 256],
  ['icon.png', 512],
]) {
  const rgba = makeRGBA(size);
  const png = encodePNG(rgba, size);
  writeFileSync(resolve(iconsDir, name), png);
  console.log(`wrote ${name} (${size}x${size}, ${png.length} bytes)`);
}
