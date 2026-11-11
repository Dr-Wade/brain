import config from "@drwade/eslint-config";

export default [
    ...config,
    {
        ignores: [
            "**/dist/**",
            "**/coverage/**",
            "**/src/generated/**",
            "playwright-report/**",
            "test-results/**"
        ]
    }
];
