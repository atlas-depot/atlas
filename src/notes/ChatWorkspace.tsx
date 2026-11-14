import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type {
  Conversation,
  ConversationCitation,
  ConversationMessage,
  ConversationRead,
} from "../../shared/conversations";
import type { NoteSummary } from "../../shared/notes";
import {
  describeAssistantMessageState,
  describeConversationRecovery,
  formatConversationLabel,
  type ConversationClient,
} from "./conversation-store";
import { classifyFailure } from "./editor-state";
import {
  createCitationSourceTarget,
  formatHeadingPath,
  formatSourceLocation,
  formatSourceRevision,
  type SourceTarget,
} from "./source-location";

type PendingSwitch = { kind: "open"; id: string } | { kind: "new" };

type OpenFailure = {
  id: string;
  kind: "missing" | "failed";
  message: string;
};

type DeleteFailure = {
  id: string;
  message: string;
};

/** Bounds a single catch-up refresh; further pages stay behind the manual control. */
const MAX_HISTORY_CATCH_UP_PAGES = 20;

/** Refresh by id so a newer answer state can never drop messages from loaded pages. */
function mergeConversationMessages(
  current: ConversationMessage[],
  incoming: ConversationMessage[],
): ConversationMessage[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((left, right) => left.sequence - right.sequence);
}

