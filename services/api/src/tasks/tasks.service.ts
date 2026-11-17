import { Logger, type OnApplicationBootstrap, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";

import type { AppConfig } from "../config/app-config.js";
import type { MeetingsService, ReminderLog } from "../meetings/meetings.service.js";
import type { BotReply, TelegramService } from "../telegram/telegram.service.js";
import { TaskNotFoundError, VaultRuleError } from "../vault/errors.js";
import { zonedParts } from "../vault/notes.js";
import type { VaultService } from "../vault/vault.service.js";
import {
    briefMessage,
    briefTicked,
    dueButtons,
    findOpenTask,
    itemsOf,
    openTasksOf,
    parseTodo,
    redated,
    rewriteTask,
    TASKS_PATH,
    ticked,
    todoList,
    todoMessage,
    withTasksAdded,
    type Brief,
    type Task
} from "./tasks.js";
import { parseWhen, shortDay } from "./when.js";

type Vault = Pick<VaultService, "notes" | "change" | "inbox">;
type Bot = Pick<TelegramService, "configured" | "notifyOwner" | "registerCommand" | "registerCallback" | "registerInterceptor">;
type Calendar = Pick<MeetingsService, "configured" | "onDay">;

/** How often the clock is checked against BRIEF_AT. */
const TICK_MS = 60_000;
/** After this long past BRIEF_AT (a restart at night), the day's brief is skipped. */
const BRIEF_WINDOW_MINUTES = 180;
/** A typed answer to "for when?" counts this long after the question. */
const ANSWER_WINDOW_MS = 15 * 60_000;

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(-2));

/**
 * Edward's to-dos: added from Claude or the bot (which asks for when), listed
 * every morning at BRIEF_AT with the day's meetings, ticked from the brief's
 * buttons. They live in Tasks.md (see tasks.ts for the line format).
 */
export class TasksService implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy {
    private readonly logger = new Logger(TasksService.name);
    private readonly now: () => Date;
    private timer?: NodeJS.Timeout;
    private briefSentOn?: string;
    /** The to-dos the bot last asked "for when?" about. */
    private asking?: { items: string[]; at: number };

    constructor (
        private readonly config: AppConfig,
        private readonly vault: Vault,
        private readonly bot: Bot,
        private readonly calendar: Calendar | undefined,
        private readonly log: ReminderLog,
        // Test seam: the clock.
        deps: { now?: () => Date } = {}
    ) {
        this.now = deps.now ?? (() => new Date());
    }

    /** Today in the vault's zone, `2026-11-18`. */
    today (): string {
        return zonedParts(this.now(), this.config.env.VAULT_TIMEZONE).date;
    }

    onModuleInit (): void {
        this.bot.registerCommand("todo", {
            description: "Add a to-do: /todo words. Alone: every open to-do",
            run: args => (args ? this.todoCommand(args) : this.listCommand())
        });
        this.bot.registerCommand("today", { description: "Today's meetings and to-dos", run: () => this.brief() });
        this.bot.registerCallback("due", tap => this.dueTap(tap));
        this.bot.registerCallback("done", tap => this.doneTap(tap));
        this.bot.registerInterceptor(words => this.intercept(words));
    }

    onApplicationBootstrap (): void {
        if (!this.bot.configured || this.config.env.NODE_ENV !== "production") {
            return;
        }
        void this.tick();
        this.timer = setInterval(() => void this.tick(), TICK_MS);
        this.timer.unref();
    }

    onModuleDestroy (): void {
        clearInterval(this.timer);
    }

    /** New to-dos at the end of Tasks.md (made when missing), with their day when known. */
    async add (items: string[], due?: string | null): Promise<{ path: string; items: string[] }> {
        const clean = items.map(item => item.replace(/\s+/g, " ").trim()).filter(Boolean);
        if (clean.length === 0) {
            throw new VaultRuleError("There is no to-do to add.");
        }
        return await this.vault.change(notes => ({
            message: `To-do: ${clean[0]}${clean.length > 1 ? ` (+${clean.length - 1})` : ""}`,
            files: [{ path: TASKS_PATH, content: withTasksAdded(notes.find(note => note.path === TASKS_PATH)?.content, clean, due) }],
            result: { path: TASKS_PATH, items: clean }
        }));
    }

    /** Gives open to-dos a day (or, null, none). Answers which were found. */
    async setDue (items: string[], due: string | null): Promise<{ found: string[]; missing: string[] }> {
        return await this.vault.change(notes => {
            const changed = new Map<string, string>();
            const found: string[] = [];
            const missing: string[] = [];
            for (const item of items) {
                // Each change seen by the next: two to-dos in one note.
                const current = notes.map(note => ({ path: note.path, content: changed.get(note.path) ?? note.content }));
                const task = findOpenTask(current, item);
                if (!task) {
                    missing.push(item);
                    continue;
                }
                const content = current.find(note => note.path === task.path)!.content;
                changed.set(task.path, rewriteTask(content, task, line => redated(line, due)));
                found.push(task.text);
            }
            return {
                message: `To-do: ${due ? shortDay(due) : "no date"} for ${found[0] ?? items[0]}${found.length > 1 ? ` (+${found.length - 1})` : ""}`,
                files: [...changed].map(([path, content]) => ({ path, content })),
                result: { found, missing }
            };
        });
    }

