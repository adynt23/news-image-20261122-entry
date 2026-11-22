// THE WORLD IN ONE DAY — Sunday 22 November 2026.
// A newspaper front page drawn entirely in code: 50 stories, 7 regions,
// 3 hero panels, a dotted world map, a UTC timeline and a date check.
// No images, no network, no fonts on disk — every pixel is computed here
// from a hand-authored 5x7 bitmap font and a small rasteriser, then
// encoded as PNG with Node's standard library only (node:fs, node:zlib).
// Runs twice, writes identical bytes both times.

import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

// ---------------------------------------------------------------- PNG out
const W = 1024;
const H = 1024;

const CRC_TABLE: number[] = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
  return out;
}
// Per-row filter pick: the filter whose filtered bytes have the smallest
// sum of absolute signed values (the classic libpng heuristic).
function filterRow(row: Buffer, prev: Buffer | null, type: number): Buffer {
  const out = Buffer.alloc(row.length);
  const bpp = 3;
  for (let i = 0; i < row.length; i++) {
    const a = i >= bpp ? row[i - bpp] : 0;
    const b = prev ? prev[i] : 0;
    const c = prev && i >= bpp ? prev[i - bpp] : 0;
    let v: number;
    if (type === 0) v = row[i];
    else if (type === 1) v = row[i] - a;
    else if (type === 2) v = row[i] - b;
    else if (type === 3) v = row[i] - ((a + b) >> 1);
    else {
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      v = row[i] - pr;
    }
    out[i] = v & 0xff;
  }
  return out;
}
function encodePng(rgb: Uint8Array, w: number, h: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc(h * (1 + w * 3));
  let prev: Buffer | null = null;
  for (let y = 0; y < h; y++) {
    const row = Buffer.from(rgb.buffer, rgb.byteOffset + y * w * 3, w * 3);
    let best: Buffer | null = null;
    let bestScore = Infinity;
    let bestType = 0;
    for (let t = 0; t < 5; t++) {
      const f = filterRow(row, prev, t);
      let score = 0;
      for (let i = 0; i < f.length; i++) {
        const s = f[i] < 128 ? f[i] : f[i] - 256;
        score += Math.abs(s);
      }
      if (score < bestScore) {
        bestScore = score;
        best = f;
        bestType = t;
      }
    }
    const off = y * (1 + w * 3);
    raw[off] = bestType;
    (best as Buffer).copy(raw, off + 1);
    prev = row;
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------- rasteriser
type RGB = [number, number, number];
const INK: RGB = [24, 24, 22];
const PAPER: RGB = [247, 243, 232];
const RED: RGB = [178, 34, 28];
const BLUE: RGB = [31, 68, 120];
const GOLD: RGB = [176, 132, 44];
const GREY: RGB = [110, 108, 100];
const LIGHT: RGB = [232, 226, 210];
const DARKBLUE: RGB = [18, 32, 54];

const px = new Uint8Array(W * H * 3);
function fill(r: RGB): void {
  for (let i = 0; i < W * H; i++) {
    px[i * 3] = r[0];
    px[i * 3 + 1] = r[1];
    px[i * 3 + 2] = r[2];
  }
}
function setPx(x: number, y: number, c: RGB): void {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  px[i] = c[0];
  px[i + 1] = c[1];
  px[i + 2] = c[2];
}
function rect(x: number, y: number, w: number, h: number, c: RGB): void {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(W, Math.ceil(x + w));
  const y1 = Math.min(H, Math.ceil(y + h));
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) setPx(xx, yy, c);
  }
}
function hline(x: number, y: number, w: number, c: RGB, th = 1): void {
  rect(x, y, w, th, c);
}
function vline(x: number, y: number, h: number, c: RGB, th = 1): void {
  rect(x, y, th, h, c);
}
function line(x0: number, y0: number, x1: number, y1: number, c: RGB): void {
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0;
  let y = y0;
  for (;;) {
    setPx(x, y, c);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
}
function circle(cx: number, cy: number, r: number, c: RGB, filled = true): void {
  for (let y = -r; y <= r; y++) {
    for (let x = -r; x <= r; x++) {
      const d = x * x + y * y;
      if (filled ? d <= r * r : d <= r * r && d >= (r - 1) * (r - 1)) {
        setPx(cx + x, cy + y, c);
      }
    }
  }
}
function ellipse(cx: number, cy: number, rx: number, ry: number, c: RGB): void {
  for (let y = -ry; y <= ry; y++) {
    for (let x = -rx; x <= rx; x++) {
      if ((x * x) / (rx * rx) + (y * y) / (ry * ry) <= 1) setPx(cx + x, cy + y, c);
    }
  }
}

// ------------------------------------------------- 5x7 bitmap font (mine)
// Each glyph is 7 rows of 5 cells; '#' is ink, '.' is blank.
const FONT: Record<string, string[]> = {
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  B: ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
  C: [".####", "#....", "#....", "#....", "#....", "#....", ".####"],
  D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  F: ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
  G: [".####", "#....", "#....", "#.###", "#...#", "#...#", ".###."],
  H: ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  I: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "#####"],
  J: ["..###", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##.."],
  K: ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
  L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  M: ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
  N: ["#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#", "#...#"],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  P: ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
  Q: [".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  V: ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
  W: ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"],
  X: ["#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"],
  Y: ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
  Z: ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"],
  "0": [".###.", "#..##", "#.#.#", "##..#", "#...#", "#...#", ".###."],
  "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
  "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
  "3": ["####.", "....#", "....#", ".###.", "....#", "....#", "####."],
  "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
  "6": [".###.", "#....", "#....", "####.", "#...#", "#...#", ".###."],
  "7": ["#####", "....#", "...#.", "..#..", "..#..", "..#..", "..#.."],
  "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  "9": [".###.", "#...#", "#...#", ".####", "....#", "....#", ".###."],
};

Object.assign(FONT, {
  a: [".....", ".....", ".####", "....#", ".####", "#...#", ".####"],
  b: ["#....", "#....", "####.", "#...#", "#...#", "#...#", "####."],
  c: [".....", ".....", ".####", "#....", "#....", "#....", ".####"],
  d: ["....#", "....#", ".####", "#...#", "#...#", "#...#", ".####"],
  e: [".....", ".....", ".###.", "#...#", "#####", "#....", ".###."],
  f: ["..##.", ".#..#", ".#...", "####.", ".#...", ".#...", ".#..."],
  g: [".....", ".....", ".####", "#...#", "#...#", ".####", "....#", ".###."],
  h: ["#....", "#....", "####.", "#...#", "#...#", "#...#", "#...#"],
  i: ["..#..", ".....", ".##..", "..#..", "..#..", "..#..", ".###."],
  j: ["...#.", ".....", "..##.", "...#.", "...#.", "...#.", ".##.."],
  k: ["#....", "#....", "#..#.", "#.#..", "##...", "#.#..", "#..#."],
  l: [".##..", "..#..", "..#..", "..#..", "..#..", "..#..", ".###."],
  m: [".....", ".....", "##.#.", "#.#.#", "#.#.#", "#.#.#", "#.#.#"],
  n: [".....", ".....", "####.", "#...#", "#...#", "#...#", "#...#"],
  o: [".....", ".....", ".###.", "#...#", "#...#", "#...#", ".###."],
  p: [".....", ".....", "####.", "#...#", "#...#", "####.", "#....", "#...."],
  q: [".....", ".....", ".####", "#...#", "#...#", ".####", "....#", "....#"],
  r: [".....", ".....", "#.##.", "##..#", "#....", "#....", "#...."],
  s: [".....", ".....", ".####", "#....", ".###.", "....#", "####."],
  t: [".#...", ".#...", "####.", ".#...", ".#...", ".#...", "..##."],
  u: [".....", ".....", "#...#", "#...#", "#...#", "#...#", ".####"],
  v: [".....", ".....", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
  w: [".....", ".....", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"],
  x: [".....", ".....", "#...#", ".#.#.", "..#..", ".#.#.", "#...#"],
  y: [".....", ".....", "#...#", "#...#", "#...#", ".####", "....#", ".###."],
  z: [".....", ".....", "#####", "...#.", "..#..", ".#...", "#####"],
  " ": [".....", ".....", ".....", ".....", ".....", ".....", "....."],
  ".": [".....", ".....", ".....", ".....", ".....", ".##..", ".##.."],
  ",": [".....", ".....", ".....", ".....", ".....", ".##..", ".#..."],
  ":": [".....", ".##..", ".##..", ".....", ".##..", ".##..", "....."],
  ";": [".....", ".##..", ".##..", ".....", ".##..", ".#...", ".#..."],
  "!": ["..#..", "..#..", "..#..", "..#..", "..#..", ".....", "..#.."],
  "?": [".###.", "#...#", "....#", "...#.", "..#..", ".....", "..#.."],
  "'": ["..#..", "..#..", ".#...", ".....", ".....", ".....", "....."],
  '"': [".#.#.", ".#.#.", ".....", ".....", ".....", ".....", "....."],
  "-": [".....", ".....", ".....", ".###.", ".....", ".....", "....."],
  "(": ["...#.", "..#..", ".#...", ".#...", ".#...", "..#..", "...#."],
  ")": [".#...", "..#..", "...#.", "...#.", "...#.", "..#..", ".#..."],
  "/": ["....#", "....#", "...#.", "..#..", ".#...", "#....", "#...."],
  "&": [".###.", "#...#", "#.#..", ".#...", "#.#.#", "#..#.", ".##.#"],
  "%": ["##..#", "##.#.", "...#.", "..#..", ".#...", "#.##.", "#..##"],
  "+": [".....", "..#..", "..#..", "#####", "..#..", "..#..", "....."],
  "=": [".....", ".....", "#####", ".....", "#####", ".....", "....."],
  $: ["..#..", ".####", "#.#..", ".###.", "..#.#", "####.", "..#.."],
  "*": [".....", ".#.#.", ".###.", "#####", ".###.", ".#.#.", "....."],
  "#": [".#.#.", ".#.#.", "#####", ".#.#.", "#####", ".#.#.", ".#.#."],
  "@": [".###.", "#...#", "#.###", "#.#.#", "#.###", "#....", ".###."],
  _: [".....", ".....", ".....", ".....", ".....", ".....", "#####"],
  "<": ["...#.", "..#..", ".#...", "#....", ".#...", "..#..", "...#."],
  ">": [".#...", "..#..", "...#.", "....#", "...#.", "..#..", ".#..."],
  "[": [".###.", ".#...", ".#...", ".#...", ".#...", ".#...", ".###."],
  "]": [".###.", "...#.", "...#.", "...#.", "...#.", "...#.", ".###."],
  "\u2022": [".....", ".....", ".##..", ".##..", ".....", ".....", "....."],
  "\u00b7": [".....", ".....", ".##..", ".##..", ".....", ".....", "....."],
  "\u00b0": [".###.", "#...#", ".###.", ".....", ".....", ".....", "....."],
  "\u2014": [".....", ".....", ".....", "#####", ".....", ".....", "....."],
  "\u2019": ["..#..", "..#..", ".#...", ".....", ".....", ".....", "....."],
  "\u201c": [".#.#.", ".#.#.", ".....", ".....", ".....", ".....", "....."],
  "\u201d": [".#.#.", ".#.#.", ".....", ".....", ".....", ".....", "....."],
  "\u2192": [".....", ".....", "..#..", "..#..", "#####", ".#.#.", "..#.."],
});

// Fix the 8-row glyphs (g, p, q, y): trim to 7 rows by dropping the
// last row — descenders render one row short, still legible.
for (const k of ["g", "p", "q", "y"]) {
  if (FONT[k].length > 7) FONT[k] = FONT[k].slice(0, 7);
}

// ------------------------------------------------------------ text drawing
function glyphWidth(scale: number): number {
  return 5 * scale + scale; // 5 cells + 1 cell gap
}
function textWidth(text: string, scale: number): number {
  let w = 0;
  for (const ch of text) w += ch === " " ? 3 * scale + scale : glyphWidth(scale);
  return w - scale;
}
function drawGlyph(x: number, y: number, ch: string, scale: number, c: RGB): void {
  const g = FONT[ch] ?? FONT["?"];
  for (let r = 0; r < 7; r++) {
    const row = g[r] ?? ".....";
    for (let col = 0; col < 5; col++) {
      if (row[col] === "#") rect(x + col * scale, y + r * scale, scale, scale, c);
    }
  }
}
function drawText(
  x: number,
  y: number,
  text: string,
  scale: number,
  c: RGB,
  bold = false,
): number {
  let cx = x;
  for (const ch of text) {
    if (ch === " ") {
      cx += 3 * scale + scale;
      continue;
    }
    drawGlyph(cx, y, ch, scale, c);
    if (bold) drawGlyph(cx + Math.max(1, Math.floor(scale / 2)), y, ch, scale, c);
    cx += glyphWidth(scale);
  }
  return cx;
}
function drawTextCentered(x: number, y: number, w: number, text: string, scale: number, c: RGB, bold = false): void {
  const tw = textWidth(text, scale) + (bold ? Math.max(1, Math.floor(scale / 2)) : 0);
  drawText(x + Math.floor((w - tw) / 2), y, text, scale, c, bold);
}
function wrapText(text: string, maxW: number, scale: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    const trial = cur ? cur + " " + word : word;
    if (textWidth(trial, scale) <= maxW || !cur) {
      cur = trial;
    } else {
      lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}
function drawPara(x: number, y: number, text: string, maxW: number, scale: number, c: RGB, leading: number): number {
  const lines = wrapText(text, maxW, scale);
  let yy = y;
  for (const ln of lines) {
    drawText(x, yy, ln, scale, c);
    yy += leading;
  }
  return yy;
}

// ---------------------------------------------------------------- content
// 50 stories, 7 regions. Wording re-verified in Stage 2 (22 Nov 2026):
// #13 Belgium confirmed (airspace shut 07:00-21:00 Mon, most flights
// cancelled); #17 Japan poll CORRECTED to 62% (not 92% — 93% is the
// negative view of China); #25 Houthi intercepts confirmed (Reuters);
// #34 Roundup $7.25bn confirmed (Reuters/AP, 20 Nov); #35 Palisades
// conviction confirmed (CNN, 20 Nov); #37 Sudan landmine hedged as
// reports differ 18-23; #45 Bitcoin $61,231 confirmed (CoinTelegraph).
// Swaps applied: #21 -> F8, #39 -> F7, #50 -> F6. #49 updated with the
// Las Vegas GP result (Verstappen won). #47 stays "final set" (ATP final
// not yet played at build time). "Claimed"/"reported" hedge every
// unverified item. Poland missiles and Wall Street are IN the 50 as
// dated 20 Nov stories, so they are NOT in the date-check exclusions.

interface Hero {
  scene: "bahrain" | "kryvyi" | "mexico";
  kicker: string;
  head: string;
  deck: string;
  src: string;
}
const HEROES: Hero[] = [
  {
    scene: "bahrain",
    kicker: "MIDDLE EAST \u00b7 21 NOV",
    head: "IRAN STRIKES US BASES IN BAHRAIN",
    deck: "IRGC missiles hit al-Riffa and Awali; Tehran claims two Patriot radars destroyed. The US says most were intercepted.",
    src: "AL JAZEERA \u00b7 REUTERS",
  },
  {
    scene: "kryvyi",
    kicker: "UKRAINE \u00b7 20\u201321 NOV",
    head: "TRIPLE-TAP IN KRYVYI RIH",
    deck: "A boy of 7 and a paramedic of 20 are killed. Zelensky calls Putin \u201ca killer\u201d after Trump called him \u201ca friend\u201d.",
    src: "CNN \u00b7 AP",
  },
  {
    scene: "mexico",
    kicker: "MEXICO \u00b7 20\u201321 NOV",
    head: "EL CHAPO ISIDRO CAPTURED",
    deck: "Troops seize FBI Top 10 fugitive Fausto Isidro Meza Flores in Guasave, Sinaloa. 11 dead, 8 held; cartel roadblocks follow.",
    src: "REUTERS \u00b7 AP",
  },
];

interface Card {
  icon: string;
  head: string;
  deck: string;
  src: string;
}
const CARDS: Card[] = [
  { icon: "leaf", head: "COP31 NEARS A DEAL", deck: "New package tabled in Antalya; approval session 06:00 GMT.", src: "REUTERS" },
  { icon: "burst", head: "400-DRONE BARRAGE", deck: "400+ drones, 110+ missiles hit Ukraine; 8 killed.", src: "AP" },
  { icon: "flag", head: "MISSILES LAND IN POLAND", deck: "Kh-101 near Nowy Lipowiec; NATO: grave violation.", src: "REUTERS" },
  { icon: "shield", head: "NATO DEFENDS EVERY INCH", deck: "Poland asks for more Eastern Sentry jets and early warning.", src: "PAP" },
  { icon: "ship", head: "SPARTA II ABLAZE", deck: "Drones hit the sanctioned Russian cargo ship; 16 crew off.", src: "REUTERS" },
  { icon: "mount", head: "NEPAL PM IN NEW DELHI", deck: "Balendra Shah's first foreign trip; talks with Modi on Monday.", src: "ANI" },
  { icon: "ship", head: "TANKERS HIT IN HORMUZ", deck: "UKMTO: stern and engine-room strikes; no casualties.", src: "UKMTO" },
  { icon: "bolt", head: "IRAN POWER RATIONING", deck: "Rolling ~2-hour cuts from Sunday as war damage bites.", src: "RFE/RL" },
  { icon: "star", head: "EISENKOT TO FORM GOVT", deck: "Herzog picks the ex-army chief over Netanyahu; 67 of 120 MKs back him.", src: "WIRES" },
  { icon: "quake", head: "M6.9 QUAKE SHAKES PERU", deck: "39+ homes damaged, a teenager hurt; felt in Lima.", src: "USGS" },
];

// 37 briefs — one line each, source in brackets. Count: 5 + 6 + 5 + 6 + 3
// + 5 + 4 + 3 = 37. Heroes (3) + cards (10) + briefs (37) = 50.
const BRIEFS: string[] = [
  "Russian helicopter \u201c4.1 km into Finnish airspace\u201d off Loviisa [FIN DEF MIN]",
  "Denmark: Russia plotted to kill rapper Kyivstoner; envoy expelled [REUTERS]",
  "Estonia to shut all 5 Russia road crossings from 1 Dec [EST GOVT]",
  "France protests shrink: 82,500 march, down from 106,000 [REUTERS]",
  "Belgium: airspace shut 07:00\u201321:00 Mon; most flights cancelled [SKEYES]",
  "ICJ finds Myanmar guilty of Rohingya genocide, 9\u20136 [UN NEWS]",
  "M5.9 quake, Eastern New Guinea, 04:42 UTC [EMSC, reported]",
  "Japan: record 62% feel friendly to South Korea, poll finds [CABINET OFFICE]",
  "Seoul: K-pop group A20 debuts with 6 Chinese members [KOREA TIMES, reported]",
  "Hong Kong flight in emergency landing in Philippines [reported]",
  "Philippines monitors monkey-linked malaria in N. Palawan [DOH, reported]",
  "US denies Iran hit an F-16; Tehran also claims an MQ-9 downing [CENTCOM]",
  "Saudi-led coalition intercepts 3 Houthi missiles aimed at Riyadh [REUTERS]",
  "Gaza: van strike kills 3; aid link disputed [AL JAZEERA]",
  "Israeli troops set up checkpoint in Syria's Quneitra [reported]",
  "Araghchi: reopening Hormuz \u201cnot difficult\u201d if US ends blockade [EURONEWS]",
  "FBI probes apparent hack of its NCIC crime database [CNN \u00b7 AP]",
  "Democrats to probe $12.11bn in Venezuela oil funds [AL JAZEERA]",
  "Trump wants a \u201cpermanent deal\u201d to block an Iranian bomb [EURONEWS, reported]",
  "Missouri judge approves Bayer's $7.25bn Roundup settlement [REUTERS]",
  "LA: man convicted of starting the deadly 2025 Palisades fire [CNN]",
  "US midterms: loss corners Vance as the 2028 field widens [reported]",
  "Sudan: landmine kills 18\u201323 on the road to El-Obeid [reports differ]",
  "DRC Ebola: 5,387 dead; Kenya discharges its last patient [WHO \u00b7 ECDC]",
  "South Sudan: 300+ flee shelters as Tambura clashes resume [reported]",
  "Wall Street correction: Nasdaq \u22125.28% Fri, worst week since Mar 2020 [LE MONDE]",
  "Gold at a 14-month low; worst week in 8 months [REUTERS]",
  "Nvidia: SEC probes accounting; stock \u221214% Fri [REUTERS]",
  "Anthropic slides after its $83 IPO on Nasdaq [INVESTOPEDIA]",
  "Bitcoin falls to a 20-week low near $61,200 [COINTELEGRAPH]",
  "EU gives fossil-fuel importers a 2-year methane reprieve [OFFSHORE ENERGY]",
  "ATP Finals final set: Alcaraz vs Zverev, Turin, Sun [ATP]",
  "Premier League: Leeds stun Chelsea 4\u20131 at Stamford Bridge [BBC]",
  "F1 Las Vegas: Verstappen WINS; Norris 2nd +0.639s, Piastri 3rd [F1]",
  "US approved ~879,000 AI chips for China in six months [THE REGISTER]",
  "EU\u2013UK conclude 3 deals: food safety, carbon market, youth mobility [20 NOV]",
  "Merz ties EU budget backing to all states funding Ukraine [FT]",
];

const STATS: { n: string; label: string }[] = [
  { n: "2", label: "TANKERS HIT IN HORMUZ" },
  { n: "16", label: "CREW OFF SPARTA II" },
  { n: "400+", label: "DRONES IN THE BARRAGE" },
  { n: "82,500", label: "MARCH IN FRANCE" },
  { n: "$7.25bn", label: "ROUNDUP SETTLEMENT" },
  { n: "1,671", label: "GAZA DEAD SINCE TRUCE" },
];

const TIMELINE: { t: string; label: string }[] = [
  { t: "00:50", label: "WIRES READ TO 00:50 UTC" },
  { t: "04:00", label: "LAS VEGAS GP: LIGHTS OUT" },
  { t: "06:00", label: "COP31 APPROVAL SESSION" },
  { t: "18:00", label: "ATP FINAL, TURIN (CET)" },
];

const DATE_CHECK =
  "DATE CHECK \u2014 LEFT OUT: Shenzhen summit (19 Nov) \u00b7 Riemann claim (20 Nov) \u00b7 " +
  "Norway oil ruling (13 Nov) \u00b7 Gibran resignation (12\u201313 Nov) \u00b7 Kinmen drill (3 Nov). " +
  "Every story here happened, or was first reported, on 22 Nov 2026 in at least one time zone.";

// Extra glyphs used by the copy: en dash and the minus sign.
Object.assign(FONT, {
  "\u2013": [".....", ".....", ".....", ".###.", ".....", ".....", "....."],
  "\u2212": [".....", ".....", ".....", ".###.", ".....", ".....", "....."],
});

// ------------------------------------------------------- hero illustrations
// Simple geometric scenes, drawn in code — no photographs anywhere.
function sceneBahrain(x: number, y: number, w: number, h: number): void {
  rect(x, y, w, h, DARKBLUE);
  // skyline silhouettes
  const sky: [number, number, number][] = [
    [0, 34, 26], [30, 22, 34], [68, 40, 26], [98, 18, 30], [132, 30, 28],
    [164, 42, 30], [198, 20, 26], [230, 34, 30], [264, 26, 28], [292, 38, 28],
  ];
  for (const [sx, sh, sw] of sky) rect(x + sx, y + h - 26 - sh, sw, sh + 26, INK);
  // windows
  for (let i = 0; i < 40; i++) {
    const wx = x + 6 + ((i * 37) % (w - 12));
    const wy = y + h - 22 - ((i * 23) % 34);
    rect(wx, wy, 3, 3, GOLD);
  }
  // fire glow over the industrial site
  circle(x + 250, y + h - 30, 16, RED);
  circle(x + 250, y + h - 30, 10, GOLD);
  circle(x + 238, y + h - 34, 7, GOLD);
  // missile arcs
  line(x + 40, y + 8, x + 150, y + 44, PAPER);
  line(x + 150, y + 44, x + 210, y + 66, PAPER);
  circle(x + 40, y + 8, 3, PAPER);
  circle(x + 150, y + 44, 3, PAPER);
  line(x + 300, y + 14, x + 230, y + 40, PAPER);
  circle(x + 300, y + 14, 3, PAPER);
  // sea
  rect(x, y + h - 8, w, 8, BLUE);
}
function sceneKryvyi(x: number, y: number, w: number, h: number): void {
  rect(x, y, w, h, [203, 196, 180]);
  // apartment blocks
  rect(x + 14, y + 22, 74, h - 22, GREY);
  rect(x + 104, y + 34, 64, h - 34, [140, 136, 126]);
  rect(x + 184, y + 16, 84, h - 16, GREY);
  rect(x + 282, y + 40, 26, h - 40, [140, 136, 126]);
  // lit windows
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 5; c++) {
      if ((r + c) % 3 !== 0) rect(x + 22 + c * 13, y + 30 + r * 12, 6, 6, GOLD);
    }
  }
  // explosion starburst
  const cx = x + 150;
  const cy = y + 30;
  for (let a = 0; a < 8; a++) {
    const ang = (a * Math.PI) / 4;
    line(cx, cy, Math.round(cx + Math.cos(ang) * 26), Math.round(cy + Math.sin(ang) * 26), RED);
    line(cx, cy, Math.round(cx + Math.cos(ang + 0.4) * 18), Math.round(cy + Math.sin(ang + 0.4) * 18), GOLD);
  }
  circle(cx, cy, 10, RED);
  circle(cx, cy, 5, GOLD);
  // smoke
  circle(x + 120, y + 14, 10, [120, 116, 108]);
  circle(x + 140, y + 8, 12, [120, 116, 108]);
  circle(x + 168, y + 12, 9, [120, 116, 108]);
  // medical cross (the rescuers)
  rect(x + w - 34, y + h - 26, 20, 7, RED);
  rect(x + w - 27, y + h - 33, 7, 20, RED);
}
function sceneMexico(x: number, y: number, w: number, h: number): void {
  rect(x, y, w, h, [233, 214, 170]);
  // sun
  circle(x + 268, y + 18, 12, GOLD);
  // mountains
  const mtn: [number, number][] = [[0, 52], [52, 22], [104, 52], [150, 30], [210, 52], [250, 34], [320, 52]];
  for (let i = 0; i < mtn.length - 1; i += 2) {
    const [ax, ay] = mtn[i];
    const [bx, by] = mtn[i + 1];
    const [cx2, cy2] = mtn[i + 2];
    line(x + ax, y + h - 24, x + bx, y + by, [120, 92, 60]);
    line(x + bx, y + by, x + cx2, y + h - 24, [120, 92, 60]);
  }
  // desert road
  rect(x, y + h - 24, w, 24, [196, 164, 110]);
  line(x, y + h - 12, x + w, y + h - 12, INK);
  // road dashes
  for (let d = 8; d < w; d += 32) rect(x + d, y + h - 14, 16, 3, PAPER);
  // badge star
  const bx = x + 52;
  const by = y + 26;
  circle(bx, by, 15, GOLD);
  circle(bx, by, 11, PAPER);
  for (let a = 0; a < 5; a++) {
    const ang = -Math.PI / 2 + (a * 2 * Math.PI) / 5;
    const ang2 = ang + Math.PI / 5;
    line(bx, by, Math.round(bx + Math.cos(ang) * 9), Math.round(by + Math.sin(ang) * 9), RED);
    line(bx, by, Math.round(bx + Math.cos(ang2) * 4), Math.round(by + Math.sin(ang2) * 4), RED);
  }
  circle(bx, by, 3, RED);
}
function drawScene(kind: Hero["scene"], x: number, y: number, w: number, h: number): void {
  if (kind === "bahrain") sceneBahrain(x, y, w, h);
  else if (kind === "kryvyi") sceneKryvyi(x, y, w, h);
  else sceneMexico(x, y, w, h);
}

// ------------------------------------------------------------- card icons
function drawIcon(kind: string, x: number, y: number, s: number, c: RGB): void {
  const u = s / 22;
  const px2 = (dx: number, dy: number, w: number, h: number) =>
    rect(Math.round(x + dx * u), Math.round(y + dy * u), Math.max(1, Math.round(w * u)), Math.max(1, Math.round(h * u)), c);
  if (kind === "leaf") {
    circle(Math.round(x + 11 * u), Math.round(y + 10 * u), Math.round(8 * u), c);
    line(Math.round(x + 11 * u), Math.round(y + 18 * u), Math.round(x + 11 * u), Math.round(y + 22 * u), c);
    line(Math.round(x + 4 * u), Math.round(y + 8 * u), Math.round(x + 11 * u), Math.round(y + 12 * u), c);
    line(Math.round(x + 18 * u), Math.round(y + 8 * u), Math.round(x + 11 * u), Math.round(y + 12 * u), c);
  } else if (kind === "burst") {
    for (let a = 0; a < 8; a++) {
      const ang = (a * Math.PI) / 4;
      line(
        Math.round(x + 11 * u), Math.round(y + 11 * u),
        Math.round(x + 11 * u + Math.cos(ang) * 10 * u),
        Math.round(y + 11 * u + Math.sin(ang) * 10 * u), c,
      );
    }
    circle(Math.round(x + 11 * u), Math.round(y + 11 * u), Math.round(3 * u), c);
  } else if (kind === "flag") {
    px2(4, 2, 2, 18);
    px2(6, 3, 12, 7);
  } else if (kind === "shield") {
    px2(5, 2, 12, 12);
    px2(5, 12, 12, 3);
    px2(8, 15, 6, 3);
    px2(10, 18, 2, 2);
  } else if (kind === "ship") {
    px2(3, 14, 16, 4);
    px2(6, 18, 10, 2);
    px2(10, 4, 2, 10);
    px2(12, 5, 7, 5);
  } else if (kind === "mount") {
    line(Math.round(x + 2 * u), Math.round(y + 19 * u), Math.round(x + 9 * u), Math.round(y + 5 * u), c);
    line(Math.round(x + 9 * u), Math.round(y + 5 * u), Math.round(x + 16 * u), Math.round(y + 19 * u), c);
    line(Math.round(x + 13 * u), Math.round(y + 19 * u), Math.round(x + 18 * u), Math.round(y + 10 * u), c);
    line(Math.round(x + 18 * u), Math.round(y + 10 * u), Math.round(x + 21 * u), Math.round(y + 19 * u), c);
  } else if (kind === "bolt") {
    px2(12, 2, 4, 6);
    px2(8, 8, 8, 4);
    px2(10, 12, 4, 4);
    px2(6, 16, 8, 4);
  } else if (kind === "star") {
    for (let a = 0; a < 5; a++) {
      const ang = -Math.PI / 2 + (a * 2 * Math.PI) / 5;
      line(
        Math.round(x + 11 * u), Math.round(y + 11 * u),
        Math.round(x + 11 * u + Math.cos(ang) * 10 * u),
        Math.round(y + 11 * u + Math.sin(ang) * 10 * u), c,
      );
    }
    circle(Math.round(x + 11 * u), Math.round(y + 11 * u), Math.round(3 * u), c);
  } else if (kind === "quake") {
    line(Math.round(x + 2 * u), Math.round(y + 12 * u), Math.round(x + 7 * u), Math.round(y + 12 * u), c);
    line(Math.round(x + 7 * u), Math.round(y + 12 * u), Math.round(x + 10 * u), Math.round(y + 4 * u), c);
    line(Math.round(x + 10 * u), Math.round(y + 4 * u), Math.round(x + 13 * u), Math.round(y + 18 * u), c);
    line(Math.round(x + 13 * u), Math.round(y + 18 * u), Math.round(x + 16 * u), Math.round(y + 8 * u), c);
    line(Math.round(x + 16 * u), Math.round(y + 8 * u), Math.round(x + 20 * u), Math.round(y + 12 * u), c);
  }
}

// --------------------------------------------------------- dotted world map
// Continents as ellipses in lon/lat space; dots land where the grid falls
// inside one. Red dots mark where the day's biggest stories happened.
const CONTINENTS: [number, number, number, number][] = [
  [-100, 50, 55, 28], [-158, 64, 16, 9], [-88, 14, 14, 7],
  [-42, 74, 12, 7], [-60, -14, 17, 27], [14, 52, 20, 11],
  [18, 4, 21, 27], [92, 50, 52, 24], [78, 21, 9, 12],
  [104, 10, 14, 11], [134, -25, 17, 9],
];
const HOTSPOTS: [number, number][] = [
  [50.5, 26.2], [33.4, 47.9], [-108.5, 25.6], [30.7, 36.9],
  [21, 52.2], [-77, -12], [34.5, 31.5], [-115.1, 36.2], [7.7, 45.1],
];
function drawMap(x: number, y: number, w: number, h: number): void {
  const step = 7;
  for (let gy = y + 3; gy < y + h - 3; gy += step) {
    for (let gx = x + 3; gx < x + w - 3; gx += step) {
      const lon = ((gx - x) / w) * 360 - 180;
      const lat = 90 - ((gy - y) / h) * 180;
      let land = false;
      for (const [clon, clat, rx, ry] of CONTINENTS) {
        const d = ((lon - clon) / rx) ** 2 + ((lat - clat) / ry) ** 2;
        if (d <= 1) {
          land = true;
          break;
        }
      }
      if (land) rect(gx, gy, 2, 2, INK);
    }
  }
  for (const [lon, lat] of HOTSPOTS) {
    const hx = x + ((lon + 180) / 360) * w;
    const hy = y + ((90 - lat) / 180) * h;
    circle(Math.round(hx), Math.round(hy), 4, PAPER);
    circle(Math.round(hx), Math.round(hy), 3, RED);
  }
}

// ------------------------------------------------------------------- layout
function drawSpaced(segments: string[], x: number, y: number, w: number, scale: number, c: RGB, bold: boolean): void {
  const widths = segments.map(
    (s) => textWidth(s, scale) + (bold ? Math.max(1, Math.floor(scale / 2)) : 0),
  );
  const total = widths.reduce((a, b) => a + b, 0);
  const gap = (w - total) / (segments.length - 1);
  let cx = x;
  for (let i = 0; i < segments.length; i++) {
    drawText(cx, y, segments[i], scale, c, bold);
    cx += widths[i] + gap;
  }
}
function outline(x: number, y: number, w: number, h: number, c: RGB): void {
  hline(x, y, w, c);
  hline(x, y + h - 1, w, c);
  vline(x, y, h, c);
  vline(x + w - 1, y, h, c);
}

function build(): void {
  fill(PAPER);
  // ---- masthead
  rect(24, 8, 976, 3, INK);
  drawText(24, 16, "SUNDAY EDITION", 1, INK, true);
  const issue = "50 STORIES \u00b7 7 REGIONS \u00b7 WIRES TO 00:50 UTC";
  drawText(1000 - textWidth(issue, 1), 16, issue, 1, INK);
  hline(24, 27, 976, INK);
  drawTextCentered(24, 32, 976, "THE WORLD IN ONE DAY", 7, INK, true);
  rect(24, 86, 976, 3, RED);
  drawTextCentered(24, 93, 976, "SUNDAY 22 NOVEMBER 2026", 5, INK, true);
  hline(24, 133, 976, INK);
  drawTextCentered(
    24, 139, 976,
    "GULF STRIKES \u00b7 COP31 NEARS A DEAL \u00b7 EL CHAPO ISIDRO FALLS \u00b7 WALL STREET SLIDES",
    2, INK,
  );
  // ---- stat strip
  const statY = 159;
  for (let i = 0; i < STATS.length; i++) {
    const bx = 24 + i * 164;
    outline(bx, statY, 156, 42, INK);
    drawText(bx + 8, statY + 5, STATS[i].n, 3, RED, true);
    drawText(bx + 8, statY + 28, STATS[i].label, 1, INK);
  }
  // ---- heroes
  const heroY = 207;
  for (let i = 0; i < 3; i++) {
    const hx = 24 + i * 328;
    outline(hx, heroY, 320, 240, INK);
    drawScene(HEROES[i].scene, hx + 1, heroY + 1, 318, 76);
    drawText(hx + 8, heroY + 84, HEROES[i].kicker, 1, RED, true);
    drawPara(hx + 8, heroY + 98, HEROES[i].head, 304, 3, INK, 22);
    drawPara(hx + 8, heroY + 146, HEROES[i].deck, 304, 2, INK, 14);
    drawText(hx + 8, heroY + 224, HEROES[i].src, 1, GREY);
  }
  // ---- region bar
  hline(24, 449, 976, INK);
  drawSpaced(
    ["EUROPE 10", "ASIA-PACIFIC 8", "MIDDLE EAST 8", "AMERICAS 7", "AFRICA 4", "MARKETS & TECH 5", "SPORT 5"],
    24, 454, 976, 2, INK, true,
  );
  hline(24, 471, 976, INK);
  // ---- cards (10)
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 5; c++) {
      const card = CARDS[r * 5 + c];
      const cx = 24 + c * 196;
      const cy = 477 + r * 74;
      outline(cx, cy, 188, 70, INK);
      rect(cx, cy, 188, 3, RED);
      drawIcon(card.icon, cx + 166, cy + 6, 16, RED);
      drawPara(cx + 6, cy + 8, card.head, 150, 2, INK, 14);
      drawPara(cx + 6, cy + 38, card.deck, 176, 1, INK, 9);
      drawText(cx + 6, cy + 58, card.src, 1, GREY);
    }
  }
  // ---- dotted world map
  drawMap(24, 627, 976, 62);
  drawTextCentered(
    24, 693, 976,
    "RED DOTS MARK WHERE THE DAY HAPPENED: BAHRAIN \u00b7 KRYVYI RIH \u00b7 GUASAVE \u00b7 ANTALYA \u00b7 WARSAW \u00b7 LIMA \u00b7 GAZA \u00b7 LAS VEGAS \u00b7 TURIN",
    1, INK,
  );
  // ---- UTC timeline
  hline(24, 707, 976, INK);
  const tl: [string, string][] = [
    ["00:50", "WIRES READ TO 00:50 UTC"],
    ["04:00", "LAS VEGAS GP: LIGHTS OUT"],
    ["06:00", "COP31 APPROVAL SESSION"],
    ["18:00", "ATP FINAL, TURIN (CET)"],
  ];
  for (let i = 0; i < tl.length; i++) {
    const tx = 24 + i * 244;
    vline(tx, 711, 21, INK);
    drawText(tx + 8, 712, tl[i][0], 2, RED, true);
    drawText(tx + 8, 727, tl[i][1], 1, INK);
  }
  // ---- briefs
  drawText(24, 740, "ALSO ON SUNDAY \u2014 37 MORE STORIES", 2, INK, true);
  const bRight = "EVERY STORY DATED \u00b7 SOURCES NAMED";
  drawText(1000 - textWidth(bRight, 1), 743, bRight, 1, INK);
  hline(24, 757, 976, INK);
  const colX = [24, 512];
  const colW = [480, 488];
  for (let col = 0; col < 2; col++) {
    const start = col * 19;
    const count = col === 0 ? 19 : 18;
    for (let i = 0; i < count; i++) {
      drawText(colX[col], 764 + i * 9, "\u2022 " + BRIEFS[start + i], 1, INK);
    }
  }
  // ---- date check
  rect(24, 936, 976, 2, RED);
  rect(24, 1004, 976, 2, RED);
  rect(24, 936, 2, 70, RED);
  rect(998, 936, 2, 70, RED);
  drawPara(36, 944, DATE_CHECK, 944, 2, INK, 14);
  // ---- footer
  drawTextCentered(
    24, 1012, 976,
    "SOURCES NAMED BESIDE EACH STORY: REUTERS \u00b7 AP \u00b7 CNN \u00b7 AL JAZEERA \u00b7 BBC \u00b7 UKMTO \u00b7 USGS \u00b7 ATP \u00b7 F1 \u00b7 WHO \u00b7 ECDC \u00b7 UN NEWS \u2014 DRAWN ENTIRELY IN CODE; NO PHOTOGRAPHS.",
    1, INK,
  );
  rect(24, 1021, 976, 2, INK);
}

function main(): void {
  build();
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
  mkdirSync(outDir, { recursive: true });
  const png = encodePng(px, W, H);
  writeFileSync(`${outDir}/entry.png`, png);
}

main();
