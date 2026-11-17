import { describe, expect, it } from "vitest";

import { appendText } from "./editing.js";
import { glossaryInstructions, parseGlossary } from "./glossary.js";

describe("appendText", () => {
    it("adds a row to a table, and a paragraph after it", () => {
        const register = "# Décisions\n\n| Date | Décision | Qui | Réunion |\n| --- | --- | --- | --- |\n";
        const row = "| 2026-11-26 | Cotisation à 30 € | Trésorier | [[2026-11-26 1900 CA]] |";
        expect(appendText(register, row)).toBe(`${register}${row}\n`);
        expect(appendText(`${register}${row}\n`, "Voir aussi le budget.")).toBe(`${register}${row}\n\nVoir aussi le budget.\n`);
    });
});

describe("the glossary", () => {
    it("goes to Claude as a list under the instructions, and nothing when empty", () => {
        const glossary = parseGlossary("- **Memento IT**: ma structure\n```\n- **Not this**\n```\n* **Ådalen**: client");
        expect(glossary.terms).toEqual(["Memento IT", "Ådalen"]);
        expect(glossaryInstructions(glossary)).toBe("\n- Names Edward uses (Glossary.md). Spell them so; dictation mangles them, so when a word looks like a mis-hearing of one, use the name and say so:\n  - **Memento IT**: ma structure\n  - **Ådalen**: client");
        expect(glossaryInstructions(parseGlossary(undefined))).toBe("");
    });
});
