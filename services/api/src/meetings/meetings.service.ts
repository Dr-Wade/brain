import { Logger, type OnApplicationBootstrap, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";

import type { AppConfig } from "../config/app-config.js";
import type { TelegramService } from "../telegram/telegram.service.js";
import type { FetchLike } from "../vault/github.js";
import { zonedParts, type Note } from "../vault/notes.js";
import type { VaultService } from "../vault/vault.service.js";
import { occurrencesBetween, type Occurrence } from "./calendar.js";
import {
    createdMessage,
    daysBetween,
    DEFAULT_RULES_NOTE,
    eveMessage,
    openActions,
    parseRules,
    prepNote,
    prepPath,
    prepProgress,
    previousInSeries,
    ruleFor,
    RULES_PATH,
    shortWhen
} from "./prep.js";

/** Who has already been told what: one key per pass and per reminder. */
export interface ReminderLog {
    /** True the first time a key is claimed, false ever after. */
    claim (key: string): Promise<boolean>
    release (key: string): Promise<void>
}

export interface UpcomingMeeting {
    title: string
    start: Date
    when: string
    location?: string
    prepNote?: string
    prep?: { done: number; total: number }
}

type Vault = Pick<VaultService, "notesUnder" | "createNote" | "search">;
type Notifier = Pick<TelegramService, "notifyOwner" | "registerCommand">;

/** How often the clock is checked against MEETINGS_RUN_AT. */
const TICK_MS = 10 * 60 * 1000;
/** The published calendar is fetched again after this. */
const FEED_TTL_MS = 10 * 60 * 1000;
const DAY_MS = 86_400_000;

/**
 * Meeting prep from the published calendar. Once a day (MEETINGS_RUN_AT, in
 * the vault's zone) it creates a prep note for each meeting as soon as it is
 * within its rule's days (Meetings/Rules.md), tells Edward on Telegram, and
 * the day before a meeting says how far the prep got.
 */
export class MeetingsService implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy {
    private readonly logger = new Logger(MeetingsService.name);
    private readonly fetchImpl: FetchLike;
    private readonly now: () => Date;
    private timer?: NodeJS.Timeout;
    private feed?: { ics: string; at: number };

    constructor (
        private readonly config: AppConfig,
        private readonly vault: Vault,
        private readonly notifier: Notifier,
        private readonly log: ReminderLog,
        // Test seams: the calendar's HTTP and the clock.
        deps: { fetchImpl?: FetchLike; now?: () => Date } = {}
    ) {
        this.fetchImpl = deps.fetchImpl ?? fetch;
        this.now = deps.now ?? (() => new Date());
    }

    get configured (): boolean {
        return Boolean(this.config.env.CALENDAR_ICS_URL);
    }

    onModuleInit (): void {
        if (this.configured) {
            this.notifier.registerCommand("next", { description: "Meetings in the next 7 days", run: () => this.nextCommand() });
        }
    }

    onApplicationBootstrap (): void {
        if (!this.configured || this.config.env.NODE_ENV !== "production") {
            return;
        }
        // A first check right away: a restart after the hour still runs today's pass.
        void this.tick();
        this.timer = setInterval(() => void this.tick(), TICK_MS);
        this.timer.unref();
    }

    onModuleDestroy (): void {
        clearInterval(this.timer);
    }

    /** Runs the day's pass once, at or after MEETINGS_RUN_AT. */
    async tick (): Promise<void> {
        const { date, time } = zonedParts(this.now(), this.config.env.VAULT_TIMEZONE);
        if (time < this.config.env.MEETINGS_RUN_AT.replace(":", "")) {
            return;
        }
        const key = `run:${date}`;
        if (!await this.log.claim(key)) {
            return;
        }
        try {
            const result = await this.run();
            this.logger.log(`Meeting pass ${date}: ${result.created.length} prep notes, ${result.reminded.length} reminders`);
        } catch (error) {
            // Released, so the next tick tries again.
            await this.log.release(key);
            this.logger.error(`Meeting pass ${date} failed: ${(error as Error).message}`);
        }
    }

    /** The day's pass: prep notes due, and eve-of-meeting reminders. */
    async run (): Promise<{ created: string[]; reminded: string[] }> {
        const timeZone = this.config.env.VAULT_TIMEZONE;
        const now = this.now();
        let notes = await this.vault.notesUnder("Meetings");
        let rulesNote = notes.find(note => note.path === RULES_PATH);
        if (!rulesNote) {
            // Where Edward tunes the lead times; created once, then his.
            await this.vault.createNote(RULES_PATH, DEFAULT_RULES_NOTE, "Meeting rules: the defaults");
            rulesNote = { path: RULES_PATH, content: DEFAULT_RULES_NOTE };
        }
        const rules = parseRules(rulesNote.content);
        const horizon = Math.max(1, ...rules.map(rule => rule.days ?? 0));
        const occurrences = await this.occurrences(now, new Date(now.getTime() + (horizon + 1) * DAY_MS));

        const created: string[] = [];
        const reminded: string[] = [];
        for (const occurrence of occurrences) {
            if (occurrence.allDay || occurrence.cancelled || occurrence.start <= now) {
                continue;
            }
            const rule = ruleFor(occurrence.title, rules);
            const days = daysBetween(now, occurrence.start, timeZone);
            if (!rule || rule.days === null || days > rule.days) {
                continue;
            }
            const path = prepPath(occurrence, timeZone);
            const previous = previousInSeries(occurrence, notes, timeZone);
            let note = notes.find(candidate => candidate.path === path);
            if (!note) {
                const related = (await this.vault.search(occurrence.title, 8))
                    .filter(hit => !/^(Meetings|Inbox|Templates)\//.test(hit.path) && hit.path !== "Home.md")
                    .slice(0, 3);
                const content = prepNote(occurrence, { previous, related, today: now }, timeZone);
                const result = await this.vault.createNote(path, content, `Meeting prep: ${occurrence.title}`);
                note = { path, content };
                notes = [...notes, note];
                if (result.created) {
                    created.push(path);
                }
            }
            // Announced once, whenever it was made: a send that failed (no chat
            // with the bot yet, Telegram down) goes out at the next pass.
            const open = previous ? openActions(previous.content).length : 0;
            if (await this.notify(`created:${path}`, createdMessage(occurrence, days, path, open, timeZone))) {
                reminded.push(`created:${path}`);
            }
            if (days === 1 && await this.notify(`eve:${path}`, eveMessage(occurrence, prepProgress(note.content), timeZone))) {
                reminded.push(`eve:${path}`);
            }
        }
        return { created, reminded };
    }

    /** The coming meetings, with their prep notes when there are some. */
    async upcoming (days = 7): Promise<UpcomingMeeting[]> {
        const timeZone = this.config.env.VAULT_TIMEZONE;
        const now = this.now();
        const [occurrences, notes] = await Promise.all([
            this.occurrences(now, new Date(now.getTime() + days * DAY_MS)),
            this.vault.notesUnder("Meetings")
        ]);
        return occurrences
            .filter(occurrence => !occurrence.allDay && !occurrence.cancelled)
            .map(occurrence => {
                const note: Note | undefined = notes.find(candidate => candidate.path === prepPath(occurrence, timeZone));
                return {
                    title: occurrence.title,
                    start: occurrence.start,
                    when: shortWhen(occurrence.start, timeZone),
                    location: occurrence.location,
                    prepNote: note?.path,
                    prep: note ? prepProgress(note.content) : undefined
                };
            });
    }

    private async nextCommand (): Promise<string> {
        const meetings = await this.upcoming(7);
        if (meetings.length === 0) {
            return "No meetings in the next 7 days.";
        }
        return meetings.map(meeting => {
            const prep = meeting.prep ? (meeting.prep.total > 0 ? ` (prep ${meeting.prep.done}/${meeting.prep.total})` : " (prep note)") : "";
            return `• ${meeting.when} — ${meeting.title}${prep}`;
        }).join("\n");
    }

    /** Sends once per key; a failed send is released, to go out next pass. */
    private async notify (key: string, text: string): Promise<boolean> {
        if (!await this.log.claim(key)) {
            return false;
        }
        try {
            if (await this.notifier.notifyOwner(text)) {
                return true;
            }
        } catch (error) {
            this.logger.error(`Reminder ${key} not sent: ${(error as Error).message}`);
        }
        await this.log.release(key);
        return false;
    }

    private async occurrences (from: Date, to: Date): Promise<Occurrence[]> {
        const url = this.config.env.CALENDAR_ICS_URL;
        if (!url) {
            return [];
        }
        if (!this.feed || this.now().getTime() - this.feed.at > FEED_TTL_MS) {
            const response = await this.fetchImpl(url);
            if (!response.ok) {
                // Never the URL: anyone holding it reads the calendar.
                throw new Error(`The published calendar answered ${response.status}`);
            }
            this.feed = { ics: await response.text(), at: this.now().getTime() };
        }
        return occurrencesBetween(this.feed.ics, from, to);
    }
}
