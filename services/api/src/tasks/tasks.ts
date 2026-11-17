import { appendText } from "../vault/editing.js";
import { fold, type Note } from "../vault/notes.js";
import { addDays, longDay, nextWeekday, parseWhen, shortDay, weekday } from "./when.js";

/**
 * Edward's to-dos: task lines anywhere in the vault, dated the way the
 * Obsidian Tasks plugin writes it (`- [ ] Faire la facturation 📅 2026-11-18`),
 * so the plugin reads them too if he installs it. New ones go to Tasks.md.
 * Pure: the service reads and commits.
 */

export const TASKS_PATH = "Tasks.md";

export const DEFAULT_TASKS_NOTE = `---
tags: [system]
---
# Tasks

My to-dos, one line each with its day: \`- [ ] what 📅 2026-11-18\`. Claude and the Brain bot add
them here and ask for when; the bot sends the day's list at 08:00, and ticking one there ticks it
here (✅ and the day it was done). Ticked lines are cleared at the monthly look-back. Actions from
a meeting stay in its note: with a 📅 day they are in the morning list too.

## To do
`;

export interface Task {
    path: string
    /** Index of its line in the note. */
    line: number
    /** The words, without the dates the Tasks plugin adds. */
    text: string
    due?: string
    done: boolean
}

