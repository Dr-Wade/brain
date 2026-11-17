import { Inject, Injectable } from "@nestjs/common";

import { AppConfig, issueRepos } from "../config/app-config.js";
import {
    appendText,
    applyEdits,
    assertDeletable,
    assertMovable,
    assertWritable,
    fileName,
    findNote,
    isTaken,
    listFolder,
    noteFrontmatter,
    notePath,
    openTasks,
    relink,
    withFrontmatter,
    type Edit,
    type FolderListing
} from "./editing.js";
import { NotConfiguredError, RepoNotAllowedError, VaultRuleError } from "./errors.js";
import { encodePath, GitHubClient, type FetchLike, type FileChange } from "./github.js";
import {
    captureMarkdown,
    datedPath,
    inboxPath,
    noteTitle,
    searchNotes,
    stripFrontmatter,
    titleFrom,
    zonedParts,
    type Capture,
    type Note,
    type SearchHit
} from "./notes.js";
import { readTarGz } from "./tar.js";

export { EditMismatchError, NoteNotFoundError, NotConfiguredError, RepoNotAllowedError, VaultError, VaultRuleError } from "./errors.js";

/** A note is read whole up to this; longer ones are cut, saying so. */
const READ_LIMIT = 20_000;
/** How long the branch head is trusted before asking GitHub again. */
const HEAD_TTL_MS = 15_000;

interface Snapshot {
    /** The commit, and its tree (the base of the next commit). */
    sha: string
    tree: string
    notes: Note[]
    /** Every folder holding a file, Markdown or not ("Projects" with only its .gitkeep). */
    folders: Set<string>
}

/** What a change computed from the head commits, and what it answers. */
interface Change<T> {
    message: string
    files: FileChange[]
    result: T
}

