import { expect, it } from "vite-plus/test";
import { evaluateAnswerSupport, type AnswerSupportFixture } from "./answer-support-evaluation.ts";

const fixture: AnswerSupportFixture = {
  description: "Synthetic",
  cases: [
    {
      id: "meeting",
      kind: "supported",
      question: "When is the meeting?",
      passages: [{ label: "plan", text: "The meeting is at the library at 14:00." }],
      mustCite: ["plan"],
    },
  ],
};
const key = (limit: number) =>
  Response.json({
    data: { limit, limit_remaining: limit, limit_reset: null, include_byok_in_limit: true },
  });
const call = (name: string, input: unknown, cost = 0.01) =>
  Response.json({
    choices: [
      {
        message: {
          content: null,
          tool_calls: [
            { id: `call-${name}`, function: { name, arguments: JSON.stringify(input) } },
          ],
        },
      },
    ],
    usage: { cost },
  });
const grade = (supported: boolean) =>
  call("grade", {
    supported,
    unsupportedClaims: supported ? [] : ["The meeting is at 09:00."],
    acknowledgesConflict: false,
    violatesForbidden: false,
    mentionsRequired: true,
  });

/** A scripted provider: answers the key check, then replays completions in order. */
function provider(limit: number, reply: (passageId: string) => Response[]) {
  const sent: Record<string, unknown>[] = [];
  let script: Response[] | undefined;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (url.endsWith("/key")) return key(limit);
    const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as {
      messages: { role: string; content: string }[];
      tools: { function: { name: string } }[];
    };
    sent.push(body);
    const tool = body.messages.find((message) => message.role === "tool");
    // The first answer call searches. Later calls, and the judge, replay the script.
    if (!tool && body.tools[0]?.function.name !== "grade")
      return call("search_notes", { query: "meeting" });
    if (tool) {
      const { passages } = JSON.parse(tool.content) as { passages: { id: string }[] };
      script ??= reply(passages[0]!.id);
    }
    return script!.shift()!;
  };
  return { sent, fetchImpl };
}
const run = (fetchImpl: typeof fetch, maxSpend?: number) =>
  evaluateAnswerSupport({
    apiKey: "synthetic",
    model: "synthetic/model",
    fixture,
    fetchImpl,
    maxSpend,
  });

it("separates a valid source from a supported claim", async () => {
  const contradicting = provider(1, (id) => [
    call("eve__reply", {
      status: "completed",
      text: "The meeting is at 09:00.",
      citations: [{ passageId: id, excerpt: "at the library at 14:00" }],
    }),
    grade(false),
  ]);
  const report = await run(contradicting.fetchImpl);
  expect(report).toMatchObject({ passed: 0, validSourceButUnsupportedClaim: 1, requests: 3 });
  expect(report.results[0]).toMatchObject({
    checks: { provenance: true, status: true, citesRequired: true, claimsSupported: false },
    unsupportedClaims: ["The meeting is at 09:00."],
  });
  expect(contradicting.sent.at(-1)).not.toHaveProperty("tool_choice");
  expect(report.providerReportedCostCredits).toBeCloseTo(0.03);
});

it("fails an invented source without asking the judge", async () => {
  const invented = provider(1, () => [
    call("eve__reply", {
      status: "completed",
      text: "At 14:00.",
      citations: [{ passageId: "p_0000000000000000", excerpt: "14:00" }],
    }),
  ]);
  const report = await run(invented.fetchImpl);
  expect(report.results[0]).toMatchObject({
    passed: false,
    status: "unknown_source",
    checks: { provenance: false },
  });
  expect(invented.sent).toHaveLength(2);
});

it("spends nothing on a key that is not capped at one dollar and stops at its spend bound", async () => {
  const uncapped = provider(5, () => []);
  await expect(run(uncapped.fetchImpl)).rejects.toThrow("capped at $1");
  expect(uncapped.sent).toHaveLength(0);
  const bounded = provider(1, () => []);
  await expect(run(bounded.fetchImpl, 0.005)).rejects.toThrow("spend bound");
  expect(bounded.sent).toHaveLength(1);
});