    /** Ticks an open to-do (✅ and today), wherever it is. */
    async complete (text: string): Promise<{ path: string; text: string }> {
        const today = this.today();
        return await this.vault.change(notes => {
            const task = findOpenTask(notes, text);
            if (!task) {
                throw new TaskNotFoundError(text);
            }
            const note = notes.find(candidate => candidate.path === task.path)!;
            return {
                message: `Done: ${task.text}`,
                files: [{ path: task.path, content: rewriteTask(note.content, task, line => ticked(line, today)) }],
                result: { path: task.path, text: task.text }
            };
        });
    }

    /** Open to-dos, with their days. */
    async open (): Promise<Task[]> {
        return openTasksOf(await this.vault.notes());
    }

    /** The morning message: the day's meetings, the to-dos due and late, the inbox. */
    async brief (): Promise<Brief> {
        const today = this.today();
        const [notes, inbox, day] = await Promise.all([this.vault.notes(), this.vault.inbox(), this.meetingsOf(today)]);
        return briefMessage({ today, tasks: openTasksOf(notes), inbox: inbox.length, ...day });
    }

    /** Sends the day's brief once, at or after BRIEF_AT. */
    async tick (): Promise<void> {
        const { date, time } = zonedParts(this.now(), this.config.env.VAULT_TIMEZONE);
        const late = minutes(time) - minutes(this.config.env.BRIEF_AT);
        if (late < 0 || late > BRIEF_WINDOW_MINUTES || this.briefSentOn === date) {
            return;
        }
        const key = `brief:${date}`;
        if (!await this.log.claim(key)) {
            this.briefSentOn = date;
            return;
        }
        try {
            const brief = await this.brief();
            if (await this.bot.notifyOwner(brief.text, brief.buttons)) {
                this.briefSentOn = date;
                return;
            }
        } catch (error) {
            this.logger.error(`Brief ${date} not sent: ${(error as Error).message}`);
        }
        // Released, so the next tick tries again.
        await this.log.release(key);
    }

    private async meetingsOf (today: string): Promise<{ meetings?: Awaited<ReturnType<Calendar["onDay"]>>; calendarFailed?: boolean }> {
        if (!this.calendar?.configured) {
            return {};
        }
        try {
            return { meetings: await this.calendar.onDay(today) };
        } catch (error) {
            this.logger.warn(`No meetings in the brief: ${(error as Error).message}`);
            return { calendarFailed: true };
        }
    }

    /** "/todo words": the words are the to-do, a day at the start or after "pour" is its day. */
    private async todoCommand (args: string): Promise<BotReply> {
        const request = parseTodo(args, this.today(), true);
        return request ? await this.added(request.items, request.due) : "What should I add? /todo words";
    }

    private async listCommand (): Promise<string> {
        return todoList(await this.open(), this.today());
    }

    /**
     * A message Edward sends: a day, when the bot just asked "for when?";
     * a to-do, when it starts with a to-do word. Anything else is a capture.
     */
    private async intercept (words: string): Promise<BotReply | undefined> {
        const today = this.today();
        if (this.asking && this.now().getTime() - this.asking.at < ANSWER_WINDOW_MS) {
            const due = parseWhen(words, today);
            if (due !== undefined) {
                const { items } = this.asking;
                this.asking = undefined;
                const { found, missing } = await this.setDue(items, due);
                return this.dueAnswer(found, missing, due);
            }
        }
        const request = parseTodo(words, today);
        return request ? await this.added(request.items, request.due) : undefined;
    }

    private async added (items: string[], due: string | null | undefined): Promise<BotReply> {
        const saved = await this.add(items, due);
        this.asking = due === undefined ? { items: saved.items, at: this.now().getTime() } : undefined;
        return { text: todoMessage(saved.items, due), buttons: dueButtons(this.today()) };
    }

    private dueAnswer (found: string[], missing: string[], due: string | null): string {
        const lines = [`📅 ${due ? shortDay(due) : "No date"}`, ...found.map(item => `• ${item}`)];
        if (missing.length) {
            lines.push(`⚠️ Not found any more: ${missing.join(", ")}`);
        }
        return lines.join("\n");
    }

    /** A day button under a to-do message. */
    private async dueTap (tap: { data: string; text: string; buttons: { text: string; data: string }[][] }) {
        const value = tap.data.slice("due:".length);
        const due = value === "none" ? null : value;
        const items = itemsOf(tap.text);
        const { found, missing } = await this.setDue(items, due);
        if (this.asking && items.every(item => this.asking!.items.includes(item))) {
            this.asking = undefined;
        }
        const text = todoMessage(items, due) + (missing.length ? `\n⚠️ Not found any more: ${missing.join(", ")}` : "");
        return { edit: { text, buttons: tap.buttons }, toast: found.length ? (due ? shortDay(due) : "No date") : "Not found any more" };
    }

    /** A ✓ button under the brief. */
    private async doneTap (tap: { data: string; text: string; buttons: { text: string; data: string }[][] }) {
        const number = Number(tap.data.slice("done:".length));
        const after = briefTicked(tap.text, number, tap.buttons);
        if (!after.task) {
            return { toast: "Already ticked." };
        }
        try {
            await this.complete(after.task);
        } catch (error) {
            if (!(error instanceof TaskNotFoundError)) {
                throw error;
            }
            return { edit: { text: after.text, buttons: after.buttons }, toast: "It was already ticked in the vault." };
        }
        return { edit: { text: after.text, buttons: after.buttons }, toast: "Done ✓" };
    }
}
