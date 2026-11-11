import { createRouter, createWebHistory } from "vue-router";

import { authClient } from "./lib/auth.js";

declare module "vue-router" {
    interface RouteMeta {
        /** Reachable without a session. Every other route needs one. */
        public?: boolean
    }
}

export const router = createRouter({
    history: createWebHistory(),
    routes: [
        { path: "/", name: "todos", component: () => import("./pages/TodosPage.vue") },
        { path: "/sign-in", name: "sign-in", component: () => import("./pages/SignInPage.vue"), meta: { public: true } },
        { path: "/sign-up", name: "sign-up", component: () => import("./pages/SignUpPage.vue"), meta: { public: true } },
        { path: "/:pathMatch(.*)*", redirect: "/" }
    ]
});

router.beforeEach(async to => {
    const { data: session } = await authClient.getSession();
    if (!to.meta.public && !session) {
        return { name: "sign-in", query: { redirect: to.fullPath } };
    }
    if (to.meta.public && session) {
        return { name: "todos" };
    }
    return true;
});
