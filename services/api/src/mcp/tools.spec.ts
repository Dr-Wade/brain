import { createMcpHandler } from "@modelcontextprotocol/server";
import { describe, expect, it, vi } from "vitest";

import { EditMismatchError, NoteNotFoundError, VaultRuleError } from "../vault/vault.service.js";
import { createVaultMcpServer, type Vault } from "./tools.js";

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
        fileIssue: vi.fn(async () => ({ number: 7, url: "https://github.com/bcc-nancy/members/issues/7" }))
    };
}

/** One JSON-RPC call through the same handler production serves, unauthenticated here. */
async function rpc (vault: ReturnType<typeof fakeVault>, method: string, params?: unknown, issueRepos = ["bcc-nancy/members"]) {
    const handler = createMcpHandler(() => createVaultMcpServer(vault as unknown as Vault, { issueRepos, version: "test" }));
    const response = await handler.fetch(new Request("http://localhost/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", "accept": "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
    }));
    const text = await response.text();
    const data = text.split("\n").find(line => line.startsWith("data: "))?.slice(6) ?? text;
    return JSON.parse(data) as { result?: { tools?: { name: string }[]; content?: { text: string }[]; isError?: boolean }; error?: unknown };
}

const call = (vault: ReturnType<typeof fakeVault>, name: string, args: unknown) => rpc(vault, "tools/call", { name, arguments: args });

describe("the vault's MCP tools", () => {
    it("lists the tools, the issue tool only when repos are configured", async () => {
        const names = (repos: string[]) => rpc(fakeVault(), "tools/list", undefined, repos).then(answer => answer.result?.tools?.map(tool => tool.name));
        expect(await names(["bcc-nancy/members"])).toEqual([
            "capture_idea", "search_notes", "read_note", "list_inbox", "list_notes", "open_tasks",
            "create_note", "edit_note", "append_to_note", "move_note", "delete_note", "file_for_atlas"
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
});
