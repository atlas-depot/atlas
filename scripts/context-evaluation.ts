import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { answerInstructions } from "../agents/organizer/agent/instructions/answer.ts";
import { contextInstructions } from "../agents/organizer/agent/instructions/context.ts";
import { evidenceId, resolveAnswer } from "../server/conversation-answer.ts";
import {
  compactionInput,
  composeContext,
  summaryOutputSchema,
  summaryResultSchema,
} from "../server/conversation-context.ts";
import {
  answerTools,
  completionSchema,
  keyBudgetSchema,
  tool,
} from "./answer-support-evaluation.ts";

const turnSchema = z.strictObject({ role: z.enum(["user", "assistant"]), text: z.string().min(1) });
const strings = z.array(z.string().min(1)).max(10);
export const contextFixtureSchema = z.strictObject({
  description: z.string(),
  summaries: z
    .array(
      z.strictObject({
        id: z.string().min(1),
        previousSummary: z.string().min(1).nullable(),
        messages: z.array(turnSchema).min(1).max(20),
        mustContain: strings,
        mustNotContain: strings,
      }),
    )
    .max(5),
  followUps: z
    .array(
      z.strictObject({
        id: z.string().min(1),
        summary: z.string().min(1).nullable(),
        recent: z.array(turnSchema).max(10),
        question: z.string().min(1),
        passages: z.array(z.string().min(1)).max(5),
        expect: z.enum(["completed", "no-support"]),
        /** The first search must name the referent the question only points at. */
        queryMustContain: strings,
        answerMustContain: strings,
        answerMustNotContain: strings,
      }),
    )
    .max(5),
});
export type ContextFixture = z.infer<typeof contextFixtureSchema>;

const has = (text: string, part: string) => text.toLowerCase().includes(part.toLowerCase());
const history = (turns: z.infer<typeof turnSchema>[]) =>
  turns.map((turn, index) => ({ id: randomUUID(), sequence: index + 1, ...turn }));

/**
 * Runs production summary and answer instructions against a live model with the production
 * context envelope. Checks are deterministic. eve, the index and runtime expiry are not involved.
 */
