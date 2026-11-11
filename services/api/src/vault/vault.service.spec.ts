import { createTarGzip } from "nanotar";
import { describe, expect, it } from "vitest";

import { AppConfig } from "../config/app-config.js";
import { isAllowedGithubAccount } from "../auth/auth.module.js";
import { NoteNotFoundError, NotConfiguredError, RepoNotAllowedError, VaultService } from "./vault.service.js";

const env = {
    DATABASE_URL: "postgresql://unused@localhost/unused",
    VAULT_REPO: "Dr-Wade/vault",
    VAULT_TOKEN: "vault-token",
    VAULT_TIMEZONE: "Europe/Paris",
    ISSUE_REPOS: "bcc-nancy/members, Dr-Wade/brain",
    ISSUE_TOKEN: "issue-token"
};

interface Call {
    method: string
    url: string
    auth: string | null
    body?: unknown
}

/** A GitHub that holds a vault tarball and records every call. */
function fakeGitHub (files: Record<string, string>, options: { taken?: string[]; sha?: () => string } = {}) {
    const calls: Call[] = [];
    let created = 0;
    const fetchImpl = async (url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        const headers = new Headers(init?.headers);
        const body = typeof init?.body === "string" ? JSON.parse(init.body) as unknown : undefined;
        calls.push({ method, url, auth: headers.get("authorization"), body });
        const path = new URL(url).pathname;
        if (path === "/repos/Dr-Wade/vault/branches/main") {
            return Response.json({ commit: { sha: options.sha?.() ?? "abc123" } });
        }
        if (path.startsWith("/repos/Dr-Wade/vault/tarball/")) {
            const tar = await createTarGzip(Object.entries(files).map(([name, data]) => ({ name: `Dr-Wade-vault-abc123/${name}`, data })));
            return new Response(tar);
        }
        if (method === "PUT" && path.startsWith("/repos/Dr-Wade/vault/contents/")) {
            const filePath = decodeURIComponent(path.slice("/repos/Dr-Wade/vault/contents/".length));
            if (options.taken?.includes(filePath)) {
                return Response.json({ message: "sha wasn't supplied" }, { status: 422 });
            }
            created++;
            return Response.json({ content: { html_url: `https://github.com/Dr-Wade/vault/blob/main/${filePath}` } }, { status: 201 });
        }
        if (method === "POST" && path.endsWith("/issues")) {
            return Response.json({ number: 42, html_url: `https://github.com${path.replace("/repos", "")}/42` }, { status: 201 });
        }
        return Response.json({ message: "Not Found" }, { status: 404 });
    };
    return { calls, fetchImpl, created: () => created };
}

const at = new Date("2026-11-11T08:42:00Z");
const service = (github: ReturnType<typeof fakeGitHub>, overrides: Record<string, string | undefined> = {}, now = () => at) =>
    new VaultService(new AppConfig({ ...env, ...overrides }), github.fetchImpl, now);

const vault = {
    "CLAUDE.md": "# Vault — agent notes",
    "Inbox/2026-11-10 0800 Older.md": "---\nsource: claude\n---\n# Older\n\nFirst idea.",
    "Inbox/2026-11-11 0900 Newer.md": "# Newer\n\nSecond idea, about payments.",
    "Notes/Paiements.md": "# Paiements\n\nSuivi des paiements des événements.",
    ".obsidian/app.json": "{}",
    ".obsidian/notes.md": "# hidden",
    "Notes/image.png": "binary"
};

