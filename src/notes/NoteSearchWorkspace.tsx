import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import type { NoteSummary } from "../../shared/notes";
import { classifyFailure } from "./editor-state";
import { NotesRequestError } from "./notes-store";
import type { NoteSearchClient } from "./note-search-store";
import {
  buildInternalNoteHref,
  formatNoteAuthorship,
  formatNoteTimestamp,
  getNoteAuthorship,
  resolveOriginSource,
} from "./note-metadata";
import {
  createSearchSourceTarget,
  describeSearchOutcome,
  formatHeadingPath,
  formatSourceLocation,
  formatSourceRevision,
  type SearchOutcome,
  type SourceTarget,
} from "./source-location";

function searchFailureMessage(error: unknown): string {
  if (error instanceof NotesRequestError) {
    if (error.status === 429) {
      return "Search rate limit reached. Wait a moment and retry your search.";
    }
    if (error.status === 403) {
      return "Search request was blocked. Restore request access and retry your search.";
    }
  }
  const kind = classifyFailure(error);
  if (kind === "unavailable") {
    return "Note search is not available yet. Retry your search in a moment.";
  }
  return "Search could not be completed. Your query is preserved so you can retry.";
}

export function NoteSearchWorkspace({
  client,
  notes,
  enabled,
  canOpenSource,
  activeSourceTarget,
  onOpenSource,
  onOpenNote,
  onUnauthenticated,
}: {
  client: NoteSearchClient;
  notes: NoteSummary[];
  enabled: boolean;
  canOpenSource: boolean;
  activeSourceTarget: SourceTarget | null;
  onOpenSource: (target: SourceTarget) => void;
  onOpenNote?: (noteId: string) => void;
  onUnauthenticated: () => void;
}) {
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [outcome, setOutcome] = useState<SearchOutcome | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [resultTitles, setResultTitles] = useState<Record<string, string>>({});
  const [resultSummaries, setResultSummaries] = useState<Record<string, NoteSummary>>({});
  const requestIdRef = useRef(0);
  const inFlightIdRef = useRef(0);
  const enabledRef = useRef(enabled);

  useEffect(() => {
    enabledRef.current = enabled;
    if (!enabled) {
      requestIdRef.current += 1;
      inFlightIdRef.current = 0;
      void Promise.resolve().then(() => setSearching(false));
    }
  }, [enabled]);

  useEffect(() => {
    return () => {
      requestIdRef.current += 1;
      inFlightIdRef.current = 0;
    };
  }, []);

  async function runSearch(rawQuery: string) {
    const trimmed = rawQuery.trim();
    if (!enabledRef.current || trimmed.length === 0) return;

    const titles = Object.fromEntries(
      notes.map((note) => [note.id, note.title.trim() || "Untitled note"]),
    );
    const summaries = Object.fromEntries(notes.map((note) => [note.id, note]));
    const requestId = ++requestIdRef.current;
    inFlightIdRef.current = requestId;
    setSubmittedQuery(trimmed);
    setSearching(true);
    setFailure(null);

    try {
      const response = await client.search(trimmed);
      if (requestId !== requestIdRef.current || !enabledRef.current) {
        return;
      }
      setOutcome(describeSearchOutcome(trimmed, response));
      setResultTitles(titles);
      setResultSummaries(summaries);
      setFailure(null);
    } catch (error) {
      if (requestId !== requestIdRef.current) {
        return;
      }
      if (classifyFailure(error) === "unauthenticated") {
        setOutcome(null);
        setFailure(null);
        setSearching(false);
        onUnauthenticated();
        return;
      }
      setFailure(searchFailureMessage(error));
    } finally {
      if (inFlightIdRef.current === requestId) {
        inFlightIdRef.current = 0;
        setSearching(false);
      }
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runSearch(query);
  }

  function resolveNoteTitle(noteId: string): string {
    const found = notes.find((item) => item.id === noteId);
    if (!found) {
      return resultTitles[noteId] ?? "Saved note";
    }
    return found.title.trim() || "Untitled note";
  }

  const trimmedQuery = query.trim();
  const retryQuery = trimmedQuery.length > 0 ? trimmedQuery : submittedQuery;
  const isSearching = searching && enabled;

  return (
    <section aria-label="Search notes" className="note-search-workspace">
      <form className="note-search-form" onSubmit={handleSubmit}>
        <Input
          type="search"
          aria-label="Search saved notes"
          placeholder="Search notes"
          value={query}
          maxLength={500}
          disabled={!enabled}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Button
          type="submit"
          variant="ghost"
          size="icon"
          aria-label="Search"
          title="Search"
          disabled={!enabled || trimmedQuery.length === 0}
        >
          <MagnifyingGlassIcon aria-hidden="true" />
        </Button>
      </form>

      {isSearching || (!failure && outcome && outcome.query !== trimmedQuery) ? (
        <p className="note-search-query-summary" aria-live="polite">
          {isSearching ? "Searching…" : `Results for “${outcome?.query}”`}
        </p>
      ) : null}

      {failure ? (
        <div className="note-search-feedback">
          <p role="alert" className="note-search-error">
            {failure}
          </p>
          {retryQuery ? (
            <Button
              type="button"
              variant="outline"
              disabled={!enabled}
              onClick={() => void runSearch(retryQuery)}
            >
              Retry search
            </Button>
          ) : null}
        </div>
      ) : null}

      {!failure && outcome ? (
        <div className="note-search-results" data-search-outcome={outcome.kind} aria-live="polite">
          {outcome.coverageNotice ? (
            <div className="note-search-feedback">
              <p role="note" className="note-search-notice">
                {outcome.coverageNotice}
              </p>
              {outcome.canRetry ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={!enabled}
                  onClick={() => void runSearch(retryQuery || outcome.query)}
                >
                  Retry search
                </Button>
              ) : null}
            </div>
          ) : null}

          {outcome.emptyMessage ? (
            <div className="note-search-feedback">
              <p role="note" className="note-search-empty">
                {outcome.emptyMessage}
              </p>
              {outcome.canRetry ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={!enabled}
                  onClick={() => void runSearch(retryQuery || outcome.query)}
                >
                  Retry search
                </Button>
              ) : null}
            </div>
          ) : null}

          {outcome.candidates.length > 0 ? (
            <ul className="note-search-candidate-list" aria-label="Search results">
              {outcome.candidates.map((candidate, index) => {
                const { source } = candidate;
                const headingPath = formatHeadingPath(source.headingPath);
                const locationLabel = formatSourceLocation(source);
                const revisionLabel = formatSourceRevision(source.version);
                const noteTitle = resolveNoteTitle(source.noteId);
                const summary =
                  notes.find((item) => item.id === source.noteId) ?? resultSummaries[source.noteId];
                const originSource = resolveOriginSource(summary?.origin, notes);
                const isActive =
                  activeSourceTarget?.source.noteId === source.noteId &&
                  activeSourceTarget?.source.version === source.version &&
                  formatSourceLocation(activeSourceTarget.source) === locationLabel;
                const candidateKey =
                  source.kind === "block"
                    ? `${source.noteId}:${source.version}:${source.blockId}:${source.part ?? 0}:${index}`
                    : `${source.noteId}:${source.version}:${source.startOffset}-${source.endOffset}:${source.part ?? 0}:${index}`;

                return (
                  <li key={candidateKey} className="note-search-candidate-item">
                    <Card
                      size="sm"
                      className={isActive ? "note-search-card is-active" : "note-search-card"}
                    >
                      <CardHeader>
                        <CardTitle>{noteTitle}</CardTitle>
                        <CardDescription>
                          <span>
                            {headingPath ? `${headingPath} - ` : ""}
                            {locationLabel} - {revisionLabel}
                          </span>
                          {summary ? (
                            <span className="note-search-meta">
                              <span
                                className="note-authorship-badge"
                                data-authorship={getNoteAuthorship(summary)}
                              >
                                {formatNoteAuthorship(summary)}
                              </span>
                              <span className="note-meta-timestamp">
                                Last edited{" "}
                                <time dateTime={summary.updatedAt}>
                                  {formatNoteTimestamp(summary.updatedAt)}
                                </time>
                              </span>
                            </span>
                          ) : null}
                        </CardDescription>
                        <CardAction>
                          <Button
                            type="button"
                            variant="outline"
                            disabled={!enabled || !canOpenSource}
                            aria-current={isActive ? "location" : undefined}
                            onClick={() =>
                              onOpenSource({
                                ...createSearchSourceTarget(candidate, outcome.query),
                                noteTitle,
                              })
                            }
                          >
                            Open source
                          </Button>
                        </CardAction>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        <blockquote className="note-search-excerpt">{candidate.text}</blockquote>
                        {originSource ? (
                          <div
                            className="note-search-origin"
                            data-source-state={originSource.status}
                          >
                            <span className="note-meta-label">Source note:</span>
                            {originSource.status === "available" ? (
                              <>
                                <a
                                  href={buildInternalNoteHref(originSource.noteId)}
                                  className="note-source-link"
                                  aria-disabled={!enabled || !canOpenSource || undefined}
                                  tabIndex={!enabled || !canOpenSource ? -1 : undefined}
                                  onClick={(event) => {
                                    event.preventDefault();
                                    if (!enabled || !canOpenSource) return;
                                    onOpenNote?.(originSource.noteId);
                                  }}
                                >
                                  {originSource.title}
                                </a>
                                <span className="note-meta-revision">
                                  (Revision {originSource.revision})
                                </span>
                              </>
                            ) : (
                              <span className="note-source-unavailable">
                                Source note unavailable (Revision {originSource.revision})
                              </span>
                            )}
                          </div>
                        ) : null}
                      </CardContent>
                    </Card>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
