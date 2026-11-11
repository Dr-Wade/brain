<script setup lang="ts">
import Button from "primevue/button";
import Message from "primevue/message";
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute } from "vue-router";

import { authClient } from "../lib/auth.js";

const { t } = useI18n();
const route = useRoute();
const redirecting = ref(false);
const failure = ref<string>();

// better-auth comes back here with ?error=… when GitHub sign-in fails;
// unable_to_get_user_info is the answer for any account but the allowed one.
const callbackError = computed(() => {
    const error = route.query.error;
    if (typeof error !== "string") {
        return undefined;
    }
    return error === "unable_to_get_user_info" ? t("auth.notAllowed") : t("auth.failed", { message: error });
});

const continueWithGithub = async () => {
    failure.value = undefined;
    redirecting.value = true;
    const redirect = typeof route.query.redirect === "string" && route.query.redirect.startsWith("/") ? route.query.redirect : "/";
    // A full-page redirect to GitHub. During Claude's sign-in the client
    // plugin adds the signed request, and the server resumes it on return.
    const { error } = await authClient.signIn.social({ provider: "github", callbackURL: redirect, errorCallbackURL: "/sign-in" });
    if (error) {
        redirecting.value = false;
        failure.value = t("auth.failed", { message: error.message ?? error.statusText });
    }
};
</script>

<template>
  <main class="mx-auto flex max-w-sm flex-col gap-6 px-4 py-16">
    <div class="flex flex-col gap-2">
      <h1 class="text-2xl font-semibold">
        {{ t("auth.signInTitle") }}
      </h1>
      <p class="text-muted-color">
        {{ t("auth.signInLead") }}
      </p>
    </div>
    <Message
      v-if="failure ?? callbackError"
      role="alert"
      severity="error"
    >
      {{ failure ?? callbackError }}
    </Message>
    <Button
      :aria-busy="redirecting"
      class="min-h-11"
      icon="pi pi-github"
      :label="t('auth.continueWithGithub')"
      :loading="redirecting"
      @click="continueWithGithub"
    />
  </main>
</template>
