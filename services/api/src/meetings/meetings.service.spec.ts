import { describe, expect, it, vi } from "vitest";

import { AppConfig } from "../config/app-config.js";
import type { Note } from "../vault/notes.js";
import { OUTLOOK_ICS } from "./outlook-ics.fixture.js";
import { MeetingsService, type ReminderLog } from "./meetings.service.js";
import { DEFAULT_RULES_NOTE, RULES_PATH } from "./prep.js";

function setup (options: { now: string; notes?: Note[]; ics?: string; runAt?: string }) {
    const notes: Note[] = [...(options.notes ?? [])];
    const vault = {
        notesUnder: vi.fn(async (folder: string) => notes.filter(note => note.path.startsWith(`${folder}/`))),
        createNote: vi.fn(async (path: string, content: string) => {
            if (notes.some(note => note.path === path)) {
                return { created: false };
            }
            notes.push({ path, content });
            return { created: true, url: `https://github.com/x/${path}` };
        }),
        search: vi.fn(async () => [])
    };
    const sent: string[] = [];
    const notifier = {
        notifyOwner: vi.fn(async (text: string) => {
            sent.push(text);
            return true;
        }),
        registerCommand: vi.fn()
    };
    const keys = new Set<string>();
    const log: ReminderLog = {
        claim: async key => !keys.has(key) && Boolean(keys.add(key)),
        release: async key => void keys.delete(key)
    };
    const fetchImpl = vi.fn(async () => new Response(options.ics ?? OUTLOOK_ICS));
    let now = new Date(options.now);
    const service = new MeetingsService(
        new AppConfig({ DATABASE_URL: "postgresql://unused@localhost/x", CALENDAR_ICS_URL: "https://calendar.example/secret.ics", MEETINGS_RUN_AT: options.runAt }),
        vault,
        notifier,
        log,
        { fetchImpl, now: () => now }
    );
    return { service, notes, sent, keys, vault, notifier, fetchImpl, setNow: (at: string) => (now = new Date(at)) };
}

