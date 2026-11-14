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
  cacheResetToken,
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
  cacheResetToken: number;
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
  const [historyRefreshPending, setHistoryRefreshPending] = useState(false);
  const [historyFailure, setHistoryFailure] = useState<string | null>(null);

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
  const historyCursorRef = useRef<string | undefined>(undefined);
  const activeReadRef = useRef<ConversationRead | null>(null);
  const listInitializedRef = useRef(false);
  const deleteRequestIdRef = useRef(0);

  const invalidateActive = useCallback(() => {
    openRequestIdRef.current += 1;
    actionGenerationRef.current += 1;
    setOpeningId(null);
    setCreating(false);
    setSending(false);
    setActing(false);
    setLoadingMoreMessages(false);
  }, []);

  const isCurrentOpenRequest = useCallback(
    (requestId: number, conversationId?: string) =>
      requestId === openRequestIdRef.current &&
      enabledRef.current &&
      (conversationId === undefined || !deletedIdsRef.current.has(conversationId)),
    [],
  );

  function clearHistory() {
    messagesRef.current = [];
    historyCursorRef.current = undefined;
    activeReadRef.current = null;
    setActiveRead(null);
    setMessages([]);
    setMessagesNextCursor(null);
    setHistoryRefreshPending(false);
    setHistoryFailure(null);
  }

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
  const retryDeleteRef = useRef<HTMLButtonElement>(null);
  const chatHeadingRef = useRef<HTMLHeadingElement>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null);

  const hasUnsentInput = unsentMessage.trim().length > 0;

  useEffect(() => {
    enabledRef.current = enabled;
    if (!enabled) {
      listRequestIdRef.current += 1;
      deleteRequestIdRef.current += 1;
      void Promise.resolve().then(() => {
        invalidateActive();
        setDeletingId(null);
        setLoadingMoreConversations(false);
        setLoadingMoreMessages(false);
      });
    }
  }, [enabled, invalidateActive]);

  useEffect(() => {
    if (cacheResetToken === 0) return;
    void Promise.resolve().then(() => {
      invalidateActive();
      clearHistory();
      setConversations([]);
      setCachedNoteTitles({});
      setListNextCursor(null);
      listInitializedRef.current = false;
    });
  }, [cacheResetToken, invalidateActive]);

  useEffect(() => {
    return () => {
      listRequestIdRef.current += 1;
      openRequestIdRef.current += 1;
    };
  }, []);

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
        const hadLoadedList = listInitializedRef.current;
        setConversations((current) => [
          ...current.filter(
            (item) => locallyCreatedIdsRef.current.has(item.id) && !returnedIds.has(item.id),
          ),
          ...filtered,
          ...current.filter(
            (item) =>
              hadLoadedList &&
              !returnedIds.has(item.id) &&
              !locallyCreatedIdsRef.current.has(item.id) &&
              !deletedIdsRef.current.has(item.id),
          ),
        ]);
        if (!hadLoadedList) setListNextCursor(result.nextCursor);
        listInitializedRef.current = true;
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
   * Continue from the contiguous history boundary, never an optimistically appended
   * send. A bounded catch-up exposes any remaining pages through the manual control.
   */
  const fetchLatestHistory = useCallback(
    async (id: string, fromStart = false) => {
      const current = fromStart ? [] : messagesRef.current;
      let cursor = fromStart ? undefined : historyCursorRef.current;
      let merged = current;
      for (let page = 0; page < MAX_HISTORY_CATCH_UP_PAGES; page += 1) {
        const result = await client.messages(id, { limit: 50, cursor });
        merged = mergeConversationMessages(merged, result.messages);
        if (result.nextCursor === null) {
          return {
            messages: merged,
            nextCursor: null,
            cursor: result.messages.at(-1)?.sequence.toString() ?? cursor,
          };
        }
        cursor = result.nextCursor;
      }
      return { messages: merged, nextCursor: cursor ?? null, cursor };
    },
    [client],
  );

  const commitHistory = useCallback(
    (result: { messages: ConversationMessage[]; nextCursor: string | null; cursor?: string }) => {
      messagesRef.current = mergeConversationMessages(messagesRef.current, result.messages);
      setMessages(messagesRef.current);
      // A late page cannot move the contiguous boundary behind a newer refresh.
      if (Number(result.cursor ?? 0) >= Number(historyCursorRef.current ?? 0)) {
        historyCursorRef.current = result.cursor;
        setMessagesNextCursor(result.nextCursor);
      }
      setHistoryFailure(null);
    },
    [],
  );

  const refreshActiveConversation = useCallback(
    async (id: string) => {
      const requestId = openRequestIdRef.current;
      const actionGeneration = actionGenerationRef.current;
      const stillCurrent = () =>
        actionGeneration === actionGenerationRef.current && isCurrentOpenRequest(requestId, id);
      try {
        const readResult = await client.read(id);
        if (!stillCurrent()) return;
        const previousTurnId = activeReadRef.current?.activeTurn?.id;
        const turnChanged = previousTurnId !== readResult.activeTurn?.id;
        const historyResult =
          turnChanged || historyRefreshPending ? await fetchLatestHistory(id) : null;
        if (!stillCurrent()) return;
        // Publish the read and its history together. Failed history keeps the old
        // running turn visible and polling alive, including between queued turns.
        if (historyResult) commitHistory(historyResult);
        activeReadRef.current = readResult;
        setActiveRead(readResult);
        setHistoryRefreshPending(false);
        setConversations((current) =>
          current.map((item) => (item.id === id ? readResult.conversation : item)),
        );
      } catch (error) {
        if (!stillCurrent()) return;
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
            invalidateActive();
            selectConversation(null);
            clearHistory();
            setOpenFailure({
              id,
              kind: "missing",
              message: "This conversation is no longer available.",
            });
          }
        }
      }
    },
    [
      client,
      fetchLatestHistory,
      commitHistory,
      historyRefreshPending,
      invalidateActive,
      isCurrentOpenRequest,
      onUnauthenticated,
    ],
  );

  const activeTurnRunning = activeRead !== null && activeRead.activeTurn !== null;

  // A running answer only becomes visible through a new read, so keep the active
  // conversation in sync until the server reports a terminal turn.
  useEffect(() => {
    if (!enabled || activeConversationId === null || (!activeTurnRunning && !historyRefreshPending))
      return;
    const id = activeConversationId;
    const timer = window.setInterval(() => {
      if (turnRefreshBusyRef.current) return;
      turnRefreshBusyRef.current = true;
      void refreshActiveConversation(id).finally(() => {
        turnRefreshBusyRef.current = false;
      });
    }, 1_500);
    return () => window.clearInterval(timer);
  }, [
    enabled,
    activeConversationId,
    activeTurnRunning,
    historyRefreshPending,
    refreshActiveConversation,
  ]);

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
    invalidateActive();
    const requestId = openRequestIdRef.current;
    snapshotNoteTitles();
    setDeleteNotice(null);
    setOpenFailure(null);
    setActionFailure(null);
    // Clear previous conversation state immediately so another conversation's cached
    // messages are never displayed while loading or after a missing/failed read.
    selectConversation(id);
    setOpeningId(id);
    clearHistory();

    try {
      // A read can publish a completed answer, so history must be requested after it.
      const readResult = await client.read(id);
      if (!isCurrentOpenRequest(requestId, id)) return;
      const historyResult = await fetchLatestHistory(id, true);
      if (!isCurrentOpenRequest(requestId, id)) {
        return;
      }
      setConversations((current) => {
        const exists = current.some((item) => item.id === id);
        if (!exists) {
          return [readResult.conversation, ...current];
        }
        return current.map((item) => (item.id === id ? readResult.conversation : item));
      });
      activeReadRef.current = readResult;
      setActiveRead(readResult);
      commitHistory(historyResult);
      setOpenFailure(null);
    } catch (error) {
      if (!isCurrentOpenRequest(requestId, id)) {
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
        clearHistory();
        setOpenFailure({
          id,
          kind: "missing",
          message: "This conversation is no longer available.",
        });
        return;
      }
      clearHistory();
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
      if (!isCurrentOpenRequest(requestId, targetId)) {
        return;
      }
      commitHistory({
        ...result,
        cursor: result.nextCursor ?? result.messages.at(-1)?.sequence.toString() ?? cursor,
      });
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
    invalidateActive();
    const requestId = openRequestIdRef.current;
    setCreating(true);
    setDeleteNotice(null);
    setOpenFailure(null);
    setActionFailure(null);
    const key = pendingCreateKeyRef.current ?? crypto.randomUUID();
    pendingCreateKeyRef.current = key;

    try {
      const created = await client.create(key);
      if (!isCurrentOpenRequest(requestId)) {
        return;
      }
      pendingCreateKeyRef.current = null;
      locallyCreatedIdsRef.current.add(created.id);
      setConversations((current) => [created, ...current.filter((item) => item.id !== created.id)]);
      setListState("ready");
      selectConversation(created.id);
      clearHistory();
      const read = {
        conversation: created,
        activeTurn: null,
        recovery: null,
      };
      activeReadRef.current = read;
      setActiveRead(read);
      requestAnimationFrame(() => composerRef.current?.focus());
    } catch (error) {
      if (requestId !== openRequestIdRef.current) return;
      const kind = classifyFailure(error);
      if (kind === "unauthenticated") {
        onUnauthenticated();
        return;
      }
      if (kind === "creation-conflict") {
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
        if (!isCurrentOpenRequest(watchId)) {
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
        clearHistory();
        const createdRead = {
          conversation: created,
          activeTurn: null,
          recovery: null,
        };
        activeReadRef.current = createdRead;
        setActiveRead(createdRead);
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
      if (!isCurrentOpenRequest(watchId, targetId)) {
        return;
      }

      // Session pauses retain this identity until a current retry confirms acceptance.
      if (pendingSendKeyRef.current?.key === sendKey) pendingSendKeyRef.current = null;

      setUnsentMessage("");
      const read = {
        conversation: sent.conversation,
        activeTurn: sent.activeTurn,
        recovery: sent.recovery,
      };
      activeReadRef.current = read;
      setActiveRead(read);
      setConversations((current) =>
        current.map((item) => (item.id === sent.conversation.id ? sent.conversation : item)),
      );
      messagesRef.current = mergeConversationMessages(messagesRef.current, [sent.message]);
      setMessages(messagesRef.current);

      // Acceptance is final even when the follow-up history request fails.
      await refreshHistoryAfterAction(targetId, watchId);
    } catch (error) {
      if (watchId !== openRequestIdRef.current) return;
      const kind = classifyFailure(error);
      if (kind === "unauthenticated") {
        onUnauthenticated();
        return;
      }
      if (kind === "creation-conflict") {
        pendingCreateKeyRef.current = null;
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

  async function refreshHistoryAfterAction(id: string, requestId: number) {
    const actionGeneration = actionGenerationRef.current;
    const stillCurrent = () =>
      actionGeneration === actionGenerationRef.current && isCurrentOpenRequest(requestId, id);
    try {
      const result = await fetchLatestHistory(id);
      if (!stillCurrent()) return;
      commitHistory(result);
      setHistoryRefreshPending(false);
    } catch (error) {
      if (!stillCurrent()) return;
      if (classifyFailure(error) === "unauthenticated") {
        onUnauthenticated();
        return;
      }
      setHistoryFailure(
        "Your action was accepted, but message history could not be refreshed. Retrying history does not send another message.",
      );
      setHistoryRefreshPending(true);
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
      if (!isCurrentOpenRequest(watchId, targetId)) {
        return;
      }
      setActiveRead(updated);
      activeReadRef.current = updated;
      setConversations((current) =>
        current.map((item) => (item.id === updated.conversation.id ? updated.conversation : item)),
      );
      await refreshHistoryAfterAction(targetId, watchId);
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
    const requestId = ++deleteRequestIdRef.current;
    setConfirmDeleteId(null);
    setDeletingId(id);
    setDeleteFailure(null);
    setDeleteNotice(null);

    try {
      await client.delete(id);
    } catch (error) {
      if (!enabledRef.current || requestId !== deleteRequestIdRef.current) return;
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
        requestAnimationFrame(() => retryDeleteRef.current?.focus());
        return;
      }
    }

    if (!enabledRef.current || requestId !== deleteRequestIdRef.current) return;
    deletedIdsRef.current.add(id);
    locallyCreatedIdsRef.current.delete(id);
    setDeletingId(null);
    setDeleteFailure(null);
    setConversations((current) => current.filter((item) => item.id !== id));
    setOpenFailure((current) => (current?.id === id ? null : current));

    if (activeConversationIdRef.current === id) {
      invalidateActive();
      selectConversation(null);
      clearHistory();
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
                onPresentationChange("sidebar");
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
        <h2 ref={chatHeadingRef} tabIndex={-1}>
          Saved conversations
        </h2>
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
              ref={retryDeleteRef}
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
        <div className="chat-history-column">
          <p className="sr-only" aria-live="polite" aria-atomic="true">
            {listState === "loading"
              ? "Loading saved conversations."
              : listState === "ready"
                ? `${conversations.length} saved conversations loaded.`
                : "Saved conversations could not be loaded."}
          </p>
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
                        onClick={(event) => {
                          deleteTriggerRef.current = event.currentTarget;
                          setConfirmDeleteId(item.id);
                        }}
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

        <div className="chat-thread-column">
          <p className="sr-only" aria-live="polite" aria-atomic="true">
            {openingId
              ? "Opening conversation."
              : activeRead
                ? `${messages.length} messages loaded. ${activeRead.activeTurn ? "Answer in progress." : "History updated."}`
                : "No conversation selected."}
          </p>
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
                    onClick={(event) => {
                      deleteTriggerRef.current = event.currentTarget;
                      setConfirmDeleteId(activeRead.conversation.id);
                    }}
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

          {historyFailure ? (
            <div className="note-search-feedback">
              <p role="alert" className="note-search-error">
                {historyFailure}
              </p>
              <Button
                type="button"
                variant="outline"
                disabled={controlsBusy}
                onClick={() => {
                  if (activeConversationId) void refreshActiveConversation(activeConversationId);
                }}
              >
                Retry loading messages
              </Button>
            </div>
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
          finalFocus={() => {
            const trigger = deleteTriggerRef.current;
            if (trigger?.isConnected && !trigger.disabled) return trigger;
            return newConversationRef.current && !newConversationRef.current.disabled
              ? newConversationRef.current
              : chatHeadingRef.current;
          }}
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
