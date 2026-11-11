import "./style.css";
import "primeicons/primeicons.css";

import * as Sentry from "@sentry/vue";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import PrimeVue from "primevue/config";
import ToastService from "primevue/toastservice";
import { createApp } from "vue";

import { clientConfigGet } from "./api/index.js";
import App from "./App.vue";
import { i18n } from "./i18n.js";
import { router } from "./router.js";
import { preset } from "./theme.js";

// Runtime configuration from the API, so one build runs in every environment.
const { data: config } = await clientConfigGet();

const app = createApp(App);

if (config?.sentryDsn) {
    Sentry.init({
        app,
        dsn: config.sentryDsn,
        environment: config.environment,
        release: config.version,
        dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false }
    });
}

app.use(PrimeVue, {
    theme: { preset, options: { cssLayer: { name: "primevue", order: "theme, base, primevue" } } }
});
app.use(ToastService);
app.use(VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } }) });
app.use(i18n);
app.use(router);
app.mount("#app");
