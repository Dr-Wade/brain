import { describe, expect, it } from "vitest";

import type { Occurrence } from "./calendar.js";
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
    seriesKey
} from "./prep.js";

const tz = "Europe/Paris";
const ca: Occurrence = {
    uid: "ca",
    title: "CA",
    start: new Date("2026-11-18T17:00:00Z"),
    end: new Date("2026-11-18T19:00:00Z"),
    allDay: false,
    location: "Salle B",
    description: "Ordre du jour\n\n1. Budget",
    cancelled: false
};

describe("rules", () => {
    it("reads the default note, first match winning, skip as no note", () => {
        const rules = parseRules(DEFAULT_RULES_NOTE);
        expect(rules).toEqual([
            { pattern: "Conseil d'administration", days: 7 },
            { pattern: "CA", days: 7 },
            { pattern: "*", days: 2 }
        ]);
        expect(parseRules("| Déjeuner | skip |\n| Point | 0 |")).toEqual([{ pattern: "Déjeuner", days: null }, { pattern: "Point", days: null }]);
        expect(parseRules(undefined)).toEqual([{ pattern: "*", days: 2 }]);
    });

    it("matches whole words, accents and case ignored", () => {
        const rules = parseRules(DEFAULT_RULES_NOTE);
        expect(ruleFor("CA de novembre", rules)?.days).toBe(7);
        expect(ruleFor("Réunion du conseil d’administration", rules)?.pattern).toBe("*");
        expect(ruleFor("Réunion du Conseil d'Administration", rules)?.days).toBe(7);
        expect(ruleFor("Café avec Paul", rules)?.pattern).toBe("*");
        expect(ruleFor("x", [{ pattern: "CA", days: 7 }])).toBeUndefined();
    });
});

describe("dates and series", () => {
    it("counts calendar days in the zone, across the clock change", () => {
        // 07:00 and 23:30 in Paris: the same day. 23:30 and the next 09:00: one.
        expect(daysBetween(new Date("2026-11-11T06:00Z"), new Date("2026-11-11T22:30Z"), tz)).toBe(0);
        expect(daysBetween(new Date("2026-11-11T22:30Z"), new Date("2026-11-12T08:00Z"), tz)).toBe(1);
        expect(daysBetween(new Date("2026-11-11T06:00Z"), new Date("2026-11-18T17:00Z"), tz)).toBe(7);
        expect(daysBetween(new Date("2026-10-24T10:00Z"), new Date("2026-10-26T10:00Z"), tz)).toBe(2);
    });

    it("names the series without dates", () => {
        expect(seriesKey("CA du 14 novembre 2026")).toBe("ca du");
        expect(seriesKey("Weekly sync")).toBe("weekly sync");
        expect(prepPath(ca, tz)).toBe("Meetings/2026-11-18 1800 CA.md");
    });
});

describe("prep notes", () => {
    const previous = {
        path: "Meetings/2026-11-11 1800 CA.md",
        content: "---\nmeeting: 2026-11-11T18:00+01:00\nseries: ca\n---\n# CA — Wed 11 Nov 18:00\n\n## To prepare\n\n- [ ] not an action\n\n## Actions\n\n- [x] Done thing\n- [ ] Send the budget\n- [ ] Book the room\n"
    };

    it("finds the previous meeting of the series and its open actions", () => {
        const notes = [previous, { path: "Meetings/2026-11-04 1800 Other.md", content: "---\nseries: other\n---\n" }, { path: "Meetings/Rules.md", content: "" }];
        expect(previousInSeries(ca, notes, tz)?.path).toBe(previous.path);
        expect(previousInSeries({ ...ca, title: "Board" }, notes, tz)).toBeUndefined();
        expect(openActions(previous.content)).toEqual(["Send the budget", "Book the room"]);
    });

    it("writes the note: when, where, the invite, last time, related notes, prep list", () => {
        const note = prepNote(ca, { previous, related: [{ path: "Notes/Budget.md", title: "Budget" }], today: new Date("2026-11-11T06:00Z") }, tz);
        expect(note).toContain("created: 2026-11-11\nmeeting: 2026-11-18T18:00+01:00\nseries: ca\ntags: [meeting]");
        expect(note).toContain("# CA — Wed 18 Nov 18:00");
        expect(note).toContain("**When:** Wednesday 18 November 2026, 18:00–20:00\n**Where:** Salle B");
        expect(note).toContain("> Ordre du jour\n>\n> 1. Budget");
        expect(note).toContain("[[Meetings/2026-11-11 1800 CA|CA, 2026-11-11]]\n\nStill open from then:\n- [ ] Send the budget\n- [ ] Book the room");
        expect(note).toContain("- [[Notes/Budget|Budget]]");
        expect(prepProgress(note)).toEqual({ done: 0, total: 3 });
        expect(openActions(note)).toEqual(["Send the budget", "Book the room"]);
    });

    it("counts the prep that is done", () => {
        expect(prepProgress("## To prepare\n\n- [x] A\n- [X] B\n- [ ] C\n\n## Notes\n- [ ] not prep")).toEqual({ done: 2, total: 3 });
        expect(prepProgress("no list")).toEqual({ done: 0, total: 0 });
    });

    it("says when and what in the reminders", () => {
        expect(createdMessage(ca, 7, "Meetings/2026-11-18 1800 CA.md", 2, tz))
            .toBe("📅 CA — Wed 18 Nov 18:00, in 7 days.\nPrep note ready: Meetings/2026-11-18 1800 CA.md\n2 actions still open from last time.");
        expect(createdMessage(ca, 1, "p", 0, tz)).toContain(", tomorrow.");
        expect(eveMessage(ca, { done: 1, total: 3 }, tz)).toBe("⏰ Tomorrow 18:00: CA. Prep 1/3 done.");
        expect(eveMessage(ca, { done: 3, total: 3 }, tz)).toBe("⏰ Tomorrow 18:00: CA. Prep done ✓");
    });
});
