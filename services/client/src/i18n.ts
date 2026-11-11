import { createI18n } from "vue-i18n";
import { z } from "zod";

import en from "./locales/en.json";
import fr from "./locales/fr.json";

export type Locale = "en" | "fr";

const locale: Locale = navigator.language.toLowerCase().startsWith("fr") ? "fr" : "en";

// Zod's own messages (form errors) follow the same language.
z.config(locale === "fr" ? z.locales.fr() : z.locales.en());
document.documentElement.lang = locale;

export const i18n = createI18n({
    legacy: false,
    locale,
    fallbackLocale: "en",
    messages: { en, fr }
});
