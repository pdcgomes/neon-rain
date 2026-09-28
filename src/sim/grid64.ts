/**
 * Compact text encoding for byte grids in mission JSON: run-length pairs (value, run 1..255) in
 * base64, prefixed "rle:". City grids are mostly long runs, so this stays small. Works in the
 * browser and in Node (both have btoa/atob).
 */
export function encodeGrid(data: Uint8Array): string {
  const out: number[] = [];
  for (let i = 0; i < data.length; ) {
    const v = data[i];
    let n = 1;
    while (i + n < data.length && data[i + n] === v && n < 255) n++;
    out.push(v, n);
    i += n;
  }
  let s = '';
  for (let i = 0; i < out.length; i += 0x8000) s += String.fromCharCode(...out.slice(i, i + 0x8000));
  return `rle:${btoa(s)}`;
}

export function decodeGrid(text: string, length: number): Uint8Array {
  const out = new Uint8Array(length);
  if (!text) return out;
  const rle = text.startsWith('rle:');
  const bin = atob(rle ? text.slice(4) : text);
  if (!rle) {
    for (let i = 0; i < Math.min(length, bin.length); i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  let o = 0;
  for (let i = 0; i + 1 < bin.length && o < length; i += 2) {
    const v = bin.charCodeAt(i);
    const n = bin.charCodeAt(i + 1);
    out.fill(v, o, Math.min(length, o + n));
    o += n;
  }
  return out;
}
