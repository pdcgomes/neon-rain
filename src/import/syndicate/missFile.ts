/**
 * MISSxx.DAT: plain-text briefing split into blocks by lines holding a single "|". The first two
 * blocks are the prices of the extra intelligence tiers, the third is the free briefing (title,
 * mission type, then text), and every block after that is one purchasable tier.
 */
export interface SyndBriefing {
  title: string;
  kind: string;
  /** Free briefing paragraphs. */
  text: string[];
  /** Purchasable intelligence tiers, each a list of paragraphs (the first is usually a heading). */
  tiers: string[][];
}

const tidy = (s: string) =>
  s
    .toLowerCase()
    .replace(/(^|[.!?]\s+|\n)([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase())
    .replace(/\bi\b/g, 'I');

export function parseBriefing(data: Uint8Array | string): SyndBriefing {
  const text = typeof data === 'string' ? data : new TextDecoder('latin1').decode(data);
  const blocks = text.replace(/\r/g, '').split(/\n\|\n/);
  const paras = (b: string) =>
    b
      .split(/\n\s*\n/)
      .map((p) => p.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .map(tidy);
  const main = paras(blocks[2] ?? '');
  const [title = '', kind = '', ...rest] = main;
  return {
    title: title.replace(/\.$/, ''),
    kind: kind.replace(/\.$/, ''),
    text: rest,
    tiers: blocks.slice(3).map(paras).filter((t) => t.length),
  };
}
