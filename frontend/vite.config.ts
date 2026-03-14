import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "url";
import VueRouter from "unplugin-vue-router/vite";
import fs from "node:fs";
import path from "node:path";
import { VitePWA } from "vite-plugin-pwa";

// Read version from package.json (works in both local and Docker)
function getVersion(): string {
    // npm_package_version is set when running via npm scripts
    if (process.env.npm_package_version) {
        return process.env.npm_package_version;
    }
    // Fallback: read package.json directly
    try {
        const pkgPath = path.join(
            import.meta.dirname || __dirname,
            "package.json",
        );
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
        return pkg.version || "2.1.2";
    } catch {
        return "2.1.2";
    }
}

function getBuildDate(): string {
    return new Date().toISOString().split("T")[0];
}

function tryFile(path: string) {
    try {
        if (fs.existsSync(path)) {
            // check read permissions, will throw if not allowed
            fs.accessSync(path, fs.constants.R_OK);
            const parsed = JSON.parse(fs.readFileSync(path, "utf-8"));
            return parsed?.oidc?.frontend;
        }
    } catch (error) {
        return undefined;
    }
}

function parseRcConfig() {
    let currentPath = import.meta.dirname || __dirname;

    const RETRIES = 3;
    for (let i = 0; i < RETRIES; i++) {
        const config = tryFile(path.join(currentPath, ".fleet-managerrc"));
        if (config) return config;
        // move to up directory and continue;
        currentPath = path.join(currentPath, "..");
    }

    return {};
}

// Get version info
const appVersion = getVersion();
const buildDate = getBuildDate();

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
    // Build-time OIDC fallback is only for local dev.
    // Production images always embed "{}" and rely on runtime-config.js.
    const buildTimeOidcConfig = mode === "development" ? parseRcConfig() : {};

    return {
        clearScreen: false,
        plugins: [
            VueRouter(),
            vue(),
            VitePWA({
                registerType: "autoUpdate",
                manifest: {
                    name: "Shelly Fleet Manager",
                    short_name: "Fleet Manager",
                    description:
                        "Fleet Manager is a standalone software for controlling and monitoring new generations of Shelly devices.",
                    theme_color: "#141D4D",
                    icons: [
                        {
                            src: "/pwa-192x192.png",
                            sizes: "192x192",
                            type: "image/png",
                            purpose: "any",
                        },
                        {
                            src: "/pwa-512x512.png",
                            sizes: "512x512",
                            type: "image/png",
                            purpose: "any",
                        },
                        {
                            src: "/pwa-maskable-192x192.png",
                            sizes: "192x192",
                            type: "image/png",
                            purpose: "maskable",
                        },
                        {
                            src: "/pwa-maskable-512x512.png",
                            sizes: "512x512",
                            type: "image/png",
                            purpose: "maskable",
                        },
                    ],
                    start_url: "/",
                    display: "standalone",
                    background_color: "#283992",
                },
                workbox: {
                    // Take over immediately
                    skipWaiting: true,
                    clientsClaim: true,
                    // Never serve index.html for these routes
                    navigateFallbackDenylist: [
                        /^\/api/,
                        /^\/health/,
                        /^\/rpc/,
                        /^\/node-red/,
                        /^\/grafana/,
                        /^\/alexa/,
                        /^\/media/,
                        /^\/uploads/,
                    ],
                    // Don't cache API/backend routes - always go to network
                    runtimeCaching: [
                        {
                            urlPattern: ({ url }) =>
                                url.pathname === "/runtime-config.js",
                            handler: "NetworkOnly",
                        },
                        {
                            urlPattern: ({ url }) =>
                                url.pathname.startsWith("/api"),
                            handler: "NetworkOnly",
                        },
                        {
                            urlPattern: ({ url }) =>
                                url.pathname.startsWith("/health"),
                            handler: "NetworkOnly",
                        },
                        {
                            urlPattern: ({ url }) =>
                                url.pathname.startsWith("/rpc"),
                            handler: "NetworkOnly",
                        },
                    ],
                },
            }),
        ],
        resolve: {
            alias: [
                {
                    find: "@",
                    replacement: fileURLToPath(new URL("./src", import.meta.url)),
                },
            ],
        },
        define: {
            NPM_APP_VERSION: JSON.stringify(appVersion),
            GIT_LAST_COMMIT_TIME: JSON.stringify(buildDate),
            OIDC_CONFIG: JSON.stringify(buildTimeOidcConfig),
        },
        build: {},
        test: {
            environment: "happy-dom",
            globals: true,
            include: ["test/**/*.test.ts"],
            setupFiles: ["test/setup.ts"],
        },
    };
});
