import { Inject, Injectable } from "@nestjs/common";
import { parseTarGzip } from "nanotar";

import { AppConfig, issueRepos } from "../config/app-config.js";
import { GitHubClient, type FetchLike } from "./github.js";
import {
    captureMarkdown,
    datedPath,
    inboxPath,
    noteTitle,
    searchNotes,
    stripFrontmatter,
    titleFrom,
    type Capture,
    type Note,
    type SearchHit
} from "./notes.js";

export class NotConfiguredError extends Error {
    constructor (what: string) {
        super(`${what} is not configured on this server.`);
        this.name = "NotConfiguredError";
    }
}

export class NoteNotFoundError extends Error {
    constructor (path: string) {
        super(`No note at "${path}".`);
        this.name = "NoteNotFoundError";
    }
}

export class RepoNotAllowedError extends Error {
    constructor (repo: string, allowed: string[]) {
        super(`Issues can only be filed on: ${allowed.join(", ") || "(none configured)"}. Not on "${repo}".`);
        this.name = "RepoNotAllowedError";
    }
}

/** A note is read whole up to this; longer ones are cut, saying so. */
const READ_LIMIT = 20_000;
/** How long the branch head is trusted before asking GitHub again. */
const HEAD_TTL_MS = 15_000;

interface Snapshot {
    sha: string
    notes: Note[]
}

/**
 * The vault as the connector sees it: GitHub is the truth. Writes go through
 * the contents API (one commit per capture); reads come from a tarball of the
 * branch head, parsed once per commit and kept in memory.
 */
@Injectable()
export class VaultService {
    private snapshot?: Snapshot;
    private headCheckedAt = 0;
    private loading?: Promise<Snapshot>;

    constructor (
        @Inject(AppConfig) private readonly config: AppConfig,
        // Tests pass a fake GitHub; production uses fetch.
        private readonly fetchImpl: FetchLike = fetch,
        private readonly now: () => Date = () => new Date()
    ) {}

    get configured (): boolean {
        const { VAULT_REPO, VAULT_TOKEN } = this.config.env;
        return Boolean(VAULT_REPO && VAULT_TOKEN);
    }

    /** One new inbox file per capture; an existing name gets " (2)", " (3)"… */
    async capture (capture: Capture): Promise<{ path: string; url: string; title: string }> {
        const at = this.now();
        const title = titleFrom(capture);
        const content = captureMarkdown(capture, title, at, this.config.env.VAULT_TIMEZONE);
        const saved = await this.createUnique(attempt => inboxPath(title, at, this.config.env.VAULT_TIMEZONE, attempt), content, `Capture: ${title}`);
        return { ...saved, title };
    }

    /**
     * A file in Attachments/, named like the inbox (`2026-11-11 0942 voice.ogg`),
     * never overwriting. Answers its path, for an `![[embed]]`.
     */
    async saveAttachment (name: string, bytes: Uint8Array): Promise<string> {
        const at = this.now();
        const dot = name.lastIndexOf(".");
        const [stem, extension] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
        const saved = await this.createUnique(attempt => datedPath("Attachments", stem, at, this.config.env.VAULT_TIMEZONE, attempt, extension), bytes, `Attachment: ${name}`);
        return saved.path;
    }

    /** Creates a note at a fixed path unless one is there. */
    async createNote (path: string, content: string, message: string): Promise<{ created: boolean; url?: string }> {
        const { repo, branch, client } = this.vault();
        const result = await client.createFile(repo, { path, content, branch, message });
        if (!result.created) {
            return { created: false };
        }
        this.headCheckedAt = 0;
        return { created: true, url: result.htmlUrl };
    }

    /** Adds Markdown at the end of a note, re-reading it if it changed meanwhile. */
    async append (path: string, markdown: string, message: string): Promise<void> {
        const { repo, branch, client } = this.vault();
        for (let attempt = 1; attempt <= 3; attempt++) {
            const file = await client.getFile(repo, path, branch);
            if (!file) {
                throw new NoteNotFoundError(path);
            }
            const content = `${file.content.replace(/\s*$/, "")}\n\n${markdown.trim()}\n`;
            if (await client.updateFile(repo, { path, content, sha: file.sha, message, branch })) {
                this.headCheckedAt = 0;
                return;
            }
        }
        throw new Error(`"${path}" kept changing; the addition was not saved.`);
    }

    /** Every note under a folder, from the branch head. */
    async notesUnder (folder: string): Promise<Note[]> {
        const { notes } = await this.load();
        const prefix = folder.endsWith("/") ? folder : `${folder}/`;
        return notes.filter(note => note.path.startsWith(prefix));
    }

