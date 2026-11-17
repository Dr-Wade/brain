import { createMcpHandler } from "@modelcontextprotocol/server";
import { describe, expect, it, vi } from "vitest";

import { EditMismatchError, NoteNotFoundError, VaultRuleError } from "../vault/vault.service.js";
import { createVaultMcpServer, type Tasks, type Vault } from "./tools.js";

function fakeVault (): { [K in keyof Vault]: ReturnType<typeof vi.fn> } {
    return {
        capture: vi.fn(async () => ({ path: "Inbox/2026-11-11 0942 Idée.md", url: "https://github.com/x" })),
        search: vi.fn(async () => [{ path: "Notes/Paiements.md", title: "Paiements", snippet: "Suivi des paiements", score: 6 }]),
        read: vi.fn(async () => ({ path: "Notes/Paiements.md", title: "Paiements", content: "# Paiements", truncated: true })),
        inbox: vi.fn(async () => []),
        list: vi.fn(async () => ({ folder: "Projects", notes: [{ path: "Projects/AG.md", title: "AG" }], folders: [{ path: "Projects/Site", notes: 2 }] })),
        tasks: vi.fn(async () => [{ path: "Notes/Paiements.md", title: "Paiements", tasks: ["Relancer le trésorier", "Lister les impayés"] }]),
        addNote: vi.fn(async () => ({ path: "Notes/Vote.md", url: "https://github.com/v" })),
        edit: vi.fn(async () => ({ path: "Notes/Paiements.md", changed: true })),
        append: vi.fn(async () => ({ path: "CA/Agenda.md" })),
        move: vi.fn(async () => ({ from: "Inbox/x.md", to: "Notes/x.md", relinked: ["Home.md"] })),
        remove: vi.fn(async () => ({ path: "Inbox/x.md" })),
        fileIssue: vi.fn(async () => ({ number: 7, url: "https://github.com/bcc-nancy/members/issues/7" })),
        readFile: vi.fn(async (path: string) => ({ path, bytes: new TextEncoder().encode("Prix : 14,56 €") }))
    };
}

/** One JSON-RPC call through the same handler production serves, unauthenticated here. */
async function rpc (vault: ReturnType<typeof fakeVault>, method: string, params?: unknown, issueRepos = ["bcc-nancy/members"], extra: { tasks?: Tasks; glossary?: string } = {}) {
    const handler = createMcpHandler(() => createVaultMcpServer(vault as unknown as Vault, { issueRepos, version: "test", ...extra }));
    const response = await handler.fetch(new Request("http://localhost/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", "accept": "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
    }));
    const text = await response.text();
    const data = text.split("\n").find(line => line.startsWith("data: "))?.slice(6) ?? text;
    return JSON.parse(data) as { result?: { tools?: { name: string }[]; content?: { type: string; text: string; data?: string; mimeType?: string }[]; isError?: boolean; instructions?: string }; error?: unknown };
}

const call = (vault: ReturnType<typeof fakeVault>, name: string, args: unknown) => rpc(vault, "tools/call", { name, arguments: args });

