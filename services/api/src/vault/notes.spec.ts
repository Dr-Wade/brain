import { describe, expect, it } from "vitest";

import { captureMarkdown, fold, inboxPath, noteTitle, queryTerms, safeFileTitle, searchNotes, titleFrom, zonedParts, type Note } from "./notes.js";

// 08:42 UTC is 09:42 in Paris in November (UTC+1).
const at = new Date("2026-11-11T08:42:00Z");

describe("naming captures", () => {
    it("dates the inbox file in the vault's zone", () => {
        expect(zonedParts(at, "Europe/Paris")).toEqual({ date: "2026-11-11", time: "0942", iso: "2026-11-11T09:42+01:00" });
        expect(zonedParts(at, "UTC").iso).toBe("2026-11-11T08:42+00:00");
    });

    it("builds Inbox/<date> <time> <title>.md, with a suffix on retries", () => {
        expect(inboxPath("Paiements des événements", at, "Europe/Paris")).toBe("Inbox/2026-11-11 0942 Paiements des événements.md");
        expect(inboxPath("Paiements", at, "Europe/Paris", 2)).toBe("Inbox/2026-11-11 0942 Paiements (2).md");
    });

    it("keeps file names legal and short", () => {
        expect(safeFileTitle("CA: factures / paiements?")).toBe("CA factures paiements");
        expect(safeFileTitle("..hidden")).toBe("hidden");
        expect(safeFileTitle("   ")).toBe("Idea");
        expect(safeFileTitle("word ".repeat(40)).length).toBeLessThanOrEqual(80);
    });

    it("takes the title given, else the first words", () => {
        expect(titleFrom({ text: "x", title: "  Mon titre " })).toBe("Mon titre");
        expect(titleFrom({ text: "Il nous faut un meilleur suivi des paiements pour les inscriptions aux événements." }))
            .toBe("Il nous faut un meilleur suivi des paiements");
    });

    it("writes the frontmatter the vault expects, the words verbatim", () => {
        const markdown = captureMarkdown({ text: "  Suivre les paiements.  ", context: "Après le CA", suggested: "ca-agenda" }, "Paiements", at, "Europe/Paris");
        expect(markdown).toBe([
            "---",
            "captured: 2026-11-11T09:42+01:00",
            "source: claude",
            "suggested: ca-agenda",
            "tags: [idea]",
            "---",
            "# Paiements",
            "",
            "Suivre les paiements.",
            "",
            "## Context",
            "",
            "Après le CA",
            ""
        ].join("\n"));
        expect(captureMarkdown({ text: "a" }, "T", at, "UTC")).toContain("suggested: unsure");
    });
});

describe("searching notes", () => {
    const notes: Note[] = [
        { path: "Notes/Paiements des événements.md", content: "---\ntags: [ca]\n---\n# Paiements des événements\n\nLes factures des inscriptions arrivent en retard." },
        { path: "Notes/Divers.md", content: "# Divers\n\nUn mot sur les paiements, en passant." },
        { path: "Projects/Atlas.md", content: "# Atlas\n\nAgents qui construisent les tickets." },
        { path: "Templates/Idea.md", content: "# {{title}}\n\npaiements" }
    ];

    it("ignores accents and case", () => {
        expect(fold("Événement")).toBe("evenement");
        expect(queryTerms("Paiement ÉVÉNEMENT de la")).toEqual(["paiement", "evenement", "de", "la"]);
    });

    it("ranks notes holding more of the terms first, and title hits above body hits", () => {
        const hits = searchNotes(notes, "paiements evenements");
        expect(hits.map(hit => hit.path)).toEqual(["Notes/Paiements des événements.md", "Notes/Divers.md"]);
        expect(hits[0]?.title).toBe("Paiements des événements");
    });

    it("skips templates, and answers nothing for an empty query", () => {
        expect(searchNotes(notes, "paiements").map(hit => hit.path)).not.toContain("Templates/Idea.md");
        expect(searchNotes(notes, "  ")).toEqual([]);
    });

    it("quotes the text around the first match, accents intact", () => {
        const [hit] = searchNotes(notes, "factures");
        expect(hit?.snippet).toContain("Les factures des inscriptions");
        const long = { path: "Notes/Long.md", content: `${"début ".repeat(60)}cible ${"fin ".repeat(80)}` };
        const [cut] = searchNotes([long], "cible");
        expect(cut?.snippet.startsWith("…")).toBe(true);
        expect(cut?.snippet.endsWith("…")).toBe(true);
        expect(cut?.snippet).toContain("cible");
    });

    it("titles a note by its heading, else its file name", () => {
        expect(noteTitle({ path: "Notes/x.md", content: "---\na: b\n---\n# Titre\n" })).toBe("Titre");
        expect(noteTitle({ path: "Notes/Sans titre.md", content: "texte" })).toBe("Sans titre");
    });

    it("respects the limit", () => {
        expect(searchNotes(notes, "paiements", 1)).toHaveLength(1);
    });
});