describe("MeetingsService", () => {
    it("creates prep notes as meetings come within their rule's days, and says so once", async () => {
        // Wed 11 Nov, 07:30 in Paris. CA tonight (7-day rule), Café on Friday (2-day rule).
        const { service, notes, sent } = setup({ now: "2026-11-11T06:30:00Z" });
        const first = await service.run();
        expect(first.created).toEqual(["Meetings/2026-11-11 1800 CA.md", "Meetings/2026-11-13 0900 Café avec Paul.md"]);
        expect(notes.map(note => note.path)).toContain(RULES_PATH);
        expect(sent).toEqual([
            "📅 CA — Wed 11 Nov 18:00, today.\nPrep note ready: Meetings/2026-11-11 1800 CA.md",
            "📅 Café avec Paul — Fri 13 Nov 09:00, in 2 days.\nPrep note ready: Meetings/2026-11-13 0900 Café avec Paul.md"
        ]);

        const again = await service.run();
        expect(again).toEqual({ created: [], reminded: [] });
        expect(sent).toHaveLength(2);
    });

    it("leaves out all-day, cancelled, skipped and too-distant meetings", async () => {
        const rules = { path: RULES_PATH, content: "| Café | skip |\n| CA | 7 |\n| * | 2 |" };
        const { service } = setup({ now: "2026-11-11T06:30:00Z", notes: [rules] });
        const { created } = await service.run();
        // No Armistice (all day), no Point budget (cancelled), no Café (skip),
        // no CA of the 26th (15 days out).
        expect(created).toEqual(["Meetings/2026-11-11 1800 CA.md"]);
    });

    it("the day before, tells how far the prep got, once", async () => {
        const prep = {
            path: "Meetings/2026-11-13 0900 Café avec Paul.md",
            content: "# Café\n\n## To prepare\n\n- [x] One\n- [ ] Two\n\n## Notes\n"
        };
        const { service, sent } = setup({ now: "2026-11-12T06:30:00Z", notes: [{ path: RULES_PATH, content: DEFAULT_RULES_NOTE }, prep] });
        await service.run();
        await service.run();
        expect(sent).toEqual([
            "📅 Café avec Paul — Fri 13 Nov 09:00, tomorrow.\nPrep note ready: Meetings/2026-11-13 0900 Café avec Paul.md",
            "⏰ Tomorrow 09:00: Café avec Paul. Prep 1/2 done."
        ]);
    });

    it("links the previous meeting of the series and counts its open actions", async () => {
        const last = { path: "Meetings/2026-11-04 1800 CA.md", content: "---\nmeeting: 2026-11-04T18:00+01:00\nseries: ca\n---\n# CA\n\n## Actions\n\n- [ ] Send the budget\n" };
        const { service, notes, sent } = setup({ now: "2026-11-11T06:30:00Z", notes: [{ path: RULES_PATH, content: DEFAULT_RULES_NOTE }, last] });
        await service.run();
        const created = notes.find(note => note.path === "Meetings/2026-11-11 1800 CA.md")!;
        expect(created.content).toContain("Still open from then:\n- [ ] Send the budget");
        expect(sent[0]).toContain("1 action still open from last time.");
    });

    it("runs the daily pass once, at or after its hour", async () => {
        const { service, sent, setNow, keys } = setup({ now: "2026-11-11T05:30:00Z", runAt: "07:00" });
        await service.tick();
        expect(keys.size).toBe(0);
        setNow("2026-11-11T06:10:00Z");
        await service.tick();
        await service.tick();
        expect(keys.has("run:2026-11-11")).toBe(true);
        expect(sent).toHaveLength(2);
    });

    it("announces a prep note at the next pass when the first send failed", async () => {
        const { service, sent, notifier } = setup({ now: "2026-11-11T06:30:00Z" });
        notifier.notifyOwner.mockRejectedValueOnce(new Error("Forbidden: bot can't initiate conversation"));
        await service.run();
        expect(sent).toHaveLength(1);
        await service.run();
        expect(sent).toHaveLength(2);
        expect(sent[1]).toContain("Prep note ready: Meetings/2026-11-11 1800 CA.md");
    });

    it("lets a failed pass run again at the next tick", async () => {
        const { service, keys, fetchImpl } = setup({ now: "2026-11-11T06:30:00Z" });
        fetchImpl.mockResolvedValueOnce(new Response("nope", { status: 500 }));
        await service.tick();
        expect(keys.has("run:2026-11-11")).toBe(false);
        await service.tick();
        expect(keys.has("run:2026-11-11")).toBe(true);
    });

    it("lists the coming meetings with their prep state", async () => {
        const prep = { path: "Meetings/2026-11-13 0900 Café avec Paul.md", content: "## To prepare\n\n- [x] One\n- [ ] Two\n" };
        const { service } = setup({ now: "2026-11-11T06:30:00Z", notes: [prep] });
        const list = await service.upcoming(7);
        expect(list.map(meeting => [meeting.when, meeting.title, meeting.prepNote ?? null, meeting.prep ?? null])).toEqual([
            ["Wed 11 Nov 18:00", "CA", null, null],
            ["Fri 13 Nov 09:00", "Café avec Paul", prep.path, { done: 1, total: 2 }]
        ]);
    });

    it("registers /next only with a calendar", () => {
        const { service, notifier } = setup({ now: "2026-11-11T06:30:00Z" });
        service.onModuleInit();
        expect(notifier.registerCommand).toHaveBeenCalledWith("next", expect.objectContaining({ description: expect.any(String) }));
    });

    it("reads several calendars, a meeting on two of them once, and gets by when one fails", async () => {
        // A Google calendar in UTC: the CA again (on both calendars), and a Ådalen meeting.
        const google = [
            "BEGIN:VCALENDAR", "VERSION:2.0",
            "BEGIN:VEVENT", "UID:g-ca", "SUMMARY:CA", "DTSTART:20261111T170000Z", "DTEND:20261111T190000Z", "END:VEVENT",
            "BEGIN:VEVENT", "UID:g-adalen", "SUMMARY:Ådalen status", "DTSTART:20261111T090000Z", "DTEND:20261111T100000Z", "END:VEVENT",
            "END:VCALENDAR", ""
        ].join("\r\n");
        let googleUp = true;
        const fetchImpl = vi.fn(async (url: string) => {
            if (url.includes("google")) {
                return googleUp ? new Response(google) : new Response("", { status: 503 });
            }
            return new Response(OUTLOOK_ICS);
        });
        let now = new Date("2026-11-11T06:30:00Z");
        const notes: Note[] = [{ path: "Meetings/2026-11-11 1000 Ådalen status.md", content: "## To prepare\n\n- [x] Chiffres\n- [ ] Démo" }];
        const service = new MeetingsService(
            new AppConfig({ DATABASE_URL: "postgresql://unused@localhost/x", CALENDAR_ICS_URL: "https://outlook.example/a.ics,\nhttps://google.example/b.ics" }),
            { notesUnder: vi.fn(async () => notes), createNote: vi.fn(), search: vi.fn(async () => []) },
            { notifyOwner: vi.fn(async () => true), registerCommand: vi.fn() },
            { claim: async () => true, release: async () => undefined },
            { fetchImpl, now: () => now }
        );
        expect(service.configured).toBe(true);
        expect(await service.onDay("2026-11-11")).toEqual([
            { time: "All day", title: "Armistice", prep: undefined },
            { time: "10:00", title: "Ådalen status", prep: { done: 1, total: 2 } },
            { time: "18:00", title: "CA", prep: undefined }
        ]);
        expect(fetchImpl).toHaveBeenCalledTimes(2);

        // Google down past the cache: its last answer stands in.
        googleUp = false;
        now = new Date("2026-11-11T07:00:00Z");
        expect((await service.upcoming(1)).map(meeting => meeting.title)).toEqual(["Ådalen status", "CA"]);
        // Never answered at all: left out, the other calendar still read.
        const fresh = new MeetingsService(
            new AppConfig({ DATABASE_URL: "postgresql://unused@localhost/x", CALENDAR_ICS_URL: "https://outlook.example/a.ics https://google.example/b.ics" }),
            { notesUnder: vi.fn(async () => []), createNote: vi.fn(), search: vi.fn(async () => []) },
            { notifyOwner: vi.fn(async () => true), registerCommand: vi.fn() },
            { claim: async () => true, release: async () => undefined },
            { fetchImpl, now: () => now }
        );
        expect((await fresh.upcoming(1)).map(meeting => meeting.title)).toEqual(["CA"]);
    });
});
