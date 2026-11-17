import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";

import type { MeetingsService } from "../meetings/meetings.service.js";
import { MAX_NOTE_LENGTH } from "../vault/editing.js";
import { SUGGESTIONS } from "../vault/notes.js";
import { VaultError, type VaultService } from "../vault/vault.service.js";

/** What the tools need from the vault; a fake in tests. */
export type Vault = Pick<VaultService, "capture" | "search" | "read" | "inbox" | "list" | "tasks" | "addNote" | "edit" | "append" | "move" | "remove" | "fileIssue">;
/** The calendar side; absent when no calendar is published. */
export type Meetings = Pick<MeetingsService, "upcoming">;

const INSTRUCTIONS = `Edward's second brain: an Obsidian vault in French and English, in git (every change is a commit; nothing is lost).
- Capture: when Edward shares an idea, a thought to keep, or says "note that" / "note ça", call capture_idea with his own words. Do not wait for the end of the conversation.
- Find: before answering about something he may have written down, search_notes, then read_note on the best hits. list_notes browses a folder; open_tasks lists what is still to do.
- Change: read_note first. edit_note corrects a word, ticks a task or rewrites a passage; append_to_note adds to the end of a note or of a section; create_note makes a note outside the inbox. To fix a capture, edit it: never save a corrected copy. Keep Edward's words: add structure around them, do not rewrite them away. Say what you changed.
- Links are wikilinks to file names: [[Paiements des événements]]. Link a new note to a related one when there is one.
- Weekly sort (list_inbox): propose one destination per note as a numbered list (note, issue, ca-agenda, bin) and wait for his answer. Then note → move_note to Notes/ or a project folder; issue → file_for_atlas, then delete_note; ca-agenda → append_to_note on CA/Agenda.md, then delete_note; bin → delete_note.
- Meetings: upcoming_meetings, then read_note on its prep note, then search_notes (and his Drive, when that connector is on) for what it needs. Work through "To prepare" with him, ticking what is done. After the meeting, append_to_note under "Notes", "Decisions" and "Actions" ("- [ ] who: what, by when"). Do not invent decisions.
- Archive/Notion is read-only; meeting notes never move.
- file_for_atlas opens a GitHub issue for software work. Only when Edward asks for an issue, and after reading the title back to him.`;

const text = (value: string): CallToolResult => ({ content: [{ type: "text", text: value }] });

/** Expected failures go back to the model as tool errors it can explain; the rest throw. */
async function answer (run: () => Promise<string>): Promise<CallToolResult> {
    try {
        return text(await run());
    } catch (error) {
        if (error instanceof VaultError) {
            return { ...text(error.message), isError: true };
        }
        throw error;
    }
}

