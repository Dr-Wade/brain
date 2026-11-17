/**
 * Pure helpers for changing notes: which paths may be written, finding a
 * note, applying edits, adding to a section, moving out of the inbox and
 * keeping wikilinks right. No I/O here; `VaultService` commits the result.
 */
import { EditMismatchError, NoteNotFoundError, VaultError, VaultRuleError } from "./errors.js";
import { fold, noteTitle, type Note } from "./notes.js";

/** Read, never changed: the Notion import. A page leaves it by moving to Notes/. */
const READ_ONLY = ["Archive/Notion/"];
/** Found by their path by the meeting pass: never moved or renamed. */
const PINNED = ["Meetings/"];
/** The weekly sort's bin: the only folder notes are deleted from. */
const DELETABLE = ["Inbox/"];
/** Characters Obsidian or Windows refuse in a file name. */
const BAD_NAME = /[\\:*?"<>|#^[\]]/;

export const MAX_NOTE_LENGTH = 200_000;

export interface Edit {
    /** A passage of the note, exactly as it is (whitespace aside), found once. */
    find: string
    /** What it becomes; empty deletes it. */
    replace: string
}

/** A Markdown path inside the vault, outside hidden folders: "Notes/Paiements" → "Notes/Paiements.md". */
export function notePath (input: string): string {
    const path = input.trim().replace(/^\/+/, "").normalize("NFC");
    const segments = path.split("/");
    if (!path || segments.some(segment => !segment || segment !== segment.trim() || segment.startsWith("."))) {
        throw new VaultRuleError(`"${input}" is not a note path: folders and a file name, like "Notes/Paiements des événements.md".`);
    }
    const bad = segments.find(segment => BAD_NAME.test(segment));
    if (bad) {
        throw new VaultRuleError(`"${bad}" has a character file names cannot hold: \\ : * ? " < > | # ^ [ ]`);
    }
    return /\.md$/i.test(path) ? path : `${path}.md`;
}

export function assertWritable (path: string): void {
    const area = READ_ONLY.find(prefix => path.startsWith(prefix));
    if (area) {
        throw new VaultRuleError(`${area} is read-only. Move the page to Notes/ first, then change it there.`);
    }
}

export function assertMovable (path: string): void {
    if (PINNED.some(prefix => path.startsWith(prefix))) {
        throw new VaultRuleError("Meeting notes stay where they are: the meeting pass finds them by their path.");
    }
}

export function assertDeletable (path: string): void {
    if (!DELETABLE.some(prefix => path.startsWith(prefix))) {
        throw new VaultRuleError(`Only inbox notes are deleted. Move "${path}" to Archive/ instead.`);
    }
}

/** The file name without ".md": what Obsidian's wikilinks point at. */
export const fileName = (path: string): string => (path.split("/").pop() ?? path).replace(/\.md$/i, "");

/** Paths compared the way Windows and macOS see them: one file whatever the case. */
const pathKey = (path: string): string => path.normalize("NFC").toLowerCase();

/** Whether a path is taken, case aside. */
export function isTaken (notes: Note[], path: string): boolean {
    const key = pathKey(path);
    return notes.some(note => pathKey(note.path) === key);
}

/**
 * A note by its path (".md" and case optional) or, failing that, by its title
 * or file name when exactly one note has it.
 */
export function findNote (notes: Note[], input: string): Note {
    const wanted = input.trim().replace(/^\/+/, "").normalize("NFC");
    const stem = pathKey(wanted.replace(/\.md$/i, ""));
    const byPath = notes.find(note => note.path === wanted)
        ?? notes.find(note => pathKey(note.path.replace(/\.md$/i, "")) === stem);
    if (byPath) {
        return byPath;
    }
    const name = fold(fileName(wanted));
    const byName = notes.filter(note => fold(fileName(note.path)) === name || fold(noteTitle(note)) === name);
    if (byName.length === 1) {
        return byName[0]!;
    }
    if (byName.length > 1) {
        throw new NoteNotFoundError(input, ` Several notes match: ${byName.map(note => note.path).join(", ")}. Give the path.`);
    }
    throw new NoteNotFoundError(input, " search_notes or list_notes give the paths.");
}

/** Each edit replaces one passage found exactly once; all of them or none. */
export function applyEdits (content: string, edits: Edit[]): string {
    let text = content;
    edits.forEach((edit, index) => {
        const label = edits.length > 1 ? `Edit ${index + 1}: ` : "";
        if (!edit.find.trim()) {
            throw new EditMismatchError(`${label}the text to find is empty.`);
        }
        const found = locate(text, edit.find);
        if (found.length === 0) {
            throw new EditMismatchError(`${label}the text to find is not in the note. Read it again and copy the passage exactly.`);
        }
        if (found.length > 1) {
            throw new EditMismatchError(`${label}the text to find is in the note ${found.length} times. Include more of the text around it.`);
        }
        const [{ at, length }] = found as [{ at: number; length: number }];
        text = text.slice(0, at) + edit.replace + text.slice(at + length);
    });
    return text;
}

/**
 * Where a passage is: exactly, or else with any run of whitespace matching
 * any other (a copied passage loses French non-breaking spaces and line ends).
 */
function locate (text: string, passage: string): { at: number; length: number }[] {
    const exact: { at: number; length: number }[] = [];
    for (let at = text.indexOf(passage); at !== -1; at = text.indexOf(passage, at + 1)) {
        exact.push({ at, length: passage.length });
    }
    if (exact.length > 0) {
        return exact;
    }
    const pattern = passage.trim().split(/[\s  ]+/).map(escapeRegExp).join("[\\s\\u00a0\\u202f]+");
    return [...text.matchAll(new RegExp(pattern, "g"))].map(match => ({ at: match.index, length: match[0].length }));
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s/;
const FENCE = /^\s*(?:```|~~~)/;
const FRONTMATTER = /^---\n([\s\S]*?)\n---(?:\n|$)/;

/** For each line, its heading level and text, or nothing (code blocks and frontmatter are not headings). */
function headings (lines: string[]): ({ level: number; text: string } | undefined)[] {
    let inFence = false;
    let inFrontmatter = lines[0] === "---";
    return lines.map((line, index) => {
        if (inFrontmatter) {
            if (index > 0 && line === "---") {
                inFrontmatter = false;
            }
            return undefined;
        }
        if (FENCE.test(line)) {
            inFence = !inFence;
            return undefined;
        }
        const match = inFence ? null : HEADING.exec(line);
        return match ? { level: match[1]!.length, text: match[2]! } : undefined;
    });
}

/**
 * Adds Markdown at the end of the note, or at the end of the section under
 * `heading` (before the next heading of the same or a higher level). A list
 * item added after a list item joins the list; anything else gets a blank line.
 */
export function appendText (content: string, markdown: string, heading?: string): string {
    const addition = markdown.replace(/^\n+/, "").replace(/\s+$/, "");
    if (!addition) {
        throw new EditMismatchError("There is nothing to add.");
    }
    if (!heading?.trim()) {
        return `${joinBlocks(content.replace(/\s+$/, ""), addition)}\n`;
    }
    const lines = content.split("\n");
    const levels = headings(lines);
    const wanted = fold(heading.replace(/^#+\s*/, "").trim());
    const start = levels.findIndex(found => found !== undefined && fold(found.text) === wanted);
    if (start === -1) {
        const all = levels.filter(found => found !== undefined).map(found => found.text);
        throw new EditMismatchError(`No heading "${heading}" in the note. Its headings: ${all.join(", ") || "none"}.`);
    }
    const level = levels[start]!.level;
    let end = levels.findIndex((found, index) => index > start && found !== undefined && found.level <= level);
    if (end === -1) {
        end = lines.length;
    }
    let last = end;
    while (last > start + 1 && !lines[last - 1]!.trim()) {
        last--;
    }
    const section = joinBlocks(lines.slice(0, last).join("\n"), addition);
    const after = lines.slice(end).join("\n").replace(/^\n+/, "");
    return after ? `${section}\n\n${after}` : `${section}\n`;
}

function joinBlocks (before: string, addition: string): string {
    if (!before) {
        return addition;
    }
    const lastLine = before.slice(before.lastIndexOf("\n") + 1);
    const firstLine = addition.split("\n", 1)[0] ?? "";
    return `${before}${LIST_ITEM.test(lastLine) && LIST_ITEM.test(firstLine) ? "\n" : "\n\n"}${addition}`;
}

/**
 * A capture's frontmatter turned into a note's, as it leaves the inbox:
 * `created` (the capture's date) and `tags` kept or added; `captured`,
 * `source` and `suggested` dropped. A note without frontmatter gets one.
 */
export function noteFrontmatter (content: string, today: string): string {
    const match = FRONTMATTER.exec(content);
    if (!match) {
        return `---\ncreated: ${today}\ntags: []\n---\n${content.replace(/^\n+/, "")}`;
    }
    const captured = /^captured:\s*(\d{4}-\d{2}-\d{2})/m.exec(match[1]!)?.[1];
    const kept = match[1]!.split("\n").filter(line => !/^(?:captured|source|suggested):/.test(line));
    if (!kept.some(line => line.startsWith("created:"))) {
        kept.unshift(`created: ${captured ?? today}`);
    }
    if (!kept.some(line => line.startsWith("tags:"))) {
        kept.push("tags: []");
    }
    return `---\n${kept.join("\n")}\n---\n${content.slice(match[0].length)}`;
}

/** The vault's frontmatter on a new note that has none. */
export function withFrontmatter (content: string, today: string): string {
    const text = FRONTMATTER.test(content) ? content : noteFrontmatter(content, today);
    return text.endsWith("\n") ? text : `${text}\n`;
}

const WIKILINK = /(!?\[\[)([^\]|#\n]+)((?:#[^\]|\n]*)?(?:\|[^\]\n]*)?\]\])/g;

/**
 * The notes whose wikilinks pointed at `from`, rewritten to point at `to`.
 * `notes` is the vault after the move (the note at `to`). Obsidian links by
 * file name, or by path when two notes share a name: a link by name is
 * rewritten when the name changes, a link by path whenever the path does.
 */
export function relink (notes: Note[], from: string, to: string): Note[] {
    const fromStem = pathKey(from.replace(/\.md$/i, ""));
    const toStem = to.replace(/\.md$/i, "");
    const fromName = pathKey(fileName(from));
    const toName = fileName(to);
    const others = notes.filter(note => note.path !== to);
    const oldNameShared = others.some(note => pathKey(fileName(note.path)) === fromName);
    const newNameShared = others.some(note => pathKey(fileName(note.path)) === pathKey(toName));
    const renamed = fromName !== pathKey(toName);
    const changed: Note[] = [];
    for (const note of notes) {
        const content = note.content.replace(WIKILINK, (link, open: string, target: string, rest: string) => {
            const stem = target.trim().replace(/\.md$/i, "");
            if (stem.includes("/")) {
                return pathKey(stem) === fromStem ? `${open}${toStem}${rest}` : link;
            }
            if (pathKey(stem) !== fromName || oldNameShared) {
                return link;
            }
            if (newNameShared) {
                return `${open}${toStem}${rest}`;
            }
            return renamed ? `${open}${toName}${rest}` : link;
        });
        if (content !== note.content) {
            changed.push({ path: note.path, content });
        }
    }
    return changed;
}

export interface FolderListing {
    folder: string
    notes: { path: string; title: string }[]
    folders: { path: string; notes: number }[]
}

/** The notes right in a folder ("" for the top), and its subfolders with how many notes each holds. */
export function listFolder (notes: Note[], folders: Iterable<string>, folder = ""): FolderListing {
    const asked = folder.trim().replace(/^\/+|\/+$/g, "");
    const known = [...folders];
    const actual = asked ? known.find(candidate => candidate === asked) ?? known.find(candidate => pathKey(candidate) === pathKey(asked)) : "";
    if (actual === undefined) {
        const top = known.filter(candidate => !candidate.includes("/")).sort();
        throw new VaultError(`No folder "${folder}". Top-level folders: ${top.join(", ")}.`);
    }
    const base = actual ? `${actual}/` : "";
    const direct: { path: string; title: string }[] = [];
    const counts = new Map<string, number>();
    for (const sub of known) {
        if (sub.startsWith(base) && sub !== actual && !sub.slice(base.length).includes("/")) {
            counts.set(sub, 0);
        }
    }
    for (const note of notes) {
        if (!note.path.startsWith(base)) {
            continue;
        }
        const rest = note.path.slice(base.length);
        const slash = rest.indexOf("/");
        if (slash === -1) {
            direct.push({ path: note.path, title: noteTitle(note) });
        } else {
            const sub = `${base}${rest.slice(0, slash)}`;
            counts.set(sub, (counts.get(sub) ?? 0) + 1);
        }
    }
    return {
        folder: actual,
        notes: direct.sort((a, b) => a.path.localeCompare(b.path)),
        folders: [...counts].map(([path, count]) => ({ path, notes: count })).sort((a, b) => a.path.localeCompare(b.path))
    };
}

const OPEN_TASK = /^\s*[-*+] \[ \]\s+(.*\S)\s*$/;

/**
 * Unticked tasks (`- [ ] …`) by note, outside code blocks. Templates and the
 * archive are left out unless asked for by folder.
 */
export function openTasks (notes: Note[], folder = ""): { path: string; title: string; tasks: string[] }[] {
    const asked = folder.trim().replace(/^\/+|\/+$/g, "");
    const base = asked ? `${pathKey(asked)}/` : "";
    const result: { path: string; title: string; tasks: string[] }[] = [];
    for (const note of notes) {
        const key = pathKey(note.path);
        if (!key.startsWith(base)) {
            continue;
        }
        if (!base && (note.path.startsWith("Templates/") || note.path.startsWith("Archive/"))) {
            continue;
        }
        let inFence = false;
        const tasks: string[] = [];
        for (const line of note.content.split("\n")) {
            if (FENCE.test(line)) {
                inFence = !inFence;
                continue;
            }
            const match = inFence ? null : OPEN_TASK.exec(line);
            if (match) {
                tasks.push(match[1]!);
            }
        }
        if (tasks.length > 0) {
            result.push({ path: note.path, title: noteTitle(note), tasks });
        }
    }
    return result.sort((a, b) => a.path.localeCompare(b.path));
}