    private async createUnique (pathFor: (attempt: number) => string, content: string | Uint8Array, message: string): Promise<{ path: string; url: string }> {
        const { repo, branch, client } = this.vault();
        for (let attempt = 1; attempt <= 5; attempt++) {
            const path = pathFor(attempt);
            const result = await client.createFile(repo, { path, content, branch, message });
            if (result.created) {
                // The next read must see it.
                this.headCheckedAt = 0;
                return { path, url: result.htmlUrl };
            }
        }
        throw new Error(`Could not find a free file name for "${pathFor(1)}".`);
    }

    async search (query: string, limit?: number): Promise<SearchHit[]> {
        const { notes } = await this.load();
        return searchNotes(notes, query, limit);
    }

    async read (path: string): Promise<{ path: string; title: string; content: string; truncated: boolean }> {
        const { notes } = await this.load();
        const wanted = path.replace(/^\/+/, "");
        const note = notes.find(candidate => candidate.path === wanted)
            ?? notes.find(candidate => candidate.path === `${wanted}.md`);
        if (!note) {
            throw new NoteNotFoundError(path);
        }
        const truncated = note.content.length > READ_LIMIT;
        return { path: note.path, title: noteTitle(note), content: truncated ? note.content.slice(0, READ_LIMIT) : note.content, truncated };
    }

    /** What waits in the inbox, oldest first (the names start with the date). */
    async inbox (): Promise<{ path: string; title: string; preview: string }[]> {
        const { notes } = await this.load();
        return notes
            .filter(note => note.path.startsWith("Inbox/"))
            .sort((a, b) => a.path.localeCompare(b.path))
            .map(note => ({
                path: note.path,
                title: noteTitle(note),
                preview: stripFrontmatter(note.content).replace(/^#.*$/m, "").replace(/\s+/g, " ").trim().slice(0, 160)
            }));
    }

    /** Files an issue on one of ISSUE_REPOS. Never labels it: Atlas builds `ready`. */
    async fileIssue (input: { repo: string; title: string; body: string }): Promise<{ number: number; url: string }> {
        const { ISSUE_TOKEN } = this.config.env;
        const allowed = issueRepos(this.config.env);
        if (!ISSUE_TOKEN || allowed.length === 0) {
            throw new NotConfiguredError("Filing issues");
        }
        const repo = allowed.find(candidate => candidate.toLowerCase() === input.repo.trim().toLowerCase());
        if (!repo) {
            throw new RepoNotAllowedError(input.repo, allowed);
        }
        const body = `${input.body.trim()}\n\n---\n_Filed from Claude through the vault connector._\n`;
        const issue = await new GitHubClient(ISSUE_TOKEN, this.fetchImpl).createIssue(repo, { title: input.title.trim(), body });
        return { number: issue.number, url: issue.htmlUrl };
    }

    private vault () {
        const { VAULT_REPO, VAULT_TOKEN, VAULT_BRANCH } = this.config.env;
        if (!VAULT_REPO || !VAULT_TOKEN) {
            throw new NotConfiguredError("The vault");
        }
        return { repo: VAULT_REPO, branch: VAULT_BRANCH, client: new GitHubClient(VAULT_TOKEN, this.fetchImpl) };
    }

    /** The parsed branch head; one tarball per commit, shared by concurrent calls. */
    private async load (): Promise<Snapshot> {
        if (this.snapshot && this.now().getTime() - this.headCheckedAt < HEAD_TTL_MS) {
            return this.snapshot;
        }
        this.loading ??= this.refresh().finally(() => {
            this.loading = undefined;
        });
        return await this.loading;
    }

    private async refresh (): Promise<Snapshot> {
        const { repo, branch, client } = this.vault();
        const sha = await client.branchSha(repo, branch);
        this.headCheckedAt = this.now().getTime();
        if (this.snapshot?.sha === sha) {
            return this.snapshot;
        }
        const items = await parseTarGzip(await client.tarball(repo, sha));
        const notes: Note[] = [];
        for (const item of items) {
            // "Owner-repo-sha/Notes/x.md" → "Notes/x.md"; skip hidden folders.
            const path = item.name.split("/").slice(1).join("/");
            if (!path.endsWith(".md") || path.split("/").some(segment => segment.startsWith("."))) {
                continue;
            }
            notes.push({ path, content: item.text });
        }
        this.snapshot = { sha, notes };
        return this.snapshot;
    }
}
