import * as Sentry from "@sentry/nestjs";

// Imported first by main.ts. Without SENTRY_DSN nothing is initialised.
if (process.env.SENTRY_DSN) {
    Sentry.init({
        dsn: process.env.SENTRY_DSN,
        environment: process.env.NODE_ENV,
        release: process.env.APP_VERSION,
        // Sentry 11 collects cookies, headers and bodies unless told not to.
        // Errors and stack traces are what we need; nothing the user sent.
        dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false }
    });
}
