import { describe, expect, it } from "vitest";

import {
    briefMessage,
    briefTicked,
    DEFAULT_TASKS_NOTE,
    dueButtons,
    findOpenTask,
    itemsOf,
    openTasksOf,
    parseTodo,
    redated,
    rewriteTask,
    TASKS_PATH,
    tasksIn,
    ticked,
    todoList,
    todoMessage,
    withTasksAdded
} from "./tasks.js";
import { parseWhen } from "./when.js";

// Tuesday 17 November 2026.
const TODAY = "2026-11-17";

describe("parseWhen", () => {
    it.each([
        ["aujourd'hui", "2026-11-17"],
        ["Demain", "2026-11-18"],
        ["pour demain", "2026-11-18"],
        ["après-demain", "2026-11-19"],
        ["vendredi", "2026-11-20"],
        ["mardi", "2026-11-24"],
        ["lundi prochain", "2026-11-23"],
        ["next Monday", "2026-11-23"],
        ["thu", "2026-11-19"],
        ["la semaine prochaine", "2026-11-23"],
        ["cette semaine", "2026-11-20"],
        ["dans 3 jours", "2026-11-20"],
        ["in two weeks", "2026-12-01"],
        ["25/11", "2026-11-25"],
        ["1/2", "2027-02-01"],
        ["10/11", "2027-11-10"],
        ["25.12.2026", "2026-12-25"],
        ["2026-12-01", "2026-12-01"],
        ["le 3 décembre", "2026-12-03"],
        ["lundi 24 novembre", "2026-11-24"],
        ["December 3rd", "2026-12-03"],
        ["3 dec 2027", "2027-12-03"],
        ["le 25", "2026-11-25"],
        ["le 2", "2026-12-02"],
        ["sans date", null],
        ["no date", null],
        ["Faire la facturation", undefined],
        ["31/02", undefined],
        ["le point", undefined],
        ["", undefined]
    ])("%s → %s", (input, expected) => {
        expect(parseWhen(input, TODAY)).toBe(expected);
    });
});

describe("parseTodo", () => {
    it("takes a dictated list with its day", () => {
        expect(parseTodo("To-do pour demain :\n- Tester le module de vote pour l'AG\n- Faire la facturation\n- Contrôler la facturation manquante pour Memento IT", TODAY)).toEqual({
            items: ["Tester le module de vote pour l'AG", "Faire la facturation", "Contrôler la facturation manquante pour Memento IT"],
            due: "2026-11-18"
        });
    });

    it("takes one to-do, and leaves the day to ask when it names none", () => {
        expect(parseTodo("À faire : s'assurer d'avoir une routine d'inventaire", TODAY)).toEqual({ items: ["s'assurer d'avoir une routine d'inventaire"], due: undefined });
        expect(parseTodo("À faire vendredi, envoyer le budget", TODAY)).toEqual({ items: ["envoyer le budget"], due: "2026-11-20" });
        expect(parseTodo("to do tomorrow call Jean", TODAY)).toEqual({ items: ["call Jean"], due: "2026-11-18" });
        expect(parseTodo("Tâches - A\n- B", TODAY)).toEqual({ items: ["A", "B"], due: undefined });
        expect(parseTodo("À faire :\nPour le CA :\n1. Budget\n2. [ ] Salle", TODAY)).toEqual({ items: ["Budget", "Salle"], due: undefined });
        expect(parseTodo("todo: appeler Jean pour vendredi", TODAY)).toEqual({ items: ["appeler Jean"], due: "2026-11-20" });
        expect(parseTodo("todo: contrôler la facturation de mardi", TODAY)).toEqual({ items: ["contrôler la facturation de mardi"], due: undefined });
    });

    it("leaves sentences that only start like a to-do", () => {
        expect(parseTodo("To do this, we need a budget", TODAY)).toBeUndefined();
        expect(parseTodo("À faire le point avec Jean", TODAY)).toBeUndefined();
        expect(parseTodo("Todolist app idea", TODAY)).toBeUndefined();
        expect(parseTodo("Une idée pour le CA", TODAY)).toBeUndefined();
        expect(parseTodo("À faire :", TODAY)).toBeUndefined();
    });

    it("needs no keyword after /todo", () => {
        expect(parseTodo("Faire la facturation", TODAY, true)).toEqual({ items: ["Faire la facturation"], due: undefined });
        expect(parseTodo("demain: Faire la facturation", TODAY, true)).toEqual({ items: ["Faire la facturation"], due: "2026-11-18" });
    });
});

