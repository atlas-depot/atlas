import { useState } from "react";

import emptyRaw from "../fixtures/briefing/empty-example.json?raw";
import malformedRaw from "../fixtures/briefing/malformed-missing-author.json?raw";
import validRaw from "../fixtures/briefing/valid-example.json?raw";
import {
  parseFixtures,
  type BriefingExample,
  type FixtureIssue,
  type FixtureResult,
} from "./fixtures/parse-fixtures";

type FixtureKey = "valid" | "empty" | "malformed";
type Source = BriefingExample["sources"][number];

const FIXTURES: Record<FixtureKey, { label: string; raw: string }> = {
  valid: { label: "Valid example", raw: validRaw },
  empty: { label: "Empty example", raw: emptyRaw },
  malformed: { label: "Invalid example (missing author)", raw: malformedRaw },
};

// File text is decoded here; the parser only receives already decoded data.
function loadFixture(key: FixtureKey): FixtureResult {
  let decoded: unknown;
  try {
    decoded = JSON.parse(FIXTURES[key].raw);
  } catch {
    return { success: false, issues: [{ path: [], message: "The file is not valid JSON." }] };
  }
  return parseFixtures(decoded);
}

function kindLabel(source: Source): string {
  return source.kind === "user_note" ? "Your note" : "External message";
}

function linkName(source: Source, number: number): string {
  return source.kind === "user_note"
    ? `Open source ${number}: your note`
    : `Open source ${number}: external message from ${source.source.author}`;
}

function SourceDetail({ source }: { source: Source | undefined }) {
  return (
    <section className="detail" aria-live="polite">
      <h2>Source</h2>
      {source ? (
        <>
          <p className="kind">{kindLabel(source)}</p>
          {source.kind === "external_message" && (
            <p className="origin">
              From {source.source.author}
              {source.source.sentAt ? ` · ${source.source.sentAt}` : ""}
            </p>
          )}
          <p className="content">{source.content}</p>
        </>
      ) : (
        <p>Select a source link to see where this came from.</p>
      )}
    </section>
  );
}

function BriefingView({
  data,
  selectedId,
  onSelect,
}: {
  data: BriefingExample;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (data.briefing.items.length === 0) {
    return <p className="empty">No briefing items yet.</p>;
  }

  const selected = data.sources.find((source) => source.id === selectedId);

  return (
    <>
      <section>
        <h2>Briefing</h2>
        <ul className="items">
          {data.briefing.items.map((item, itemIndex) => (
            <li key={itemIndex}>
              <p className="item-text">{item.text}</p>
              <div className="links">
                {item.sourceIds.map((sourceId, referenceIndex) => {
                  const source = data.sources.find((candidate) => candidate.id === sourceId);
                  if (!source) return null;
                  return (
                    <button
                      key={sourceId}
                      type="button"
                      aria-label={linkName(source, referenceIndex + 1)}
                      aria-pressed={sourceId === selectedId}
                      onClick={() => onSelect(sourceId)}
                    >
                      [{referenceIndex + 1}]
                    </button>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
      </section>
      <SourceDetail source={selected} />
    </>
  );
}

function InvalidState({ issues }: { issues: FixtureIssue[] }) {
  return (
    <section className="invalid" role="alert">
      <h2>Could not load the example</h2>
      <ul>
        {issues.map((issue, index) => (
          <li key={index}>
            <code>{issue.path.length > 0 ? issue.path.join(" › ") : "file"}</code>: {issue.message}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function App() {
  const [fixtureKey, setFixtureKey] = useState<FixtureKey>("valid");
  // Only in memory: a refresh resets both the fixture choice and the open source.
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const result = loadFixture(fixtureKey);

  return (
    <main>
      <p className="banner" role="note">
        Fixed synthetic example data. Not a live message or account.
      </p>
      <h1>Atlas</h1>

      <div className="picker">
        <label htmlFor="fixture">Example data (development only)</label>
        <select
          id="fixture"
          value={fixtureKey}
          onChange={(event) => {
            setFixtureKey(event.target.value as FixtureKey);
            setSelectedId(null);
          }}
        >
          {Object.entries(FIXTURES).map(([key, fixture]) => (
            <option key={key} value={key}>
              {fixture.label}
            </option>
          ))}
        </select>
      </div>

      {result.success ? (
        <BriefingView data={result.data} selectedId={selectedId} onSelect={setSelectedId} />
      ) : (
        <InvalidState issues={result.issues} />
      )}
    </main>
  );
}
