/**
 * Atlas selects each job with a private service principal. The API authenticates question answering with its own
 * service username, so the job is fixed by the server and never by a model, a note or a browser.
 */
export const API_PRINCIPAL = "api";
export const CHAT_PRINCIPAL = "chat";
export const CONTEXT_PRINCIPAL = "context";

type SessionAuth = {
  auth: {
    current: { principalId: string } | null;
    initiator: { principalId: string } | null;
  };
};

/** A session answers questions only when the chat principal both opened and is driving it. */
export function isChatSession(session: SessionAuth): boolean {
  return (
    session.auth.initiator?.principalId === CHAT_PRINCIPAL &&
    session.auth.current?.principalId === CHAT_PRINCIPAL
  );
}

/** Organize keeps its tools unless the chat principal touched the session at all. */
export function isOrganizeSession(session: SessionAuth): boolean {
  return (
    session.auth.initiator?.principalId !== CHAT_PRINCIPAL &&
    session.auth.current?.principalId !== CHAT_PRINCIPAL &&
    session.auth.initiator?.principalId !== CONTEXT_PRINCIPAL &&
    session.auth.current?.principalId !== CONTEXT_PRINCIPAL
  );
}

export function isContextSession(session: SessionAuth): boolean {
  return (
    session.auth.initiator?.principalId === CONTEXT_PRINCIPAL &&
    session.auth.current?.principalId === CONTEXT_PRINCIPAL
  );
}