/**
 * The vault as the connector sees it: GitHub is the truth. Captures go through
 * the contents API (create only, one commit each); changes to existing notes
 * are computed from the branch head and committed on top of it through the Git
 * Data API, starting again if someone committed meanwhile. Reads come from a
 * tarball of the branch head, parsed once per commit and kept in memory.
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

    /**
     * Adds Markdown at the end of a note, or at the end of one of its sections.
     * Computed from the head at the time of saving, so nothing written meanwhile is lost.
     */
    async append (path: string, markdown: string, options: { heading?: string; message?: string } = {}): Promise<{ path: string }> {
        return await this.commit(({ notes }) => {
            const note = findNote(notes, path);
            assertWritable(note.path);
            return {
                message: options.message ?? `Add to ${fileName(note.path)}`,
                files: [{ path: note.path, content: appendText(note.content, markdown, options.heading) }],
                result: { path: note.path }
            };
        });
    }

    /** A new note at a path, with the vault's frontmatter when it has none. Never overwrites. */
    async addNote (path: string, content: string): Promise<{ path: string; url: string }> {
        const target = notePath(path);
        assertWritable(target);
        return await this.commit(({ notes }) => {
            if (isTaken(notes, target)) {
                throw new VaultRuleError(`There is already a note at "${target}". Read it and edit it, or pick another name.`);
            }
            return {
                message: `Note: ${fileName(target)}`,
                files: [{ path: target, content: withFrontmatter(content, this.today()) }],
                result: { path: target, url: this.url(target) }
            };
        });
    }

    /** Replaces passages of a note, each found exactly once: all the edits, or none. */
    async edit (path: string, edits: Edit[]): Promise<{ path: string; changed: boolean }> {
        return await this.commit(({ notes }) => {
            const note = findNote(notes, path);
            assertWritable(note.path);
            const content = applyEdits(note.content, edits);
            return {
                message: `Edit: ${fileName(note.path)}`,
                files: content === note.content ? [] : [{ path: note.path, content }],
                result: { path: note.path, changed: content !== note.content }
            };
        });
    }

    /**
     * Moves or renames a note, in one commit with the wikilinks that pointed at
     * it. Leaving the inbox, its frontmatter becomes a note's.
     */
    async move (path: string, to: string): Promise<{ from: string; to: string; relinked: string[] }> {
        return await this.commit(({ notes, folders }) => {
            const note = findNote(notes, path);
            assertMovable(note.path);
            const target = destination(folders, note.path, to);
            assertWritable(target);
            if (target === note.path) {
                throw new VaultRuleError(`"${note.path}" is already there.`);
            }
            const rest = notes.filter(other => other.path !== note.path);
            if (isTaken(rest, target)) {
                throw new VaultRuleError(`There is already a note at "${target}". Pick another name.`);
            }
            const leavingInbox = note.path.startsWith("Inbox/") && !target.startsWith("Inbox/");
            const moved = { path: target, content: leavingInbox ? noteFrontmatter(note.content, this.today()) : note.content };
            const relinked = relink([...rest, moved], note.path, target);
            const others = relinked.filter(other => other.path !== target);
            return {
                message: `Move: ${note.path} → ${target}`,
                files: [
                    { path: target, content: relinked.find(other => other.path === target)?.content ?? moved.content },
                    { path: note.path, content: null },
                    ...others
                ],
                result: { from: note.path, to: target, relinked: others.map(other => other.path) }
            };
        });
    }

    /** Deletes an inbox note. Git history keeps it. */
    async remove (path: string): Promise<{ path: string }> {
        return await this.commit(({ notes }) => {
            const note = findNote(notes, path);
            assertDeletable(note.path);
            return { message: `Delete: ${fileName(note.path)}`, files: [{ path: note.path, content: null }], result: { path: note.path } };
        });
    }

    /** The notes and subfolders of one folder ("" for the top). */
    async list (folder?: string): Promise<FolderListing> {
        const { notes, folders } = await this.load();
        return listFolder(notes, folders, folder);
    }

    /** Unticked tasks by note, across the vault or one folder. */
    async tasks (folder?: string): Promise<{ path: string; title: string; tasks: string[] }[]> {
        const { notes } = await this.load();
        return openTasks(notes, folder);
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
        const note = findNote(notes, path);
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

    /**
     * One commit computed from the branch head: `change` gets the head's notes
     * and answers the files to write. If the branch moved meanwhile (Obsidian,
     * the Mac mini, another capture), it starts again from the new head.
     */
    private async commit<T> (change: (snapshot: Snapshot) => Change<T>): Promise<T> {
        const { repo, branch, client } = this.vault();
        for (let attempt = 1; attempt <= 3; attempt++) {
            const snapshot = await this.load(true);
            const { message, files, result } = change(snapshot);
            if (files.length === 0) {
                return result;
            }
            const committed = await client.commitFiles(repo, { branch, parent: snapshot.sha, baseTree: snapshot.tree, message, files });
            if (committed) {
                // Our own commit: the snapshot follows it without a new tarball.
                this.snapshot = { ...committed, ...applyFiles(snapshot, files) };
                this.headCheckedAt = this.now().getTime();
                return result;
            }
        }
        throw new Error("The vault kept changing while saving; nothing was saved.");
    }

    private today (): string {
        return zonedParts(this.now(), this.config.env.VAULT_TIMEZONE).date;
    }

    private url (path: string): string {
        return `https://github.com/${this.config.env.VAULT_REPO}/blob/${encodePath(this.config.env.VAULT_BRANCH)}/${encodePath(path)}`;
    }

    /**
     * The parsed branch head; one tarball per commit, shared by concurrent
     * calls. `fresh` asks GitHub for the head even within the TTL.
     */
    private async load (fresh = false): Promise<Snapshot> {
        if (!fresh && this.snapshot && this.now().getTime() - this.headCheckedAt < HEAD_TTL_MS) {
            return this.snapshot;
        }
        this.loading ??= this.refresh().finally(() => {
            this.loading = undefined;
        });
        return await this.loading;
    }

    private async refresh (): Promise<Snapshot> {
        const { repo, branch, client } = this.vault();
        const head = await client.branchHead(repo, branch);
        this.headCheckedAt = this.now().getTime();
        if (this.snapshot?.sha === head.sha) {
            return this.snapshot;
        }
        const decoder = new TextDecoder();
        const notes: Note[] = [];
        const folders = new Set<string>();
        for (const file of readTarGz(await client.tarball(repo, head.sha))) {
            // "Owner-repo-sha/Notes/x.md" → "Notes/x.md"; hidden folders left out.
            const path = file.path.split("/").slice(1).join("/");
            if (!path || path.split("/").some(segment => segment.startsWith(".") && segment !== ".gitkeep")) {
                continue;
            }
            addFolders(folders, path);
            if (path.endsWith(".md")) {
                notes.push({ path, content: decoder.decode(file.bytes) });
            }
        }
        this.snapshot = { ...head, notes, folders };
        return this.snapshot;
    }
}

/** Every folder above a path: "A/B/c.md" → "A", "A/B". */
function addFolders (folders: Set<string>, path: string): void {
    const segments = path.split("/").slice(0, -1);
    for (let depth = 1; depth <= segments.length; depth++) {
        folders.add(segments.slice(0, depth).join("/"));
    }
}

/** The snapshot's notes and folders once the files are written. */
function applyFiles (snapshot: Snapshot, files: FileChange[]): Pick<Snapshot, "notes" | "folders"> {
    const notes = new Map(snapshot.notes.map(note => [note.path, note]));
    const folders = new Set(snapshot.folders);
    for (const file of files) {
        if (file.content === null) {
            notes.delete(file.path);
        } else {
            notes.set(file.path, { path: file.path, content: file.content });
            addFolders(folders, file.path);
        }
    }
    return { notes: [...notes.values()], folders };
}

/** "Notes/", or the name of an existing folder, keeps the file name; anything else is the new path. */
function destination (folders: Set<string>, from: string, to: string): string {
    const asked = to.trim().replace(/^\/+/, "");
    const folder = asked.replace(/\/+$/, "");
    const known = [...folders].find(candidate => candidate.toLowerCase() === folder.toLowerCase());
    if (asked.endsWith("/") || (known && !/\.md$/i.test(asked))) {
        return notePath(`${known ?? folder}/${fileName(from)}.md`);
    }
    return notePath(asked);
}
