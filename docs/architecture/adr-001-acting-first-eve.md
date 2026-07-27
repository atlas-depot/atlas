# ADR-001: Acting-first product with Eve as agent runtime

Date: 2026-07-27
Status: Accepted
Owners: Efe Baran Durmaz
Related issues: product posture grill (acting-first + Eve)

## Context

Atlas was specified as a permissioned memory system with proposal/approval/audit surfaces and Temporal for durable ingestion and actions. That framing optimized for proof, policy theater, and explicit confirmation UX.

Product direction changed: Atlas is an acting second brain (Notion + Obsidian + proactive cloud agent). Users care that work happened (alarm set, draft ready, follow-up done), not that a receipt, policy hash, or JSONL audit line exists. Coding-agent markets already moved from per-step human approval to auto modes (Claude Code auto, Codex auto-review).

We needed a durable agent runtime that fits TypeScript, Next.js, multi-channel expand, tool-based acting, and Vercel-friendly year-1 hosting, without making cryptographic provenance or approval fatigue the product.

## Decision

1. **Product posture: acting-first (A).** Memory is the substrate; the agent acts on it. Proof/receipt/policy-signing UI is not a product surface.
2. **Eve is the acting brain.** Use [eve](https://eve.dev/) (`vercel/eve`) as the durable agent framework for chat, proactive schedules, tools, and channels.
3. **Architecture shape: A1.5.** Eve owns conversational and proactive acting. Atlas Postgres remains canonical memory. Ingestion/OCR/embed/extract stays a **deterministic Workflow SDK pipeline**, not a free-form agent loop.
4. **Durability: Workflow SDK, not Temporal.** Production year-1 uses Vercel Workflow via Eve. Local/dev and self-host exit use `@workflow/world-postgres`. Temporal is removed as the default.
5. **Monorepo: `apps/agent` (L2).** Eve lives in `apps/agent`. `apps/web` uses `useEveAgent` (and rewrites/proxy for same-origin DX). Hetzner/self-host exit keeps agent separable.
6. **Web: W1.** Web composer is an Eve client, not a separate AI SDK chat stack.
7. **Channels: C1, web-first.** Eve first-class channels for Slack and similar. Chat SDK channel bridge for surfaces Eve does not first-class (for example WhatsApp). Ship web first; expand later.
8. **Approvals: P1 now, P2 later.** Internal safe writes and external drafts auto (`never()`). Real external writes (send email, create calendar event) and destructive actions require short human confirm (`always()`). Optional later: classifier-style auto-review (P2).
9. **Citations: G1.** Soft, tappable source links on answers/actions. No mandatory “ungrounded → I do not know” hard gate. No proof panel.
10. **Memory writes: M1.** Mostly auto-write. Inbox review only for low-confidence or conflicting extracts.
11. **Sharing: R0.** MVP is single-user / single workspace. Shared spaces are post-MVP.
12. **Sandbox: S0.** No Vercel Sandbox / code-mode default in MVP. Typed TypeScript tools call Atlas domain services. Code-mode remains a later opt-in (S1).
13. **Deploy: D3.** Year-1 Vercel-native Eve (credits + Spend Management). Documented exit: Hetzner/VPS + `@workflow/world-postgres` (D2a). Cloudflare Workers are not an Eve host target.

## Alternatives considered

1. Keep Temporal + AI SDK + Chat SDK bot without Eve.
2. Eve as full A2 brain including free-form ingestion agent loops.
3. Day-1 full self-host on Hetzner (D2a/D2b).
4. Hard source-grounding and per-action approval as primary trust UX.
5. Chat SDK as the only omnichannel layer with Eve unused.

## Evidence

- Eve docs: filesystem-first agents, durable sessions on Workflow SDK, tool approvals (`always` / `once` / `never`), schedules, Next.js `withEve` / `useEveAgent`, self-host Nitro Node + `@workflow/world-postgres`.
- [Using Chat SDK and eve together](https://vercel.com/kb/guide/chat-sdk-and-eve): Chat SDK = transport; Eve = durable agent loop; first-class Eve channels preferred; Chat SDK channel for adapters Eve lacks.
- Eve pricing maps to Functions + Workflows + optional Sandbox + models. Sandbox is the main infra spike; S0 removes it. Model tokens dominate cost.
- Vercel for Startups credits (~$200/mo year-1) cover early D3 infra; Spend Management caps spike risk.
- Claude Code auto and Codex auto-review show per-step human approval UX is dead for loved agent products; invisible guardrails remain.
- Hetzner CX33/CX43 (~€8–16/mo EU) is a viable D2a exit for `eve start`, not a CF Workers path.

## Consequences

Positive consequences:

- Product center of gravity matches “agent that acts on memory.”
- One agent runtime across web and future channels.
- One durability substrate (Workflow SDK) instead of Temporal Cloud + separate bot stack.
- Cost controllable year-1 via credits, S0, and spend caps; self-host exit documented.

Negative consequences:

- Eve is beta; APIs may change before GA.
- Docs and skills that assumed Temporal, hard grounding, shared-space MVP, and approval-first UX need revision.
- `apps/bot` as a separate Chat-SDK-only app is largely superseded by Eve channels.

Risks:

- Eve beta churn.
- Vercel Workflow stream/event cost if verbose streaming or aggressive crons.
- Over-autonomy on external writes if P1 tools are misclassified as `never()`.

## Rollback or revision plan

- If Eve beta blocks shipping: keep Atlas domain + Workflow SDK ingestion; replace Eve UI/runtime with AI SDK UI + custom tool loop behind the same tool ports.
- If Vercel cost spikes past Spend Management: move `apps/agent` to Hetzner/VPS with `@workflow/world-postgres` (D2a); keep `apps/web` on Vercel.
- If P1 is too aggressive: tighten external-write tools to `always()` or introduce P2 classifier.
- Sharing (R1/R2) can return post-MVP without changing Eve-as-brain.
