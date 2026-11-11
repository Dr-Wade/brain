<script setup lang="ts">
import { TodoCreate } from "@starter/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import Button from "primevue/button";
import DatePicker from "primevue/datepicker";
import InputText from "primevue/inputtext";
import Message from "primevue/message";
import Skeleton from "primevue/skeleton";
import { useToast } from "primevue/usetoast";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { z } from "zod";

import {
    todosCreateMutation,
    todosListOptions,
    todosListQueryKey,
    todosRemoveMutation,
    todosUpdateMutation
} from "../api/@tanstack/vue-query.gen.js";
import FormField from "../components/FormField.vue";
import TodoItem from "../components/TodoItem.vue";
import { useForm } from "../composables/useForm.js";
import { authClient } from "../lib/auth.js";

// The API's own schema, with the date picker's Date in place of the ISO string.
const NewTodo = TodoCreate.extend({ remindAt: z.date().nullable() });

const { t } = useI18n();
const toast = useToast();
const router = useRouter();
const queryClient = useQueryClient();

const todos = useQuery(todosListOptions());
const refresh = () => queryClient.invalidateQueries({ queryKey: todosListQueryKey() });
const failed = () => toast.add({ severity: "error", summary: t("todos.saveFailed"), life: 5000 });
const create = useMutation({ ...todosCreateMutation(), onSuccess: refresh, onError: failed });
const update = useMutation({ ...todosUpdateMutation(), onSuccess: refresh, onError: failed });
const remove = useMutation({ ...todosRemoveMutation(), onSuccess: refresh, onError: failed });

const { values, errors, submitting, handleSubmit, reset } = useForm(NewTodo, () => ({ title: "", remindAt: null }));
const add = handleSubmit(async ({ title, remindAt }) => {
    await create.mutateAsync({ body: { title, remindAt: remindAt?.toISOString() ?? null } });
    reset();
});

async function signOut () {
    await authClient.signOut();
    queryClient.clear();
    await router.replace({ name: "sign-in" });
}
</script>

<template>
  <div class="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
    <header class="flex items-center justify-between">
      <h1 class="text-2xl font-semibold">
        {{ t("todos.title") }}
      </h1>
      <Button
        icon="pi pi-sign-out"
        :label="t('app.signOut')"
        severity="secondary"
        text
        @click="signOut"
      />
    </header>

    <form
      class="flex flex-col gap-3 sm:flex-row sm:items-start"
      novalidate
      @submit.prevent="add"
    >
      <FormField
        id="title"
        v-slot="field"
        class="flex-1"
        :error="errors.title"
        :label="t('todos.new')"
      >
        <InputText
          id="title"
          v-model="values.title"
          :aria-describedby="field.describedBy"
          :invalid="field.invalid"
        />
      </FormField>
      <FormField
        id="remind-at"
        v-slot="field"
        :error="errors.remindAt"
        :label="t('todos.remindAt')"
      >
        <DatePicker
          v-model="values.remindAt"
          :aria-describedby="field.describedBy"
          hour-format="24"
          input-id="remind-at"
          :invalid="field.invalid"
          :min-date="new Date()"
          show-button-bar
          show-time
        />
      </FormField>
      <Button
        class="sm:mt-7"
        icon="pi pi-plus"
        :label="t('todos.add')"
        :loading="submitting"
        type="submit"
      />
    </form>

    <section
      :aria-busy="todos.isPending.value"
      aria-live="polite"
    >
      <div
        v-if="todos.isPending.value"
        class="flex flex-col gap-3"
      >
        <Skeleton
          v-for="n in 3"
          :key="n"
          height="2.5rem"
        />
      </div>
      <Message
        v-else-if="todos.isError.value"
        severity="error"
      >
        {{ t("todos.loadFailed") }}
      </Message>
      <p
        v-else-if="!todos.data.value?.length"
        class="text-muted-color"
      >
        {{ t("todos.empty") }}
      </p>
      <ul
        v-else
        class="divide-y divide-surface-200 dark:divide-surface-700"
      >
        <TodoItem
          v-for="todo in todos.data.value"
          :key="todo.id"
          :todo="todo"
          @remove="remove.mutate({ path: { id: todo.id } })"
          @toggle="done => update.mutate({ path: { id: todo.id }, body: { done } })"
        />
      </ul>
    </section>
  </div>
</template>
