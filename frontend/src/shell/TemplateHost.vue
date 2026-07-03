<template>
    <section class="template-host">
        <div v-if="error" class="template-host__error">
            <h1>Unable to load this fleet view</h1>
            <p>{{ error.message }}</p>
            <details v-if="error.stack" class="template-host__stack">
                <summary>Stack trace (paste this if you report the bug)</summary>
                <pre>{{ error.stack }}</pre>
            </details>
            <button class="template-host__reload" @click="reloadView">Reload</button>
        </div>
        <Suspense v-else>
            <component :is="TemplateRoot" />
            <template #fallback>
                <div class="template-host__loading">Loading fleet view...</div>
            </template>
        </Suspense>
    </section>
</template>

<script setup lang="ts">
import TemplateRoot from '@template/index.vue';
import {onErrorCaptured, ref} from 'vue';

// We capture both message + stack so the user can paste a copy-friendly
// trace into the bug report instead of digging through DevTools. The
// "happens from time to time" intermittent bugs (transient null on a
// host composable, race during initial mount) need the stack to locate.
const error = ref<{message: string; stack?: string} | null>(null);

onErrorCaptured((err) => {
    if (err instanceof Error) {
        error.value = {message: err.message, stack: err.stack};
    } else {
        error.value = {message: String(err)};
    }
    console.error('[template-host] render error:', err);
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
