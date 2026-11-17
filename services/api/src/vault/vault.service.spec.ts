import { describe, expect, it } from "vitest";

import { AppConfig } from "../config/app-config.js";
import { isAllowedGithubAccount } from "../auth/auth.module.js";
import { githubTarball } from "./github-tarball.fixture.js";
import { EditMismatchError, NoteNotFoundError, NotConfiguredError, RepoNotAllowedError, VaultRuleError, VaultService } from "./vault.service.js";

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

/**
 * A GitHub holding one vault branch in memory, the way the connector uses it:
 * branch head, tarball, contents API, and commits through the Git Data API
 * (a ref update that is not a fast-forward is refused). Records every call.
 */
function fakeGitHub (initial: Record<string, string>, options: { taken?: string[] } = {}) {
    const files = new Map(Object.entries(initial));
    const calls: Call[] = [];
    let counter = 1;
    let head = { sha: "c1", tree: "t1" };
    const trees = new Map<string, { base: string; entries: { path: string; content?: string; sha?: null }[] }>();
    const commits = new Map<string, { tree: string; parent: string }>();
    const tarballs = new Map<string, Uint8Array>();
    const advance = () => {
        counter++;
        head = { sha: `c${counter}`, tree: `t${counter}` };
    };
    /** Someone else commits meanwhile: Obsidian on the laptop, the Mac mini. */
    const push = (changes: Record<string, string | null>) => {
        for (const [path, content] of Object.entries(changes)) {
            if (content === null) {
                files.delete(path);
            } else {
                files.set(path, content);
            }
        }
        advance();
    };
    let beforeRefUpdate: (() => void) | undefined;

    const fetchImpl = async (url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        const headers = new Headers(init?.headers);
        const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : undefined;
        calls.push({ method, url, auth: headers.get("authorization"), body });
        const path = decodeURIComponent(new URL(url).pathname);
        const repo = "/repos/Dr-Wade/vault";
        if (path === `${repo}/branches/main`) {
            return Response.json({ commit: { sha: head.sha, commit: { tree: { sha: head.tree } } } });
        }
        if (path.startsWith(`${repo}/tarball/`)) {
            const tarball = tarballs.get(head.sha) ?? githubTarball(Object.fromEntries(files));
            tarballs.set(head.sha, tarball);
            return new Response(tarball);
        }
        if (method === "PUT" && path.startsWith(`${repo}/contents/`)) {
            const filePath = path.slice(`${repo}/contents/`.length);
            if (files.has(filePath) || options.taken?.includes(filePath)) {
                return Response.json({ message: "sha wasn't supplied" }, { status: 422 });
            }
            push({ [filePath]: Buffer.from(String(body!.content), "base64").toString("utf8") });
            return Response.json({ content: { html_url: `https://github.com/Dr-Wade/vault/blob/main/${filePath}` } }, { status: 201 });
        }
        if (method === "POST" && path === `${repo}/git/trees`) {
            const id = `tree-${trees.size + 1}`;
            trees.set(id, { base: String(body!.base_tree), entries: body!.tree as { path: string; content?: string; sha?: null }[] });
            return Response.json({ sha: id }, { status: 201 });
        }
        if (method === "POST" && path === `${repo}/git/commits`) {
            const id = `commit-${commits.size + 1}`;
            commits.set(id, { tree: String(body!.tree), parent: (body!.parents as string[])[0]! });
            return Response.json({ sha: id }, { status: 201 });
        }
        if (method === "PATCH" && path === `${repo}/git/refs/heads/main`) {
            beforeRefUpdate?.();
            beforeRefUpdate = undefined;
            const commit = commits.get(String(body!.sha))!;
            if (commit.parent !== head.sha || body!.force !== false) {
                return Response.json({ message: "Update is not a fast forward" }, { status: 422 });
            }
            const tree = trees.get(commit.tree)!;
            expect(tree.base).toBe(head.tree);
            for (const entry of tree.entries) {
                if (entry.sha === null) {
                    expect(files.has(entry.path)).toBe(true);
                    files.delete(entry.path);
                } else {
                    files.set(entry.path, entry.content!);
                }
            }
            head = { sha: String(body!.sha), tree: commit.tree };
            return Response.json({ object: { sha: head.sha } });
        }
        if (method === "POST" && path.endsWith("/issues")) {
            return Response.json({ number: 42, html_url: `https://github.com${path.replace("/repos", "")}/42` }, { status: 201 });
        }
        return Response.json({ message: "Not Found" }, { status: 404 });
    };
    return {
        calls,
        files,
        fetchImpl,
        push,
        /** Runs just before the next ref update reaches the branch. */
        racing: (run: () => void) => {
            beforeRefUpdate = run;
        },
        commitsMade: () => commits.size
    };
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
        expect(tarballs()).toBe(2);
        // The connector's own commit: the snapshot follows it, no new tarball.
        await subject.edit("Notes/Paiements.md", [{ find: "Suivi", replace: "Le suivi" }]);
        expect(await subject.search("suivi")).toHaveLength(1);
        expect(tarballs()).toBe(2);
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

const notes = {
    "Home.md": "# Home\n\nSee [[Paiements]] and [[Inbox/2026-11-16 1831 To-do]].",
    "CA/Agenda.md": "# CA agenda\n\n## 26 novembre\n\n- Budget 2027\n- Cotisations\n\n## Later\n\n- Statuts\n",
    "Inbox/2026-11-16 1831 To-do pour demain (17 novembre 2026) avec une longue note.md": "---\ncaptured: 2026-11-16T18:31+01:00\nsource: claude\nsuggested: note\ntags: [idea]\n---\n# To-do pour demain\n\n- Faire la facturation\n- Contrôler la facturation manquante pour même\n",
    "Inbox/2026-11-16 1831 To-do.md": "# To-do\n\n- [ ] Appeler Marc\n",
    "Inbox/Prix Licence.md": "14,56€ / mois pour Business Standard",
    "Notes/Paiements.md": "---\ncreated: 2026-11-11\ntags: []\n---\n# Paiements\n\nSuivi des paiements des événements.\n\n- [ ] Relancer le trésorier\n- [x] Lister les impayés\n",
    "Meetings/2026-11-16 1000 Ådalen status.md": "# Ådalen status\n\n## To prepare\n\n- [x] Summary\n- [ ] What I want out of it\n\n## Decisions\n\n## Actions\n",
    "Archive/Notion/Old page.md": "# Old page\n\n- [ ] Ancient task\n",
    "Templates/Meeting.md": "## Actions\n\n- [ ] \n- [ ] Who: what\n",
    "Projects/.gitkeep": ""
};
const LONG = "Inbox/2026-11-16 1831 To-do pour demain (17 novembre 2026) avec une longue note.md";

describe("VaultService, changing notes", () => {
    it("sees notes whose paths are too long for a plain tar header", async () => {
        const subject = service(fakeGitHub(notes));
        expect((await subject.inbox()).map(item => item.path)).toContain(LONG);
        expect((await subject.read(LONG)).title).toBe("To-do pour demain");
    });

    it("reads a note by its title when no path matches, and says when several do", async () => {
        const subject = service(fakeGitHub(notes));
        expect((await subject.read("paiements")).path).toBe("Notes/Paiements.md");
        expect((await subject.read("Prix licence")).path).toBe("Inbox/Prix Licence.md");
        await expect(subject.read("To-do")).resolves.toMatchObject({ path: "Inbox/2026-11-16 1831 To-do.md" });
        const twice = fakeGitHub({ "Notes/Budget.md": "# A", "Projects/Budget.md": "# B" });
        await expect(service(twice).read("Budget")).rejects.toThrow(/Several notes match: Notes\/Budget.md, Projects\/Budget.md/);
    });

    it("edits passages found once, in one commit on top of the head", async () => {
        const github = fakeGitHub(notes);
        const saved = await service(github).edit(LONG, [
            { find: "pour même", replace: "pour Memento IT" },
            { find: "- Faire la facturation", replace: "- [ ] Faire la facturation" }
        ]);
        expect(saved).toEqual({ path: LONG, changed: true });
        expect(github.files.get(LONG)).toContain("- [ ] Faire la facturation\n- Contrôler la facturation manquante pour Memento IT\n");
        expect(github.commitsMade()).toBe(1);
        const commit = github.calls.find(call => call.url.endsWith("/git/commits"))!;
        expect(commit.body).toMatchObject({ message: "Edit: 2026-11-16 1831 To-do pour demain (17 novembre 2026) avec une longue note", parents: ["c1"] });
    });

    it("refuses an edit whose passage is missing or ambiguous, saving none of the edits", async () => {
        const github = fakeGitHub(notes);
        const subject = service(github);
        await expect(subject.edit("Notes/Paiements.md", [{ find: "Suivi", replace: "X" }, { find: "absent", replace: "Y" }])).rejects.toThrow(/Edit 2: the text to find is not in the note/);
        await expect(subject.edit("Notes/Paiements.md", [{ find: "- [", replace: "* [" }])).rejects.toBeInstanceOf(EditMismatchError);
        expect(github.commitsMade()).toBe(0);
        expect(github.files.get("Notes/Paiements.md")).toBe(notes["Notes/Paiements.md"]);
    });

    it("finds a passage whose spaces differ, like a French non-breaking space", async () => {
        const github = fakeGitHub({ "Notes/Prix.md": "Prix\u202f: 14,56\u00a0€\npar mois" });
        await service(github).edit("Notes/Prix.md", [{ find: "Prix : 14,56 € par mois", replace: "Prix : 15 € par mois" }]);
        expect(github.files.get("Notes/Prix.md")).toBe("Prix : 15 € par mois");
    });

    it("starts again from the new head when someone committed meanwhile, keeping their change", async () => {
        const github = fakeGitHub(notes);
        const subject = service(github);
        await subject.read("Home.md");
        github.racing(() => github.push({ "Notes/Paiements.md": `${notes["Notes/Paiements.md"]}\nAjouté sur le portable.\n` }));
        await subject.append("Notes/Paiements.md", "- [ ] Envoyer le récapitulatif");
        const content = github.files.get("Notes/Paiements.md")!;
        expect(content).toContain("Ajouté sur le portable.");
        expect(content).toMatch(/Ajouté sur le portable\.\n\n- \[ \] Envoyer le récapitulatif\n$/);
        expect(github.commitsMade()).toBe(2);
    });

    it("adds to the end of a section, joining its list", async () => {
        const github = fakeGitHub(notes);
        const subject = service(github);
        await subject.append("CA/Agenda.md", "- Late fees des conférences", { heading: "26 novembre" });
        expect(github.files.get("CA/Agenda.md")).toBe("# CA agenda\n\n## 26 novembre\n\n- Budget 2027\n- Cotisations\n- Late fees des conférences\n\n## Later\n\n- Statuts\n");
        await subject.append("Meetings/2026-11-16 1000 Ådalen status.md", "- [ ] Alexander: send the warranty list, by Friday", { heading: "actions" });
        await subject.append("Meetings/2026-11-16 1000 Ådalen status.md", "Currency stays NOK.", { heading: "Decisions" });
        expect(github.files.get("Meetings/2026-11-16 1000 Ådalen status.md")).toBe("# Ådalen status\n\n## To prepare\n\n- [x] Summary\n- [ ] What I want out of it\n\n## Decisions\n\nCurrency stays NOK.\n\n## Actions\n\n- [ ] Alexander: send the warranty list, by Friday\n");
        await expect(subject.append("CA/Agenda.md", "x", { heading: "Décembre" })).rejects.toThrow("No heading \"Décembre\" in the note. Its headings: CA agenda, 26 novembre, Later.");
    });

    it("creates a note with the vault's frontmatter, never over another one", async () => {
        const github = fakeGitHub(notes);
        const subject = service(github);
        const created = await subject.addNote("Projects/AG 2027/Vote", "# Vote\n\nModule de vote pour l'AG.");
        expect(created).toEqual({ path: "Projects/AG 2027/Vote.md", url: "https://github.com/Dr-Wade/vault/blob/main/Projects/AG%202027/Vote.md" });
        expect(github.files.get("Projects/AG 2027/Vote.md")).toBe("---\ncreated: 2026-11-11\ntags: []\n---\n# Vote\n\nModule de vote pour l'AG.\n");
        await expect(subject.addNote("notes/paiements.md", "x")).rejects.toThrow(/already a note at "notes\/paiements.md"/);
        expect((await subject.list("Projects")).folders).toEqual([{ path: "Projects/AG 2027", notes: 1 }]);
    });

    it("keeps writes inside the vault's rules", async () => {
        const github = fakeGitHub(notes);
        const subject = service(github);
        await expect(subject.addNote("../outside.md", "x")).rejects.toBeInstanceOf(VaultRuleError);
        await expect(subject.addNote(".obsidian/app.md", "x")).rejects.toBeInstanceOf(VaultRuleError);
        await expect(subject.addNote(".github/workflows/x", "x")).rejects.toBeInstanceOf(VaultRuleError);
        await expect(subject.addNote("Notes/A: B", "x")).rejects.toBeInstanceOf(VaultRuleError);
        await expect(subject.edit("Archive/Notion/Old page.md", [{ find: "Old", replace: "New" }])).rejects.toThrow(/Archive\/Notion\/ is read-only/);
        await expect(subject.move("Meetings/2026-11-16 1000 Ådalen status.md", "Notes/")).rejects.toThrow(/Meeting notes stay where they are/);
        await expect(subject.remove("Notes/Paiements.md")).rejects.toThrow(/Only inbox notes are deleted/);
        await expect(subject.move("Notes/Paiements.md", "Archive/Notion/")).rejects.toBeInstanceOf(VaultRuleError);
        expect(github.commitsMade()).toBe(0);
    });

    it("moves a capture out of the inbox: a note's frontmatter, its links following", async () => {
        const github = fakeGitHub(notes);
        const moved = await service(github).move("Inbox/2026-11-16 1831 To-do.md", "Notes/");
        expect(moved).toEqual({ from: "Inbox/2026-11-16 1831 To-do.md", to: "Notes/2026-11-16 1831 To-do.md", relinked: ["Home.md"] });
        expect(github.files.has("Inbox/2026-11-16 1831 To-do.md")).toBe(false);
        expect(github.files.get("Notes/2026-11-16 1831 To-do.md")).toBe("---\ncreated: 2026-11-11\ntags: []\n---\n# To-do\n\n- [ ] Appeler Marc\n");
        // A link by path follows; a link by name still finds the note.
        expect(github.files.get("Home.md")).toBe("# Home\n\nSee [[Paiements]] and [[Notes/2026-11-16 1831 To-do]].");
        expect(github.commitsMade()).toBe(1);
    });

    it("renames a note, rewriting the links by name, aliases and headings kept", async () => {
        const github = fakeGitHub({
            ...notes,
            "Notes/Cotisations.md": "Voir [[paiements#Relances|les relances]], ![[Paiements]] et [[Paiementsx]]."
        });
        const moved = await service(github).move("Paiements", "Notes/Paiements des événements");
        expect(moved.relinked).toEqual(["Home.md", "Notes/Cotisations.md"]);
        expect(github.files.get("Notes/Cotisations.md")).toBe("Voir [[Paiements des événements#Relances|les relances]], ![[Paiements des événements]] et [[Paiementsx]].");
        expect(github.files.get("Notes/Paiements des événements.md")).toBe(notes["Notes/Paiements.md"]);
    });

    it("deletes inbox notes only", async () => {
        const github = fakeGitHub(notes);
        const subject = service(github);
        expect(await subject.remove("Prix Licence")).toEqual({ path: "Inbox/Prix Licence.md" });
        expect(github.files.has("Inbox/Prix Licence.md")).toBe(false);
        await expect(subject.read("Inbox/Prix Licence.md")).rejects.toBeInstanceOf(NoteNotFoundError);
    });

    it("lists a folder's notes and subfolders, empty ones included", async () => {
        const subject = service(fakeGitHub(notes));
        const top = await subject.list();
        expect(top.notes).toEqual([{ path: "Home.md", title: "Home" }]);
        expect(top.folders.map(folder => `${folder.path}:${folder.notes}`)).toEqual(["Archive:1", "CA:1", "Inbox:3", "Meetings:1", "Notes:1", "Projects:0", "Templates:1"]);
        expect((await subject.list("archive/")).folders).toEqual([{ path: "Archive/Notion", notes: 1 }]);
        await expect(subject.list("Nowhere")).rejects.toThrow(/No folder "Nowhere". Top-level folders: Archive, CA, Inbox, Meetings, Notes, Projects, Templates./);
    });

    it("lists open tasks by note, templates and the archive aside", async () => {
        const subject = service(fakeGitHub(notes));
        expect(await subject.tasks()).toEqual([
            { path: "Inbox/2026-11-16 1831 To-do.md", title: "To-do", tasks: ["Appeler Marc"] },
            { path: "Meetings/2026-11-16 1000 Ådalen status.md", title: "Ådalen status", tasks: ["What I want out of it"] },
            { path: "Notes/Paiements.md", title: "Paiements", tasks: ["Relancer le trésorier"] }
        ]);
        expect((await subject.tasks("Archive")).map(note => note.tasks)).toEqual([["Ancient task"]]);
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
