import { z } from "zod";

/** PostgreSQL JSONB and text both reject NUL; malformed UTF-16 must never be repaired silently. */
export const noteTextSchema = z
  .string()
  .refine((value) => !value.includes("\0") && !/\p{Surrogate}/u.test(value), {
    error: "Text must contain valid Unicode and no NUL characters.",
  });

const color = noteTextSchema.max(128);
const alignment = z.enum(["left", "center", "right", "justify"]);
const colors = { backgroundColor: color.default("default"), textColor: color.default("default") };
const paragraphProps = z.strictObject({ ...colors, textAlignment: alignment.default("left") });
const styles = z.strictObject({
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  strike: z.boolean().optional(),
  code: z.boolean().optional(),
  textColor: color.optional(),
  backgroundColor: color.optional(),
});
const text = z.strictObject({ type: z.literal("text"), text: noteTextSchema, styles });
export const noteLinkSchema = noteTextSchema
  .min(1)
  .max(8_192)
  .refine((value) => {
    for (const character of value) {
      const code = character.charCodeAt(0);
      if (code <= 0x20 || code === 0x7f) return false;
    }
    try {
      const url = new URL(value, "https://atlas.invalid/");
      return (
        ["https:", "http:", "mailto:"].includes(url.protocol) && !url.username && !url.password
      );
    } catch {
      return false;
    }
  }, "Use an HTTP, HTTPS, email or relative link.");
const inline = z.union([
  text,
  z.strictObject({ type: z.literal("link"), href: noteLinkSchema, content: z.array(text) }),
]);
const inlineContent = z.array(inline);
const cell = z.strictObject({
  type: z.literal("tableCell"),
  props: z.strictObject({
    ...paragraphProps.shape,
    colspan: z.number().int().min(1).max(50).optional(),
    rowspan: z.number().int().min(1).max(100).optional(),
  }),
  content: inlineContent,
});
const tableContent = z
  .strictObject({
    type: z.literal("tableContent"),
    // JSON encodes undefined array entries as null. Restore the library's public shape on read.
    columnWidths: z
      .array(
        z
          .number()
          .positive()
          .max(10_000)
          .nullish()
          .transform((value) => value ?? undefined),
      )
      .min(1)
      .max(50),
    headerRows: z.number().int().min(0).max(100).optional(),
    headerCols: z.number().int().min(0).max(50).optional(),
    rows: z
      .array(
        z.strictObject({
          cells: z
            .union([z.array(cell), z.array(inlineContent)])
            .refine((value) => value.length <= 50),
        }),
      )
      .min(1)
      .max(100),
  })
  .superRefine((table, ctx) => {
    const columns = table.columnWidths.length;
    const occupied = table.rows.map(() => Array.from({ length: columns }, () => false));
    const invalid = () =>
      ctx.addIssue({
        code: "custom",
        message: "Table cells and spans must fill the declared grid.",
      });
    if ((table.headerRows ?? 0) > table.rows.length || (table.headerCols ?? 0) > columns)
      return invalid();
    for (const [rowIndex, row] of table.rows.entries()) {
      for (const item of row.cells) {
        const column = occupied[rowIndex].indexOf(false);
        const width = Array.isArray(item) ? 1 : (item.props.colspan ?? 1);
        const height = Array.isArray(item) ? 1 : (item.props.rowspan ?? 1);
        if (column < 0 || column + width > columns || rowIndex + height > table.rows.length)
          return invalid();
        for (let y = rowIndex; y < rowIndex + height; y++) {
          for (let x = column; x < column + width; x++) {
            if (occupied[y][x]) return invalid();
            occupied[y][x] = true;
          }
        }
      }
      if (occupied[rowIndex].includes(false)) return invalid();
    }
  });
