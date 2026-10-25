import { expect, test } from "@playwright/test";

// Expected values come from fixtures/briefing/expected.json (the `message-1`
// record of the valid example), not from what the application renders.
const messageSource = {
  content: "The project review is on 22 October at 14:00.",
  author: "Deniz (synthetic)",
};

// The other reference in the same briefing item points at a user note. Opening
// it has to fail this test, so its content must stay absent.
const noteSourceContent = "Prepare the budget summary before the project review.";

test("a source reference opens the external message it targets", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("Select a source link to see where this came from.")).toBeVisible();

  const reference = page.getByRole("button", {
    name: /external message from Deniz \(synthetic\)/i,
  });
  await expect(reference).toHaveCount(1);
  await reference.click();

  await expect(page.getByText(messageSource.content, { exact: true })).toBeVisible();
  await expect(page.getByText(`From ${messageSource.author}`)).toBeVisible();
  await expect(page.getByText("External message", { exact: true })).toBeVisible();

  await expect(page.getByText(noteSourceContent, { exact: true })).toHaveCount(0);
  await expect(page.getByText("Your note", { exact: true })).toHaveCount(0);
});
