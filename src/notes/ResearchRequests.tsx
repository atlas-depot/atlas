import { useEffect, useRef, useState } from "react";
import { GlobeIcon } from "@phosphor-icons/react/dist/csr/Globe";
import { Button } from "@/components/ui/button";
import type { ResearchDisclosureRequest } from "../../shared/research";
import type { ConversationClient } from "./conversation-store";
import { NotesRequestError } from "./notes-store";

function isOpen(request: ResearchDisclosureRequest) {
  return Date.parse(request.expiresAt) > Date.now();
}

function ExactQuery({ text }: { text: string }) {
  // Make formatting controls visible as well as preserving the original query.
  const visible = text.replace(
    /[\p{Cc}\p{Cf}]/gu,
    (char) => `[U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}]`,
  );
  return (
    <>
      <blockquote dir="auto" className="chat-permission-query">
        {text}
      </blockquote>
      {visible !== text && (
        <p className="chat-permission-disclosure">
          With control characters shown: <bdi>{visible}</bdi>
        </p>
      )}
    </>
  );
}

/** Mounted only for a verified account's selected, running turn. */
export function ResearchRequests({
  conversationId,
  client,
  onUnauthenticated,
}: {
  conversationId: string;
  client: ConversationClient;
  onUnauthenticated: () => void;
}) {
  const [requests, setRequests] = useState<ResearchDisclosureRequest[]>([]);
  const [busy, setBusy] = useState(false);
  const [readFailed, setReadFailed] = useState(false);
  const [notice, setNotice] = useState("");
  // Each decision invalidates reads that started before it, including when the write response is lost.
  const generation = useRef(0);
  const mounted = useRef(false);
  const deciding = useRef(false);

  useEffect(() => {
    mounted.current = true;
    let active = true;
    let timer: number;
    async function refresh() {
      const current = generation.current;
      try {
        if (deciding.current) return;
        const next = await client.researchRequests(conversationId);
        if (!active || current !== generation.current) return;
        setRequests(next.filter(isOpen));
        setReadFailed(false);
      } catch (error) {
        if (!active || current !== generation.current) return;
        setRequests([]);
        if (error instanceof NotesRequestError && error.status === 401) onUnauthenticated();
        else setReadFailed(true);
      } finally {
        if (active) timer = window.setTimeout(refresh, 1500);
      }
    }
    void refresh();
    return () => {
      active = false;
      mounted.current = false;
      window.clearTimeout(timer);
    };
  }, [conversationId, client, onUnauthenticated]);

  async function decide(request: ResearchDisclosureRequest, decision: "approve" | "deny") {
    if (deciding.current) return;
    if (!isOpen(request)) {
      setRequests((rows) => rows.filter((row) => row.id !== request.id));
      setNotice("This request is no longer available.");
      return;
    }
    deciding.current = true;
    const current = ++generation.current;
    setBusy(true);
    setNotice("");
    try {
      await client.decideResearch(conversationId, request, decision);
      if (!mounted.current || current !== generation.current) return;
      setRequests((rows) =>
        decision === "deny"
          ? rows.filter((row) => row.id !== request.id)
          : rows.map((row) => (row.id === request.id ? { ...row, status: "approved" } : row)),
      );
      setNotice(decision === "deny" ? "Web search denied." : "Web search allowed.");
    } catch (error) {
      if (!mounted.current || current !== generation.current) return;
      setRequests([]);
      if (error instanceof NotesRequestError && error.status === 401) onUnauthenticated();
      else if (error instanceof NotesRequestError && [404, 409].includes(error.status))
        setNotice("This request is no longer available.");
      else setNotice("Could not confirm your choice. Checking the request again.");
    } finally {
      if (mounted.current && current === generation.current) {
        deciding.current = false;
        setBusy(false);
      }
    }
  }

  return (
    <>
      <p role="status" className={notice || readFailed ? "chat-permission-status" : "sr-only"}>
        {readFailed ? "Could not check web search requests. Retrying..." : notice}
      </p>
      {requests.map((request) => (
        <section aria-label="Web search permission" key={request.id} className="chat-permission">
          <h3>
            <GlobeIcon aria-hidden="true" />
            Allow this web search?
          </h3>
          <ExactQuery text={request.proposedQuery} />
          <p className="chat-permission-disclosure">
            Atlas sends this text to OpenRouter. Its model may rephrase it for web search.
          </p>
          <div className="chat-permission-actions">
            {request.status === "pending" ? (
              <Button
                className="chat-allow"
                disabled={busy}
                onClick={() => void decide(request, "approve")}
              >
                Allow
              </Button>
            ) : (
              <span>Allowed, awaiting search.</span>
            )}
            <Button
              className="chat-deny"
              variant="outline"
              disabled={busy}
              onClick={() => void decide(request, "deny")}
            >
              Deny
            </Button>
          </div>
        </section>
      ))}
    </>
  );
}
