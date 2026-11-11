import ICAL from "ical.js";

/** One occurrence of a calendar event, recurrences expanded. */
export interface Occurrence {
    uid: string
    title: string
    start: Date
    end: Date
    allDay: boolean
    location?: string
    description?: string
    cancelled: boolean
}

/**
 * The occurrences starting in [from, to), from an ICS feed (Outlook's
 * published calendar). Its VTIMEZONE blocks are registered first: Outlook
 * names zones the Windows way ("Romance Standard Time"), which only the
 * feed itself defines. Moved or edited occurrences (RECURRENCE-ID) replace
 * the ones the rule would give; EXDATEs are skipped by the expansion.
 */
export function occurrencesBetween (ics: string, from: Date, to: Date): Occurrence[] {
    const calendar = new ICAL.Component(ICAL.parse(ics));
    for (const zone of calendar.getAllSubcomponents("vtimezone")) {
        ICAL.TimezoneService.register(zone);
    }
    const events = calendar.getAllSubcomponents("vevent").map(component => new ICAL.Event(component));
    const masters = new Map<string, ICAL.Event>();
    for (const event of events) {
        if (!event.isRecurrenceException()) {
            masters.set(event.uid, event);
        }
    }
    for (const event of events) {
        if (event.isRecurrenceException()) {
            masters.get(event.uid)?.relateException(event);
        }
    }

    const occurrences: Occurrence[] = [];
    const rangeEnd = ICAL.Time.fromJSDate(to, true);
    for (const event of masters.values()) {
        if (!event.isRecurring()) {
            const start = event.startDate.toJSDate();
            if (start >= from && start < to) {
                occurrences.push(toOccurrence(event, event.startDate, event.endDate));
            }
            continue;
        }
        const iterator = event.iterator();
        for (let next = iterator.next(), guard = 0; next && guard < 5000; next = iterator.next(), guard++) {
            if (next.compare(rangeEnd) >= 0) {
                break;
            }
            const details = event.getOccurrenceDetails(next);
            const start = details.startDate.toJSDate();
            if (start >= from && start < to) {
                occurrences.push(toOccurrence(details.item, details.startDate, details.endDate));
            }
        }
    }
    return occurrences.sort((a, b) => a.start.getTime() - b.start.getTime());
}

function toOccurrence (event: ICAL.Event, start: ICAL.Time, end: ICAL.Time): Occurrence {
    const status = String(event.component.getFirstPropertyValue("status") ?? "").toUpperCase();
    return {
        uid: event.uid,
        title: (event.summary || "Untitled").trim(),
        start: start.toJSDate(),
        end: end.toJSDate(),
        allDay: start.isDate,
        location: event.location?.trim() || undefined,
        description: cleanDescription(event.description),
        cancelled: status === "CANCELLED" || /^(canceled|cancelled|annulé)\s*:/i.test(event.summary ?? "")
    };
}

/** The invite's text without the Teams or Zoom joining block that follows a line of underscores. */
export function cleanDescription (description: string | undefined): string | undefined {
    if (!description) {
        return undefined;
    }
    const cut = description.split(/\n?_{10,}/)[0] ?? "";
    const text = cut.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
    if (!text) {
        return undefined;
    }
    return text.length > 1500 ? `${text.slice(0, 1500)}…` : text;
}
