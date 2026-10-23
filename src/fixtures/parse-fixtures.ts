import { z } from "zod";

export type FixtureIssue = {
  path: Array<string | number>;
  message: string;
};

export type FixtureResult =
  | { success: true; data: BriefingExample }
  | { success: false; issues: FixtureIssue[] };

const nonBlankText = z.string().refine((value) => value.trim().length > 0, {
  error: "Expected non-whitespace text.",
});

const sourceOrigin = z.strictObject({
  author: nonBlankText,
  sentAt: z.iso.datetime({ offset: true }).optional(),
});

const userNoteSource = z.strictObject({
  id: nonBlankText,
  kind: z.literal("user_note"),
  content: nonBlankText,
});

const externalMessageSource = z.strictObject({
  id: nonBlankText,
  kind: z.literal("external_message"),
  content: nonBlankText,
  source: sourceOrigin,
});

const briefingItem = z.strictObject({
  text: nonBlankText,
  sourceIds: z.array(nonBlankText).min(1),
});

const briefingExampleSchema = z
  .strictObject({
    sources: z.array(z.discriminatedUnion("kind", [userNoteSource, externalMessageSource])),
    briefing: z.strictObject({
      items: z.array(briefingItem),
    }),
  })
  .superRefine((example, ctx) => {
    const sourceIds = new Set<string>();
    example.sources.forEach((source, index) => {
      if (sourceIds.has(source.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["sources", index, "id"],
          message: `Duplicate source id "${source.id}".`,
        });
      }
      sourceIds.add(source.id);
    });
    example.briefing.items.forEach((item, itemIndex) => {
      item.sourceIds.forEach((sourceId, referenceIndex) => {
        if (!sourceIds.has(sourceId)) {
          ctx.addIssue({
            code: "custom",
            path: ["briefing", "items", itemIndex, "sourceIds", referenceIndex],
            message: `Unknown source id "${sourceId}".`,
          });
        }
      });
    });
  });

export type BriefingExample = z.infer<typeof briefingExampleSchema>;

export function parseFixtures(input: unknown): FixtureResult {
  const result = briefingExampleSchema.safeParse(input);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return {
    success: false,
    issues: result.error.issues.map((issue) => ({
      path: issue.path.map((segment) => (typeof segment === "number" ? segment : String(segment))),
      message: issue.message,
    })),
  };
}
