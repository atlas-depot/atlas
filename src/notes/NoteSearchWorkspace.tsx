import { useEffect, useId, useRef, useState, type FormEvent } from "react";
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
import { Label } from "@/components/ui/label";
import type { NoteSummary } from "../../shared/notes";
import { classifyFailure } from "./editor-state";
import { NotesRequestError } from "./notes-store";
import type { NoteSearchClient } from "./note-search-store";
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
  activeSourceTarget,
  onOpenSource,
  onUnauthenticated,
}: {
  client: NoteSearchClient;
  notes: NoteSummary[];
  enabled: boolean;
  activeSourceTarget: SourceTarget | null;
  onOpenSource: (target: SourceTarget) => void;
  onUnauthenticated: () => void;
}) {
  const queryInputId = useId();
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [outcome, setOutcome] = useState<SearchOutcome | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const enabledRef = useRef(enabled);

  useEffect(() => {
    enabledRef.current = enabled;
    if (!enabled) {
      requestIdRef.current += 1;
    }
  }, [enabled]);

  useEffect(() => {
    return () => {
      requestIdRef.current += 1;
    };
  }, []);

  async function runSearch(rawQuery: string) {
    const trimmed = rawQuery.trim();
    if (!enabledRef.current || trimmed.length === 0) return;

    const requestId = ++requestIdRef.current;
    setSubmittedQuery(trimmed);
    setSearching(true);
    setFailure(null);

    try {
      const response = await client.search(trimmed);
      if (requestId !== requestIdRef.current || !enabledRef.current) {
        return;
      }
      setOutcome(describeSearchOutcome(trimmed, response));
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
      if (requestId === requestIdRef.current) {
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
      return "Saved note";
    }
    return found.title.trim() || "Untitled note";
  }

  const trimmedQuery = query.trim();
  const retryQuery = trimmedQuery.length > 0 ? trimmedQuery : submittedQuery;
  const isSearching = searching && enabled;

  return (
    <section aria-label="Search notes" className="note-search-workspace">
      <div className="note-search-header">
        <h2>Search notes</h2>
        <form className="note-search-form" onSubmit={handleSubmit}>
          <div className="note-search-field">
            <Label htmlFor={queryInputId}>Search saved notes</Label>
            <Input
              id={queryInputId}
              type="search"
              value={query}
              placeholder="Find saved passages by keyword or question"
              maxLength={500}
              disabled={!enabled}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div className="note-search-actions">
            <Button
              type="submit"
              variant="outline"
              disabled={!enabled || trimmedQuery.length === 0}
            >
              Search
            </Button>
          </div>
        </form>
      </div>

      {submittedQuery ? (
        <p className="note-search-query-summary">
          {isSearching ? `Searching for "${submittedQuery}"...` : `Query: "${submittedQuery}"`}
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
        <div className="note-search-results" data-search-outcome={outcome.kind}>
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
                        </CardDescription>
                        <CardAction>
                          <Button
                            type="button"
                            variant="outline"
                            disabled={!enabled}
                            onClick={() =>
                              onOpenSource(createSearchSourceTarget(candidate, outcome.query))
                            }
                          >
                            Open source
                          </Button>
                        </CardAction>
                      </CardHeader>
                      <CardContent>
                        <blockquote className="note-search-excerpt">{candidate.text}</blockquote>
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
