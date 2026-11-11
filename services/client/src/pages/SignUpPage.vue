<script setup lang="ts">
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Message from "primevue/message";
import Password from "primevue/password";
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { z } from "zod";

import FormField from "../components/FormField.vue";
import { useForm } from "../composables/useForm.js";
import { authClient } from "../lib/auth.js";

// The API enforces the same minimum (emailAndPassword.minPasswordLength).
const SignUp = z.object({
    name: z.string().trim().min(1),
    email: z.email(),
    password: z.string().min(10).max(128)
});

const { t } = useI18n();
const router = useRouter();
const failure = ref<string>();
const { values, errors, submitting, handleSubmit } = useForm(SignUp, () => ({ name: "", email: "", password: "" }));

const submit = handleSubmit(async input => {
    failure.value = undefined;
    const { error } = await authClient.signUp.email(input);
    if (error) {
        failure.value = t("auth.failed", { message: error.message ?? error.statusText });
        return;
    }
    await router.replace("/");
});
</script>

<template>
  <main class="mx-auto flex max-w-sm flex-col gap-6 px-4 py-16">
    <h1 class="text-2xl font-semibold">
      {{ t("auth.signUpTitle") }}
    </h1>
    <form
      class="flex flex-col gap-4"
      novalidate
      @submit.prevent="submit"
    >
      <FormField
        id="name"
        v-slot="field"
        :error="errors.name"
        :label="t('auth.name')"
      >
        <InputText
          id="name"
          v-model="values.name"
          :aria-describedby="field.describedBy"
          autocomplete="name"
          :invalid="field.invalid"
        />
      </FormField>
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
        :hint="t('auth.passwordHint')"
        :label="t('auth.password')"
      >
        <Password
          v-model="values.password"
          :feedback="false"
          fluid
          input-id="password"
          :input-props="{ 'aria-describedby': field.describedBy, autocomplete: 'new-password' }"
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
        :label="t('auth.signUp')"
        :loading="submitting"
        type="submit"
      />
    </form>
    <RouterLink
      class="text-primary underline"
      :to="{ name: 'sign-in' }"
    >{{ t("auth.toSignIn") }}</RouterLink>
  </main>
</template>
