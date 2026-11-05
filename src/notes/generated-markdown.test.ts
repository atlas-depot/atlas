import { describe, expect, it } from "vite-plus/test";
import { canImportGeneratedMarkdown } from "./generated-markdown";

describe("generated Markdown import", () => {
  it.each([
    ["list markers", "- First\n- Second", "* First\n* Second\n"],
    ["emphasis delimiters", "**Bold** and *soft*", "__Bold__ and _soft_"],
    ["paragraph spacing", "# Title\n\nA paragraph", "# Title\n\n\nA paragraph\n\n"],
    ["list spacing", "- First\n- Second", "* First\n\n* Second"],
    ["task-list spelling", "- [X] Done\n- [ ] Next", "* [x] Done\n* [ ] Next"],
    ["code fences", "```ts\nconst answer = 42;\n```", "~~~ts\nconst answer = 42;\n~~~"],
    ["autolinks", "https://example.com", "[https://example.com](https://example.com)"],
    ["table padding", "| A | B |\n| :--- | ---: |\n| x | y |", "A|B\n:---|---:\nx|y"],
  ])("accepts equivalent %s", (_label, source, roundtrip) => {
    expect(canImportGeneratedMarkdown(source, roundtrip)).toBe(true);
  });

  it.each([
    ["text", "Keep this fact", "Keep another fact"],
    ["code bytes", "```ts\nconst n = 1;\n```", "```ts\nconst n = 2;\n```"],
    ["code indentation", "```py\n  run()\n```", "```py\nrun()\n```"],
    ["code language", "```ts\nrun()\n```", "```js\nrun()\n```"],
    ["code metadata", "```ts title=demo\nrun()\n```", "```ts\nrun()\n```"],
    ["link target", "[Source](https://example.com/a)", "[Source](https://example.com/b)"],
    ["link title", '[Source](https://example.com "Evidence")', "[Source](https://example.com)"],
    ["link label", "[Source](https://example.com)", "[Other](https://example.com)"],
    ["list order", "- First\n- Second", "- Second\n- First"],
    ["ordered start", "3. First\n4. Second", "1. First\n2. Second"],
    ["task completion", "- [x] Done", "- [ ] Done"],
    ["table alignment", "| A |\n| ---: |\n| x |", "| A |\n| :--- |\n| x |"],
    ["table content", "| A |\n| --- |\n| x |", "| A |\n| --- |\n| y |"],
    ["strikethrough", "~~removed~~", "removed"],
    ["hard break", "first  \nsecond", "first\nsecond"],
    ["paragraph boundary", "first\n\nsecond", "first second"],
  ])("rejects changes to %s", (_label, source, roundtrip) => {
    expect(canImportGeneratedMarkdown(source, roundtrip)).toBe(false);
  });

  it.each([
    "<aside>Unsupported HTML</aside>",
    "![Remote image](https://example.com/image.png)",
    "Claim[^1]\n\n[^1]: Evidence",
    "[Source][ref]\n\n[ref]: https://example.com",
  ])("keeps unsupported content in source mode even if unchanged: %s", (source) => {
    expect(canImportGeneratedMarkdown(source, source)).toBe(false);
  });
});
