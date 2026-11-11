<script setup lang="ts">
import Button from "primevue/button";
import Message from "primevue/message";
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute } from "vue-router";

import { authClient } from "../lib/auth.js";

const { t } = useI18n();
const route = useRoute();
const clientName = ref<string>();
const pending = ref<"allow" | "deny">();
const failure = ref<string>();

onMounted(async () => {
    const clientId = route.query.client_id;
    if (typeof clientId !== "string") {
        return;
    }
    const { data } = await authClient.$fetch<{ client_name?: string }>("/oauth2/public-client", { method: "GET", query: { client_id: clientId } });
    clientName.value = data?.client_name;
});

const answer = async (accept: boolean) => {
    failure.value = undefined;
    pending.value = accept ? "allow" : "deny";
    // The client plugin adds the signed request from this page's query.
    const { data, error } = await authClient.$fetch<{ redirect: boolean; url: string }>("/oauth2/consent", { method: "POST", body: { accept } });
    if (error || !data?.url) {
        pending.value = undefined;
        failure.value = t("auth.failed", { message: error?.message ?? error?.statusText ?? "no redirect" });
        return;
    }
    window.location.assign(data.url);
};
</script>

<template>
  <main class="mx-auto flex max-w-md flex-col gap-6 px-4 py-16">
    <h1 class="text-2xl font-semibold">
      {{ t("consent.title", { client: clientName ?? t("consent.anApp") }) }}
    </h1>
    <div class="flex flex-col gap-2">
      <p>{{ t("consent.lead") }}</p>
      <ul class="list-disc pl-6">
        <li>{{ t("consent.capture") }}</li>
        <li>{{ t("consent.read") }}</li>
        <li>{{ t("consent.issues") }}</li>
      </ul>
    </div>
    <Message
      v-if="failure"
      role="alert"
      severity="error"
    >
      {{ failure }}
    </Message>
    <div class="flex flex-col gap-3">
      <Button
        class="min-h-11"
        :disabled="pending !== undefined"
        :label="t('consent.allow')"
        :loading="pending === 'allow'"
        @click="answer(true)"
      />
      <Button
        class="min-h-11"
        :disabled="pending !== undefined"
        :label="t('consent.deny')"
        :loading="pending === 'deny'"
        severity="secondary"
        @click="answer(false)"
      />
    </div>
  </main>
</template>
