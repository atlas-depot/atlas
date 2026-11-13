import { evidenceId } from "../../server/conversation-answer.ts";
import type { createConversationResearchStore } from "../../server/db/conversation-research.ts";
import {
  researchToolResultSchema,
  webEvidenceSourceSchema,
  type ResearchToolResult,
} from "../../shared/evidence.ts";
import type { ResearchResult } from "./research.ts";

type ResearchGate = Pick<
  ReturnType<typeof createConversationResearchStore>,
  "prepare" | "claimGeneralized" | "waitForDecision" | "claimApproved" | "finish" | "recordResult"
>;
type Research = (question: string, signal: AbortSignal) => Promise<ResearchResult>;

function notPerformed(reason: "denied" | "expired" | "cancelled" | "stale"): ResearchToolResult {
  return { status: "not_performed", reason };
}

/** Coordinates chat-only disclosure approval before invoking the existing public research path. */
export function createChatResearch({
  gate,
  research,
  now = () => new Date(),
}: {
  gate: ResearchGate;
  research: Research;
  now?: () => Date;
}) {
  return async function runResearch(
    sessionId: string,
    input: { question: string; requiresPrivateDisclosure?: boolean },
    signal: AbortSignal,
  ): Promise<ResearchToolResult> {
    const prepared = await gate.prepare(sessionId, input);
    if (prepared.status === "unavailable" || prepared.status === "limit")
      throw new Error("Research permission could not be verified.");

    let question: string;
    let request: { id: string; queryHash: string } | undefined;
    if (prepared.status === "generalized") {
      const claimed = await gate.claimGeneralized(sessionId, {
        question: input.question,
        outboundQuestion: prepared.outboundQuestion,
        queryHash: prepared.queryHash,
        contextHash: prepared.contextHash,
      });
      if (!claimed) return notPerformed("stale");
      question = prepared.outboundQuestion;
    } else {
      const decision = await gate.waitForDecision(
        sessionId,
        prepared.request.id,
        prepared.request.queryHash,
        signal,
      );
      if (decision !== "approved") return notPerformed(decision === "pending" ? "stale" : decision);
      const claim = await gate.claimApproved(
        sessionId,
        prepared.request.id,
        prepared.request.queryHash,
        prepared.contextHash,
      );
      if (claim !== "claimed") return notPerformed(claim);
      request = { id: prepared.request.id, queryHash: prepared.request.queryHash };
      // Approval is for the exact displayed question. No transcript or note text is appended.
      question = input.question.trim();
    }

    if (signal.aborted) {
      if (request) await gate.finish(sessionId, request.id, request.queryHash, "cancelled");
      throw new DOMException("Research cancelled.", "AbortError");
    }

    try {
      const result = await research(question, signal);
      if (signal.aborted) throw new DOMException("Research cancelled.", "AbortError");
      const retrievedAt = now().toISOString();
      const output = researchToolResultSchema.parse({
        status: "completed",
        question,
        text: result.text,
        sources: result.sources.map(({ url, title }) => {
          const source = webEvidenceSourceSchema.parse({
            kind: "web",
            url,
            // A provider may omit a title; the verified URL is still a usable record.
            title: title.trim() || url,
            retrievedAt,
          });
          return { id: evidenceId(source), source };
        }),
      });
      const recorded = await gate.recordResult(sessionId, output);
      if (recorded.status !== "recorded")
        throw new Error(
          recorded.status === "budget"
            ? "Research results exceeded the conversation evidence limit."
            : "Research results could not be recorded.",
        );
      if (request) await gate.finish(sessionId, request.id, request.queryHash, "completed");
      return output;
    } catch {
      if (request)
        await gate.finish(
          sessionId,
          request.id,
          request.queryHash,
          signal.aborted ? "cancelled" : "failed",
        );
      if (signal.aborted) throw new DOMException("Research cancelled.", "AbortError");
      throw new Error("Public research could not be completed.");
    }
  };
}
