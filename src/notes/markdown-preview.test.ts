import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import { MarkdownPreview } from "./MarkdownPreview";

describe("safe Markdown preview", () => {
  it("renders supported Markdown as semantic elements, preserving literal code", () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownPreview, {
        content:
          "# Heading\n\nA **strong** and *emphasized* paragraph.\n\n- First\n- Second\n\n> Quote\n\n| Key | Value |\n| --- | --- |\n| A | B |\n\n[Project](https://example.com)\n\n```html\n<script>literal()</script>\n```",
      }),
    );
    for (const expected of [
      "<h1>Heading</h1>",
      "<p>A <strong>strong</strong>",
      "<em>emphasized</em>",
      "<ul>",
      "<li>First</li>",
      "<blockquote>",
      "<table>",
      "<td>B</td>",
      'href="https://example.com"',
      "&lt;script&gt;literal()&lt;/script&gt;",
    ]) {
      expect(html).toContain(expected);
    }
  });

  it("drops raw HTML and remote images and neutralizes unsafe link protocols", () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownPreview, {
        content:
          '<script>window.hacked = true</script>\n\n<img src=x onerror="alert(1)">\n\n<iframe src="https://example.com"></iframe>\n\n[bad](javascript:alert%281%29)\n\n[data](data:text/html,boom)\n\n![tracking](https://example.com/pixel.png)\n\n[safe](https://example.com)',
      }),
    );
    expect(html).not.toMatch(/<script|<img|<iframe|onerror|javascript:|data:text|pixel\.png/);
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain(">bad</a>");
  });
});