const TASK_LINE = /^(\s*[-*+] \[)([ xX])(\]\s+)(.*\S)\s*$/;
const FENCE = /^\s*(?:```|~~~)/;
/** The Tasks plugin's dated fields: due, scheduled, start, created, done, cancelled. */
const DATE_FIELDS = /\s*[📅⏳🛫➕✅❌]️?\s*\d{4}-\d{2}-\d{2}/gu;
const DUE = /📅️?\s*(\d{4}-\d{2}-\d{2})/u;

/** The task lines of a note, outside code blocks. */
export function tasksIn (note: Note): Task[] {
    const tasks: Task[] = [];
    let inFence = false;
    note.content.split("\n").forEach((line, index) => {
        if (FENCE.test(line)) {
            inFence = !inFence;
            return;
        }
        const match = inFence ? null : TASK_LINE.exec(line);
        if (match) {
            const body = match[4]!;
            tasks.push({ path: note.path, line: index, text: taskText(body), due: DUE.exec(body)?.[1], done: match[2] !== " " });
        }
    });
    return tasks;
}

/** A task's words without its dates. */
export function taskText (body: string): string {
    return body.replace(DATE_FIELDS, "").replace(/\s+/g, " ").trim();
}

/** Open tasks of the notes that count: templates and the archive left out. */
export function openTasksOf (notes: Note[]): Task[] {
    return notes
        .filter(note => !note.path.startsWith("Templates/") && !note.path.startsWith("Archive/"))
        .flatMap(tasksIn)
        .filter(task => !task.done);
}

/** `- [ ] Faire la facturation 📅 2026-11-18` */
export function taskLine (text: string, due?: string | null): string {
    return `- [ ] ${text.replace(/\s+/g, " ").trim()}${due ? ` 📅 ${due}` : ""}`;
}

/** Tasks.md with these to-dos added under "To do" (or at the end), created from the default when missing. */
export function withTasksAdded (content: string | undefined, items: string[], due?: string | null): string {
    const note = content ?? DEFAULT_TASKS_NOTE;
    const lines = items.map(item => taskLine(item, due)).join("\n");
    try {
        return appendText(note, lines, "To do");
    } catch {
        return appendText(note, lines);
    }
}

const same = (a: string, b: string) => fold(a).replace(/\s+/g, " ").trim() === fold(b).replace(/\s+/g, " ").trim();

/**
 * The open task with these words, Tasks.md first, then anywhere. Exact words
 * first; accents, case and spacing ignored after.
 */
export function findOpenTask (notes: Note[], text: string): Task | undefined {
    const open = openTasksOf(notes).sort((a, b) => Number(b.path === TASKS_PATH) - Number(a.path === TASKS_PATH));
    const wanted = taskText(text.replace(/^\s*[-*+] \[[ xX]\]\s*/, ""));
    return open.find(task => task.text === wanted) ?? open.find(task => same(task.text, wanted));
}

/** The note with one task line rewritten by `change`. */
export function rewriteTask (content: string, task: Task, change: (line: string) => string): string {
    const lines = content.split("\n");
    lines[task.line] = change(lines[task.line]!);
    return lines.join("\n");
}

/** The line ticked, with ✅ and the day it was done. */
export function ticked (line: string, today: string): string {
    return `${line.replace(TASK_LINE, "$1x$3$4")} ✅ ${today}`;
}

/** The line with its 📅 day set, changed or (null) removed. */
export function redated (line: string, due: string | null): string {
    const without = line.replace(/\s*📅️?\s*\d{4}-\d{2}-\d{2}/u, "").replace(/\s+$/, "");
    return due ? `${without} 📅 ${due}` : without;
}

/** What starts a to-do sent to the bot: "À faire :", "To-do pour demain :", "/todo". */
const TODO_KEYWORD = /^\s*(?:to[\s-]?dos?|à faire|a faire|tâches?|taches?)(?=[\s:,–—-]|$)/iu;
const LIST_MARKER = /^\s*(?:[-*+•]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/u;
/** Between the to-do word (and its day) and the to-dos. */
const SEPARATOR = /[:,–—]|\s-\s/u;

export interface TodoRequest {
    items: string[]
    /** A day it named, null for "no date", undefined when it did not say. */
    due?: string | null
}

/**
 * The to-dos in a message that starts with a to-do word, and the day it
 * names right after it: "To-do pour demain :\n- A\n- B", "À faire : appeler
 * Jean", "À faire vendredi, envoyer le budget". Anything else: undefined.
 * `explicit` (the /todo command) needs no keyword.
 */
export function parseTodo (words: string, today: string, explicit = false): TodoRequest | undefined {
    let rest = words.trim();
    const keyword = TODO_KEYWORD.exec(rest);
    if (keyword) {
        rest = rest.slice(keyword[0].length);
    } else if (!explicit) {
        return undefined;
    }
    // A day right after the keyword: the longest run of up to five words, before
    // any separator, that names one ("pour demain", "lundi prochain", "le 3 décembre").
    let due: string | null | undefined;
    const segment = rest.split("\n", 1)[0]!.split(SEPARATOR, 1)[0]!;
    const tokens = [...segment.matchAll(/\S+/gu)].slice(0, 5);
    for (let count = tokens.length; count >= 1; count--) {
        const parsed = parseWhen(tokens.slice(0, count).map(token => token[0]).join(" "), today);
        if (parsed !== undefined) {
            due = parsed;
            const last = tokens[count - 1]!;
            rest = rest.slice(last.index + last[0].length);
            break;
        }
    }
    const separated = new RegExp(`^\\s*(?:${SEPARATOR.source})`, "u").test(rest) || /^[ \t]*\n/.test(rest);
    if (keyword && !explicit && due === undefined && !separated) {
        // "To do this, we need…" is a sentence, not a to-do.
        return undefined;
    }
    rest = rest.replace(new RegExp(`^\\s*(?:${SEPARATOR.source})?\\s*`, "u"), "");
    // One to-do per line, list markers off; a line ending with ":" heads the list.
    const items = rest.split("\n")
        .map(line => line.replace(LIST_MARKER, "").replace(/\s+/g, " ").trim())
        .filter(line => line && !line.endsWith(":"))
        .slice(0, 20);
    if (items.length === 1 && due === undefined) {
        // "Appeler Jean pour vendredi": a day at the end, after "pour" or "for".
        const trailing = /\s+((?:pour|for|by|d'ici|d’ici|avant|before)\s+(?:\S+\s*){1,4})$/iu.exec(items[0]!);
        const parsed = trailing ? parseWhen(trailing[1]!, today) : undefined;
        if (trailing && parsed !== undefined) {
            due = parsed;
            items[0] = items[0]!.slice(0, trailing.index).replace(/[\s,]+$/u, "");
        }
    }
    return items.length > 0 && items.every(Boolean) ? { items, due } : undefined;
}

export interface Button {
    text: string
    data: string
}

/** The days offered for a to-do: today, tomorrow, this Friday, next Monday, no date. */
export function dueButtons (today: string): Button[][] {
    const tomorrow = addDays(today, 1);
    const friday = addDays(today, (5 - weekday(today) + 7) % 7);
    const monday = nextWeekday(today, 1);
    const later = [friday, monday].filter(day => day > tomorrow);
    return [
        [{ text: "Today", data: `due:${today}` }, { text: "Tomorrow", data: `due:${tomorrow}` }],
        ...(later.length ? [[...new Set(later)].map(day => ({ text: shortDay(day), data: `due:${day}` }))] : []),
        [{ text: "No date", data: "due:none" }]
    ];
}

/** The bot's answer to new to-dos; its "• " lines are how a button finds them again. */
export function todoMessage (items: string[], due: string | null | undefined): string {
    const head = items.length === 1 ? "📝 To-do" : `📝 ${items.length} to-dos`;
    const when = due === undefined
        ? "📅 For when? Tap, or reply with a day (« jeudi », « 25/11 »)."
        : due === null ? "📅 No date" : `📅 ${shortDay(due)}`;
    return [head, ...items.map(item => `• ${item}`), when].join("\n");
}

/** The to-dos a bot message lists, from its "• " lines. */
export function itemsOf (message: string): string[] {
    return message.split("\n").filter(line => line.startsWith("• ")).map(line => line.slice(2).trim());
}

export interface BriefMeeting {
    time: string
    title: string
    prep?: { done: number; total: number }
}

export interface Brief {
    text: string
    buttons: Button[][]
}

/**
 * The morning message: the day's meetings, the to-dos due today and late
 * ones, numbered so a button ticks each, and what waits in the inbox.
 */
export function briefMessage (input: { today: string; meetings?: BriefMeeting[]; calendarFailed?: boolean; tasks: Task[]; inbox: number; heading?: string }): Brief {
    const { today } = input;
    const dueToday = input.tasks.filter(task => task.due === today);
    const late = input.tasks.filter(task => task.due !== undefined && task.due < today).sort((a, b) => a.due!.localeCompare(b.due!));
    const undated = input.tasks.filter(task => task.due === undefined && task.path === TASKS_PATH).length;
    const lines = [input.heading ?? `☀️ ${longDay(today)}`];

    if (input.meetings) {
        lines.push("", input.meetings.length ? "📅 Meetings" : "📅 No meetings today.");
        for (const meeting of input.meetings) {
            const prep = meeting.prep && meeting.prep.total > 0 ? ` · prep ${meeting.prep.done}/${meeting.prep.total}` : "";
            lines.push(`${meeting.time} ${meeting.title}${prep}`);
        }
    } else if (input.calendarFailed) {
        lines.push("", "📅 The calendar did not answer.");
    }

    let number = 0;
    const buttons: Button[] = [];
    const list = (title: string, tasks: Task[]) => {
        if (tasks.length === 0) {
            return;
        }
        lines.push("", title);
        for (const task of tasks.slice(0, 30)) {
            number++;
            lines.push(`${number}. ${task.text}`);
            buttons.push({ text: `✓ ${number}`, data: `done:${number}` });
        }
    };
    list("✅ To do today", dueToday);
    list("⏰ Late", late);
    if (dueToday.length === 0 && late.length === 0) {
        lines.push("", "✅ Nothing due today.");
    }

    const footer = [
        input.inbox ? `📥 ${input.inbox} in the inbox` : undefined,
        undated ? `${undated} to-do${undated === 1 ? "" : "s"} without a day (/todo)` : undefined
    ].filter(Boolean);
    if (footer.length) {
        lines.push("", footer.join(" · "));
    }
    const rows: Button[][] = [];
    for (let index = 0; index < buttons.length; index += 5) {
        rows.push(buttons.slice(index, index + 5));
    }
    return { text: lines.join("\n"), buttons: rows };
}

/** The brief once task `number` is done: its line ticked, its button gone. */
export function briefTicked (message: string, number: number, buttons: Button[][]): { text: string; buttons: Button[][]; task?: string } {
    let task: string | undefined;
    const text = message.split("\n").map(line => {
        const match = /^(\d+)\. (.+)$/.exec(line);
        if (match && Number(match[1]) === number) {
            task = match[2]!;
            return `✔️ ${match[2]}`;
        }
        return line;
    }).join("\n");
    const rows = buttons.map(row => row.filter(button => button.data !== `done:${number}`)).filter(row => row.length > 0);
    return { text, buttons: rows, task };
}

/** Every open to-do, by day: late, today, coming, then without a day. */
export function todoList (tasks: Task[], today: string): string {
    if (tasks.length === 0) {
        return "No open to-dos.";
    }
    const dated = tasks.filter(task => task.due).sort((a, b) => a.due!.localeCompare(b.due!));
    const lines: string[] = [];
    let current: string | undefined;
    for (const task of dated) {
        const group = task.due! < today ? "⏰ Late" : task.due === today ? "Today" : shortDay(task.due!);
        if (group !== current) {
            lines.push("", group);
            current = group;
        }
        lines.push(`• ${task.text}${task.path === TASKS_PATH ? "" : `  (${task.path.replace(/\.md$/, "")})`}`);
    }
    const undated = tasks.filter(task => !task.due && task.path === TASKS_PATH);
    if (undated.length) {
        lines.push("", "No day");
        lines.push(...undated.map(task => `• ${task.text}`));
    }
    return lines.join("\n").trim();
}

