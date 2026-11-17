/**
 * Glossary.md: the names Edward uses (people, organisations, projects), one
 * list line each with the name in bold. Claude gets the lines with the
 * connector's instructions; Deepgram gets the bold names as keyterms, so
 * dictation spells them right. Pure.
 */

export const GLOSSARY_PATH = "Glossary.md";

export interface Glossary {
    /** The list lines, as written, for Claude. */
    lines: string[]
    /** The bold names, for the transcription. */
    terms: string[]
}

/** What Claude is given at most: the instructions travel with every conversation. */
const MAX_CHARS = 4_000;
/** Deepgram allows 100 keyterms and 500 tokens in all. */
const MAX_TERMS = 60;

export function parseGlossary (content: string | undefined): Glossary {
    const lines: string[] = [];
    const terms = new Set<string>();
    let inFence = false;
    let size = 0;
    for (const raw of (content ?? "").split("\n")) {
        if (/^\s*(?:```|~~~)/.test(raw)) {
            inFence = !inFence;
            continue;
        }
        const item = inFence ? undefined : /^\s*[-*+]\s+(.*\S)/.exec(raw)?.[1];
        if (!item || size + item.length > MAX_CHARS) {
            continue;
        }
        lines.push(item);
        size += item.length + 1;
        for (const match of item.matchAll(/\*\*([^*\n]{2,50})\*\*/g)) {
            if (terms.size < MAX_TERMS) {
                terms.add(match[1]!.trim());
            }
        }
    }
    return { lines, terms: [...terms] };
}

/** The glossary as a paragraph of the connector's instructions, or "" when empty. */
export function glossaryInstructions (glossary: Glossary): string {
    if (glossary.lines.length === 0) {
        return "";
    }
    return `\n- Names Edward uses (Glossary.md). Spell them so; dictation mangles them, so when a word looks like a mis-hearing of one, use the name and say so:\n${glossary.lines.map(line => `  - ${line}`).join("\n")}`;
}
