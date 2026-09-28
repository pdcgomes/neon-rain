/**
 * RNC ProPack method 1 decompressor (the Huffman + LZ77 packer Bullfrog used for most Syndicate data).
 *
 * Header, 18 bytes, big-endian: "RNC" 0x01, unpacked length u32, packed length u32, unpacked CRC u16,
 * packed CRC u16, leeway u8, chunk count u8. The bit stream is read LSB-first in little-endian 16-bit
 * words; literal runs are copied straight from the byte stream.
 */

interface HufEntry {
  code: number;
  len: number;
  value: number;
}

class Bits {
  buf = 0;
  count = 0;
  pos: number;
  private src: Uint8Array;

  constructor(src: Uint8Array, pos: number) {
    this.src = src;
    this.pos = pos;
    this.buf = this.word(pos);
    this.count = 16;
  }

  private word(at: number): number {
    return (this.src[at] ?? 0) | ((this.src[at + 1] ?? 0) << 8);
  }

  peek(mask: number): number {
    return this.buf & mask;
  }

  advance(n: number): void {
    this.buf >>>= n;
    this.count -= n;
    if (this.count < 16) {
      this.pos += 2;
      this.buf = (this.buf | (this.word(this.pos) << this.count)) >>> 0;
      this.count += 16;
    }
  }

  read(mask: number, n: number): number {
    const v = this.peek(mask);
    this.advance(n);
    return v;
  }

  /** Re-syncs the top 16 bits after a literal run moved `pos`. */
  fix(): void {
    this.count -= 16;
    this.buf &= (1 << this.count) - 1;
    this.buf = (this.buf | (this.word(this.pos) << this.count)) >>> 0;
    this.count += 16;
  }

  byte(): number {
    return this.src[this.pos++] ?? 0;
  }
}

function mirror(x: number, n: number): number {
  let top = 1 << (n - 1);
  let bottom = 1;
  while (top > bottom) {
    const mask = top | bottom;
    const masked = x & mask;
    if (masked !== 0 && masked !== mask) x ^= mask;
    top >>>= 1;
    bottom <<= 1;
  }
  return x;
}

function readTable(table: HufEntry[], bits: Bits): void {
  const num = bits.read(0x1f, 5);
  if (!num) return;
  const lens: number[] = [];
  let max = 1;
  for (let i = 0; i < num; i++) {
    lens[i] = bits.read(0x0f, 4);
    max = Math.max(max, lens[i]);
  }
  table.length = 0;
  let code = 0;
  for (let len = 1; len <= max; len++) {
    for (let j = 0; j < num; j++) {
      if (lens[j] !== len) continue;
      table.push({ code: mirror(code, len), len, value: j });
      code++;
    }
    code <<= 1;
  }
}

function hufRead(table: HufEntry[], bits: Bits): number {
  for (const e of table) {
    if (bits.peek((1 << e.len) - 1) !== e.code) continue;
    bits.advance(e.len);
    if (e.value < 2) return e.value;
    const base = 1 << (e.value - 1);
    return base | bits.read(base - 1, e.value - 1);
  }
  throw new Error('RNC: bad Huffman code');
}

export function isRnc(data: Uint8Array): boolean {
  return data.length >= 18 && data[0] === 0x52 && data[1] === 0x4e && data[2] === 0x43;
}

/** Decompresses an RNC-packed buffer. Buffers without the RNC signature are returned unchanged. */
export function unrnc(data: Uint8Array): Uint8Array {
  if (!isRnc(data)) return data;
  if (data[3] !== 1) throw new Error(`RNC: unsupported method ${data[3]}`);
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const outLen = dv.getUint32(4);
  const out = new Uint8Array(outLen);
  const bits = new Bits(data, 18);
  bits.advance(2);
  const raw: HufEntry[] = [];
  const dist: HufEntry[] = [];
  const len: HufEntry[] = [];
  let o = 0;
  while (o < outLen) {
    readTable(raw, bits);
    readTable(dist, bits);
    readTable(len, bits);
    let chunks = bits.read(0xffff, 16);
    for (;;) {
      let n = hufRead(raw, bits);
      if (n) {
        while (n-- && o < outLen) out[o++] = bits.byte();
        bits.fix();
      }
      if (--chunks <= 0) break;
      const back = hufRead(dist, bits) + 1;
      let copy = hufRead(len, bits) + 2;
      if (back > o) throw new Error('RNC: back-reference before start');
      while (copy-- && o < outLen) {
        out[o] = out[o - back];
        o++;
      }
    }
  }
  return out;
}
