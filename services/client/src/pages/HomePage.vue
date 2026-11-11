<script setup lang="ts">
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import { useToast } from "primevue/usetoast";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";

import { authClient } from "../lib/auth.js";

const { t } = useI18n();
const toast = useToast();
const router = useRouter();
const connectorUrl = `${window.location.origin}/api/mcp`;

const copy = async () => {
    try {
        await navigator.clipboard.writeText(connectorUrl);
        toast.add({ severity: "success", summary: t("home.copied"), life: 2500 });
    } catch {
        toast.add({ severity: "warn", summary: t("home.copyFailed"), life: 4000 });
    }
};

const signOut = async () => {
    await authClient.signOut();
    await router.replace({ name: "sign-in" });
};
</script>

<template>
  <main class="mx-auto flex max-w-xl flex-col gap-6 px-4 py-16">
    <header class="flex items-center justify-between gap-4">
      <h1 class="text-2xl font-semibold">
        {{ t("app.name") }}
      </h1>
      <Button
        :label="t('app.signOut')"
        severity="secondary"
        text
        @click="signOut"
      />
    </header>
    <p>{{ t("home.lead") }}</p>
    <div class="flex flex-col gap-2">
      <label
        class="font-medium"
        for="connector-url"
      >{{ t("home.urlLabel") }}</label>
      <div class="flex gap-2">
        <InputText
          id="connector-url"
          class="flex-1"
          readonly
          :value="connectorUrl"
        />
        <Button
          :aria-label="t('home.copy')"
          icon="pi pi-copy"
          @click="copy"
        />
      </div>
    </div>
    <ol class="list-decimal space-y-1 pl-6">
      <li>{{ t("home.step1") }}</li>
      <li>{{ t("home.step2") }}</li>
      <li>{{ t("home.step3") }}</li>
    </ol>
  </main>
</template>
