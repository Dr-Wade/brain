import { reactive, ref, watch } from "vue";
import { z } from "zod";

type Errors<S extends z.ZodObject> = Partial<Record<keyof z.input<S>, string>>;

/**
 * A form backed by a Zod schema, usually the one the API validates with
 * (packages/schemas). Validation runs on submit, then again on every change
 * until the form is valid, so errors appear when they are useful and
 * disappear as soon as they are fixed.
 */
export function useForm<S extends z.ZodObject> (schema: S, initial: () => z.input<S>) {
    const values = reactive(initial()) as z.input<S>;
    const errors = ref<Errors<S>>({});
    const submitting = ref(false);
    let attempted = false;

    function validate (): z.output<S> | undefined {
        const result = schema.safeParse(values);
        if (result.success) {
            errors.value = {};
            return result.data;
        }
        const fieldErrors = z.flattenError(result.error).fieldErrors as Record<string, string[] | undefined>;
        errors.value = Object.fromEntries(
            Object.entries(fieldErrors).map(([field, messages]) => [field, messages?.[0]])
        ) as Errors<S>;
        return undefined;
    }

    watch(values, () => {
        if (attempted) {
            validate();
        }
    }, { deep: true });

    function handleSubmit (submit: (data: z.output<S>) => Promise<unknown> | unknown) {
        return async () => {
            attempted = true;
            const data = validate();
            if (!data || submitting.value) {
                return;
            }
            submitting.value = true;
            try {
                await submit(data);
            } finally {
                submitting.value = false;
            }
        };
    }

    function reset () {
        Object.assign(values, initial());
        attempted = false;
        errors.value = {};
    }

    return { values, errors, submitting, handleSubmit, reset };
}
