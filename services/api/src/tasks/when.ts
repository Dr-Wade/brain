import { fold } from "../vault/notes.js";

/**
 * Days as the vault writes them (`2026-11-18`), and the words Edward uses for
 * them, in French or English. Pure: "today" is passed in, in the vault's zone.
 */

/** `date` moved by `days` calendar days. */
export function addDays (date: string, days: number): string {
    const at = new Date(`${date}T12:00:00Z`);
    at.setUTCDate(at.getUTCDate() + days);
    return at.toISOString().slice(0, 10);
}

/** 0 for Sunday … 6 for Saturday. */
export function weekday (date: string): number {
    return new Date(`${date}T12:00:00Z`).getUTCDay();
}

/** "Tue 18 Nov" */
export function shortDay (date: string): string {
    return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" })
        .format(new Date(`${date}T12:00:00Z`)).replace(",", "");
}

/** "Tuesday 18 November" */
export function longDay (date: string): string {
    return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" })
        .format(new Date(`${date}T12:00:00Z`)).replace(",", "");
}

/** The first `day` (0–6) strictly after `date`. */
export function nextWeekday (date: string, day: number): string {
    const ahead = (day - weekday(date) + 7) % 7 || 7;
    return addDays(date, ahead);
}

const WEEKDAYS: Record<string, number> = {
    dimanche: 0, lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6,
    sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
    dim: 0, lun: 1, mar: 2, mer: 3, jeu: 4, ven: 5, sam: 6,
    sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6
};

const MONTHS: Record<string, number> = {
    janvier: 1, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, aout: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12,
    january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
    janv: 1, jan: 1, fevr: 2, fev: 2, feb: 2, mar: 3, avr: 4, apr: 4, juil: 7, jul: 7, aug: 8, sept: 9, sep: 9, oct: 10, nov: 11, dec: 12
};

const NUMBERS: Record<string, number> = { un: 1, une: 1, a: 1, one: 1, deux: 2, two: 2, trois: 3, three: 3, quatre: 4, four: 4, cinq: 5, five: 5 };

const NO_DATE = new Set(["no date", "sans date", "pas de date", "none", "aucune", "someday", "un jour", "plus tard", "later", "jamais"]);

/** A real calendar date, or undefined (31/02). */
function dateOf (year: number, month: number, day: number): string | undefined {
    const at = new Date(Date.UTC(year, month - 1, day, 12));
    if (at.getUTCFullYear() !== year || at.getUTCMonth() !== month - 1 || at.getUTCDate() !== day) {
        return undefined;
    }
    return at.toISOString().slice(0, 10);
}

/** Day and month without a year: this year, or next year once it has passed. */
function upcoming (today: string, month: number, day: number, year?: number): string | undefined {
    if (year !== undefined) {
        return dateOf(year < 100 ? 2000 + year : year, month, day);
    }
    const thisYear = Number(today.slice(0, 4));
    const date = dateOf(thisYear, month, day);
    return date && date < today ? dateOf(thisYear + 1, month, day) : date;
}

/**
 * The day a phrase means, from `today`: "demain", "vendredi", "next week",
 * "25/11", "le 3 décembre", "dans 3 jours", "2026-12-01". `null` for "no
 * date"; undefined when the phrase is not a day.
 */
export function parseWhen (input: string, today: string): string | null | undefined {
    let text = fold(input).replace(/[.!?…]+$/u, "").replace(/[’']/g, "'").replace(/\s+/g, " ").trim();
    text = text.replace(/^(?:pour|for|by|d'ici|avant|before|due|on|a rendre)\s+/, "");
    if (!text) {
        return undefined;
    }
    if (NO_DATE.has(text)) {
        return null;
    }
    if (/^(?:aujourd'?hui|auj|today|tonight|ce soir|now|maintenant|asap)$/.test(text)) {
        return today;
    }
    if (/^(?:demain|tomorrow|tmrw|demain matin|demain soir)$/.test(text)) {
        return addDays(today, 1);
    }
    if (/^(?:apres[- ]demain|(?:the )?day after tomorrow)$/.test(text)) {
        return addDays(today, 2);
    }
    if (/^(?:cette semaine|this week|fin de (?:la )?semaine|end of (?:the )?week)$/.test(text)) {
        const friday = addDays(today, (5 - weekday(today) + 7) % 7);
        return weekday(today) === 6 || weekday(today) === 0 ? today : friday;
    }
    if (/^(?:la )?semaine prochaine$|^next week$/.test(text)) {
        return nextWeekday(today, 1);
    }
    const within = /^(?:dans|in) (\d{1,3}|\p{L}+) (jours?|days?|semaines?|weeks?)$/u.exec(text);
    if (within) {
        const count = /^\d+$/.test(within[1]!) ? Number(within[1]) : NUMBERS[within[1]!];
        if (count !== undefined) {
            return addDays(today, /^(?:semaine|week)/.test(within[2]!) ? count * 7 : count);
        }
        return undefined;
    }
    const day = /^(?:(?:next|ce|this) )?(\p{L}+)(?: (?:prochain|next))?$/u.exec(text);
    if (day && WEEKDAYS[day[1]!] !== undefined) {
        return nextWeekday(today, WEEKDAYS[day[1]!]!);
    }
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (iso) {
        return dateOf(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    }
    const numeric = /^(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2}|\d{4}))?$/.exec(text);
    if (numeric) {
        return upcoming(today, Number(numeric[2]), Number(numeric[1]), numeric[3] === undefined ? undefined : Number(numeric[3]));
    }
    // "le 3 décembre", "lundi 24 novembre", "3rd of december 2026".
    const dayMonth = /^(?:(?:le|the) )?(?:(\p{L}+) )?(\d{1,2})(?:er|st|nd|rd|th)? (?:of )?(\p{L}+)\.?(?: (\d{4}))?$/u.exec(text);
    if (dayMonth && MONTHS[dayMonth[3]!] !== undefined && (dayMonth[1] === undefined || WEEKDAYS[dayMonth[1]] !== undefined)) {
        return upcoming(today, MONTHS[dayMonth[3]!]!, Number(dayMonth[2]), dayMonth[4] === undefined ? undefined : Number(dayMonth[4]));
    }
    // "december 3", "dec 3rd, 2026".
    const monthDay = /^(\p{L}+)\.? (\d{1,2})(?:st|nd|rd|th)?(?:,? (\d{4}))?$/u.exec(text);
    if (monthDay && MONTHS[monthDay[1]!] !== undefined) {
        return upcoming(today, MONTHS[monthDay[1]!]!, Number(monthDay[2]), monthDay[3] === undefined ? undefined : Number(monthDay[3]));
    }
    // "le 25", "the 25th": this month, or next once it has passed.
    const dayOnly = /^(?:le|the) (\d{1,2})(?:er|st|nd|rd|th)?$/.exec(text);
    if (dayOnly) {
        const [year, month] = today.split("-").map(Number) as [number, number];
        const date = dateOf(year, month, Number(dayOnly[1]));
        if (date && date >= today) {
            return date;
        }
        return month === 12 ? dateOf(year + 1, 1, Number(dayOnly[1])) : dateOf(year, month + 1, Number(dayOnly[1]));
    }
    return undefined;
}
