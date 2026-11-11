import { expect, it } from "vite-plus/test";
import { conversationTimestamp } from "./conversation-messages.ts";

it.each([
  ["2026-11-10 12:00:00.123456+00", "2026-11-10T12:00:00.123456Z"],
  ["2026-11-10 15:00:00.123456+03", "2026-11-10T12:00:00.123456Z"],
  ["2026-11-11 01:30:00+05:30", "2026-11-10T20:00:00Z"],
  ["2026-11-10 07:00:00.5-05", "2026-11-10T12:00:00.5Z"],
  ["2026-11-10T12:00:00.123Z", "2026-11-10T12:00:00.123Z"],
])("prints %s as the same instant in UTC with its stored precision", (stored, expected) => {
  expect(conversationTimestamp(stored)).toBe(expected);
});
