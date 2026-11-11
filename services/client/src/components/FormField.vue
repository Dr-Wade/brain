<script setup lang="ts">
import Message from "primevue/message";
import { computed } from "vue";

// A label, the control, an optional hint and the field's error, wired together
// for assistive technology: the control gets `aria-describedby` pointing at the
// hint and the error, and `invalid` while there is one. A control that is not
// an <input> (PrimeVue's Select is a span with role="combobox") cannot be named
// by `<label for>`: give it `aria-labelledby` from the slot's `labelId`.
const props = defineProps<{
    id: string
    label: string
    error?: string
    hint?: string
}>();

const describedBy = computed(() => [
    props.hint ? `${props.id}-hint` : undefined,
    props.error ? `${props.id}-error` : undefined
].filter(Boolean).join(" ") || undefined);
</script>

<template>
  <div class="flex flex-col gap-1">
    <label
      :id="`${id}-label`"
      class="font-medium"
      :for="id"
    >{{ label }}</label>
    <slot
      :described-by="describedBy"
      :invalid="Boolean(error)"
      :label-id="`${id}-label`"
    />
    <small
      v-if="hint"
      :id="`${id}-hint`"
      class="text-muted-color"
    >{{ hint }}</small>
    <Message
      v-if="error"
      :id="`${id}-error`"
      severity="error"
      size="small"
      variant="simple"
    >
      {{ error }}
    </Message>
  </div>
</template>