export const blockIdSchema = noteTextSchema.min(1).max(128);
const bodies = [
  z.strictObject({
    id: blockIdSchema,
    type: z.literal("paragraph"),
    props: paragraphProps,
    content: inlineContent,
  }),
  z.strictObject({
    id: blockIdSchema,
    type: z.literal("heading"),
    props: paragraphProps.extend({
      level: z.union([
        z.literal(1),
        z.literal(2),
        z.literal(3),
        z.literal(4),
        z.literal(5),
        z.literal(6),
      ]),
      isToggleable: z.boolean().optional(),
    }),
    content: inlineContent,
  }),
  z.strictObject({
    id: blockIdSchema,
    type: z.literal("bulletListItem"),
    props: paragraphProps,
    content: inlineContent,
  }),
  z.strictObject({
    id: blockIdSchema,
    type: z.literal("numberedListItem"),
    props: paragraphProps.extend({ start: z.number().int().min(0).max(1_000_000).optional() }),
    content: inlineContent,
  }),
  z.strictObject({
    id: blockIdSchema,
    type: z.literal("checkListItem"),
    props: paragraphProps.extend({ checked: z.boolean() }),
    content: inlineContent,
  }),
  z.strictObject({
    id: blockIdSchema,
    type: z.literal("quote"),
    props: z.strictObject(colors),
    content: inlineContent,
  }),
  z.strictObject({
    id: blockIdSchema,
    type: z.literal("codeBlock"),
    props: z.strictObject({ language: noteTextSchema.max(128) }),
    content: z.array(
      z.strictObject({ type: z.literal("text"), text: noteTextSchema, styles: z.strictObject({}) }),
    ),
  }),
  z.strictObject({
    id: blockIdSchema,
    type: z.literal("divider"),
    props: z.strictObject({}),
    content: z.undefined().optional(),
  }),
  z.strictObject({
    id: blockIdSchema,
    type: z.literal("table"),
    props: z.strictObject({ textColor: color.default("default") }),
    content: tableContent,
  }),
] as const;
const blockBody = z.discriminatedUnion("type", bodies);
export type AtlasBlock = z.infer<typeof blockBody> & { children: AtlasBlock[] };
const block: z.ZodType<AtlasBlock> = z.lazy(() => {
  const children = z.array(block);
  return z.discriminatedUnion("type", [
    bodies[0].extend({ children }),
    bodies[1].extend({ children }),
    bodies[2].extend({ children }),
    bodies[3].extend({ children }),
    bodies[4].extend({ children }),
    bodies[5].extend({ children }),
    bodies[6].extend({ children }),
    bodies[7].extend({ children }),
    bodies[8].extend({ children }),
  ]);
});

/** Reject resource-heavy input before entering the recursive block parser. */
function checkDocumentBounds(value: unknown, ctx: z.RefinementCtx) {
  const pending = [{ value, depth: 0 }];
  let count = 0;
  let textLength = 0;
  while (pending.length > 0) {
    const item = pending.pop();
    if (!item) break;
    if (++count > 50_000 || item.depth > 96) {
      ctx.addIssue({ code: "custom", message: "Document is too large or deeply nested." });
      return;
    }
    if (typeof item.value === "string") textLength += item.value.length;
    if (textLength > 100_000) {
      ctx.addIssue({ code: "custom", message: "Document text exceeds 100,000 characters." });
      return;
    }
    if (typeof item.value === "object" && item.value !== null) {
      for (const child of Object.values(item.value))
        pending.push({ value: child, depth: item.depth + 1 });
    }
  }
  try {
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 900_000)
      ctx.addIssue({ code: "custom", message: "Document exceeds the JSON size limit." });
  } catch {
    ctx.addIssue({ code: "custom", message: "Document must be JSON serializable." });
  }
}
const boundedDocument = z.unknown().superRefine(checkDocumentBounds);

export const blockNoteDocumentSchema = boundedDocument
  .pipe(
    z.strictObject({
      format: z.literal("blocknote"),
      schemaVersion: z.literal(1),
      blocks: z.array(block).min(1).max(1_000),
    }),
  )
  .superRefine((document, ctx) => {
    // Defaults are persisted too; a document accepted for writing must remain valid on read.
    checkDocumentBounds(document, ctx);
    const ids = new Set<string>();
    const pending = document.blocks.map((value) => ({ value, depth: 0 }));
    while (pending.length > 0) {
      const item = pending.pop();
      if (!item) break;
      if (ids.has(item.value.id) || ids.size >= 1_000 || item.depth > 20) {
        ctx.addIssue({
          code: "custom",
          message: "Blocks need unique IDs, at most 1,000 blocks and at most 20 nesting levels.",
        });
        return;
      }
      ids.add(item.value.id);
      pending.push(...item.value.children.map((value) => ({ value, depth: item.depth + 1 })));
    }
  });
export const documentContentSchema = z.union([
  noteTextSchema.max(100_000),
  blockNoteDocumentSchema,
]);
export type BlockNoteDocument = z.infer<typeof blockNoteDocumentSchema>;
export type NoteContent = z.infer<typeof documentContentSchema>;

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, child]) => [key, canonicalValue(child)]),
    );
  }
  return value;
}

/** Sort object keys without changing arrays or primitive types. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

/** Includes the content type: a literal string is never equal to a JSON document. */
export function canonicalNoteContent(content: NoteContent): string {
  return canonicalJson(content);
}

/** A derived model input, never a second authoritative note representation. */
export function organizerContent(content: NoteContent): string {
  return typeof content === "string"
    ? content
    : `BlockNote JSON document:\n${canonicalNoteContent(content)}`;
}
