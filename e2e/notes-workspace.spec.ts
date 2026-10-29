import { expect, test } from "@playwright/test";

test("edit, keyboard save, and switching notes preserve the literal Markdown", async ({ page }) => {
  await page.goto("/");
  const source = page.getByRole("textbox", { name: "Markdown source" });
  await expect(page.getByRole("status")).toHaveText("Loading notes...");
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue(
    "Project review",
  );
  const markdown =
    "# My note\n\n**Important**  \n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n```js\nconst x = '<script>';\n```\n";
  await source.fill(markdown);
  await expect(page.getByRole("status")).toHaveText("Unsaved changes");
  await expect(
    page
      .getByRole("region", { name: "Markdown preview" })
      .getByRole("heading", { name: "My note" }),
  ).toBeVisible();
  await page.keyboard.press("Control+s");
  await expect(page.getByRole("status")).toHaveText("Saving...");
  await expect(page.getByRole("status")).toHaveText("Saved for this preview session");
  await page.getByRole("button", { name: "Reading notes", exact: true }).click();
  await page.getByRole("button", { name: "Project review", exact: true }).click();
  await expect(source).toHaveValue(markdown);
});

test("failed save retains edits and can be retried with Cmd+S", async ({ page }) => {
  await page.goto("/?notesExample=save-failure");
  const source = page.getByRole("textbox", { name: "Markdown source" });
  await source.fill("Do not lose this draft.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Save failed. Your changes are still here. Try again.",
  );
  await expect(source).toHaveValue("Do not lose this draft.");
  await page.keyboard.press("Meta+s");
  await expect(page.getByRole("status")).toHaveText("Saved for this preview session");
});

test("typing during save stays unsaved and repeated shortcuts do not acknowledge it", async ({
  page,
}) => {
  await page.goto("/?notesExample=slow-save");
  const source = page.getByRole("textbox", { name: "Markdown source" });
  await source.fill("First snapshot");
  await page.keyboard.press("Control+s");
  await expect(page.getByRole("status")).toHaveText("Saving...");
  await source.fill("A newer edit");
  await page.keyboard.press("Control+s");
  await expect(page.getByRole("status")).toHaveText("Unsaved changes");
  await expect(source).toHaveValue("A newer edit");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Saved for this preview session");
});

test("dirty navigation can be cancelled or explicitly discarded, including with the keyboard", async ({
  page,
}) => {
  await page.goto("/");
  const title = page.getByRole("textbox", { name: "Title", exact: true });
  await title.fill("Unsaved title");
  await page.getByRole("button", { name: "Reading notes", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await expect(page.getByRole("button", { name: "Keep editing" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(title).toHaveValue("Unsaved title");
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.getByRole("button", { name: "Discard changes", exact: true }).click();
  await expect(title).toHaveValue("");
  await expect(title).toBeFocused();
  await expect(page.getByRole("status")).toHaveText("Unsaved changes");
});

test("browser navigation warns about unsaved input", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Keep me");
  const warning = page.waitForEvent("dialog");
  const reload = page.evaluate("window.location.reload()");
  const dialog = await warning;
  expect(dialog.type()).toBe("beforeunload");
  await dialog.dismiss();
  await reload;
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("Keep me");
});

test("empty and failed loading states have usable recovery", async ({ page }) => {
  await page.goto("/?notesExample=load-failure");
  await expect(page.getByRole("alert")).toHaveText("Could not load notes. Try again.");
  await page.getByRole("button", { name: "Retry loading" }).click();
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue(
    "Project review",
  );
  await page.goto("/?notesExample=empty");
  await expect(page.getByText("No notes yet. Create a new note to get started.")).toBeVisible();
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("My first note");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Saved for this preview session");
  await expect(
    page.getByRole("navigation", { name: "Notes" }).getByRole("button", { name: "My first note" }),
  ).toBeVisible();
});

test("malicious Markdown cannot execute or load remote images", async ({ page }) => {
  let remoteRequests = 0;
  await page.route("https://example.com/**", (route) => {
    remoteRequests++;
    return route.abort();
  });
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "Markdown source" })
    .fill(
      '<script>window.hacked = true</script>\n\n<img src=x onerror="window.hacked = true">\n\n[unsafe](javascript:alert%281%29)\n\n![tracking](https://example.com/pixel.png)\n\n[safe](https://example.com)',
    );
  const preview = page.getByRole("region", { name: "Markdown preview" });
  await expect(preview.locator("script, img, iframe")).toHaveCount(0);
  await expect(preview.getByRole("link", { name: "safe", exact: true })).toHaveAttribute(
    "href",
    "https://example.com",
  );
  await expect(preview.getByText("unsafe", { exact: true })).not.toHaveAttribute(
    "href",
    /javascript:/i,
  );
  expect(await page.evaluate(() => Reflect.get(globalThis, "hacked"))).toBeUndefined();
  expect(remoteRequests).toBe(0);
});

test("notes workspace fits desktop and mobile and supports keyboard editing", async ({
  page,
}, testInfo) => {
  await page.goto("/?example=briefing");
  await expect(page.getByRole("heading", { name: "Atlas", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("before-source-viewer.png"), fullPage: true });
  await page.goto("/");
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("after-notes-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  await page
    .getByRole("textbox", { name: "Markdown source" })
    .fill("# Mobile\n\n" + "longword".repeat(100));
  expect(await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")).toBe(
    true,
  );
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toHaveText("Saved for this preview session");
  await page.screenshot({ path: testInfo.outputPath("after-notes-mobile.png"), fullPage: true });
});
