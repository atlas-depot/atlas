import type { LanguageModelMiddleware } from "ai";

export const OUTPUT_TOKEN_RESERVE = 16_384;
const FRAMING_RESERVE = 4_096;

/** Text-only byte ceiling leaves output/framing room, including on multilingual/tool calls. */
export function contextBudget(
  windowTokens: number,
  authorize?: () => Promise<boolean>,
  /** Records why the attempt ends, so the caller sees a reason and not a generic failure. */
  onOverBudget?: () => Promise<unknown>,
): LanguageModelMiddleware {
  return {
    transformParams: async ({ params }) => {
      if (authorize && !(await authorize()))
        throw new Error("Conversation context is no longer authorized.");
      const bytes = Buffer.byteLength(
        JSON.stringify({
          prompt: params.prompt,
          tools: params.tools,
          responseFormat: params.responseFormat,
        }),
        "utf8",
      );
      if (bytes + OUTPUT_TOKEN_RESERVE + FRAMING_RESERVE > windowTokens) {
        await onOverBudget?.();
        throw new Error("Model context budget exceeded.");
      }
      return {
        ...params,
        maxOutputTokens: Math.min(
          params.maxOutputTokens ?? OUTPUT_TOKEN_RESERVE,
          OUTPUT_TOKEN_RESERVE,
        ),
      };
    },
  };
}
