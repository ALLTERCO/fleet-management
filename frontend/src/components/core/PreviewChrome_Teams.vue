<!-- Hex literals exempt: Teams-chrome fidelity, not design-system chrome. -->
<template>
    <div class="tms">
        <header class="tms__hdr">
            <span class="tms__app">
                <i class="fas fa-bell tms__app-icon" />
                Workflow notification
            </span>
            <span class="tms__time">{{ timeLabel }}</span>
        </header>

        <article class="tms__card" aria-label="Adaptive card preview">
            <div class="tms__accent" aria-hidden="true" />
            <div class="tms__body">
                <div class="tms__byline">
                    <div class="tms__avatar" aria-hidden="true">
                        <i class="fas fa-bolt" />
                    </div>
                    <div class="tms__byline-text">
                        <div class="tms__title">
                            {{ endpointName || 'Alert notification' }}
                        </div>
                        <div class="tms__sub">Fleet Manager · Workflow</div>
                    </div>
                </div>

                <div class="tms__content">
                    <p v-if="!rendered" class="tms__empty">
                        <i class="fas fa-eye tms__empty-icon" />
                        Adaptive card preview will appear here as you edit
                        the JSON.
                    </p>
                    <pre v-else class="tms__rendered">{{ rendered }}</pre>
                </div>

                <footer class="tms__actions" aria-hidden="true">
                    <span class="tms__action">Open alert</span>
                    <span class="tms__action tms__action--ghost">
                        Acknowledge
                    </span>
                </footer>
            </div>
        </article>
    </div>
</template>

<script setup lang="ts">
defineProps<{endpointName?: string; rendered?: string}>();

const timeLabel = (() => {
    const d = new Date();
    return d.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit'
    });
})();
</script>

<style scoped>
/* Teams-brand colors scoped locally. */
.tms {
    --tms-wash-bg: #f3f2f1;
    --tms-card-bg: #fff;
    --tms-text: #252525;
    --tms-text-dim: #616161;
    --tms-accent: #6264a7;
    --tms-action: #2b2f7a;

    display: flex;
    flex-direction: column;
    gap: var(--gap-sm);
    padding: var(--gap-md);
    border-radius: var(--radius-lg);
    background: var(--tms-wash-bg);
    color: var(--tms-text);
    box-shadow: var(--shadow-lg);
}

.tms__hdr {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--gap-sm);
    font-size: var(--type-body);
    color: var(--tms-text-dim);
}

.tms__app {
    display: inline-flex;
    align-items: center;
    gap: var(--gap-xs);
    font-weight: var(--font-semibold);
    color: var(--tms-text);
}

.tms__app-icon {
    color: var(--tms-accent);
}

.tms__time {
    font-weight: var(--font-normal);
    opacity: 0.75;
}

.tms__card {
    display: grid;
    grid-template-columns: auto 1fr;
    background: var(--tms-card-bg);
    border-radius: var(--radius-sm);
    overflow: hidden;
    box-shadow:
        0 1px 2px rgba(0, 0, 0, 0.12),
        0 2px 6px rgba(0, 0, 0, 0.08);
}

.tms__accent {
    width: 4px;
    background: var(--tms-accent);
}

.tms__body {
    display: flex;
    flex-direction: column;
    gap: var(--gap-sm);
    padding: var(--gap-md);
    min-width: 0;
}

.tms__byline {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: var(--gap-sm);
    align-items: center;
}

.tms__avatar {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.5rem;
    height: 2.5rem;
    border-radius: 50%;
    background: var(--tms-accent);
    color: #fff;
    flex-shrink: 0;
    font-size: var(--icon-size-sm);
}

.tms__byline-text {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    min-width: 0;
}

.tms__title {
    font-size: var(--type-body);
    font-weight: var(--font-bold);
    color: var(--tms-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.tms__sub {
    font-size: var(--type-body);
    color: var(--tms-text-dim);
}

.tms__content {
    font-size: var(--type-body);
    color: var(--tms-text);
    line-height: 1.5;
}

.tms__empty {
    margin: 0;
    color: var(--tms-text-dim);
    font-style: italic;
    display: inline-flex;
    align-items: center;
    gap: var(--gap-xs);
}

.tms__empty-icon {
    opacity: 0.6;
    font-style: normal;
}

.tms__rendered {
    margin: 0;
    padding: var(--gap-xs) var(--gap-sm);
    background: #f5f5f5;
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: var(--type-body);
    line-height: 1.55;
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--tms-text);
    max-height: 18rem;
    overflow-y: auto;
}

.tms__actions {
    display: flex;
    gap: var(--gap-xs);
    padding-top: var(--gap-sm);
    border-top: 1px solid rgba(0, 0, 0, 0.08);
}

.tms__action {
    display: inline-flex;
    align-items: center;
    padding: var(--space-1-5) var(--gap-sm);
    background: var(--tms-action);
    color: #fff;
    border-radius: var(--radius-xs);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
}

.tms__action--ghost {
    background: transparent;
    color: var(--tms-action);
    border: 1px solid var(--tms-action);
}
</style>
