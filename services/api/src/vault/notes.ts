/**
 * Pure helpers over vault notes: naming captures, writing their frontmatter,
 * and searching a snapshot. No I/O here, so all of it is tested directly.
 */

export interface Note {
    /** Path inside the vault, e.g. `Notes/Paiements.md`. */
    path: string
    content: string
}

export interface SearchHit {
    path: string
    title: string
    snippet: string
    score: number
}

export const SUGGESTIONS = ["note", "issue", "ca-agenda", "unsure"] as const;
export type Suggestion = typeof SUGGESTIONS[number];

/** Where a capture came from, written in its frontmatter. */
export type CaptureSource = "claude" | "telegram";

export interface Capture {
    /** Markdown: the words verbatim, or for Telegram the formatted messages. */
    text: string
    title?: string
    context?: string
    suggested?: Suggestion
    source?: CaptureSource
}

/** Date and time parts in a zone, for file names and frontmatter. */
export function zonedParts (at: Date, timeZone: string) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
        timeZoneName: "longOffset"
    }).formatToParts(at).map(part => [part.type, part.value]));
    // "GMT+01:00", or "GMT" at UTC itself.
    const offset = parts.timeZoneName === "GMT" ? "+00:00" : String(parts.timeZoneName).replace("GMT", "");
    return {
        date: `${parts.year}-${parts.month}-${parts.day}`,
        time: `${parts.hour}${parts.minute}`,
        iso: `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}${offset}`
    };
}

/** A title usable as a file name on every OS Obsidian runs on. */
export function safeFileTitle (title: string): string {
    const cleaned = title
        .replace(/[\\/:*?"<>|#^[\]]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/^\.+/, "");
    const short = cleaned.length > 80 ? cleaned.slice(0, 80).replace(/\s+\S*$/, "") : cleaned;
    return short || "Idea";
}

/** A title from the first words when none is given. */
export function titleFrom (capture: Capture): string {
    if (capture.title?.trim()) {
        return capture.title.trim();
    }
    const words = capture.text.trim().split(/\s+/).slice(0, 8).join(" ");
    return words.replace(/[.,;:!?]+$/, "") || "Idea";
}

/** `Inbox/2026-11-11 0942 Paiements des événements.md`, with an optional suffix. */
export function inboxPath (title: string, at: Date, timeZone: string, attempt = 1): string {
    return datedPath("Inbox", title, at, timeZone, attempt);
}

/**
 * `<folder>/<date> <time> <title><suffix><extension>`: the inbox's naming,
 * for attachments too (`Attachments/2026-11-11 0942 voice.ogg`).
 */
export function datedPath (folder: string, title: string, at: Date, timeZone: string, attempt = 1, extension = ".md"): string {
    const { date, time } = zonedParts(at, timeZone);
    const suffix = attempt > 1 ? ` (${attempt})` : "";
    return `${folder}/${date} ${time} ${safeFileTitle(title)}${suffix}${extension}`;
}

/** The inbox file, in the vault's conventions (see its CLAUDE.md). */
export function captureMarkdown (capture: Capture, title: string, at: Date, timeZone: string): string {
    const { iso } = zonedParts(at, timeZone);
    const lines = [
        "---",
        `captured: ${iso}`,
        `source: ${capture.source ?? "claude"}`,
        `suggested: ${capture.suggested ?? "unsure"}`,
        "tags: [idea]",
        "---",
        `# ${title.replace(/\n/g, " ")}`,
        "",
        capture.text.trim(),
        ""
    ];
    if (capture.context?.trim()) {
        lines.push("## Context", "", capture.context.trim(), "");
    }
    return lines.join("\n");
}

/** Lower case, accents dropped: "Événement" finds "evenement". */
export function fold (text: string): string {
    return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/** The note's title: its first H1, else its file name. */
export function noteTitle (note: Note): string {
    const heading = /^#\s+(.+)$/m.exec(stripFrontmatter(note.content));
    if (heading?.[1]) {
        return heading[1].trim();
    }
    return note.path.split("/").pop()!.replace(/\.md$/, "");
}

export function stripFrontmatter (content: string): string {
    return content.replace(/^---\n[\s\S]*?\n---\n?/, "");
}

const STOPWORDS = new Set([
    "the", "and", "for", "with", "about", "what", "that", "this", "from", "les", "des", "une", "pour", "avec",
    "dans", "sur", "que", "qui", "est", "pas", "aux", "par", "mon", "mes", "notes", "note"
]);

export function queryTerms (query: string): string[] {
    const terms = fold(query).split(/[^\p{L}\p{N}]+/u).filter(term => term.length >= 2 && !STOPWORDS.has(term));
    return [...new Set(terms)];
}

/**
 * Notes matching the query, best first. A note scores per term it contains,
 * title hits counting five times; notes holding more of the terms rank above
 * notes repeating one of them. Templates are not notes.
 */
export function searchNotes (notes: Note[], query: string, limit = 8): SearchHit[] {
    const terms = queryTerms(query);
    if (terms.length === 0) {
        return [];
    }
    const hits: (SearchHit & { matched: number })[] = [];
    for (const note of notes) {
        if (note.path.startsWith("Templates/")) {
            continue;
        }
        const title = noteTitle(note);
        const foldedTitle = fold(`${title} ${note.path}`);
        const body = stripFrontmatter(note.content);
        const foldedBody = fold(body);
        let score = 0;
        let matched = 0;
        for (const term of terms) {
            const inTitle = foldedTitle.includes(term) ? 5 : 0;
            const inBody = Math.min(countOf(foldedBody, term), 5);
            if (inTitle || inBody) {
                matched++;
                score += inTitle + inBody;
            }
        }
        if (matched > 0) {
            hits.push({ path: note.path, title, snippet: snippet(body, foldedBody, terms), score, matched });
        }
    }
    return hits
        .sort((a, b) => b.matched - a.matched || b.score - a.score || a.path.localeCompare(b.path))
        .slice(0, limit)
        .map(({ matched: _matched, ...hit }) => hit);
}

function countOf (haystack: string, needle: string): number {
    let count = 0;
    for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + needle.length)) {
        count++;
    }
    return count;
}

/**
 * About 240 characters around the first term found. Folding keeps lengths
 * for Latin text (accents are combining marks, removed one for one after NFD
 * splits them), so positions are mapped on the NFD form of the body.
 */
function snippet (body: string, foldedBody: string, terms: string[]): string {
    const decomposed = body.normalize("NFD");
    const positions = terms.map(term => foldedBody.indexOf(term)).filter(at => at >= 0);
    const first = positions.length ? Math.min(...positions) : 0;
    // Index in the folded text → index in the decomposed text.
    let seen = 0;
    let index = 0;
    for (; index < decomposed.length && seen < first; index++) {
        if (!/\p{Diacritic}/u.test(decomposed[index] ?? "")) {
            seen++;
        }
    }
    const start = Math.max(0, index - 80);
    const text = decomposed.slice(start, start + 240).normalize("NFC").replace(/\s+/g, " ").trim();
    return `${start > 0 ? "…" : ""}${text}${start + 240 < decomposed.length ? "…" : ""}`;
}
