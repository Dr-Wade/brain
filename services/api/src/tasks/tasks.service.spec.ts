import { describe, expect, it, vi } from "vitest";

import { AppConfig } from "../config/app-config.js";
import type { ReminderLog } from "../meetings/meetings.service.js";
import type { BotReply, CallbackHandler, MessageInterceptor, TelegramCommand } from "../telegram/telegram.service.js";
import type { Change } from "../vault/vault.service.js";
import type { Note } from "../vault/notes.js";
import { TASKS_PATH } from "./tasks.js";
import { TasksService } from "./tasks.service.js";

/** A vault in memory: `change` applies the files it answers. */
function fakeVault (initial: Note[]) {
    const notes = new Map(initial.map(note => [note.path, note.content]));
    const all = () => [...notes].map(([path, content]) => ({ path, content }));
    return {
        notes: vi.fn(async () => all()),
        inbox: vi.fn(async () => [{ path: "Inbox/a.md", title: "A", preview: "" }, { path: "Inbox/b.md", title: "B", preview: "" }]),
        async change<T> (compute: (notes: Note[]) => Change<T>): Promise<T> {
            const change = compute(all());
            for (const file of change.files) {
                if (file.content === null) {
                    notes.delete(file.path);
                } else {
                    notes.set(file.path, file.content);
                }
            }
            return change.result;
        },
        get: (path: string) => notes.get(path)
    };
}

function fakeBot () {
    const commands = new Map<string, TelegramCommand>();
    const callbacks = new Map<string, CallbackHandler>();
    const interceptors: MessageInterceptor[] = [];
    const sent: { text: string; buttons?: unknown }[] = [];
    return {
        configured: true,
        commands,
        callbacks,
        sent,
        registerCommand: (name: string, command: TelegramCommand) => void commands.set(name, command),
        registerCallback: (prefix: string, handler: CallbackHandler) => void callbacks.set(prefix, handler),
        registerInterceptor: (interceptor: MessageInterceptor) => void interceptors.push(interceptor),
        notifyOwner: vi.fn(async (text: string, buttons?: unknown) => {
            sent.push({ text, buttons });
            return true;
        }),
        /** Edward writes or dictates: the interceptors' answer, or undefined (a capture). */
        say: async (words: string): Promise<BotReply | undefined> => {
            for (const intercept of interceptors) {
                const answer = await intercept(words);
                if (answer) {
                    return answer;
                }
            }
            return undefined;
        }
    };
}

const textOf = (reply: BotReply | undefined) => (typeof reply === "string" ? reply : reply?.text);

function setup (options: { notes?: Note[]; now?: string; meetings?: () => Promise<{ time: string; title: string }[]> } = {}) {
    const vault = fakeVault(options.notes ?? []);
    const bot = fakeBot();
    const keys = new Set<string>();
    const log: ReminderLog = {
        claim: async key => !keys.has(key) && Boolean(keys.add(key)),
        release: async key => void keys.delete(key)
    };
    let now = new Date(options.now ?? "2026-11-17T17:00:00Z");
    const calendar = { configured: true, onDay: vi.fn(options.meetings ?? (async () => [{ time: "10:00", title: "Ådalen status" }])) };
    const service = new TasksService(new AppConfig({ DATABASE_URL: "postgresql://unused@localhost/x", VAULT_TIMEZONE: "Europe/Paris" }), vault, bot, calendar, log, { now: () => now });
    service.onModuleInit();
    const tap = (prefix: string, data: string, text: string, buttons: { text: string; data: string }[][] = []) => bot.callbacks.get(prefix)!({ data, text, buttons });
    return { service, vault, bot, keys, calendar, tap, setNow: (at: string) => (now = new Date(at)) };
}

