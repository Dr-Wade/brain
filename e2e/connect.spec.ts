import { expect, test } from "@playwright/test";

// The part of Claude's connection a browser sees before GitHub: register,
// open the authorization, land on sign-in. GitHub itself is not reachable
// from a test, so the journey stops at its button.
test("Claude's authorization lands on the GitHub sign-in", async ({ page, request, baseURL }) => {
    const registered = await request.post("/api/auth/oauth2/register", {
        data: {
            client_name: "Claude",
            redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
            grant_types: ["authorization_code", "refresh_token"],
            response_types: ["code"],
            token_endpoint_auth_method: "none"
        }
    });
    expect(registered.status()).toBe(201);
    const { client_id: clientId } = await registered.json() as { client_id: string };

    const query = new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: "https://claude.ai/api/mcp/auth_callback",
        scope: "openid profile email offline_access",
        state: "e2e",
        // Any S256 challenge: the flow stops before the code is exchanged.
        code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
        code_challenge_method: "S256",
        resource: `${baseURL}/api/mcp`
    });
    await page.goto(`/api/auth/oauth2/authorize?${query}`);

    await expect(page).toHaveURL(/\/sign-in\?.*client_id=/);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue with GitHub" })).toBeVisible();
});

test("the app asks for sign-in, and says when GitHub refused the account", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/sign-in/);

    await page.goto("/sign-in?error=unable_to_get_user_info");
    await expect(page.getByRole("alert")).toHaveText("This GitHub account is not allowed here.");
});
