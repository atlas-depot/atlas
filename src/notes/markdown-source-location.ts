type MarkdownRange = { startOffset: number; endOffset: number };

/** Locate a top-level rich block only when serialization proves the source boundaries. */
export function findMarkdownSourceBlock<Block extends { id: string }>(
  source: string,
  blocks: readonly Block[],
  range: MarkdownRange,
  serialize: (prefix: Block[]) => string,
): string | undefined {
  const { startOffset, endOffset } = range;
  if (
    !Number.isInteger(startOffset) ||
    !Number.isInteger(endOffset) ||
    startOffset < 0 ||
    endOffset <= startOffset ||
    endOffset > source.length ||
    blocks.length === 0
  )
    return undefined;

  const prefixes = new Map<number, string>([[0, ""]]);
  const prefix = (count: number) => {
    const cached = prefixes.get(count);
    if (cached !== undefined) return cached;
    const text = serialize(blocks.slice(0, count)).replace(/\n+$/, "");
    prefixes.set(count, text);
    return text;
  };

  try {
    if (prefix(blocks.length) !== source.replace(/\n+$/, "")) return undefined;
    let low = 1;
    let high = blocks.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (prefix(middle).length > startOffset) high = middle;
      else low = middle + 1;
    }

    const before = prefix(low - 1);
    const through = prefix(low);
    if (
      !source.startsWith(before) ||
      !source.startsWith(through) ||
      before.length > startOffset ||
      through.length <= startOffset
    )
      return undefined;

    let blockStart = before.length;
    while (source[blockStart] === "\n") blockStart += 1;
    if (startOffset < blockStart) return undefined;
    return blocks[low - 1].id || undefined;
  } catch {
    return undefined;
  }
}
