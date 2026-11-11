import { expect, test } from "@playwright/test";

// One journey across pages against the real stack. What a single component
// does belongs in a component test (services/client/src/**/*.spec.ts).
test("sign up, manage todos, sign out", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/sign-in/);

    await page.getByRole("link", { name: /create one/i }).click();
    await page.getByLabel("Name").fill("Ada");
    await page.getByLabel("Email").fill(`ada-${crypto.randomUUID()}@example.com`);
    await page.getByLabel("Password", { exact: true }).fill("correct horse battery");
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page.getByRole("heading", { name: "Todos" })).toBeVisible();
    await expect(page.getByText("Nothing to do yet")).toBeVisible();

    await page.getByLabel("New todo").fill("Water the plants");
    await page.getByRole("button", { name: "Add" }).click();
    await expect(page.getByText("Water the plants")).toBeVisible();

    await page.getByRole("checkbox", { name: "Mark \"Water the plants\" as done" }).check();
    await expect(page.getByText("Water the plants")).toHaveClass(/line-through/);

    await page.getByRole("button", { name: "Delete \"Water the plants\"" }).click();
    await expect(page.getByText("Nothing to do yet")).toBeVisible();

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/sign-in/);
});

test("rejects an empty todo with a message next to the field", async ({ page }) => {
    await page.goto("/sign-up");
    await page.getByLabel("Name").fill("Grace");
    await page.getByLabel("Email").fill(`grace-${crypto.randomUUID()}@example.com`);
    await page.getByLabel("Password", { exact: true }).fill("correct horse battery");
    await page.getByRole("button", { name: "Create account" }).click();

    await page.getByRole("button", { name: "Add" }).click();
    const title = page.getByLabel("New todo");
    await expect(title).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#title-error")).toBeVisible();
});