describe("the vault's MCP tools", () => {
    it("lists the tools, the issue tool only when repos are configured", async () => {
        const names = (repos: string[]) => rpc(fakeVault(), "tools/list", undefined, repos).then(answer => answer.result?.tools?.map(tool => tool.name));
        expect(await names(["bcc-nancy/members"])).toEqual([
            "capture_idea", "search_notes", "read_note", "list_inbox", "list_notes", "open_tasks",
            "create_note", "edit_note", "append_to_note", "move_note", "delete_note", "read_attachment", "file_for_atlas"
        ]);
        expect(await names([])).not.toContain("file_for_atlas");
    });

    it("captures with the words as given", async () => {
        const vault = fakeVault();
        const answer = await call(vault, "capture_idea", { text: "Mieux suivre les paiements", suggested: "ca-agenda" });
        expect(vault.capture).toHaveBeenCalledWith({ text: "Mieux suivre les paiements", suggested: "ca-agenda" });
        expect(answer.result?.content?.[0]?.text).toBe("Saved to Inbox/2026-11-11 0942 Idée.md (https://github.com/x).");
    });

    it("refuses an empty capture before reaching the vault", async () => {
        const vault = fakeVault();
        const answer = await call(vault, "capture_idea", { text: "" });
        expect(answer.result?.isError ?? answer.error).toBeTruthy();
        expect(vault.capture).not.toHaveBeenCalled();
    });

    it("formats search hits and says when nothing matches", async () => {
        const vault = fakeVault();
        const found = await call(vault, "search_notes", { query: "paiements", limit: 3 });
        expect(vault.search).toHaveBeenCalledWith("paiements", 3);
        expect(found.result?.content?.[0]?.text).toBe("1. Paiements — Notes/Paiements.md\n   Suivi des paiements");
        vault.search.mockResolvedValueOnce([]);
        expect((await call(vault, "search_notes", { query: "rien" })).result?.content?.[0]?.text).toBe("Nothing in the vault matches \"rien\".");
    });

    it("reads a note and flags a cut one", async () => {
        const answer = await call(fakeVault(), "read_note", { path: "Notes/Paiements.md" });
        expect(answer.result?.content?.[0]?.text).toContain("[Cut here: the note is longer.]");
    });

    it("turns expected failures into tool errors the model can explain", async () => {
        const vault = fakeVault();
        vault.read.mockRejectedValueOnce(new NoteNotFoundError("Notes/Nope.md"));
        const answer = await call(vault, "read_note", { path: "Notes/Nope.md" });
        expect(answer.result).toMatchObject({ isError: true, content: [{ text: "No note at \"Notes/Nope.md\"." }] });
    });

    it("says the inbox is empty", async () => {
        expect((await call(fakeVault(), "list_inbox", {})).result?.content?.[0]?.text).toBe("The inbox is empty.");
    });

    it("files an issue only on a listed repo", async () => {
        const vault = fakeVault();
        const filed = await call(vault, "file_for_atlas", { repo: "bcc-nancy/members", title: "Track event payments", body: "Quote" });
        expect(filed.result?.content?.[0]?.text).toBe("Filed bcc-nancy/members#7: https://github.com/bcc-nancy/members/issues/7");
        const refused = await call(vault, "file_for_atlas", { repo: "other/repo", title: "Track event payments", body: "Quote" });
        expect(refused.result?.isError ?? refused.error).toBeTruthy();
        expect(vault.fileIssue).toHaveBeenCalledTimes(1);
    });

    it("browses a folder and lists open tasks", async () => {
        const vault = fakeVault();
        expect((await call(vault, "list_notes", { folder: "Projects" })).result?.content?.[0]?.text).toBe("Projects: 1 notes, 1 folders\n📁 Projects/Site/ (2 notes)\n• AG — Projects/AG.md");
        expect((await call(vault, "open_tasks", {})).result?.content?.[0]?.text).toBe("Paiements — Notes/Paiements.md\n- [ ] Relancer le trésorier\n- [ ] Lister les impayés");
        vault.tasks.mockResolvedValueOnce([]);
        expect((await call(vault, "open_tasks", { folder: "Meetings" })).result?.content?.[0]?.text).toBe("No open tasks in Meetings.");
    });

    it("creates, edits, adds to, moves and deletes notes", async () => {
        const vault = fakeVault();
        const text = async (name: string, args: unknown) => (await call(vault, name, args)).result?.content?.[0]?.text;
        expect(await text("create_note", { path: "Notes/Vote", content: "# Vote" })).toBe("Created Notes/Vote.md (https://github.com/v).");
        expect(await text("edit_note", { path: "Paiements", edits: [{ find: "même", replace: "Memento IT" }] })).toBe("Saved the change to Notes/Paiements.md.");
        expect(vault.edit).toHaveBeenCalledWith("Paiements", [{ find: "même", replace: "Memento IT" }]);
        expect(await text("append_to_note", { path: "CA/Agenda.md", text: "- Late fees", heading: "26 novembre" })).toBe("Added to CA/Agenda.md under \"26 novembre\".");
        expect(vault.append).toHaveBeenCalledWith("CA/Agenda.md", "- Late fees", { heading: "26 novembre" });
        expect(await text("move_note", { path: "Inbox/x.md", to: "Notes/" })).toBe("Moved Inbox/x.md → Notes/x.md. Links updated in Home.md.");
        expect(await text("delete_note", { path: "Inbox/x.md" })).toBe("Deleted Inbox/x.md. Git history keeps it.");
    });

    it("gives the vault's refusals back as tool errors", async () => {
        const vault = fakeVault();
        vault.edit.mockRejectedValueOnce(new EditMismatchError("the text to find is not in the note."));
        expect((await call(vault, "edit_note", { path: "x", edits: [{ find: "a", replace: "b" }] })).result).toMatchObject({ isError: true });
        vault.remove.mockRejectedValueOnce(new VaultRuleError("Only inbox notes are deleted."));
        expect((await call(vault, "delete_note", { path: "Notes/x.md" })).result).toMatchObject({ isError: true, content: [{ text: "Only inbox notes are deleted." }] });
        expect((await call(vault, "edit_note", { path: "x", edits: [] })).result?.isError).toBe(true);
        expect(vault.edit).toHaveBeenCalledTimes(1);
    });

    it("adds, ticks and moves to-dos, and lists what is due", async () => {
        const vault = fakeVault();
        const tasks = {
            add: vi.fn(async (items: string[]) => ({ path: "Tasks.md", items })),
            complete: vi.fn(async (task: string) => ({ path: "Tasks.md", text: task })),
            setDue: vi.fn(async (items: string[]) => ({ found: items.slice(0, 1), missing: items.slice(1) }))
        };
        const text = async (name: string, args: unknown) => (await rpc(vault, "tools/call", { name, arguments: args }, [], { tasks })).result?.content?.[0]?.text;
        const names = (await rpc(vault, "tools/list", undefined, [], { tasks })).result?.tools?.map(tool => tool.name);
        expect(names).toEqual(expect.arrayContaining(["add_task", "complete_task", "reschedule_task"]));

        expect(await text("add_task", { tasks: ["Faire la facturation"], due: "2026-11-18" })).toBe("Added to Tasks.md, for Wed 18 Nov:\n- [ ] Faire la facturation");
        expect(tasks.add).toHaveBeenCalledWith(["Faire la facturation"], "2026-11-18");
        expect(await text("add_task", { tasks: ["Ranger"], due: null })).toBe("Added to Tasks.md, with no day:\n- [ ] Ranger");
        expect((await rpc(vault, "tools/call", { name: "add_task", arguments: { tasks: ["x"], due: "demain" } }, [], { tasks })).result?.isError).toBe(true);
        expect(await text("complete_task", { task: "Ranger" })).toBe("Ticked \"Ranger\" in Tasks.md.");
        expect(await text("reschedule_task", { tasks: ["A", "B"], due: "2026-11-20" })).toBe("Now for Fri 20 Nov: A.\nNot found among the open tasks: B.");

        vault.tasks.mockResolvedValueOnce([{ path: "Tasks.md", title: "Tasks", tasks: ["A 📅 2026-11-17", "B 📅 2026-11-19", "C"] }]);
        expect(await text("open_tasks", { until: "2026-11-18" })).toBe("Tasks — Tasks.md\n- [ ] A 📅 2026-11-17");
    });

    it("shows a text attachment, and carries the glossary in its instructions", async () => {
        const vault = fakeVault();
        const shown = await call(vault, "read_attachment", { path: "Prix.txt" });
        expect(vault.readFile).toHaveBeenCalledWith("Prix.txt");
        expect(shown.result?.content?.[0]?.text).toBe("Prix.txt\n\nPrix : 14,56 €");
        vault.readFile.mockResolvedValueOnce({ path: "Attachments/broken.jpg", bytes: new Uint8Array([1, 2, 3]) });
        const broken = await call(vault, "read_attachment", { path: "broken.jpg" });
        expect(broken.result).toMatchObject({ isError: true, content: [{ text: expect.stringMatching(/^Could not open Attachments\/broken\.jpg: /) }] });

        const init = await rpc(vault, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } }, [], { glossary: "\n- Names: **Memento IT**" });
        expect(init.result?.instructions).toMatch(/Archive\/Notion is read-only[\s\S]*\n- Names: \*\*Memento IT\*\*$/);
    });
});
