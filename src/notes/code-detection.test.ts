import { beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { detectCodeLanguage, inferUnlabelledCodeFences, loadCodeDetection } from "./code-detection";

// Samples win by a clear margin in highlight.js/lib/common: JavaScript 20 over
// TypeScript 19, Python 17 over Ruby 14, SQL 8 over VB.NET 5.
const javascript = [
  '"use strict";',
  "",
  'const fs = require("fs");',
  "",
  "function readTitle(path) {",
  '  const text = fs.readFileSync(path, "utf8");',
  '  return text.split("\\n")[0];',
  "}",
  "",
  "module.exports = { readTitle };",
].join("\n");
const python = [
  "import os",
  "",
  "class Note:",
  "    def __init__(self, title):",
  "        self.title = title",
  "",
  "    def save(self):",
  "        if self.title is None:",
  '            raise ValueError("missing title")',
  '        print(f"Saving {self.title}")',
  "        return True",
].join("\n");
const sql = [
  "UPDATE notes SET title = 'Renamed', updated_at = CURRENT_TIMESTAMP WHERE id = 42;",
  "DELETE FROM notes WHERE deleted_at IS NOT NULL;",
].join("\n");
const fence = "```";

beforeAll(async () => {
  await loadCodeDetection();
});

describe("detectCodeLanguage", () => {
  it("returns undefined until highlight.js has loaded", async () => {
    vi.resetModules();
    const fresh = await import("./code-detection");
    expect(fresh.detectCodeLanguage(python)).toBeUndefined();
    await fresh.loadCodeDetection();
    expect(fresh.detectCodeLanguage(python)).toBe("python");
  });

  it.each([
    ["javascript", javascript],
    ["python", python],
    ["sql", sql],
  ])("detects %s", (language, source) => {
    expect(detectCodeLanguage(source)).toBe(language);
  });

  it("ignores input shorter than 12 characters after trimming", () => {
    // A shebang scores 10, so only the length floor rejects the 11 trimmed characters.
    expect(detectCodeLanguage("#!/bin/bash\n\n\n")).toBeUndefined();
    expect(detectCodeLanguage("#!/bin/sh -e")).toBe("shellscript");
  });

  it("ignores matches below relevance 3", () => {
    // INI scores 2 for a bare assignment and 3 once a section header is added.
    expect(detectCodeLanguage("title = Weekly notes")).toBeUndefined();
    expect(detectCodeLanguage("[notes]\ntitle = Weekly")).toBe("ini");
  });

  it("ignores input longer than 20,000 characters", () => {
    const atLimit = `${python}\n\n`.repeat(100).slice(0, 20_000);
    expect(detectCodeLanguage(atLimit)).toBe("python");
    expect(detectCodeLanguage(`${atLimit}\n`)).toBeUndefined();
  });
});

describe("inferUnlabelledCodeFences", () => {
  it("labels an unlabelled fence and keeps every other byte", () => {
    expect(inferUnlabelledCodeFences(`Intro\n\n${fence}\n${python}\n${fence}\n\nOutro`)).toBe(
      `Intro\n\n${fence}python\n${python}\n${fence}\n\nOutro`,
    );
  });

  it("leaves a labelled fence alone", () => {
    expect(inferUnlabelledCodeFences(`${fence}text\n${python}\n${fence}`)).toBeUndefined();
  });

  it("leaves a fence unlabelled when its content is not detectable", () => {
    expect(
      inferUnlabelledCodeFences(`${fence}\nBuy milk\nCall Deniz\nBook the train\n${fence}`),
    ).toBeUndefined();
  });

  it("leaves an unclosed fence unlabelled", () => {
    expect(inferUnlabelledCodeFences(`${fence}\n${python}`)).toBeUndefined();
  });

  it("labels a list item's fence after its indentation", () => {
    const body = python
      .split("\n")
      .map((line) => (line ? `  ${line}` : line))
      .join("\n");
    expect(inferUnlabelledCodeFences(`- Example\n\n  ${fence}\n${body}\n  ${fence}`)).toBe(
      `- Example\n\n  ${fence}python\n${body}\n  ${fence}`,
    );
  });

  it("leaves a fence inside a blockquote unlabelled", () => {
    const quoted = [fence, ...python.split("\n"), fence]
      .map((line) => `> ${line}`.trimEnd())
      .join("\n");
    expect(inferUnlabelledCodeFences(quoted)).toBeUndefined();
  });

  it("skips Markdown longer than 20,000 characters", () => {
    const markdown = `${fence}\n${python}\n${fence}\n\n`;
    expect(inferUnlabelledCodeFences(markdown.padEnd(20_000, "x"))).toBe(
      `${fence}python\n${python}\n${fence}\n\n`.padEnd(20_000 + "python".length, "x"),
    );
    expect(inferUnlabelledCodeFences(markdown.padEnd(20_001, "x"))).toBeUndefined();
  });
});
