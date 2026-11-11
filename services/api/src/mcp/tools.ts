import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";

import type { MeetingsService } from "../meetings/meetings.service.js";
import { SUGGESTIONS } from "../vault/notes.js";
import { NoteNotFoundError, NotConfiguredError, RepoNotAllowedError, type VaultService } from "../vault/vault.service.js";

/** What the tools need from the vault; a fake in tests. */
export type Vault = Pick<VaultService, "capture" | "search" | "read" | "inbox" | "fileIssue">;
/** The calendar side; absent when no calendar is published. */
export type Meetings = Pick<MeetingsService, "upcoming">;

const INSTRUCTIONS = `Edward's second brain: an Obsidian vault in French and English.
- When Edward shares an idea, a thought to keep, or says "note that" / "note ça", call capture_idea with his own words. Do not wait for the end of the conversation.
- Before answering a question about something he may have written down, call search_notes, then read_note on the best hits.
- To help prepare a meeting: upcoming_meetings, then read_note on its prep note, then search_notes (and his Drive, when that connector is on) for what it needs. Fill the prep note's questions with him; do not invent decisions.
- file_for_atlas opens a GitHub issue for software work. Only when Edward asks for an issue, and after reading the title back to him.`;

const text = (value: string): CallToolResult => ({ content: [{ type: "text", text: value }] });

/** Expected failures go back to the model as tool errors it can explain; the rest throw. */
async function answer (run: () => Promise<string>): Promise<CallToolResult> {
    try {
        return text(await run());
    } catch (error) {
        if (error instanceof NotConfiguredError || error instanceof NoteNotFoundError || error instanceof RepoNotAllowedError) {
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
        description: "The full Markdown of one note, by the path search_notes or list_inbox returned.",
        inputSchema: z.object({
            path: z.string().min(1).max(300).describe("Path inside the vault, e.g. \"Notes/Paiements des événements.md\".")
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
