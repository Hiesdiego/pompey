/**
 * Generates the manifest `screenshots` PNGs (narrow + wide) used by Chrome's
 * rich install dialog. Pure Node — no image dependencies.
 *
 * These are on-brand *placeholder* captures drawn from the TICKR palette
 * (#0B1B3D navy / #2E7CF6 accent). Swap in real device captures when you have
 * them; the filenames and dimensions are what the manifest expects.
 *
 * Run: node scripts/gen-pwa-screenshots.mjs
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "..", "public", "screenshots");

/* ── palette (matches globals.css tokens) ──────────────────────────────── */
const INK_TOP = [11, 27, 61]; // #0B1B3D
const INK_BOT = [5, 11, 24]; // #050B18
const CARD = [16, 23, 34]; // dark surface
const CARD_EDGE = [34, 46, 66];
const ACCENT = [46, 124, 246]; // #2E7CF6
const ACCENT_HI = [75, 147, 255];
const WHITE = [248, 250, 252];
const MUTED = [170, 182, 202];
const MINT = [52, 211, 153];
const ROSE = [244, 114, 142];

/* ── tiny raster canvas ────────────────────────────────────────────────── */
class Canvas {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.buf = Buffer.alloc(w * h * 3);
    for (let y = 0; y < h; y++) {
      const t = y / (h - 1);
      // ease the vertical gradient so the top stays navy a touch longer
      const e = t * t * (3 - 2 * t);
      const c = [
        Math.round(INK_TOP[0] + (INK_BOT[0] - INK_TOP[0]) * e),
        Math.round(INK_TOP[1] + (INK_BOT[1] - INK_TOP[1]) * e),
        Math.round(INK_TOP[2] + (INK_BOT[2] - INK_TOP[2]) * e),
      ];
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 3;
        this.buf[i] = c[0];
        this.buf[i + 1] = c[1];
        this.buf[i + 2] = c[2];
      }
    }
  }

  px(x, y, [r, g, b], a = 1) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || a <= 0) return;
    const i = (y * this.w + x) * 3;
    if (a >= 1) {
      this.buf[i] = r;
      this.buf[i + 1] = g;
      this.buf[i + 2] = b;
      return;
    }
    this.buf[i] = Math.round(this.buf[i] * (1 - a) + r * a);
    this.buf[i + 1] = Math.round(this.buf[i + 1] * (1 - a) + g * a);
    this.buf[i + 2] = Math.round(this.buf[i + 2] * (1 - a) + b * a);
  }

  /** Horizontal run of pixels — the workhorse for every shape below. */
  span(x0, x1, y, color, a = 1) {
    for (let x = Math.round(x0); x <= Math.round(x1); x++) this.px(x, y, color, a);
  }

  rect(x, y, w, h, color, a = 1) {
    for (let yy = Math.round(y); yy < Math.round(y + h); yy++) this.span(x, x + w - 1, yy, color, a);
  }

  roundRect(x, y, w, h, r, color, a = 1) {
    r = Math.min(r, w / 2, h / 2);
    const top = y + r;
    const bot = y + h - r - 1;
    for (let yy = Math.round(y); yy < Math.round(y + h); yy++) {
      let inset = 0;
      if (yy < top) {
        const d = top - yy;
        inset = r - Math.sqrt(Math.max(0, r * r - d * d));
      } else if (yy > bot) {
        const d = yy - bot;
        inset = r - Math.sqrt(Math.max(0, r * r - d * d));
      }
      this.span(x + inset, x + w - 1 - inset, yy, color, a);
    }
  }

  circle(cx, cy, r, color, a = 1) {
    const r2 = r * r;
    for (let yy = Math.floor(cy - r); yy <= Math.ceil(cy + r); yy++) {
      const dy = yy - cy;
      const dx = Math.sqrt(Math.max(0, r2 - dy * dy));
      this.span(cx - dx, cx + dx, yy, color, a);
    }
  }

  /** 5x7 bitmap glyph, drawn as `scale`x`scale` blocks. */
  glyph(ch, x, y, scale, color) {
    const rows = FONT[ch] || FONT[" "];
    for (let r = 0; r < 7; r++) {
      const bits = rows[r];
      for (let c = 0; c < 5; c++) {
        if (bits & (1 << (4 - c))) {
          this.rect(x + c * scale, y + r * scale, scale, scale, color);
        }
      }
    }
    return 5 * scale;
  }

  text(str, x, y, scale, color) {
    let cx = x;
    for (const ch of str.toUpperCase()) {
      cx += this.glyph(ch, cx, y, scale, color) + scale;
    }
    return cx - x;
  }

  textWidth(str, scale) {
    let w = 0;
    for (const ch of str.toUpperCase()) w += 5 * scale + scale;
    return Math.max(0, w - scale);
  }
}