describe("task lines", () => {
    const note = {
        path: TASKS_PATH,
        content: "# Tasks\n\n- [ ] Faire la facturation 📅 2026-11-17\n- [x] Ranger ✅ 2026-11-16\n```\n- [ ] in code\n```\n  * [ ] Appeler Jean"
    };

    it("reads text, day and state, outside code", () => {
        expect(tasksIn(note)).toEqual([
            { path: TASKS_PATH, line: 2, text: "Faire la facturation", due: "2026-11-17", done: false },
            { path: TASKS_PATH, line: 3, text: "Ranger", due: undefined, done: true },
            { path: TASKS_PATH, line: 7, text: "Appeler Jean", due: undefined, done: false }
        ]);
    });

    it("finds an open task by its words, Tasks.md first, ignoring accents and case", () => {
        const meeting = { path: "Meetings/x.md", content: "- [ ] Faire la facturation 📅 2026-11-20" };
        expect(findOpenTask([meeting, note], "Faire la facturation")?.path).toBe(TASKS_PATH);
        expect(findOpenTask([meeting], "- [ ] faire la FACTURATION")?.path).toBe("Meetings/x.md");
        expect(findOpenTask([note], "Ranger")).toBeUndefined();
        expect(openTasksOf([note, { path: "Templates/Meeting.md", content: "- [ ] x" }])).toHaveLength(2);
    });

    it("ticks and redates a line", () => {
        const task = tasksIn(note)[0]!;
        expect(rewriteTask(note.content, task, line => ticked(line, TODAY)).split("\n")[2]).toBe("- [x] Faire la facturation 📅 2026-11-17 ✅ 2026-11-17");
        expect(redated("- [ ] A 📅 2026-11-17", "2026-11-20")).toBe("- [ ] A 📅 2026-11-20");
        expect(redated("- [ ] A", "2026-11-20")).toBe("- [ ] A 📅 2026-11-20");
        expect(redated("- [ ] A 📅 2026-11-17", null)).toBe("- [ ] A");
    });

    it("adds to-dos under To do, making Tasks.md when missing", () => {
        const made = withTasksAdded(undefined, ["A", "B"], "2026-11-18");
        expect(made).toBe(`${DEFAULT_TASKS_NOTE}\n- [ ] A 📅 2026-11-18\n- [ ] B 📅 2026-11-18\n`);
        expect(withTasksAdded(made, ["C"], null)).toBe(`${DEFAULT_TASKS_NOTE}\n- [ ] A 📅 2026-11-18\n- [ ] B 📅 2026-11-18\n- [ ] C\n`);
    });
});

describe("the bot's to-do messages", () => {
    it("asks for when, and finds its to-dos again in its own text", () => {
        const text = todoMessage(["A", "B"], undefined);
        expect(text).toBe("📝 2 to-dos\n• A\n• B\n📅 For when? Tap, or reply with a day (« jeudi », « 25/11 »).");
        expect(itemsOf(text)).toEqual(["A", "B"]);
        expect(todoMessage(["A"], "2026-11-20")).toBe("📝 To-do\n• A\n📅 Fri 20 Nov");
        expect(dueButtons(TODAY)).toEqual([
            [{ text: "Today", data: "due:2026-11-17" }, { text: "Tomorrow", data: "due:2026-11-18" }],
            [{ text: "Fri 20 Nov", data: "due:2026-11-20" }, { text: "Mon 23 Nov", data: "due:2026-11-23" }],
            [{ text: "No date", data: "due:none" }]
        ]);
        // On a Thursday, Friday is tomorrow: only Monday is offered after it.
        expect(dueButtons("2026-11-19")[1]).toEqual([{ text: "Mon 23 Nov", data: "due:2026-11-23" }]);
    });

    it("writes the brief with numbered to-dos to tick", () => {
        const tasks = [
            { path: TASKS_PATH, line: 1, text: "Faire la facturation", due: TODAY, done: false },
            { path: "Meetings/x.md", line: 9, text: "Edward: envoyer le budget", due: "2026-11-14", done: false },
            { path: TASKS_PATH, line: 2, text: "Plus tard", due: "2026-11-30", done: false },
            { path: TASKS_PATH, line: 3, text: "Sans jour", done: false }
        ];
        const brief = briefMessage({ today: TODAY, meetings: [{ time: "10:00", title: "Ådalen status", prep: { done: 1, total: 3 } }], tasks, inbox: 11 });
        expect(brief.text).toBe([
            "☀️ Tuesday 17 November",
            "",
            "📅 Meetings",
            "10:00 Ådalen status · prep 1/3",
            "",
            "✅ To do today",
            "1. Faire la facturation",
            "",
            "⏰ Late",
            "2. Edward: envoyer le budget",
            "",
            "📥 11 in the inbox · 1 to-do without a day (/todo)"
        ].join("\n"));
        expect(brief.buttons).toEqual([[{ text: "✓ 1", data: "done:1" }, { text: "✓ 2", data: "done:2" }]]);

        const after = briefTicked(brief.text, 2, brief.buttons);
        expect(after.task).toBe("Edward: envoyer le budget");
        expect(after.text).toContain("✔️ Edward: envoyer le budget");
        expect(after.buttons).toEqual([[{ text: "✓ 1", data: "done:1" }]]);
        expect(briefTicked(after.text, 2, after.buttons).task).toBeUndefined();

        const quiet = briefMessage({ today: TODAY, calendarFailed: true, tasks: [], inbox: 0 });
        expect(quiet.text).toBe("☀️ Tuesday 17 November\n\n📅 The calendar did not answer.\n\n✅ Nothing due today.");
        expect(quiet.buttons).toEqual([]);
    });

    it("lists every open to-do by day", () => {
        expect(todoList([
            { path: TASKS_PATH, line: 1, text: "B", due: "2026-11-20", done: false },
            { path: TASKS_PATH, line: 2, text: "A", due: "2026-11-16", done: false },
            { path: "Meetings/x.md", line: 3, text: "C", due: TODAY, done: false },
            { path: TASKS_PATH, line: 4, text: "D", done: false }
        ], TODAY)).toBe("⏰ Late\n• A\n\nToday\n• C  (Meetings/x)\n\nFri 20 Nov\n• B\n\nNo day\n• D");
        expect(todoList([], TODAY)).toBe("No open to-dos.");
    });
});