describe("TasksService", () => {
    it("takes a to-do sent to the bot, asks for when, and takes a typed day", async () => {
        const { vault, bot } = setup();
        const asked = await bot.say("À faire : faire la facturation");
        expect(textOf(asked)).toBe("📝 To-do\n• faire la facturation\n📅 For when? Tap, or reply with a day (« jeudi », « 25/11 »).");
        expect(vault.get(TASKS_PATH)).toContain("## To do\n\n- [ ] faire la facturation\n");

        expect(textOf(await bot.say("jeudi"))).toBe("📅 Thu 19 Nov\n• faire la facturation");
        expect(vault.get(TASKS_PATH)).toContain("- [ ] faire la facturation 📅 2026-11-19\n");
        // Answered: the next "jeudi" is an idea for the inbox, not a day.
        expect(await bot.say("jeudi")).toBeUndefined();
        expect(await bot.say("Une idée pour le CA")).toBeUndefined();
    });

    it("dates a to-do from a button under its message", async () => {
        const { vault, bot, tap } = setup();
        const reply = await bot.say("To-do pour demain :\n- A\n- B");
        expect(vault.get(TASKS_PATH)).toContain("- [ ] A 📅 2026-11-18\n- [ ] B 📅 2026-11-18\n");
        const buttons = (reply as { buttons: { text: string; data: string }[][] }).buttons;
        const answer = await tap("due", "due:none", textOf(reply)!, buttons);
        expect(answer).toEqual({ edit: { text: "📝 2 to-dos\n• A\n• B\n📅 No date", buttons }, toast: "No date" });
        expect(vault.get(TASKS_PATH)).toContain("- [ ] A\n- [ ] B\n");
        expect(bot.commands.has("todo") && bot.commands.has("today")).toBe(true);
        expect(textOf(await bot.commands.get("todo")!.run(""))).toBe("No day\n• A\n• B");
        expect(textOf(await bot.commands.get("todo")!.run("Appeler Jean pour vendredi"))).toBe("📝 To-do\n• Appeler Jean\n📅 Fri 20 Nov");
    });

    it("sends the brief once a day from BRIEF_AT, and ticks from its buttons", async () => {
        const tasks = `# Tasks\n\n## To do\n\n- [ ] Faire la facturation 📅 2026-11-18\n- [ ] Rien\n`;
        const meeting = { path: "Meetings/2026-11-10 1000 Ådalen status.md", content: "## Actions\n\n- [ ] Edward: envoyer le budget 📅 2026-11-14" };
        const { service, vault, bot, keys, tap, setNow } = setup({ notes: [{ path: TASKS_PATH, content: tasks }, meeting], now: "2026-11-18T06:59:00Z" });
        await service.tick();
        expect(bot.sent).toEqual([]);
        setNow("2026-11-18T07:01:00Z");
        await service.tick();
        await service.tick();
        expect(bot.sent).toHaveLength(1);
        expect(keys.has("brief:2026-11-18")).toBe(true);
        const brief = bot.sent[0]!;
        expect(brief.text).toBe("☀️ Wednesday 18 November\n\n📅 Meetings\n10:00 Ådalen status\n\n✅ To do today\n1. Faire la facturation\n\n⏰ Late\n2. Edward: envoyer le budget\n\n📥 2 in the inbox · 1 to-do without a day (/todo)");

        const buttons = brief.buttons as { text: string; data: string }[][];
        const answer = await tap("done", "done:2", brief.text, buttons);
        expect(answer).toMatchObject({ toast: "Done ✓", edit: { buttons: [[{ text: "✓ 1", data: "done:1" }]] } });
        expect(vault.get(meeting.path)).toBe("## Actions\n\n- [x] Edward: envoyer le budget 📅 2026-11-14 ✅ 2026-11-18");
        // Ticked meanwhile (Obsidian, Claude): the brief shows it done all the same.
        await service.complete("Faire la facturation");
        await expect(tap("done", "done:1", brief.text, buttons)).resolves.toMatchObject({ toast: "It was already ticked in the vault.", edit: { buttons: [[{ text: "✓ 2", data: "done:2" }]] } });
        expect(await tap("done", "done:1", "✔️ Faire la facturation", buttons)).toEqual({ toast: "Already ticked." });
    });

    it("skips a brief too late in the day, and sends it without meetings when the calendar fails", async () => {
        const late = setup({ now: "2026-11-18T13:00:00Z" });
        await late.service.tick();
        expect(late.bot.sent).toEqual([]);

        const { service, bot } = setup({ now: "2026-11-18T07:30:00Z", meetings: async () => Promise.reject(new Error("fetch failed")) });
        await service.tick();
        expect(bot.sent[0]?.text).toBe("☀️ Wednesday 18 November\n\n📅 The calendar did not answer.\n\n✅ Nothing due today.\n\n📥 2 in the inbox");
    });

    it("gives the brief back when it could not go out, for the next tick", async () => {
        const { service, bot, keys } = setup({ now: "2026-11-18T07:30:00Z" });
        bot.notifyOwner.mockRejectedValueOnce(new Error("Telegram is down"));
        await service.tick();
        expect(keys.has("brief:2026-11-18")).toBe(false);
        await service.tick();
        expect(bot.sent).toHaveLength(1);
    });

    it("ticks and redates for Claude, and says when a to-do is not there", async () => {
        const { service, vault } = setup({ notes: [{ path: TASKS_PATH, content: "- [ ] A 📅 2026-11-17\n- [ ] B" }] });
        expect(await service.setDue(["A", "B", "C"], "2026-11-20")).toEqual({ found: ["A", "B"], missing: ["C"] });
        expect(vault.get(TASKS_PATH)).toBe("- [ ] A 📅 2026-11-20\n- [ ] B 📅 2026-11-20");
        expect(await service.complete("b")).toEqual({ path: TASKS_PATH, text: "B" });
        await expect(service.complete("B")).rejects.toThrow(/No open to-do matches "B"/);
        await expect(service.add(["  "])).rejects.toThrow(/no to-do to add/);
    });
});