export function createVaultMcpServer (vault: Vault, options: { issueRepos: string[]; version: string; meetings?: Meetings }): McpServer {
    const server = new McpServer({ name: "brain", title: "Edward's vault", version: options.version }, { instructions: INSTRUCTIONS });

    server.registerTool("capture_idea", {
        title: "Capture an idea",
        description: "Save an idea or thought to the vault's inbox, in Edward's own words, for the weekly sort. One call per idea.",
        inputSchema: z.object({
            text: z.string().min(1).max(10_000).describe("The idea, as close to Edward's own words as possible. Do not summarise."),
            title: z.string().max(120).optional().describe("A short title, in the idea's language."),
            context: z.string().max(1_000).optional().describe("One line: what triggered it, who or what it concerns."),
            suggested: z.enum(SUGGESTIONS).optional().describe("Where it probably belongs: a note to keep, a GitHub issue, an item for the BCC Nancy board (ca-agenda), or unsure.")
        }),
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    }, async input => answer(async () => {
        const saved = await vault.capture(input);
        return `Saved to ${saved.path} (${saved.url}).`;
    }));

    server.registerTool("search_notes", {
        title: "Search notes",
        description: "Search the vault (notes, projects, inbox, board agenda) by keywords. Accents and case are ignored. Returns paths, titles and snippets; read_note gives the full text.",
        inputSchema: z.object({
            query: z.string().min(1).max(200).describe("Keywords, not a sentence: \"paiement événement facture\"."),
            limit: z.number().int().min(1).max(20).optional().describe("How many results, 8 by default.")
        }),
        annotations: { readOnlyHint: true, openWorldHint: false }
    }, async ({ query, limit }) => answer(async () => {
        const hits = await vault.search(query, limit);
        if (hits.length === 0) {
            return `Nothing in the vault matches "${query}".`;
        }
        return hits.map((hit, index) => `${index + 1}. ${hit.title} — ${hit.path}\n   ${hit.snippet}`).join("\n");
    }));

    server.registerTool("read_note", {
        title: "Read a note",
        description: "The full Markdown of one note, by its path (from search_notes, list_notes or list_inbox) or its title.",
        inputSchema: z.object({
            path: z.string().min(1).max(300).describe("Path inside the vault, e.g. \"Notes/Paiements des événements.md\", or the note's title.")
        }),
        annotations: { readOnlyHint: true, openWorldHint: false }
    }, async ({ path }) => answer(async () => {
        const note = await vault.read(path);
        return `${note.path}\n\n${note.content}${note.truncated ? "\n\n[Cut here: the note is longer.]" : ""}`;
    }));

    server.registerTool("list_inbox", {
        title: "List the inbox",
        description: "What is waiting in the inbox to be sorted, oldest first.",
        inputSchema: z.object({}),
        annotations: { readOnlyHint: true, openWorldHint: false }
    }, async () => answer(async () => {
        const items = await vault.inbox();
        if (items.length === 0) {
            return "The inbox is empty.";
        }
        return items.map((item, index) => `${index + 1}. ${item.title} — ${item.path}\n   ${item.preview}`).join("\n");
    }));

    server.registerTool("list_notes", {
        title: "Browse a folder",
        description: "The notes and subfolders in one folder of the vault, or its top level when no folder is given (Inbox, Notes, Projects, CA, Meetings, Archive, Templates).",
        inputSchema: z.object({
            folder: z.string().max(300).optional().describe("e.g. \"Projects\" or \"Archive/Notion\". Empty for the top level.")
        }),
        annotations: { readOnlyHint: true, openWorldHint: false }
    }, async ({ folder }) => answer(async () => {
        const listing = await vault.list(folder);
        const lines = [`${listing.folder || "Vault"}: ${listing.notes.length} notes, ${listing.folders.length} folders`];
        for (const sub of listing.folders) {
            lines.push(`📁 ${sub.path}/ (${sub.notes} notes)`);
        }
        for (const note of listing.notes.slice(0, 200)) {
            lines.push(`• ${note.title} — ${note.path}`);
        }
        if (listing.notes.length > 200) {
            lines.push(`… and ${listing.notes.length - 200} more: search_notes narrows it down.`);
        }
        return lines.join("\n");
    }));

    server.registerTool("open_tasks", {
        title: "Open tasks",
        description: "Unticked tasks (\"- [ ]\" lines) across the vault or in one folder, by note: meeting actions, project to-dos, prep still to do. Templates and the archive are left out.",
        inputSchema: z.object({
            folder: z.string().max(300).optional().describe("Only this folder, e.g. \"Meetings\" or \"Projects\". Empty for the whole vault.")
        }),
        annotations: { readOnlyHint: true, openWorldHint: false }
    }, async ({ folder }) => answer(async () => {
        const notes = await vault.tasks(folder);
        if (notes.length === 0) {
            return folder ? `No open tasks in ${folder}.` : "No open tasks in the vault.";
        }
        const lines: string[] = [];
        let count = 0;
        for (const note of notes) {
            if (count >= 200) {
                lines.push("… more in other notes: give a folder to narrow it down.");
                break;
            }
            lines.push(`${note.title} — ${note.path}`, ...note.tasks.map(task => `- [ ] ${task}`), "");
            count += note.tasks.length;
        }
        return lines.join("\n").trim();
    }));

    server.registerTool("create_note", {
        title: "Create a note",
        description: "A new note at a path outside the inbox, e.g. \"Notes/Paiements des événements.md\" or \"Projects/AG 2027.md\". Never overwrites. The file name is the title, in the note's language. The vault's frontmatter (created, tags) is added when missing. A quick idea goes to capture_idea instead.",
        inputSchema: z.object({
            path: z.string().min(1).max(300).describe("Folder and file name; \".md\" is optional."),
            content: z.string().max(MAX_NOTE_LENGTH).describe("The note's Markdown. Wikilinks to related notes: [[Title]].")
        }),
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    }, async ({ path, content }) => answer(async () => {
        const created = await vault.addNote(path, content);
        return `Created ${created.path} (${created.url}).`;
    }));

    server.registerTool("edit_note", {
        title: "Edit a note",
        description: "Change an existing note: each edit replaces one exact passage of it (copied from read_note, found once) with new text. Read the note first. For correcting words, ticking a task (\"- [ ]\" → \"- [x]\"), rewriting a paragraph; an empty replacement deletes the passage. All edits are saved together, or none.",
        inputSchema: z.object({
            path: z.string().min(1).max(300).describe("The note's path, or its title."),
            edits: z.array(z.object({
                find: z.string().min(1).max(MAX_NOTE_LENGTH).describe("The passage as it is in the note. Enough of it to be found only once."),
                replace: z.string().max(MAX_NOTE_LENGTH).describe("What it becomes.")
            })).min(1).max(20)
        }),
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }
    }, async ({ path, edits }) => answer(async () => {
        const saved = await vault.edit(path, edits);
        return saved.changed ? `Saved ${edits.length === 1 ? "the change" : `${edits.length} changes`} to ${saved.path}.` : `Nothing changed in ${saved.path}: the new text is the same.`;
    }));

    server.registerTool("append_to_note", {
        title: "Add to a note",
        description: "Add Markdown at the end of a note, or at the end of one of its sections by heading (\"Actions\", \"Decisions\", \"Notes\", a meeting date in CA/Agenda.md). A list item added after a list joins it.",
        inputSchema: z.object({
            path: z.string().min(1).max(300).describe("The note's path, or its title."),
            text: z.string().min(1).max(MAX_NOTE_LENGTH).describe("The Markdown to add."),
            heading: z.string().max(200).optional().describe("The section to add it to, by its heading text. Empty: the end of the note.")
        }),
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    }, async ({ path, text: markdown, heading }) => answer(async () => {
        const saved = await vault.append(path, markdown, { heading });
        return `Added to ${saved.path}${heading ? ` under "${heading}"` : ""}.`;
    }));

    server.registerTool("move_note", {
        title: "Move or rename a note",
        description: "Move a note to a folder (\"Notes/\", \"Projects/AG 2027/\") or give it a new path, which renames it. Wikilinks to it in other notes follow. Leaving the inbox, its frontmatter becomes a note's (created and tags; captured, source and suggested dropped). Meeting notes do not move.",
        inputSchema: z.object({
            path: z.string().min(1).max(300).describe("The note's path, or its title."),
            to: z.string().min(1).max(300).describe("A folder ending with \"/\", or the full new path.")
        }),
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    }, async ({ path, to }) => answer(async () => {
        const moved = await vault.move(path, to);
        const links = moved.relinked.length ? ` Links updated in ${moved.relinked.length === 1 ? moved.relinked[0] : `${moved.relinked.length} notes`}.` : "";
        return `Moved ${moved.from} → ${moved.to}.${links}`;
    }));

    server.registerTool("delete_note", {
        title: "Delete an inbox note",
        description: "Delete a note from the inbox: the weekly sort's \"bin\", or once its content went to an issue or the board agenda. Only Inbox/ notes; anything else is moved to Archive/ instead. Git history keeps a copy.",
        inputSchema: z.object({
            path: z.string().min(1).max(300).describe("The inbox note's path, or its title.")
        }),
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }
    }, async ({ path }) => answer(async () => {
        const deleted = await vault.remove(path);
        return `Deleted ${deleted.path}. Git history keeps it.`;
    }));

    const meetings = options.meetings;
    if (meetings) {
        server.registerTool("upcoming_meetings", {
            title: "Upcoming meetings",
            description: "Edward's meetings in the coming days, from his calendar, each with its prep note (a path for read_note) and how much of the prep is done. Start here to help him prepare a meeting.",
            inputSchema: z.object({
                days: z.number().int().min(1).max(30).optional().describe("How many days ahead, 7 by default.")
            }),
            annotations: { readOnlyHint: true, openWorldHint: false }
        }, async ({ days }) => answer(async () => {
            const list = await meetings.upcoming(days ?? 7);
            if (list.length === 0) {
                return `No meetings in the next ${days ?? 7} days.`;
            }
            return list.map(meeting => {
                const where = meeting.location ? ` · ${meeting.location}` : "";
                const prep = meeting.prepNote
                    ? `\n   Prep note: ${meeting.prepNote}${meeting.prep && meeting.prep.total > 0 ? ` (${meeting.prep.done}/${meeting.prep.total} done)` : ""}`
                    : "\n   No prep note yet.";
                return `• ${meeting.when} — ${meeting.title}${where}${prep}`;
            }).join("\n");
        }));
    }

    if (options.issueRepos.length > 0) {
        server.registerTool("file_for_atlas", {
            title: "File a GitHub issue",
            description: `Open a GitHub issue for software work, without any label (Edward triages it for Atlas). Allowed repos: ${options.issueRepos.join(", ")}. Read the title back to Edward before calling.`,
            inputSchema: z.object({
                repo: z.enum(options.issueRepos as [string, ...string[]]).describe("owner/name of the repo."),
                title: z.string().min(3).max(200).describe("What should change, as a short imperative sentence."),
                body: z.string().min(1).max(20_000).describe("Why, what Edward said (quoted), and any detail that helps whoever builds it.")
            }),
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
        }, async input => answer(async () => {
            const issue = await vault.fileIssue(input);
            return `Filed ${input.repo}#${issue.number}: ${issue.url}`;
        }));
    }

    return server;
}