describe("VaultService", () => {
    it("captures one commit per idea into the inbox, with the vault token", async () => {
        const github = fakeGitHub(vault);
        const saved = await service(github).capture({ text: "Suivre les paiements", title: "Paiements CA", suggested: "ca-agenda" });
        expect(saved.path).toBe("Inbox/2026-11-11 0942 Paiements CA.md");
        const put = github.calls.find(call => call.method === "PUT")!;
        expect(put.auth).toBe("Bearer vault-token");
        expect(put.url).toContain("/contents/Inbox/2026-11-11%200942%20Paiements%20CA.md");
        const body = put.body as { message: string; content: string; branch: string };
        expect(body.message).toBe("Capture: Paiements CA");
        expect(body.branch).toBe("main");
        expect(Buffer.from(body.content, "base64").toString("utf8")).toContain("suggested: ca-agenda\n");
    });

    it("never overwrites: a taken name gets a suffix", async () => {
        const github = fakeGitHub(vault, { taken: ["Inbox/2026-11-11 0942 Idée.md"] });
        const saved = await service(github).capture({ text: "x", title: "Idée" });
        expect(saved.path).toBe("Inbox/2026-11-11 0942 Idée (2).md");
    });

    it("searches and reads the markdown of the branch head, hidden folders left out", async () => {
        const github = fakeGitHub(vault);
        const subject = service(github);
        const hits = await subject.search("paiements payments");
        expect(hits.map(hit => hit.path)).toEqual(["Notes/Paiements.md", "Inbox/2026-11-11 0900 Newer.md"]);
        expect(await subject.search("hidden")).toEqual([]);
        const note = await subject.read("Notes/Paiements");
        expect(note).toMatchObject({ path: "Notes/Paiements.md", title: "Paiements", truncated: false });
        await expect(subject.read("Notes/Nope.md")).rejects.toBeInstanceOf(NoteNotFoundError);
    });

    it("downloads the tarball once per commit, and asks for the head again after a capture", async () => {
        const github = fakeGitHub(vault);
        const subject = service(github);
        await Promise.all([subject.search("a b"), subject.inbox(), subject.read("CLAUDE.md")]);
        await subject.search("x");
        const tarballs = () => github.calls.filter(call => call.url.includes("/tarball/")).length;
        const heads = () => github.calls.filter(call => call.url.includes("/branches/")).length;
        expect(tarballs()).toBe(1);
        expect(heads()).toBe(1);
        await subject.capture({ text: "new" });
        await subject.search("x");
        expect(heads()).toBe(2);
        // Same sha from the fake: the parsed snapshot is reused.
        expect(tarballs()).toBe(1);
    });

    it("lists the inbox oldest first, with a preview", async () => {
        const items = await service(fakeGitHub(vault)).inbox();
        expect(items).toEqual([
            { path: "Inbox/2026-11-10 0800 Older.md", title: "Older", preview: "First idea." },
            { path: "Inbox/2026-11-11 0900 Newer.md", title: "Newer", preview: "Second idea, about payments." }
        ]);
    });

    it("files issues only on the allowed repos, with the issue token and no labels", async () => {
        const github = fakeGitHub(vault);
        const subject = service(github);
        const issue = await subject.fileIssue({ repo: "BCC-Nancy/Members", title: " Track event payments ", body: "Edward: « suivre les paiements »" });
        expect(issue).toEqual({ number: 42, url: "https://github.com/bcc-nancy/members/issues/42" });
        const post = github.calls.find(call => call.method === "POST")!;
        expect(post.auth).toBe("Bearer issue-token");
        expect(post.body).toEqual({ title: "Track event payments", body: expect.stringContaining("Filed from Claude") });
        expect(Object.keys(post.body as object)).not.toContain("labels");
        await expect(subject.fileIssue({ repo: "someone/else", title: "x", body: "y" })).rejects.toBeInstanceOf(RepoNotAllowedError);
    });

    it("says what is missing instead of calling GitHub", async () => {
        const github = fakeGitHub(vault);
        const bare = service(github, { VAULT_TOKEN: undefined, ISSUE_TOKEN: undefined });
        expect(bare.configured).toBe(false);
        await expect(bare.capture({ text: "x" })).rejects.toBeInstanceOf(NotConfiguredError);
        await expect(bare.fileIssue({ repo: "bcc-nancy/members", title: "x", body: "y" })).rejects.toBeInstanceOf(NotConfiguredError);
        expect(github.calls).toEqual([]);
    });
});

describe("the GitHub allowlist", () => {
    it("lets in only the configured account, and nobody when unset", () => {
        expect(isAllowedGithubAccount(38118787, "38118787")).toBe(true);
        expect(isAllowedGithubAccount("38118787", "38118787")).toBe(true);
        expect(isAllowedGithubAccount(1, "38118787")).toBe(false);
        expect(isAllowedGithubAccount(undefined, "38118787")).toBe(false);
        expect(isAllowedGithubAccount(38118787, undefined)).toBe(false);
    });
});