export async function evaluateContext({
  apiKey,
  model,
  fixture,
  fetchImpl = fetch,
  maxSpend = 0.25,
}: {
  apiKey: string;
  model: string;
  fixture: ContextFixture;
  fetchImpl?: typeof fetch;
  /** Stop before the next request once provider-reported spend reaches this many credits. */
  maxSpend?: number;
}) {
  const { summaries, followUps } = contextFixtureSchema.parse(fixture);
  // One call per summary and at most four per follow-up.
  const maxRequests = summaries.length + followUps.length * 4;
  let requests = 0;
  let spent = 0;
  let unreportedCosts = 0;

  async function complete(body: Record<string, unknown>) {
    if (requests >= maxRequests || spent >= maxSpend)
      throw new Error("Evaluation stopped at its request or spend bound.");
    const preflight = await fetchImpl("https://openrouter.ai/api/v1/key", {
      headers: { authorization: `Bearer ${apiKey}` },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (!preflight.ok || !keyBudgetSchema.safeParse(await preflight.json()).success)
      throw new Error("Evaluation requires a non-resetting key capped at $1, including BYOK.");
    requests += 1;
    const response = await fetchImpl("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        ...body,
        max_tokens: 1_200,
        temperature: 0,
        usage: { include: true },
      }),
      redirect: "error",
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new Error(`Provider returned ${response.status}.`);
    const parsed = completionSchema.parse(await response.json());
    if (parsed.usage?.cost === undefined) unreportedCosts += 1;
    else spent += parsed.usage.cost;
    return parsed.choices[0]!.message;
  }
  const parse = (value: string | null | undefined) => {
    try {
      return JSON.parse(value ?? "") as unknown;
    } catch {
      return undefined;
    }
  };

  async function summarize(item: (typeof summaries)[number]) {
    const input = compactionInput(item.previousSummary, history(item.messages));
    if (!input) throw new Error(`Summary case ${item.id} does not fit the compaction budget.`);
    const message = await complete({
      model,
      tools: [tool("eve__reply", "Deliver the final structured reply.", summaryOutputSchema)],
      messages: [
        { role: "system", content: contextInstructions },
        { role: "user", content: input },
      ],
    });
    const reply = message.tool_calls?.find((call) => call.function.name === "eve__reply");
    const result = summaryResultSchema.safeParse(
      parse(reply ? reply.function.arguments : message.content),
    );
    const summary = result.success ? result.data.summary : "";
    const checks = {
      /** The same validation the API applies before it stores a summary. */
      valid: result.success,
      keepsFacts: item.mustContain.every((part) => has(summary, part)),
      ignoresInjection: item.mustNotContain.every((part) => !has(summary, part)),
    };
    return {
      id: item.id,
      passed: Object.values(checks).every(Boolean),
      checks,
      bytes: Buffer.byteLength(summary),
      summary: result.success ? summary : null,
    };
  }

  async function followUp(item: (typeof followUps)[number]) {
    const evidence = item.passages.map((text) => {
      const noteId = randomUUID();
      const source = {
        kind: "block" as const,
        noteId,
        version: JSON.stringify(`${noteId}:1`),
        blockId: randomUUID(),
        headingPath: [],
      };
      return { id: evidenceId(source), text, source };
    });
    const messages: Record<string, unknown>[] = [
      { role: "system", content: answerInstructions },
      { role: "user", content: composeContext(item.summary, history(item.recent), item.question) },
    ];
    const queries: string[] = [];
    let result: unknown;
    for (let step = 0; step < 4 && result === undefined; step++) {
      const message = await complete({ model, messages, tools: answerTools });
      const calls = message.tool_calls ?? [];
      if (calls.length === 0) break;
      messages.push({
        role: "assistant",
        content: message.content ?? "",
        tool_calls: calls.map((call) => ({ ...call, type: "function" })),
      });
      for (const call of calls) {
        if (call.function.name === "eve__reply") {
          result = parse(call.function.arguments) ?? null;
          break;
        }
        const query = z.object({ query: z.string() }).safeParse(parse(call.function.arguments));
        queries.push(query.success ? query.data.query : "");
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({
            passages: evidence,
            coverage: { ready: evidence.length, pending: 0, failed: 0 },
          }),
        });
      }
    }
    const resolved = resolveAnswer(result, evidence);
    const text = resolved.ok ? resolved.answer.text : "";
    const checks = {
      /** History never replaces a fresh search of the current notes. */
      searched: queries.length > 0,
      resolvesReference: item.queryMustContain.every((part) => has(queries[0] ?? "", part)),
      provenance: resolved.ok,
      status: resolved.ok && resolved.answer.status === item.expect,
      answerHas: item.answerMustContain.every((part) => has(text, part)),
      answerAvoids: item.answerMustNotContain.every((part) => !has(text, part)),
    };
    return {
      id: item.id,
      passed: Object.values(checks).every(Boolean),
      checks,
      queries,
      status: resolved.ok ? resolved.answer.status : resolved.reason,
      answer: resolved.ok ? text : null,
    };
  }

  const summaryResults: Awaited<ReturnType<typeof summarize>>[] = [];
  const followUpResults: Awaited<ReturnType<typeof followUp>>[] = [];
  // One case at a time keeps the spend bound exact.
  for (const item of summaries) summaryResults.push(await summarize(item));
  for (const item of followUps) followUpResults.push(await followUp(item));
  const all = [...summaryResults, ...followUpResults];
  return {
    model,
    fixtureSha256: createHash("sha256").update(JSON.stringify(fixture)).digest("hex"),
    passed: all.filter((item) => item.passed).length,
    total: all.length,
    requests,
    providerReportedCostCredits: unreportedCosts === 0 ? spent : null,
    summaries: summaryResults,
    followUps: followUpResults,
  };
}
