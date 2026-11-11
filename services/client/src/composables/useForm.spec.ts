import { describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { z } from "zod";

import { useForm } from "./useForm.js";

const Schema = z.object({ title: z.string().trim().min(1, "required") });

describe("useForm", () => {
    it("submits the parsed values", async () => {
        const form = useForm(Schema, () => ({ title: "  Milk " }));
        const submit = vi.fn();
        await form.handleSubmit(submit)();
        expect(submit).toHaveBeenCalledWith({ title: "Milk" });
    });

    it("shows errors only after a submit, and clears them once fixed", async () => {
        const form = useForm(Schema, () => ({ title: "" }));
        form.values.title = " ";
        await nextTick();
        expect(form.errors.value).toEqual({});

        const submit = vi.fn();
        await form.handleSubmit(submit)();
        expect(submit).not.toHaveBeenCalled();
        expect(form.errors.value.title).toBe("required");

        form.values.title = "Bread";
        await nextTick();
        expect(form.errors.value).toEqual({});
    });
});
