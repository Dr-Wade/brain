import { mount } from "@vue/test-utils";
import PrimeVue from "primevue/config";
import { describe, expect, it } from "vitest";

import type { Todo } from "../api/index.js";
import { i18n } from "../i18n.js";
import TodoItem from "./TodoItem.vue";

const todo: Todo = {
    id: "0190f0a0-0000-7000-8000-000000000001",
    title: "Water the plants",
    done: false,
    remindAt: null,
    createdAt: "2026-11-04T10:00:00.000Z",
    updatedAt: "2026-11-04T10:00:00.000Z"
};

// A component against props and events: no API, no browser. A page against a
// mocked API is also a component test; Playwright is for journeys (e2e/).
const render = (props: Partial<Todo> = {}) => mount(TodoItem, {
    props: { todo: { ...todo, ...props } },
    global: { plugins: [PrimeVue, i18n] }
});

describe("TodoItem", () => {
    it("shows the title, struck through once done", () => {
        expect(render().text()).toContain("Water the plants");
        expect(render({ done: true }).find(".line-through").exists()).toBe(true);
    });

    it("emits toggle when the checkbox changes", async () => {
        const wrapper = render();
        await wrapper.find("input[type=checkbox]").setValue(true);
        expect(wrapper.emitted("toggle")).toEqual([[true]]);
    });

    it("emits remove from its labelled delete button", async () => {
        const wrapper = render();
        await wrapper.find("button[aria-label='Delete \"Water the plants\"']").trigger("click");
        expect(wrapper.emitted("remove")).toHaveLength(1);
    });
});