/* ── 5x7 bitmap font (uppercase + digits + punctuation) ────────────────── */
const FONT = {
  " ": [0, 0, 0, 0, 0, 0, 0],
  A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  B: [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
  C: [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e],
  D: [0x1e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1e],
  E: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f],
  F: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
  G: [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0f],
  H: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  I: [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e],
  J: [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0c],
  K: [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
  L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
  M: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11],
  N: [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
  O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  P: [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
  Q: [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d],
  R: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  S: [0x0f, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x1e],
  T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  V: [0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04],
  W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x1b, 0x11],
  X: [0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11],
  Y: [0x11, 0x11, 0x0a, 0x04, 0x04, 0x04, 0x04],
  Z: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f],
  0: [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e],
  1: [0x04, 0x0c, 0x14, 0x04, 0x04, 0x04, 0x1f],  2: [0x0e, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1f],
  3: [0x1f, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0e],
  4: [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
  5: [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  6: [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e],
  7: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  8: [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
  9: [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c],
  ",": [0, 0, 0, 0, 0, 0x06, 0x04],
  ".": [0, 0, 0, 0, 0, 0x06, 0x06],
  "-": [0, 0, 0, 0x0e, 0, 0, 0],
  "/": [0x01, 0x01, 0x02, 0x04, 0x08, 0x10, 0x10],
  ":": [0, 0x06, 0x06, 0, 0x06, 0x06, 0],
  "+": [0, 0x04, 0x04, 0x1f, 0x04, 0x04, 0],
  "!": [0x04, 0x04, 0x04, 0x04, 0x04, 0, 0x04],
  "#": [0x0a, 0x0a, 0x1f, 0x0a, 0x1f, 0x0a, 0x0a],
};

/* ── PNG encoding ──────────────────────────────────────────────────────── */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function toPng(canvas) {
  const { w, h, buf } = canvas;
  const raw = Buffer.alloc(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) {
    const rowStart = y * (w * 3 + 1);
    raw[rowStart] = 0; // filter: none
    buf.copy(raw, rowStart + 1, y * w * 3, (y + 1) * w * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolor
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ── shared UI pieces ──────────────────────────────────────────────────── */
function logoMark(c, cx, cy, size) {
  // rounded accent tile + rising "T" mark, echoing tickr-icon.svg
  c.roundRect(cx - size / 2, cy - size / 2, size, size, size * 0.26, ACCENT);
  const bar = size * 0.1;
  const stemW = size * 0.16;
  c.rect(cx - size * 0.3, cy - size * 0.3, size * 0.6, bar, WHITE);
  c.rect(cx - stemW / 2, cy - size * 0.3, stemW, size * 0.6, WHITE);
}

function statTile(c, x, y, w, h, { label, bar, accent }) {
  c.roundRect(x, y, w, h, 22, CARD);
  c.rect(x, y, w, 3, accent ? ACCENT : CARD_EDGE, 0.9);
  c.text(label, x + 24, y + 26, 4, MUTED);
  c.text(bar.value, x + 24, y + 60, 7, WHITE);
  c.roundRect(x + 24, y + h - 30, w - 48, 8, 4, WHITE, 0.12);
  c.roundRect(x + 24, y + h - 30, (w - 48) * bar.fill, 8, 4, accent ? ACCENT_HI : MINT);
}

function rowItem(c, x, y, w, h, { dot, fill, accent }) {
  c.roundRect(x, y, w, h, 18, [22, 31, 45]);
  c.circle(x + 34, y + h / 2, 13, dot);
  c.roundRect(x + 62, y + h / 2 - 11, w * 0.34, 9, 4, WHITE, 0.86);
  c.roundRect(x + 62, y + h / 2 + 4, w * 0.22, 7, 3, MUTED, 0.5);
  c.roundRect(x + w - 24 - w * 0.2, y + h / 2 - 10, w * 0.2, 20, 10, accent, 0.9);
  c.roundRect(x + w - 24 - w * 0.2, y + h / 2 - 1, w * 0.2 * fill, 3, 2, WHITE, 0.75);
}

/* ── narrow: phone, 1080x1920 ──────────────────────────────────────────── */
function narrow() {
  const c = new Canvas(1080, 1920);
  const M = 72;

  // ambient accent glow, matching the app's mesh background
  c.circle(160, 250, 420, ACCENT, 0.055);
  c.circle(980, 1180, 480, [29, 78, 216], 0.06);

  // status bar
  c.text("TICKR", M, 86, 5, ACCENT_HI);
  c.roundRect(1080 - M - 150, 92, 150, 14, 7, WHITE, 0.28);

  // hero: mark + wordmark
  logoMark(c, 540, 430, 240);
  const wm = "TICKR";
  const wmScale = 12;
  c.text(wm, (1080 - c.textWidth(wm, wmScale)) / 2, 620, wmScale, WHITE);
  const sub = "PREDICTION LEAGUE";
  c.text(sub, (1080 - c.textWidth(sub, 4)) / 2, 730, 4, MUTED);

  // stat tiles
  const tw = (1080 - M * 2 - 32) / 2;
  statTile(c, M, 830, tw, 220, { label: "BALANCE", bar: { value: "1 250", fill: 0.72 }, accent: true });
  statTile(c, M + tw + 32, 830, tw, 220, { label: "RANK", bar: { value: "24", fill: 0.4 } });
  statTile(c, M, 1080, tw, 220, { label: "STREAK", bar: { value: "7", fill: 0.86 }, accent: true });
  statTile(c, M + tw + 32, 1080, tw, 220, { label: "CLAIMS", bar: { value: "3", fill: 0.55 } });

  // live fixtures
  c.text("LIVE FIXTURES", M, 1360, 5, MUTED);
  const rows = [
    { dot: MINT, fill: 0.8, accent: ACCENT },
    { dot: ACCENT_HI, fill: 0.52, accent: ACCENT },
    { dot: ROSE, fill: 0.66, accent: ACCENT_HI },
  ];
  rows.forEach((r, i) => rowItem(c, M, 1410 + i * 128, 1080 - M * 2, 104, r));

  // tab bar
  c.roundRect(0, 1836, 1080, 84, 0, [8, 14, 28], 0.92);
  for (let i = 0; i < 5; i++) {
    const cx = 108 + i * 216;
    c.circle(cx, 1878, 11, i === 0 ? ACCENT_HI : WHITE, i === 0 ? 1 : 0.24);
  }

  return c;
}

/* ── wide: desktop, 1920x1080 ──────────────────────────────────────────── */
function wide() {
  const c = new Canvas(1920, 1080);
  const M = 96;

  c.circle(300, 200, 520, ACCENT, 0.05);
  c.circle(1700, 900, 560, [29, 78, 216], 0.055);

  // top bar
  logoMark(c, M + 40, 96, 80);
  c.text("TICKR", M + 100, 76, 7, WHITE);
  const nav = ["FIXTURES", "MARKETS", "LEADERBOARD", "CLAIMS"];
  let nx = 560;
  for (const item of nav) {
    c.text(item, nx, 88, 4, MUTED);
    nx += c.textWidth(item, 4) + 64;
  }
  c.roundRect(1920 - M - 240, 68, 240, 56, 28, ACCENT, 0.95);
  c.text("CONNECT", 1920 - M - 210, 88, 4, WHITE);

  // headline block
  c.text("SEASON 2", M, 260, 14, WHITE);
  c.text("STAKE TICK ON CRYPTO TEAMS", M, 380, 6, ACCENT_HI);

  // stat strip
  const tiles = [
    { label: "BALANCE", bar: { value: "1 250", fill: 0.72 }, accent: true },
    { label: "RANK", bar: { value: "24", fill: 0.4 } },
    { label: "STREAK", bar: { value: "7", fill: 0.86 }, accent: true },
  ];
  const tw = (1920 - M * 2 - 64) / 3;
  tiles.forEach((t, i) => statTile(c, M + i * (tw + 32), 500, tw, 220, t));

  // board panel
  c.roundRect(M, 780, 1920 - M * 2, 240, 24, CARD, 0.85);
  c.text("LEADERBOARD", M + 32, 812, 5, MUTED);
  const rows = [
    { dot: MINT, fill: 0.82, accent: ACCENT },
    { dot: ACCENT_HI, fill: 0.6, accent: ACCENT },
  ];
  rows.forEach((r, i) => rowItem(c, M + 32, 862 + i * 76, 1920 - M * 2 - 64, 64, r));

  return c;
}

/* ── emit ──────────────────────────────────────────────────────────────── */
mkdirSync(OUT_DIR, { recursive: true });
const outputs = [
  ["narrow.png", narrow()],
  ["wide.png", wide()],
];
for (const [name, canvas] of outputs) {
  const png = toPng(canvas);
  writeFileSync(join(OUT_DIR, name), png);
  console.log(`${name}  ${canvas.w}x${canvas.h}  ${(png.length / 1024).toFixed(1)} KB`);
}
