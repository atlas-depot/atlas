import { useEffect, useMemo, useRef, useState } from "react";
import type { SessionUser } from "../../shared/auth";
import { Button } from "@/components/ui/button";
import { NotesWorkspace } from "@/notes/NotesWorkspace";
import type { NotesStore } from "@/notes/notes-store";
import { createNoteSearchClient, type NoteSearchClient } from "@/notes/note-search-store";
import { createSessionClient } from "./session";
import { SignInLink } from "./SignInLink";
import { createOrganizeClient, type OrganizeClient } from "@/notes/organize-store";

const sessionClient = createSessionClient();
const organizeClient = createOrganizeClient();
const noteSearchClient = createNoteSearchClient();

type SessionState =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "ready"; user: SessionUser }
  | { kind: "failed" };

/** Production shell. The demo editor stays independent of browser authentication. */
export function AuthenticatedNotes({ store }: { store: NotesStore }) {
  const [session, setSession] = useState<SessionState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const requestId = useRef(0);
  const verifiedUserId = useRef<string | null>(null);
  const accountId = session.kind === "ready" ? session.user.id : null;
  const [sessionCheck, setSessionCheck] = useState<"checking" | "verified" | "failed">("checking");
  // The ref closes the gap before React renders the disabled controls on focus.
  const guardedStore = useMemo<NotesStore>(() => {
    const requireVerified = () => {
      if (accountId === null || verifiedUserId.current !== accountId)
        throw new Error("Confirm your session before requesting notes.");
    };
    return {
      list: async () => {
        requireVerified();
        return store.list();
      },
      read: async (id) => {
        requireVerified();
        return store.read(id);
      },
      create: async (input, key) => {
        requireVerified();
        return store.create(input, key);
      },
      update: async (id, input, etag) => {
        requireVerified();
        return store.update(id, input, etag);
      },
      delete: async (id, etag) => {
        requireVerified();
        return store.delete(id, etag);
      },
    };
  }, [store, accountId]);

  const organizer = useMemo<OrganizeClient>(() => {
    const verified = () => {
      if (accountId === null || verifiedUserId.current !== accountId)
        throw new Error("Confirm your session before requesting AI drafts.");
    };
    return {
      list: async () => {
        verified();
        return organizeClient.list();
      },
      start: async (...args) => {
        verified();
        return organizeClient.start(...args);
      },
      readRun: async (...args) => {
        verified();
        return organizeClient.readRun(...args);
      },
      cancel: async (...args) => {
        verified();
        return organizeClient.cancel(...args);
      },
      handoff: async (...args) => {
        verified();
        return organizeClient.handoff(...args);
      },
      readDraft: async (...args) => {
        verified();
        return organizeClient.readDraft(...args);
      },
      updateDraft: async (...args) => {
        verified();
        return organizeClient.updateDraft(...args);
      },
      discard: async (...args) => {
        verified();
        return organizeClient.discard(...args);
      },
      save: async (...args) => {
        verified();
        return organizeClient.save(...args);
      },
    };
  }, [accountId]);

  const search = useMemo<NoteSearchClient>(() => {
    const verified = () => {
      if (accountId === null || verifiedUserId.current !== accountId)
        throw new Error("Confirm your session before searching notes.");
    };
    return {
      search: async (query, limit) => {
        verified();
        return noteSearchClient.search(query, limit);
      },
    };
  }, [accountId]);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      const id = ++requestId.current;
      verifiedUserId.current = null;
      setSessionCheck("checking");
      void (async () => {
        try {
          const user = await sessionClient.read();
          if (active && id === requestId.current) {
            verifiedUserId.current = user?.id ?? null;
            setSessionCheck("verified");
            setSession(user ? { kind: "ready", user } : { kind: "signed-out" });
          }
        } catch {
          if (active && id === requestId.current) {
            setSessionCheck("failed");
            setSession((current) =>
              current.kind === "ready" || current.kind === "signed-out"
                ? current
                : { kind: "failed" },
            );
          }
        }
      })();
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      verifiedUserId.current = null;
      window.removeEventListener("focus", refresh);
    };
  }, [attempt]);

  if (session.kind === "loading") {
    return (
      <main className="notes-workspace space-y-5 p-4 sm:p-6">
        <h1 className="text-2xl font-semibold">Atlas notes</h1>
        <p role="status">Checking your session...</p>
      </main>
    );
  }

  if (session.kind === "signed-out") {
    return (
      <main className="notes-workspace space-y-5 p-4 sm:p-6">
        <h1 className="text-2xl font-semibold">Atlas notes</h1>
        <p>Sign in to view and edit your notes.</p>
        <SignInLink>Sign in</SignInLink>
      </main>
    );
  }

  if (session.kind === "failed") {
    return (
      <main className="notes-workspace space-y-5 p-4 sm:p-6">
        <h1 className="text-2xl font-semibold">Atlas notes</h1>
        <p role="alert">Could not check your session. Check your connection and try again.</p>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            onClick={() => {
              setSession({ kind: "loading" });
              setAttempt((value) => value + 1);
            }}
          >
            Retry
          </Button>
          <SignInLink>Sign in</SignInLink>
        </div>
      </main>
    );
  }

  return (
    <div className="notes-workspace">
      <header className="flex flex-wrap items-center justify-between gap-3 p-4 pb-0 sm:p-6 sm:pb-0">
        <p className="min-w-0 break-all text-sm text-muted-foreground">
          Signed in as {session.user.email}
        </p>
        <form method="post" action="/api/auth/logout">
          <Button type="submit" variant="outline">
            Sign out
          </Button>
        </form>
      </header>
      {sessionCheck !== "verified" && (
        <div className="space-y-3 px-4 pt-4 sm:px-6">
          {/* Both live regions stay mounted while paused, so checking-to-failed is announced. */}
          <div>
            <p role="status">
              {sessionCheck === "checking"
                ? "Checking your session. Note requests are paused."
                : null}
            </p>
            <p role="alert">
              {sessionCheck === "failed"
                ? "Could not confirm your session. Your draft is preserved; note requests are paused."
                : null}
            </p>
          </div>
          {sessionCheck === "failed" && (
            <Button onClick={() => setAttempt((value) => value + 1)}>Retry session check</Button>
          )}
        </div>
      )}
      <NotesWorkspace
        key={session.user.id}
        store={guardedStore}
        organizer={organizer}
        search={search}
        requestsEnabled={sessionCheck === "verified"}
      />
    </div>
  );
}
