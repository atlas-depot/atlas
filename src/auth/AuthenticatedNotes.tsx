import { useEffect, useRef, useState } from "react";
import type { SessionUser } from "../../shared/auth";
import { Button } from "@/components/ui/button";
import { NotesWorkspace } from "@/notes/NotesWorkspace";
import type { NotesStore } from "@/notes/notes-store";
import { createSessionClient } from "./session";

const sessionClient = createSessionClient();

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

  useEffect(() => {
    let active = true;
    void (async () => {
      const id = ++requestId.current;
      try {
        const user = await sessionClient.read();
        if (active && id === requestId.current)
          setSession(user ? { kind: "ready", user } : { kind: "signed-out" });
      } catch {
        if (active && id === requestId.current)
          setSession((current) =>
            current.kind === "ready" || current.kind === "signed-out"
              ? current
              : { kind: "failed" },
          );
      }
    })();
    return () => {
      active = false;
    };
  }, [attempt]);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      void (async () => {
        const id = ++requestId.current;
        try {
          const user = await sessionClient.read();
          if (active && id === requestId.current)
            setSession(user ? { kind: "ready", user } : { kind: "signed-out" });
        } catch {
          if (active && id === requestId.current)
            setSession((current) =>
              current.kind === "ready" || current.kind === "signed-out"
                ? current
                : { kind: "failed" },
            );
        }
      })();
    };
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
    };
  }, []);

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
        <a
          className="inline-flex min-h-11 items-center underline underline-offset-4"
          href="/api/auth/login"
        >
          Sign in
        </a>
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
          <a
            className="inline-flex min-h-11 items-center underline underline-offset-4"
            href="/api/auth/login"
          >
            Sign in
          </a>
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
      <NotesWorkspace key={session.user.id} store={store} />
    </div>
  );
}