export function ChatWorkspace({
  client,
  notes,
  enabled,
  canOpenSource,
  activeSourceTarget,
  presentation,
  onPresentationChange,
  onOpenSource,
  onUnauthenticated,
}: {
  client: ConversationClient;
  notes: NoteSummary[];
  enabled: boolean;
  canOpenSource: boolean;
  activeSourceTarget: SourceTarget | null;
  presentation: "sidebar" | "fullscreen";
  onPresentationChange: (mode: "sidebar" | "fullscreen") => void;
  onOpenSource: (target: SourceTarget) => void;
  onUnauthenticated: () => void;
}) {
  const composerId = useId();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [listState, setListState] = useState<"loading" | "ready" | "failed">("loading");
  const [listNextCursor, setListNextCursor] = useState<string | null>(null);
  const [listAttempt, setListAttempt] = useState(0);
  const [loadingMoreConversations, setLoadingMoreConversations] = useState(false);
  const [listPageError, setListPageError] = useState<string | null>(null);

  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [activeRead, setActiveRead] = useState<ConversationRead | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [messagesNextCursor, setMessagesNextCursor] = useState<string | null>(null);
  const [loadingMoreMessages, setLoadingMoreMessages] = useState(false);
  const [openFailure, setOpenFailure] = useState<OpenFailure | null>(null);

  const [creating, setCreating] = useState(false);
  const [sending, setSending] = useState(false);
  const [acting, setActing] = useState(false);
  const [actionFailure, setActionFailure] = useState<string | null>(null);

  const [unsentMessage, setUnsentMessage] = useState("");
  const [pendingSwitch, setPendingSwitch] = useState<PendingSwitch | null>(null);

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteFailure, setDeleteFailure] = useState<DeleteFailure | null>(null);
  const [deleteNotice, setDeleteNotice] = useState<string | null>(null);

  const [cachedNoteTitles, setCachedNoteTitles] = useState<Record<string, string>>({});

  const enabledRef = useRef(enabled);
  const listRequestIdRef = useRef(0);
  const openRequestIdRef = useRef(0);
  const activeConversationIdRef = useRef<string | null>(null);
  const deletedIdsRef = useRef<Set<string>>(new Set());
  const locallyCreatedIdsRef = useRef<Set<string>>(new Set());
  const turnRefreshBusyRef = useRef(false);
  const actionGenerationRef = useRef(0);
  const messagesRef = useRef<ConversationMessage[]>([]);

  /** Keeps the selection ref in step with state so async completions can never act on a stale target. */
  function selectConversation(id: string | null) {
    activeConversationIdRef.current = id;
    setActiveConversationId(id);
  }

  const pendingSendKeyRef = useRef<{
    conversationId: string | null;
    text: string;
    policy: "queue" | "steer";
    key: string;
  } | null>(null);
  const pendingCreateKeyRef = useRef<string | null>(null);

  const composerRef = useRef<HTMLTextAreaElement>(null);
  const discardCancelRef = useRef<HTMLButtonElement>(null);
  const deleteCancelRef = useRef<HTMLButtonElement>(null);
  const newConversationRef = useRef<HTMLButtonElement>(null);

  const hasUnsentInput = unsentMessage.trim().length > 0;

  useEffect(() => {
    enabledRef.current = enabled;
    if (!enabled) {
      listRequestIdRef.current += 1;
      openRequestIdRef.current += 1;
      void Promise.resolve().then(() => {
        setOpeningId(null);
        setCreating(false);
        setSending(false);
        setActing(false);
        setDeletingId(null);
        setLoadingMoreConversations(false);
        setLoadingMoreMessages(false);
      });
    }
  }, [enabled]);

  useEffect(() => {
    return () => {
      listRequestIdRef.current += 1;
      openRequestIdRef.current += 1;
    };
  }, []);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    if (!hasUnsentInput && !sending && !creating) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasUnsentInput, sending, creating]);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const requestId = ++listRequestIdRef.current;
    void (async () => {
      try {
        const result = await client.list({ limit: 50 });
        if (!active || requestId !== listRequestIdRef.current || !enabledRef.current) {
          return;
        }
        const filtered = result.conversations.filter((item) => !deletedIdsRef.current.has(item.id));
        const returnedIds = new Set(filtered.map((item) => item.id));
        for (const createdId of [...locallyCreatedIdsRef.current]) {
          if (returnedIds.has(createdId)) locallyCreatedIdsRef.current.delete(createdId);
        }
        // A conversation created while this request was pending is absent from the
        // response snapshot, so keep it until a later list confirms it exists.
        setConversations((current) => [
          ...current.filter(
            (item) => locallyCreatedIdsRef.current.has(item.id) && !returnedIds.has(item.id),
          ),
          ...filtered,
        ]);
        setListNextCursor(result.nextCursor);
        setListState("ready");
        setListPageError(null);
      } catch (error) {
        if (!active || requestId !== listRequestIdRef.current) {
          return;
        }
        if (classifyFailure(error) === "unauthenticated") {
          onUnauthenticated();
          return;
        }
        setListState("failed");
      }
    })();
    return () => {
      active = false;
    };
  }, [client, enabled, listAttempt, onUnauthenticated]);

  /**
   * Pages forward from the newest loaded message until the store reports no further
   * page, so an answer published after the first page is never missed. The endpoint
   * continues from a sequence cursor, so the tail sequence anchors the next request.
   */
  const fetchLatestHistory = useCallback(
    async (id: string) => {
      const current = messagesRef.current;
      const tail = current.at(-1)?.sequence;
      let cursor: string | undefined = tail === undefined ? undefined : String(tail);
      let merged = current;
      for (let page = 0; page < MAX_HISTORY_CATCH_UP_PAGES; page += 1) {
        const result = await client.messages(id, { limit: 50, cursor });
        merged = mergeConversationMessages(merged, result.messages);
        if (result.nextCursor === null) {
          return { messages: merged, nextCursor: null };
        }
        cursor = result.nextCursor;
      }
      return { messages: merged, nextCursor: cursor ?? null };
    },
    [client],
  );

  const refreshActiveConversation = useCallback(
    async (id: string) => {
      const requestId = openRequestIdRef.current;
      const actionGeneration = actionGenerationRef.current;
      const stillCurrent = () =>
        requestId === openRequestIdRef.current &&
        actionGeneration === actionGenerationRef.current &&
        enabledRef.current &&
        !deletedIdsRef.current.has(id);
      try {
        const readResult = await client.read(id);
        if (!stillCurrent()) return;
        setActiveRead(readResult);
        setConversations((current) =>
          current.map((item) => (item.id === id ? readResult.conversation : item)),
        );
        if (readResult.activeTurn !== null) return;
        // The turn is terminal, so the published answer is only in the newest page.
        // Read first here so the history cannot observe an older state than the turn.
        const historyResult = await fetchLatestHistory(id);
        if (!stillCurrent()) return;
        setMessages((current) => mergeConversationMessages(current, historyResult.messages));
        setMessagesNextCursor(historyResult.nextCursor);
      } catch (error) {
        if (requestId !== openRequestIdRef.current) return;
        const kind = classifyFailure(error);
        if (kind === "unauthenticated") {
          onUnauthenticated();
          return;
        }
        if (kind === "missing") {
          // Stop refreshing a conversation that no longer exists.
          deletedIdsRef.current.add(id);
          setConversations((current) => current.filter((item) => item.id !== id));
          if (activeConversationIdRef.current === id) {
            openRequestIdRef.current += 1;
            selectConversation(null);
            setActiveRead(null);
            setMessages([]);
            setMessagesNextCursor(null);
            setOpenFailure({
              id,
              kind: "missing",
              message: "This conversation is no longer available.",
            });
          }
        }
      }
    },
    [client, fetchLatestHistory, onUnauthenticated],
  );

  const activeTurnRunning = activeRead !== null && activeRead.activeTurn !== null;

  // A running answer only becomes visible through a new read, so keep the active
  // conversation in sync until the server reports a terminal turn.
  useEffect(() => {
    if (!enabled || activeConversationId === null || !activeTurnRunning) return;
    const id = activeConversationId;
    const timer = window.setInterval(() => {
      if (turnRefreshBusyRef.current) return;
      turnRefreshBusyRef.current = true;
      void refreshActiveConversation(id).finally(() => {
        turnRefreshBusyRef.current = false;
      });
    }, 1_500);
    return () => window.clearInterval(timer);
  }, [enabled, activeConversationId, activeTurnRunning, refreshActiveConversation]);

  function snapshotNoteTitles() {
    setCachedNoteTitles((current) => {
      const next = { ...current };
      for (const note of notes) {
        next[note.id] = note.title.trim() || "Untitled note";
      }
      return next;
    });
  }

  function resolveNoteTitle(noteId: string): string {
    const found = notes.find((item) => item.id === noteId);
    if (found) {
      return found.title.trim() || "Untitled note";
    }
    return cachedNoteTitles[noteId] ?? "Saved note";
  }

  function retryLoadingConversations() {
    if (!enabled) return;
    setListState("loading");
    setListPageError(null);
    setListAttempt((value) => value + 1);
  }

  async function loadOlderConversations() {
    if (!enabledRef.current || !listNextCursor || loadingMoreConversations) return;
    const cursor = listNextCursor;
    const requestId = listRequestIdRef.current;
    setLoadingMoreConversations(true);
    setListPageError(null);
    try {
      const result = await client.list({ limit: 50, cursor });
      if (requestId !== listRequestIdRef.current || !enabledRef.current) return;
      setConversations((current) => {
        const seen = new Set(current.map((item) => item.id));
        const appended = result.conversations.filter(
          (item) => !seen.has(item.id) && !deletedIdsRef.current.has(item.id),
        );
        return [...current, ...appended];
      });
      setListNextCursor(result.nextCursor);
    } catch (error) {
      if (requestId !== listRequestIdRef.current) return;
      if (classifyFailure(error) === "unauthenticated") {
        onUnauthenticated();
        return;
      }
      setListPageError("Could not load older conversations. Try again.");
    } finally {
      if (requestId === listRequestIdRef.current) {
        setLoadingMoreConversations(false);
      }
    }
  }

  async function openConversation(id: string) {
    if (!enabledRef.current || deletedIdsRef.current.has(id)) return;
    const requestId = ++openRequestIdRef.current;
    snapshotNoteTitles();
    setDeleteNotice(null);
    setOpenFailure(null);
    setActionFailure(null);
    // Clear previous conversation state immediately so another conversation's cached
    // messages are never displayed while loading or after a missing/failed read.
    selectConversation(id);
    setOpeningId(id);
    setActiveRead(null);
    setMessages([]);
    setMessagesNextCursor(null);
    setLoadingMoreMessages(false);

    try {
      const [readResult, historyResult] = await Promise.all([
        client.read(id),
        client.messages(id, { limit: 50 }),
      ]);
      if (
        requestId !== openRequestIdRef.current ||
        !enabledRef.current ||
        deletedIdsRef.current.has(id)
      ) {
        return;
      }
      setConversations((current) => {
        const exists = current.some((item) => item.id === id);
        if (!exists) {
          return [readResult.conversation, ...current];
        }
        return current.map((item) => (item.id === id ? readResult.conversation : item));
      });
      setActiveRead(readResult);
      setMessages(historyResult.messages);
      setMessagesNextCursor(historyResult.nextCursor);
      setOpenFailure(null);
    } catch (error) {
      if (
        requestId !== openRequestIdRef.current ||
        !enabledRef.current ||
        deletedIdsRef.current.has(id)
      ) {
        return;
      }
      const kind = classifyFailure(error);
      if (kind === "unauthenticated") {
        onUnauthenticated();
        return;
      }
      if (kind === "missing") {
        setConversations((current) => current.filter((item) => item.id !== id));
        selectConversation(null);
        setActiveRead(null);
        setMessages([]);
        setMessagesNextCursor(null);
        setOpenFailure({
          id,
          kind: "missing",
          message: "This conversation is no longer available.",
        });
        return;
      }
      setActiveRead(null);
      setMessages([]);
      setMessagesNextCursor(null);
      setOpenFailure({
        id,
        kind: "failed",
        message: "Could not open this conversation. Check your connection and try again.",
      });
    } finally {
      if (requestId === openRequestIdRef.current) {
        setOpeningId(null);
      }
    }
  }

  async function loadMoreMessages() {
    if (
      !enabledRef.current ||
      !activeConversationId ||
      !messagesNextCursor ||
      loadingMoreMessages
    ) {
      return;
    }
    const targetId = activeConversationId;
    const cursor = messagesNextCursor;
    const requestId = openRequestIdRef.current;
    setLoadingMoreMessages(true);
    setActionFailure(null);
    try {
      const result = await client.messages(targetId, { limit: 50, cursor });
      if (
        requestId !== openRequestIdRef.current ||
        !enabledRef.current ||
        deletedIdsRef.current.has(targetId)
      ) {
        return;
      }
      setMessages((current) => mergeConversationMessages(current, result.messages));
      setMessagesNextCursor(result.nextCursor);
    } catch (error) {
      if (requestId !== openRequestIdRef.current) return;
      if (classifyFailure(error) === "unauthenticated") {
        onUnauthenticated();
        return;
      }
      setActionFailure("Could not load additional messages. Try again.");
    } finally {
      if (requestId === openRequestIdRef.current) {
        setLoadingMoreMessages(false);
      }
    }
  }

  async function createNewConversation() {
    if (!enabledRef.current || creating || deletingId !== null) return;
    const requestId = ++openRequestIdRef.current;
    setCreating(true);
    setDeleteNotice(null);
    setOpenFailure(null);
    setActionFailure(null);
    const key = pendingCreateKeyRef.current ?? crypto.randomUUID();
    pendingCreateKeyRef.current = key;

    try {
      const created = await client.create(key);
      if (requestId !== openRequestIdRef.current || !enabledRef.current) {
        return;
      }
      pendingCreateKeyRef.current = null;
      locallyCreatedIdsRef.current.add(created.id);
      setConversations((current) => [created, ...current.filter((item) => item.id !== created.id)]);
      setListState("ready");
      selectConversation(created.id);
      setActiveRead({
        conversation: created,
        activeTurn: null,
        recovery: null,
      });
      setMessages([]);
      setMessagesNextCursor(null);
      setLoadingMoreMessages(false);
      requestAnimationFrame(() => composerRef.current?.focus());
    } catch (error) {
      if (requestId !== openRequestIdRef.current) return;
      const kind = classifyFailure(error);
      if (kind === "unauthenticated") {
        onUnauthenticated();
        return;
      }
      if (kind === "conflict") {
        pendingCreateKeyRef.current = null;
      }
      setActionFailure("Could not start a new conversation. Try again.");
    } finally {
      if (requestId === openRequestIdRef.current) {
        setCreating(false);
      }
    }
  }

  function executeSwitch(target: PendingSwitch) {
    setPendingSwitch(null);
    setUnsentMessage("");
    pendingSendKeyRef.current = null;
    if (target.kind === "open") {
      void openConversation(target.id);
    } else {
      void createNewConversation();
    }
  }

  function requestConversationSwitch(target: PendingSwitch) {
    if (!enabled || sending || creating || deletingId !== null) return;
    if (
      target.kind === "open" &&
      target.id === activeConversationId &&
      activeRead !== null &&
      openFailure === null
    ) {
      return;
    }
    if (hasUnsentInput) {
      setPendingSwitch(target);
      return;
    }
    executeSwitch(target);
  }

  async function submitMessage(policy: "queue" | "steer" = "queue") {
    const trimmed = unsentMessage.trim();
    if (!enabledRef.current || trimmed.length === 0 || sending || creating || deletingId !== null) {
      return;
    }
    snapshotNoteTitles();
    actionGenerationRef.current += 1;
    setSending(true);
    setActionFailure(null);
    setDeleteNotice(null);

    let targetId = activeConversationId;
    const watchId = openRequestIdRef.current;

    try {
      if (!targetId) {
        const createKey = pendingCreateKeyRef.current ?? crypto.randomUUID();
        pendingCreateKeyRef.current = createKey;
        const created = await client.create(createKey);
        if (watchId !== openRequestIdRef.current || !enabledRef.current) {
          return;
        }
        pendingCreateKeyRef.current = null;
        locallyCreatedIdsRef.current.add(created.id);
        targetId = created.id;
        setConversations((current) => [
          created,
          ...current.filter((item) => item.id !== created.id),
        ]);
        setListState("ready");
        selectConversation(created.id);
        setActiveRead({
          conversation: created,
          activeTurn: null,
          recovery: null,
        });
      }

      if (deletedIdsRef.current.has(targetId)) {
        return;
      }

      const existingSend = pendingSendKeyRef.current;
      const sendKey =
        existingSend &&
        existingSend.conversationId === targetId &&
        existingSend.text === unsentMessage &&
        existingSend.policy === policy
          ? existingSend.key
          : crypto.randomUUID();
      pendingSendKeyRef.current = {
        conversationId: targetId,
        text: unsentMessage,
        policy,
        key: sendKey,
      };

      const sent = await client.send(targetId, { text: unsentMessage, policy }, sendKey);
      // A newer retry can adopt the retained key while this request is in flight;
      // only the operation that still owns it may clear it.
      if (pendingSendKeyRef.current?.key === sendKey) {
        pendingSendKeyRef.current = null;
      }

      if (
        watchId !== openRequestIdRef.current ||
        !enabledRef.current ||
        deletedIdsRef.current.has(targetId)
      ) {
        return;
      }

      setUnsentMessage("");
      setActiveRead({
        conversation: sent.conversation,
        activeTurn: sent.activeTurn,
        recovery: sent.recovery,
      });
      setConversations((current) =>
        current.map((item) => (item.id === sent.conversation.id ? sent.conversation : item)),
      );
      setMessages((current) => {
        const hasMessage = current.some((item) => item.id === sent.message.id);
        return hasMessage ? current : [...current, sent.message];
      });

      const historyResult = await fetchLatestHistory(targetId);
      if (
        watchId !== openRequestIdRef.current ||
        !enabledRef.current ||
        deletedIdsRef.current.has(targetId)
      ) {
        return;
      }
      // The store pages forward from the oldest message, so catching up to the newest
      // page keeps the accepted message and any later answer in view.
      setMessages((current) => mergeConversationMessages(current, historyResult.messages));
      setMessagesNextCursor(historyResult.nextCursor);
    } catch (error) {
      if (watchId !== openRequestIdRef.current) return;
      const kind = classifyFailure(error);
      if (kind === "unauthenticated") {
        onUnauthenticated();
        return;
      }
      if (kind === "conflict") {
        pendingSendKeyRef.current = null;
      }
      setActionFailure(
        "Could not send your message. Your unsent message is preserved so you can retry.",
      );
    } finally {
      if (watchId === openRequestIdRef.current) {
        setSending(false);
      }
    }
  }

  function handleFormSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitMessage("queue");
  }

  async function handleStopOrResume(action: "stop" | "resume") {
    if (!enabledRef.current || !activeConversationId || acting || deletingId !== null) return;
    const targetId = activeConversationId;
    const watchId = openRequestIdRef.current;
    actionGenerationRef.current += 1;
    setActing(true);
    setActionFailure(null);

    try {
      const updated =
        action === "stop" ? await client.stop(targetId) : await client.resume(targetId);
      if (
        watchId !== openRequestIdRef.current ||
        !enabledRef.current ||
        deletedIdsRef.current.has(targetId)
      ) {
        return;
      }
      setActiveRead(updated);
      setConversations((current) =>
        current.map((item) => (item.id === updated.conversation.id ? updated.conversation : item)),
      );
      const historyResult = await fetchLatestHistory(targetId);
      if (
        watchId !== openRequestIdRef.current ||
        !enabledRef.current ||
        deletedIdsRef.current.has(targetId)
      ) {
        return;
      }
      setMessages((current) => mergeConversationMessages(current, historyResult.messages));
      setMessagesNextCursor(historyResult.nextCursor);
    } catch (error) {
      if (watchId !== openRequestIdRef.current) return;
      if (classifyFailure(error) === "unauthenticated") {
        onUnauthenticated();
        return;
      }
      setActionFailure(
        action === "stop"
          ? "Could not stop the active answer. Try again."
          : "Could not resume the paused queue. Try again.",
      );
    } finally {
      if (watchId === openRequestIdRef.current) {
        setActing(false);
      }
    }
  }

  async function performDelete(id: string) {
    if (!enabledRef.current || deletingId !== null) return;
    setConfirmDeleteId(null);
    setDeletingId(id);
    setDeleteFailure(null);
    setDeleteNotice(null);

    try {
      await client.delete(id);
    } catch (error) {
      if (!enabledRef.current) return;
      const kind = classifyFailure(error);
      if (kind === "unauthenticated") {
        setDeletingId(null);
        onUnauthenticated();
        return;
      }
      if (kind !== "missing") {
        setDeletingId(null);
        setDeleteFailure({
          id,
          message: "Could not delete conversation. The conversation was retained so you can retry.",
        });
        return;
      }
    }

    if (!enabledRef.current) return;
    deletedIdsRef.current.add(id);
    locallyCreatedIdsRef.current.delete(id);
    setDeletingId(null);
    setDeleteFailure(null);
    setConversations((current) => current.filter((item) => item.id !== id));
    setOpenFailure((current) => (current?.id === id ? null : current));

    if (activeConversationIdRef.current === id) {
      openRequestIdRef.current += 1;
      setOpeningId(null);
      selectConversation(null);
      setActiveRead(null);
      setMessages([]);
      setMessagesNextCursor(null);
      setLoadingMoreMessages(false);
      setUnsentMessage("");
      pendingSendKeyRef.current = null;
      setActionFailure(null);
    }
    setDeleteNotice("Conversation deleted.");
    requestAnimationFrame(() => newConversationRef.current?.focus());
  }

  const addressedInputIds = useMemo(() => {
    const ids = new Set<string>();
    for (const message of messages) {
      if (message.role === "assistant") {
        for (const inputId of message.inputIds) {
          ids.add(inputId);
        }
      }
    }
    return ids;
  }, [messages]);

  const runningInputIds = useMemo(
    () => new Set(activeRead?.activeTurn?.inputIds ?? []),
    [activeRead],
  );

  const confirmDeleteConversation = useMemo(
    () => conversations.find((item) => item.id === confirmDeleteId) ?? null,
    [conversations, confirmDeleteId],
  );

  const recoveryDescription = useMemo(
    () => describeConversationRecovery(activeRead?.recovery ?? null),
    [activeRead],
  );

  const controlsBusy =
    !enabled || openingId !== null || creating || sending || acting || deletingId !== null;

  function renderCitation(citation: ConversationCitation, index: number) {
    const { source } = citation;
    const locationLabel = formatSourceLocation(source);
    const revisionLabel = formatSourceRevision(source.version);
    const headingPath = formatHeadingPath(source.headingPath);
    const noteTitle = citation.deleted ? "Deleted note source" : resolveNoteTitle(source.noteId);
    const isActive =
      activeSourceTarget?.source.noteId === source.noteId &&
      activeSourceTarget?.source.version === source.version &&
      formatSourceLocation(activeSourceTarget.source) === locationLabel;
    const citationKey =
      source.kind === "block"
        ? `${source.noteId}:${source.version}:${source.blockId}:${index}`
        : `${source.noteId}:${source.version}:${source.startOffset}-${source.endOffset}:${index}`;

    return (
      <li key={citationKey} className="chat-citation-item">
        <div
          className={isActive ? "chat-citation-card is-active" : "chat-citation-card"}
          data-citation-deleted={citation.deleted ? "true" : "false"}
          data-citation-stale={citation.stale ? "true" : "false"}
        >
          <div className="chat-citation-header">
            <div className="chat-citation-meta">
              <strong>{noteTitle}</strong>
              <span>
                {headingPath ? `${headingPath} - ` : ""}
                {locationLabel} - {revisionLabel}
              </span>
              {citation.deleted ? (
                <span className="chat-citation-badge">Deleted source</span>
              ) : citation.stale ? (
                <span className="chat-citation-badge">Source note changed</span>
              ) : null}
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={!enabled || !canOpenSource}
              aria-current={isActive ? "location" : undefined}
              onClick={() => {
                if (!citation.deleted) {
                  setCachedNoteTitles((current) => ({
                    ...current,
                    [source.noteId]: noteTitle,
                  }));
                }
                onOpenSource(createCitationSourceTarget(citation));
              }}
            >
              Open source
            </Button>
          </div>
          {citation.deleted ? (
            <p className="chat-citation-deleted-note">
              Source note was deleted; stored excerpt was removed.
            </p>
          ) : citation.excerpt ? (
            <blockquote className="note-search-excerpt">{citation.excerpt}</blockquote>
          ) : null}
        </div>
      </li>
    );
  }

  return (
    <section
      aria-label="Chat workspace"
      className="chat-workspace"
      data-chat-presentation={presentation}
    >
      <div className="chat-workspace-header">
        <h2>Saved conversations</h2>
        <div className="chat-workspace-actions">
          <Button
            ref={newConversationRef}
            type="button"
            variant="outline"
            disabled={controlsBusy}
            onClick={() => requestConversationSwitch({ kind: "new" })}
          >
            New conversation
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() =>
              onPresentationChange(presentation === "sidebar" ? "fullscreen" : "sidebar")
            }
          >
            {presentation === "sidebar" ? "Full screen chat" : "Sidebar chat"}
          </Button>
        </div>
      </div>

      <div aria-live="polite" className="chat-workspace-status">
        {deleteNotice ? (
          <p role="note" className="chat-status-notice">
            {deleteNotice}
          </p>
        ) : null}
        {deleteFailure ? (
          <div className="note-search-feedback">
            <p role="alert" className="note-search-error">
              {deleteFailure.message}
            </p>
            <Button
              type="button"
              variant="outline"
              disabled={controlsBusy}
              onClick={() => void performDelete(deleteFailure.id)}
            >
              Retry delete
            </Button>
          </div>
        ) : null}
      </div>

      <div className="chat-workspace-body">
        <div className="chat-history-column" aria-live="polite">
          {listState === "loading" ? (
            <p role="note" className="chat-list-status">
              Loading saved conversations...
            </p>
          ) : listState === "failed" ? (
            <div className="note-search-feedback">
              <p role="alert" className="note-search-error">
                Could not load saved conversations. Check your connection and try again.
              </p>
              <Button
                type="button"
                variant="outline"
                disabled={!enabled}
                onClick={retryLoadingConversations}
              >
                Retry loading conversations
              </Button>
            </div>
          ) : conversations.length === 0 ? (
            <p role="note" className="chat-list-empty">
              No saved conversations yet. Start a new conversation to ask about your notes.
            </p>
          ) : (
            <nav aria-label="Saved conversations" className="chat-conversation-nav">
              <ul className="chat-conversation-list">
                {conversations.map((item) => {
                  const label = formatConversationLabel(item);
                  const isSelected = activeConversationId === item.id;
                  return (
                    <li key={item.id} className="chat-conversation-item">
                      <Button
                        type="button"
                        variant={isSelected ? "secondary" : "ghost"}
                        aria-current={isSelected ? "true" : undefined}
                        disabled={controlsBusy}
                        className="chat-conversation-select"
                        onClick={() => requestConversationSwitch({ kind: "open", id: item.id })}
                      >
                        <span className="chat-conversation-label">{label}</span>
                        {item.queuePaused ? (
                          <span className="chat-conversation-badge">Paused</span>
                        ) : null}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={controlsBusy}
                        aria-label={`Delete ${label}`}
                        className="chat-conversation-delete text-destructive"
                        onClick={() => setConfirmDeleteId(item.id)}
                      >
                        Delete
                      </Button>
                    </li>
                  );
                })}
              </ul>
              {listPageError ? (
                <p role="alert" className="note-search-error">
                  {listPageError}
                </p>
              ) : null}
              {listNextCursor ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={!enabled || loadingMoreConversations}
                  onClick={() => void loadOlderConversations()}
                >
                  {loadingMoreConversations
                    ? "Loading older conversations..."
                    : "Load older conversations"}
                </Button>
              ) : null}
            </nav>
          )}
        </div>

        <div className="chat-thread-column" aria-live="polite">
          {openingId ? (
            <p role="note" className="chat-thread-status">
              Opening conversation...
            </p>
          ) : null}

          {openFailure ? (
            <div className="note-search-feedback">
              <p role="alert" className="note-search-error">
                {openFailure.message}
              </p>
              {openFailure.kind === "failed" ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={controlsBusy}
                  onClick={() => void openConversation(openFailure.id)}
                >
                  Retry opening conversation
                </Button>
              ) : null}
            </div>
          ) : null}

          {activeRead ? (
            <Card size="sm" className="chat-active-card">
              <CardHeader>
                <CardTitle>{formatConversationLabel(activeRead.conversation)}</CardTitle>
                <CardDescription>
                  {activeRead.activeTurn
                    ? "Answer in progress"
                    : activeRead.conversation.queuePaused
                      ? "Queue paused"
                      : "Saved conversation history"}
                </CardDescription>
                <CardAction>
                  <Button
                    type="button"
                    variant="ghost"
                    className="text-destructive"
                    disabled={controlsBusy}
                    onClick={() => setConfirmDeleteId(activeRead.conversation.id)}
                  >
                    Delete conversation
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent className="chat-active-body">
                {activeRead.conversation.queuePaused || recoveryDescription ? (
                  <div role="note" className="chat-queue-banner">
                    <p>
                      {recoveryDescription ??
                        "Queue is paused. Pending messages wait until you explicitly resume."}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={controlsBusy}
                      onClick={() => void handleStopOrResume("resume")}
                    >
                      Resume queue
                    </Button>
                  </div>
                ) : null}

                {activeRead.activeTurn ? (
                  <div role="note" className="chat-running-banner">
                    <div className="chat-running-details">
                      <strong>Answer in progress</strong>
                      {activeRead.activeTurn.text ? (
                        <p className="chat-running-checkpoint">{activeRead.activeTurn.text}</p>
                      ) : (
                        <p>Searching notes and preparing a grounded answer...</p>
                      )}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={controlsBusy}
                      onClick={() => void handleStopOrResume("stop")}
                    >
                      Stop answer
                    </Button>
                  </div>
                ) : null}

                {messages.length === 0 ? (
                  <p className="chat-empty-messages">
                    No messages in this conversation yet. Send a question below.
                  </p>
                ) : (
                  <ol aria-label="Conversation messages" className="chat-message-list">
                    {messages.map((message) => {
                      if (message.role === "user") {
                        const isAddressed = addressedInputIds.has(message.id);
                        const isRunning = runningInputIds.has(message.id);
                        const userStatus = isRunning
                          ? "Running"
                          : isAddressed
                            ? "Answered"
                            : activeRead.conversation.queuePaused
                              ? "Queued (paused)"
                              : "Queued";
                        return (
                          <li
                            key={message.id}
                            className="chat-message-item is-user"
                            data-message-role="user"
                            data-message-status={userStatus}
                          >
                            <div className="chat-message-meta">
                              <strong>You</strong>
                              <span className="chat-message-badge">{userStatus}</span>
                              {message.deliveryPolicy === "steer" ? (
                                <span className="chat-message-badge">Steer</span>
                              ) : null}
                            </div>
                            <p className="chat-message-text">{message.text}</p>
                          </li>
                        );
                      }

                      const presentationState = describeAssistantMessageState(message);
                      return (
                        <li
                          key={message.id}
                          className="chat-message-item is-assistant"
                          data-message-role="assistant"
                          data-answer-status={message.status}
                        >
                          <div className="chat-message-meta">
                            <strong>Atlas</strong>
                            <span className="chat-message-badge">{presentationState.badge}</span>
                            {message.inputIds.length > 1 ? (
                              <span className="chat-message-badge">
                                Addresses {message.inputIds.length} messages
                              </span>
                            ) : null}
                          </div>

                          {presentationState.warning ? (
                            <p role="note" className="chat-incomplete-warning">
                              {presentationState.warning}
                            </p>
                          ) : null}

                          {message.text.trim().length > 0 ? (
                            <p className="chat-message-text">{message.text}</p>
                          ) : presentationState.emptyFallback ? (
                            <p className="chat-message-empty">{presentationState.emptyFallback}</p>
                          ) : null}

                          {message.citations.length > 0 ? (
                            <ul aria-label="Answer citations" className="chat-citation-list">
                              {message.citations.map((citation, index) =>
                                renderCitation(citation, index),
                              )}
                            </ul>
                          ) : null}
                        </li>
                      );
                    })}
                  </ol>
                )}

                {messagesNextCursor ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!enabled || loadingMoreMessages}
                    onClick={() => void loadMoreMessages()}
                  >
                    {loadingMoreMessages ? "Loading messages..." : "Load more messages"}
                  </Button>
                ) : null}
              </CardContent>
            </Card>
          ) : !openingId && !openFailure ? (
            <p className="chat-no-selection">
              Select a saved conversation to inspect its history, or compose a message below.
            </p>
          ) : null}

          {actionFailure ? (
            <p role="alert" className="note-search-error">
              {actionFailure}
            </p>
          ) : null}

          <form className="chat-composer-form" onSubmit={handleFormSubmit}>
            <div className="chat-composer-field">
              <Label htmlFor={composerId}>Message</Label>
              <Textarea
                ref={composerRef}
                id={composerId}
                rows={3}
                maxLength={100_000}
                placeholder="Ask a question grounded in your saved notes"
                value={unsentMessage}
                disabled={!enabled || sending || creating || deletingId !== null}
                onChange={(event) => setUnsentMessage(event.target.value)}
              />
            </div>
            <div className="chat-composer-actions">
              <Button type="submit" disabled={controlsBusy || !hasUnsentInput}>
                {activeRead?.activeTurn ? "Queue message" : "Send message"}
              </Button>
              {activeRead?.activeTurn ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={controlsBusy || !hasUnsentInput}
                  onClick={() => void submitMessage("steer")}
                >
                  Steer answer
                </Button>
              ) : null}
            </div>
          </form>
        </div>
      </div>

      <AlertDialog
        open={pendingSwitch !== null}
        onOpenChange={(open) => {
          if (!open) setPendingSwitch(null);
        }}
      >
        <AlertDialogContent
          className="notes-dialog"
          initialFocus={discardCancelRef}
          finalFocus={composerRef}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsent message?</AlertDialogTitle>
            <AlertDialogDescription>
              Your unsent message has not been sent. Keep editing to stay in this conversation, or
              discard it to switch conversations.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel ref={discardCancelRef}>Keep message</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (pendingSwitch) executeSwitch(pendingSwitch);
              }}
            >
              Discard message
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={confirmDeleteId !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDeleteId(null);
        }}
      >
        <AlertDialogContent
          className="notes-dialog"
          initialFocus={deleteCancelRef}
          finalFocus={newConversationRef}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Delete conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDeleteConversation
                ? `"${formatConversationLabel(confirmDeleteConversation)}" will be permanently deleted. This cannot be undone.`
                : "This conversation will be permanently deleted. This cannot be undone."}
              {confirmDeleteId === activeConversationId && hasUnsentInput
                ? " Your unsent message will also be discarded."
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel ref={deleteCancelRef}>Keep conversation</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (confirmDeleteId) void performDelete(confirmDeleteId);
              }}
            >
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
