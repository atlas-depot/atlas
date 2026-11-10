import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { ResolvedSourceState } from "./source-location";

export function OpenedSourcePanel({
  resolved,
  fallbackTitle,
  onDismiss,
}: {
  resolved: ResolvedSourceState;
  fallbackTitle?: string | null;
  onDismiss: () => void;
}) {
  const displayTitle = resolved.noteTitle ?? fallbackTitle ?? "Unavailable note";
  const heading =
    resolved.target.origin === "citation" ? "Opened citation source" : "Opened search source";

  return (
    <section aria-label="Opened source" className="opened-source-panel">
      <Card size="sm">
        <CardHeader>
          <CardTitle>{heading}</CardTitle>
          <CardDescription>
            <span className="opened-source-identity">
              <strong>{displayTitle}</strong>
              {resolved.headingPathLabel ? ` - ${resolved.headingPathLabel}` : ""}
              {` - ${resolved.locationLabel}`}
            </span>
          </CardDescription>
          <CardAction>
            <Button type="button" variant="outline" onClick={onDismiss}>
              Dismiss source
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="opened-source-body">
          <dl className="opened-source-meta">
            {resolved.target.query ? (
              <div className="opened-source-meta-row">
                <dt>Search query</dt>
                <dd>{resolved.target.query}</dd>
              </div>
            ) : null}
            <div className="opened-source-meta-row">
              <dt>Retrieved revision</dt>
              <dd>{resolved.retrievedRevision}</dd>
            </div>
            {resolved.currentRevision ? (
              <div className="opened-source-meta-row">
                <dt>Current note revision</dt>
                <dd>{resolved.currentRevision}</dd>
              </div>
            ) : null}
            <div className="opened-source-meta-row">
              <dt>Cited location</dt>
              <dd>
                {resolved.headingPathLabel
                  ? `${resolved.headingPathLabel} - ${resolved.locationLabel}`
                  : resolved.locationLabel}
              </dd>
            </div>
          </dl>

          {resolved.warningMessage ? (
            <p role="note" className="opened-source-warning">
              {resolved.warningMessage}
            </p>
          ) : null}

          {resolved.excerpt ? (
            <div className="opened-source-excerpt-group">
              <p className="opened-source-excerpt-label">Retrieved excerpt</p>
              <blockquote className="opened-source-excerpt">{resolved.excerpt}</blockquote>
            </div>
          ) : null}

          {resolved.resolvedText && resolved.resolvedText !== resolved.excerpt ? (
            <div className="opened-source-excerpt-group">
              <p className="opened-source-excerpt-label">Current block text</p>
              <blockquote className="opened-source-excerpt">{resolved.resolvedText}</blockquote>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}
