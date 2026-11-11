/**
 * Meeting prep, as pure functions: which meetings get a note and when, what
 * the note says, and what the reminders say.
 */
import { fold, noteTitle, safeFileTitle, stripFrontmatter, zonedParts, type Note } from "../vault/notes.js";
import type { Occurrence } from "./calendar.js";

export const RULES_PATH = "Meetings/Rules.md";

export const DEFAULT_RULES_NOTE = `---
tags: [system]
---
# Meeting rules

How many days before a meeting its prep note is created, by words in the
meeting's title. The first line that matches wins; \`*\` matches every other
meeting. \`skip\`: no prep note. Whole words only: "CA" does not match "Café".

| Title contains | Days before |
| --- | --- |
| Conseil d'administration | 7 |
| CA | 7 |
| * | 2 |
`;

export interface Rule {
    pattern: string
    /** null: no prep note for these meetings. */
    days: number | null
}

/** The rules table of Meetings/Rules.md; a default when the note has none. */
export function parseRules (markdown: string | undefined): Rule[] {
    const rules: Rule[] = [];
    for (const line of (markdown ?? "").split("\n")) {
        const cells = line.trim().replace(/^\||\|$/g, "").split("|").map(cell => cell.trim());
        if (cells.length < 2 || !line.trim().startsWith("|")) {
            continue;
        }
        const [pattern = "", value = ""] = cells;
        const days = /^skip$/i.test(value) || value === "0" ? null : /^\d+$/.test(value) ? Number(value) : undefined;
        if (pattern && days !== undefined) {
            rules.push({ pattern, days });
        }
    }
    return rules.length > 0 ? rules : [{ pattern: "*", days: 2 }];
}

/** The first rule whose words appear, whole, in the title. */
export function ruleFor (title: string, rules: Rule[]): Rule | undefined {
    const folded = fold(title);
    return rules.find(rule => {
        if (rule.pattern === "*") {
            return true;
        }
        const escaped = fold(rule.pattern).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, "u").test(folded);
    });
}

/** Whole days between two instants' dates in a zone (calendar days, not 24 h). */
export function daysBetween (from: Date, to: Date, timeZone: string): number {
    const day = (at: Date) => Date.parse(`${zonedParts(at, timeZone).date}T00:00:00Z`);
    return Math.round((day(to) - day(from)) / 86_400_000);
}

