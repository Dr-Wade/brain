import { describe, expect, it } from "vitest";

import { cleanDescription, occurrencesBetween } from "./calendar.js";
import { OUTLOOK_ICS } from "./outlook-ics.fixture.js";

describe("occurrencesBetween", () => {
    const between = (from: string, to: string) => occurrencesBetween(OUTLOOK_ICS, new Date(from), new Date(to));

    it("expands the weekly series, skips the EXDATE and moves the exception", () => {
        const ca = between("2026-11-10T00:00Z", "2026-12-01T00:00Z").filter(occurrence => occurrence.uid === "ca-series");
        expect(ca.map(occurrence => occurrence.start.toISOString())).toEqual([
            "2026-11-11T17:00:00.000Z",
            // The 18th is excluded; the 25th was moved to the 26th at 19:00.
            "2026-11-26T18:00:00.000Z"
        ]);
        expect(ca[1]?.end.toISOString()).toBe("2026-11-26T20:00:00.000Z");
    });

    it("reads Outlook's Windows zone, summer time included", () => {
        const [october] = between("2026-10-20T00:00Z", "2026-10-22T00:00Z");
        // 21 October, before the clocks go back: 18:00 in Paris is 16:00 UTC.
        expect(october?.start.toISOString()).toBe("2026-10-21T16:00:00.000Z");
    });

    it("flags all-day and cancelled events, and keeps one-off ones", () => {
        const all = between("2026-11-10T00:00Z", "2026-11-20T00:00Z");
        expect(all.find(occurrence => occurrence.uid === "holiday")?.allDay).toBe(true);
        expect(all.find(occurrence => occurrence.uid === "cancelled")?.cancelled).toBe(true);
        expect(all.find(occurrence => occurrence.uid === "one-off")).toMatchObject({ title: "Café avec Paul", allDay: false, cancelled: false });
    });

    it("keeps the invite's text, not the joining block", () => {
        const [ca] = between("2026-11-11T00:00Z", "2026-11-12T00:00Z").filter(occurrence => occurrence.uid === "ca-series");
        expect(ca).toMatchObject({ location: "Salle B", description: "Ordre du jour\n1. Budget" });
        expect(cleanDescription("___________________\nTeams only")).toBeUndefined();
        expect(cleanDescription("x".repeat(2000))?.length).toBe(1501);
    });
});
