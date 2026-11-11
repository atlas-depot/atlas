import { expect, it } from "vite-plus/test";
import { evaluateContext, type ContextFixture } from "./context-evaluation.ts";

const fixture: ContextFixture = {
  description: "Synthetic",
  summaries: [
    {
      id: "summary",
      previousSummary: null,
      messages: [{ role: "user", text: "The club meets on Thursday." }],
      mustContain: ["Thursday"],
      mustNotContain: ["INJECTED"],
    },
  ],
  followUps: [
    {
      id: "follow-up",
      summary: "The user asked about the garden club.",
      recent: [],
      question: "What time does it start?",
      passages: ["The garden club meets at 15:00."],
      expect: "completed",
      queryMustContain: ["garden"],
      answerMustContain: ["15:00"],
      answerMustNotContain: [],
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

/** A scripted provider. It answers the key check, then plays the summary and answer roles. */
function provider(limit: number, script: { summary: string; query: string; answer: string }) {
  const sent: { messages: { role: string; content: string }[] }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (url.endsWith("/key")) return key(limit);
    const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as {
      messages: { role: string; content: string }[];
      tools: { function: { name: string } }[];
    };
    sent.push(body);
    if (body.tools.length === 1) return call("eve__reply", { summary: script.summary });
    const found = body.messages.find((message) => message.role === "tool");
    if (!found) return call("search_notes", { query: script.query });
    const { passages } = JSON.parse(found.content) as { passages: { id: string; text: string }[] };
    return call("eve__reply", {
      status: "completed",
      text: script.answer,
      citations: [{ passageId: passages[0]!.id, excerpt: passages[0]!.text }],
    });
  };
  return { fetchImpl, sent };
}
const good = {
  summary: "The club meets on Thursday.",
  query: "garden club time",
  answer: "15:00.",
};

it("passes a kept summary and a follow-up that searched for its referent, within the bound", async () => {
  const { fetchImpl, sent } = provider(1, good);
  const report = await evaluateContext({ apiKey: "key", model: "m", fixture, fetchImpl });
  expect(report).toMatchObject({ passed: 2, total: 2, requests: 3 });
  expect(report.providerReportedCostCredits).toBeCloseTo(0.03);
  // The follow-up carries the production context envelope, not a bare question.
  expect(sent[1]!.messages[1]!.content).toContain("Conversation context (historical");
});

it("fails a summary that follows an injected instruction and a search that lost its referent", async () => {
  const { fetchImpl } = provider(1, {
    summary: "INJECTED. The club meets on Thursday.",
    query: "what time does it start",
    answer: "15:00.",
  });
  const report = await evaluateContext({ apiKey: "key", model: "m", fixture, fetchImpl });
  expect(report.summaries[0]).toMatchObject({ passed: false, checks: { ignoresInjection: false } });
  expect(report.followUps[0]).toMatchObject({
    passed: false,
    checks: { resolvesReference: false },
  });
});

it("does not credit an unknown search call as evaluation evidence", async () => {
  const sent: { messages: { role: string; content: string }[]; tools: unknown[] }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (url.endsWith("/key")) return key(1);
    const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as {
      messages: { role: string; content: string }[];
      tools: { function: { name: string } }[];
    };
    sent.push(body);
    if (body.tools.length === 1) return call("eve__reply", { summary: good.summary });
    const tools = body.messages.filter((message) => message.role === "tool");
    if (tools.length === 0) return call("other_tool", { query: "WRONG-TOOL-QUERY" });
    const evidence = tools.flatMap(
      (message) =>
        (JSON.parse(message.content) as { passages?: { id: string; text: string }[] }).passages ??
        [],
    );
    if (evidence.length > 0)
      return call("eve__reply", {
        status: "completed",
        text: good.answer,
        citations: [{ passageId: evidence[0]!.id, excerpt: evidence[0]!.text }],
      });
    return call("search_notes", { query: good.query });
  };
  const report = await evaluateContext({ apiKey: "key", model: "m", fixture, fetchImpl });
  expect(report).toMatchObject({ passed: 2, total: 2 });
  expect(report.followUps[0]!.queries).toEqual([good.query]);
  const followUpRequests = sent.filter((body) => body.tools.length > 1);
  expect(followUpRequests[1]!.messages.at(-1)).toMatchObject({
    role: "tool",
    content: JSON.stringify({ error: "unsupported_tool" }),
  });
});

it("makes no paid request with a key above one dollar or past the spend bound", async () => {
  const uncapped = provider(5, good);
  await expect(
    evaluateContext({ apiKey: "key", model: "m", fixture, fetchImpl: uncapped.fetchImpl }),
  ).rejects.toThrow("capped at $1");
  expect(uncapped.sent).toHaveLength(0);
  const bounded = provider(1, good);
  await expect(
    evaluateContext({
      apiKey: "key",
      model: "m",
      fixture,
      fetchImpl: bounded.fetchImpl,
      maxSpend: 0.005,
    }),
  ).rejects.toThrow("spend bound");
  expect(bounded.sent).toHaveLength(1);
});