const MONTHS = /\b(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre|january|february|march|april|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/g;

/** The same meeting across dates: title folded, without numbers or month names. */
export function seriesKey (title: string): string {
    return fold(title).replace(MONTHS, " ").replace(/[\d/.-]+/g, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** `Meetings/2026-11-14 1800 CA.md` */
export function prepPath (occurrence: Occurrence, timeZone: string): string {
    const { date, time } = zonedParts(occurrence.start, timeZone);
    return `Meetings/${date} ${time} ${safeFileTitle(occurrence.title)}.md`;
}

/** "Fri 14 Nov 18:00" */
export function shortWhen (at: Date, timeZone: string): string {
    return new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
        .format(at).replace(",", "");
}

function longWhen (occurrence: Occurrence, timeZone: string): string {
    const day = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(occurrence.start).replace(",", "");
    const time = (at: Date) => new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
    return `${day}, ${time(occurrence.start)}–${time(occurrence.end)}`;
}

/** Unticked tasks of a note (`- [ ] …`), its "To prepare" list left out. */
export function openActions (content: string): string[] {
    const body = stripFrontmatter(content).replace(/## To prepare[\s\S]*?(?=\n## |$)/, "");
    return body.split("\n")
        .map(line => /^\s*[-*] \[ \] (.+)$/.exec(line)?.[1]?.trim())
        .filter((task): task is string => Boolean(task));
}

/** Ticked and total boxes under "## To prepare". */
export function prepProgress (content: string): { done: number; total: number } {
    const section = /## To prepare\n([\s\S]*?)(?=\n## |$)/.exec(content)?.[1] ?? "";
    const boxes = section.split("\n").filter(line => /^\s*[-*] \[[ xX]\] \S/.test(line));
    return { done: boxes.filter(line => /\[[xX]\]/.test(line)).length, total: boxes.length };
}

/** The latest earlier note of the same series, if any. */
export function previousInSeries (occurrence: Occurrence, notes: Note[], timeZone: string): Note | undefined {
    const key = seriesKey(occurrence.title);
    const own = prepPath(occurrence, timeZone);
    return notes
        .filter(note => note.path.startsWith("Meetings/") && note.path !== own && note.path < own && note.path !== RULES_PATH)
        .filter(note => {
            const series = /^series:\s*(.+)$/m.exec(note.content)?.[1]?.trim();
            return (series ?? seriesKey(noteTitle(note))) === key;
        })
        .sort((a, b) => b.path.localeCompare(a.path))[0];
}

const link = (path: string, label?: string) => `[[${path.replace(/\.md$/, "")}${label ? `|${label}` : ""}]]`;

/** The prep note, in the vault's conventions. */
export function prepNote (occurrence: Occurrence, context: { previous?: Note; related: { path: string; title: string }[]; today: Date }, timeZone: string): string {
    const { iso } = zonedParts(occurrence.start, timeZone);
    const lines = [
        "---",
        `created: ${zonedParts(context.today, timeZone).date}`,
        `meeting: ${iso}`,
        `series: ${seriesKey(occurrence.title)}`,
        "tags: [meeting]",
        "---",
        `# ${occurrence.title} — ${shortWhen(occurrence.start, timeZone)}`,
        "",
        `**When:** ${longWhen(occurrence, timeZone)}`
    ];
    if (occurrence.location) {
        lines.push(`**Where:** ${occurrence.location}`);
    }
    if (occurrence.description) {
        lines.push("", "## From the invite", "", ...occurrence.description.split("\n").map(line => (line ? `> ${line}` : ">")));
    }
    if (context.previous) {
        const actions = openActions(context.previous.content);
        const date = /^meeting:\s*(\d{4}-\d{2}-\d{2})/m.exec(context.previous.content)?.[1] ?? context.previous.path.slice(9, 19);
        lines.push("", "## Last time", "", `${link(context.previous.path, `${noteTitle(context.previous).replace(/ — .*$/, "")}, ${date}`)}`);
        if (actions.length > 0) {
            lines.push("", "Still open from then:", ...actions.map(action => `- [ ] ${action}`));
        }
    }
    if (context.related.length > 0) {
        lines.push("", "## Related notes", "", ...context.related.map(note => `- ${link(note.path, note.title)}`));
    }
    lines.push(
        "",
        "## To prepare",
        "",
        ...(context.previous ? ["- [ ] Reread last time's notes and open actions"] : []),
        "- [ ] What I want out of this meeting",
        "- [ ] What I need to bring or send beforehand",
        "",
        "## Notes",
        "",
        "## Decisions",
        "",
        "## Actions",
        "",
        "- [ ] ",
        ""
    );
    return lines.join("\n");
}

export function createdMessage (occurrence: Occurrence, days: number, path: string, openFromLastTime: number, timeZone: string): string {
    const when = days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
    const open = openFromLastTime > 0 ? `\n${openFromLastTime} action${openFromLastTime === 1 ? "" : "s"} still open from last time.` : "";
    return `📅 ${occurrence.title} — ${shortWhen(occurrence.start, timeZone)}, ${when}.\nPrep note ready: ${path}${open}`;
}

export function eveMessage (occurrence: Occurrence, progress: { done: number; total: number }, timeZone: string): string {
    const time = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(occurrence.start);
    const state = progress.total === 0 ? "" : progress.done === progress.total ? " Prep done ✓" : ` Prep ${progress.done}/${progress.total} done.`;
    return `⏰ Tomorrow ${time}: ${occurrence.title}.${state}`;
}
