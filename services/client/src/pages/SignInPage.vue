<script setup lang="ts">
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Message from "primevue/message";
import Password from "primevue/password";
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { z } from "zod";

import FormField from "../components/FormField.vue";
import { useForm } from "../composables/useForm.js";
import { authClient } from "../lib/auth.js";

const SignIn = z.object({
    email: z.email(),
    password: z.string().min(1)
});

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const failure = ref<string>();
const { values, errors, submitting, handleSubmit } = useForm(SignIn, () => ({ email: "", password: "" }));

const submit = handleSubmit(async ({ email, password }) => {
    failure.value = undefined;
    const { error } = await authClient.signIn.email({ email, password });
    if (error) {
        failure.value = t("auth.failed", { message: error.message ?? error.statusText });
        return;
    }
    const redirect = typeof route.query.redirect === "string" ? route.query.redirect : "/";
    await router.replace(redirect.startsWith("/") ? redirect : "/");
});
</script>

<template>
  <main class="mx-auto flex max-w-sm flex-col gap-6 px-4 py-16">
    <h1 class="text-2xl font-semibold">
      {{ t("auth.signInTitle") }}
    </h1>
    <form
      class="flex flex-col gap-4"
      novalidate
      @submit.prevent="submit"
    >
      <FormField
        id="email"
        v-slot="field"
        :error="errors.email"
        :label="t('auth.email')"
      >
        <InputText
          id="email"
          v-model="values.email"
          :aria-describedby="field.describedBy"
          autocomplete="email"
          :invalid="field.invalid"
          type="email"
        />
      </FormField>
      <FormField
        id="password"
        v-slot="field"
        :error="errors.password"
        :label="t('auth.password')"
      >
        <Password
          v-model="values.password"
          :feedback="false"
          fluid
          input-id="password"
          :input-props="{ 'aria-describedby': field.describedBy, autocomplete: 'current-password' }"
          :invalid="field.invalid"
          toggle-mask
        />
      </FormField>
      <Message
        v-if="failure"
        role="alert"
        severity="error"
      >
        {{ failure }}
      </Message>
      <Button
        :label="t('auth.signIn')"
        :loading="submitting"
        type="submit"
      />
    </form>
    <RouterLink
      class="text-primary underline"
      :to="{ name: 'sign-up', query: route.query }"
    >{{ t("auth.toSignUp") }}</RouterLink>
  </main>
</template>
