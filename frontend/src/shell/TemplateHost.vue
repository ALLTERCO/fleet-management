<template>
    <section class="template-host">
        <div v-if="error" class="template-host__error">
            <h1>Unable to load this fleet view</h1>
            <p>{{ error.message }}</p>
            <details v-if="error.stack" class="template-host__stack">
                <summary>Stack trace (paste this if you report the bug)</summary>
                <pre>{{ error.stack }}</pre>
            </details>
            <button type="button" class="template-host__reload" @click="reloadView">Reload</button>
        </div>
        <div v-else-if="!profileReady" class="template-host__loading">
            Loading organization settings...
        </div>
        <Suspense v-else-if="vueRoot">
            <component :is="vueRoot" />
            <template #fallback>
                <div class="template-host__loading">Loading fleet view...</div>
            </template>
        </Suspense>
        <div v-else ref="mountPoint" class="template-host__mount" />
    </section>
</template>

<script setup lang="ts">
import {
    computed,
    inject,
    onBeforeUnmount,
    onErrorCaptured,
    onMounted,
    ref,
    shallowRef,
    watch
} from 'vue';
import {routerKey} from 'vue-router';
import {useOrganizationStore} from '@/stores/organization';
import {resolveTemplateEntry} from './template-entry';
import {createFleetRuntimeContext} from './template-host/app/fleet-runtime-context';
import type {
    MountedTemplate,
    TemplateRuntimeContext
} from './template-host/core/types';
import {provideFleetRuntime} from './template-host/vue/provider';

declare const NPM_APP_VERSION: string;

// Message + stack so a user can paste a copy-friendly trace into a bug report;
// the intermittent mount races are not locatable without it.
const error = ref<{message: string; stack?: string} | null>(null);
const mountPoint = ref<HTMLElement | null>(null);
const vueRoot = shallowRef<unknown>(null);
const organization = useOrganizationStore();
const profileReady = computed(() => organization.profile !== null);

let runtime: TemplateRuntimeContext | null = null;
let mounted: MountedTemplate | null = null;
const router = inject(routerKey, null);

function reportError(err: unknown): void {
    if (err instanceof Error) {
        error.value = {message: err.message, stack: err.stack};
    } else {
        error.value = {message: String(err)};
    }
    console.error('[template-host] template failed:', err);
}

// One runtime context per host, created in setup so Pinia and the Vue app are
// live, and provided synchronously for Vue templates that inject it.
try {
    runtime = createFleetRuntimeContext({hostVersion: NPM_APP_VERSION, router: router ?? undefined});
    provideFleetRuntime(runtime);
} catch (err) {
    reportError(err);
}

const entry = error.value ? null : safeResolveEntry();

function safeResolveEntry() {
    try {
        const resolved = resolveTemplateEntry(NPM_APP_VERSION);
        if (profileReady.value && resolved.renderer === 'vue') {
            vueRoot.value = resolved.component;
        }
        return resolved;
    } catch (err) {
        reportError(err);
        return null;
    }
}

async function mountReadyEntry(): Promise<void> {
    if (!profileReady.value || !entry || !runtime) return;
    if (entry.renderer === 'vue') {
        vueRoot.value = entry.component;
        return;
    }
    if (!mountPoint.value) {
        reportError(new Error('React template has no mount element'));
        return;
    }
    if (mounted) return;
    try {
        mounted = await entry.mount(mountPoint.value, runtime);
    } catch (err) {
        reportError(err);
    }
}

onMounted(() => {
    void mountReadyEntry();
});

watch(profileReady, (ready) => {
    if (ready) void mountReadyEntry();
}, {flush: 'post'});

watch(
    () => organization.error,
    (profileError) => {
        if (!organization.profile && profileError) {
            reportError(new Error(`Organization settings could not be loaded: ${profileError}`));
        }
    }
);

onBeforeUnmount(async () => {
    try {
        await mounted?.unmount();
    } catch (err) {
        console.error('[template-host] template unmount failed:', err);
    } finally {
        mounted = null;
        runtime?.dispose();
        runtime = null;
    }
});

onErrorCaptured((err) => {
    reportError(err);
    return false;
});

function reloadView() {
    window.location.reload();
}
</script>

<style scoped>
.template-host {
    min-height: 100vh;
    color: var(--fm-template-text, #172033);
    background: var(--fm-template-background, #f6f8fb);
}

.template-host__mount {
    min-height: 100vh;
}

.template-host__loading,
.template-host__error {
    display: grid;
    min-height: 100vh;
    place-items: center;
    padding: 2rem;
    text-align: center;
}

.template-host__error {
    color: #8a1f1f;
}
.template-host__stack {
    width: min(100%, 720px);
    margin-top: 1rem;
    text-align: left;
    font-size: var(--icon-size-xs);
    color: var(--fm-template-text, #172033);
}
.template-host__stack pre {
    margin-top: 0.5rem;
    padding: 0.75rem;
    background: rgba(0, 0, 0, 0.05);
    border-radius: var(--radius-sm-plus);
    overflow: auto;
    max-height: 320px;
    white-space: pre-wrap;
    word-break: break-word;
}
.template-host__reload {
    margin-top: 1.25rem;
    padding: 0.55rem 1.25rem;
    border-radius: var(--radius-sm-plus);
    border: none;
    background: var(--fm-template-primary, #1f73d6);
    color: #fff;
    font-weight: 600;
    cursor: pointer;
}
.template-host__reload:hover {
    filter: brightness(1.1);
}
</style>
