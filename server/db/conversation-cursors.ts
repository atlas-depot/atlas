import { z } from "zod";
import { conversationIdSchema } from "../../shared/conversations.ts";

const listCursorSchema = z.strictObject({
  createdAt: z.iso.datetime().refine((value) => !value.startsWith("0000-"), {
    error: "Creation time must use year 0001 or later.",
  }),
  id: conversationIdSchema,
});
export function parseConversationCursor(cursor: string | undefined) {
  if (cursor === undefined) return undefined;
  try {
    if (!/^[A-Za-z0-9_-]{1,512}$/.test(cursor)) throw new Error();
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    return listCursorSchema.parse(parsed);
  } catch {
    throw new Error("Invalid conversation cursor.");
  }
}
export function encodeConversationCursor(value: { createdAt: string; id: string }) {
  return Buffer.from(JSON.stringify({ createdAt: value.createdAt, id: value.id })).toString(
    "base64url",
  );
}
export function parseMessageCursor(cursor: string | undefined) {
  if (cursor === undefined) return 0;
  if (!/^[1-9]\d{0,9}$/.test(cursor) || Number(cursor) > 2_147_483_647) {
    throw new Error("Invalid message cursor.");
  }
  return Number(cursor);
}
