import { createRouter, createWebHistory } from "vue-router";

import { authClient, isOAuthRequest } from "./lib/auth.js";

declare module "vue-router" {
    interface RouteMeta {
        /** Reachable without a session. Every other route needs one. */
        public?: boolean
    }
}

export const router = createRouter({
    history: createWebHistory(),
    routes: [
        { path: "/", name: "home", component: () => import("./pages/HomePage.vue") },
        { path: "/sign-in", name: "sign-in", component: () => import("./pages/SignInPage.vue"), meta: { public: true } },
        // Reached from Claude's authorization request, after sign-in.
        { path: "/consent", name: "consent", component: () => import("./pages/ConsentPage.vue") },
        { path: "/:pathMatch(.*)*", redirect: "/" }
    ]
});

router.beforeEach(async to => {
    const { data: session } = await authClient.getSession();
    if (!to.meta.public && !session) {
        return { name: "sign-in", query: { redirect: to.fullPath } };
    }
    // A signed-in visit to the sign-in page goes home, unless Claude sent it
    // there to sign in again (prompt=login): that one must stay.
    if (to.meta.public && session && !isOAuthRequest(to.query)) {
        return { name: "home" };
    }
    return true;
});
