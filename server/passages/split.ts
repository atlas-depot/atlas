export const MAX_PASSAGE_CHARS = 4_000;

const graphemeSegmenter = new Intl.Segmenter("en", { granularity: "grapheme" });

export function isMeaningful(text: string): boolean {
  return text.trim().length > 0;
}

function mergeBlankParts(parts: string[]): string[] {
  const merged: string[] = [];
  let pending = "";
  for (const part of parts) {
    if (!isMeaningful(part)) {
      if (
        merged.length > 0 &&
        merged[merged.length - 1].length + part.length <= MAX_PASSAGE_CHARS
      ) {
        merged[merged.length - 1] += part;
      } else {
        pending += part;
      }
      continue;
    }
    const candidate = pending + part;
    merged.push(candidate.length <= MAX_PASSAGE_CHARS ? candidate : part);
    pending = "";
  }
  if (
    pending.length > 0 &&
    merged.length > 0 &&
    merged[merged.length - 1].length + pending.length <= MAX_PASSAGE_CHARS
  ) {
    merged[merged.length - 1] += pending;
  }
  return merged;
}

function safeSliceLength(text: string, limit: number, allowOversized: boolean): number {
  if (text.length <= limit) return text.length;
  const boundaries = graphemeBoundaries(text);
  let end = 0;
  for (const boundary of boundaries) {
    if (boundary > limit) break;
    end = boundary;
  }
  if (end > 0) return end;
  if (!allowOversized) return 0;
  return boundaries.find((boundary) => boundary > 0) ?? text.length;
}

/**
 * Code and tables must keep every character across a split. The 4,000 character limit stays soft
 * for one indivisible grapheme, because cutting it would corrupt Unicode.
 */
function packExactParts(parts: string[]): string[] {
  const packed: string[] = [];
  let current = "";
  for (const part of parts) {
    if (!isMeaningful(part)) {
      let rest = part;
      if (current.length > 0) {
        const room = MAX_PASSAGE_CHARS - current.length;
        if (room > 0) {
          const take = safeSliceLength(rest, room, false);
          current += rest.slice(0, take);
          rest = rest.slice(take);
        }
        if (rest.length > 0) {
          packed.push(current);
          current = "";
        }
      }
      while (rest.length > 0) {
        const take = safeSliceLength(rest, MAX_PASSAGE_CHARS, true);
        packed.push(rest.slice(0, take));
        rest = rest.slice(take);
      }
      continue;
    }
    if (current.length > 0 && current.length + part.length > MAX_PASSAGE_CHARS) {
      packed.push(current);
      current = "";
    }
    if (part.length > MAX_PASSAGE_CHARS) {
      packed.push(part);
    } else {
      current += part;
    }
  }
  if (current.length > 0) packed.push(current);
  return packed;
}

export function graphemeBoundaries(text: string): number[] {
  const boundaries = [0];
  for (const segment of graphemeSegmenter.segment(text)) {
    if (segment.index > 0) boundaries.push(segment.index);
  }
  boundaries.push(text.length);
  return boundaries;
}

function largestBoundaryAtOrBefore(boundaries: number[], limit: number, after: number): number {
  let result = after;
  for (const boundary of boundaries) {
    if (boundary > limit) break;
    if (boundary > after) result = boundary;
  }
  return result;
}

export function splitProse(text: string): string[] {
  if (text.length <= MAX_PASSAGE_CHARS) return [text];
  // One indivisible grapheme may exceed the soft limit; splitting it would corrupt Unicode.
  const boundaries = graphemeBoundaries(text);
  const parts: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = largestBoundaryAtOrBefore(boundaries, start + MAX_PASSAGE_CHARS, start);
    if (end <= start) {
      end = boundaries.find((boundary) => boundary > start) ?? text.length;
    }
    const minimum = start + Math.floor(MAX_PASSAGE_CHARS / 2);
    if (end > minimum) {
      for (let index = end; index > minimum; index--) {
        const character = text[index - 1];
        if (character === "\n" || character === " " || character === "\t") {
          const boundary = largestBoundaryAtOrBefore(boundaries, index, start);
          if (boundary > start) end = boundary;
          break;
        }
      }
    }
    parts.push(text.slice(start, end));
    start = end;
  }
  return mergeBlankParts(parts);
}

function splitGraphemes(text: string, limit: number): string[] {
  const parts: string[] = [];
  let start = 0;
  while (start < text.length) {
    const take = safeSliceLength(text.slice(start), limit, true);
    parts.push(text.slice(start, start + take));
    start += take;
  }
  return parts;
}

export function splitLines(text: string): string[] {
  if (text.length <= MAX_PASSAGE_CHARS) return [text];
  const lines: string[] = [];
  let lineStart = 0;
  for (let index = 0; index < text.length; index++) {
    if (text[index] === "\n") {
      lines.push(text.slice(lineStart, index + 1));
      lineStart = index + 1;
    }
  }
  if (lineStart < text.length) lines.push(text.slice(lineStart));
  const parts: string[] = [];
  let current = "";
  for (const line of lines) {
    if (line.length > MAX_PASSAGE_CHARS) {
      if (current) {
        parts.push(current);
        current = "";
      }
      parts.push(...splitGraphemes(line, MAX_PASSAGE_CHARS));
    } else if (current.length > 0 && current.length + line.length > MAX_PASSAGE_CHARS) {
      parts.push(current);
      current = line;
    } else {
      current += line;
    }
  }
  if (current) parts.push(current);
  return packExactParts(parts);
}
