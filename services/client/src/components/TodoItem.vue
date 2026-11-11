<script setup lang="ts">
import Button from "primevue/button";
import Checkbox from "primevue/checkbox";
import { useI18n } from "vue-i18n";

import type { Todo } from "../api/index.js";

defineProps<{ todo: Todo }>();
const emit = defineEmits<{
    toggle: [done: boolean]
    remove: []
}>();

const { t, d } = useI18n();
</script>

<template>
  <li class="flex items-center gap-3 py-2">
    <Checkbox
      :aria-label="t('todos.markDone', { title: todo.title })"
      binary
      :model-value="todo.done"
      @update:model-value="emit('toggle', Boolean($event))"
    />
    <div class="flex min-w-0 flex-1 flex-col">
      <span
        class="truncate"
        :class="{ 'text-muted-color line-through': todo.done }"
      >{{ todo.title }}</span>
      <small
        v-if="todo.remindAt"
        class="text-muted-color"
      >
        {{ t("todos.reminder", { date: d(new Date(todo.remindAt), { dateStyle: "medium", timeStyle: "short" }) }) }}
      </small>
    </div>
    <Button
      :aria-label="t('todos.delete', { title: todo.title })"
      icon="pi pi-trash"
      severity="secondary"
      text
      @click="emit('remove')"
    />
  </li>
</template>
