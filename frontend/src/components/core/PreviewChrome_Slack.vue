<!-- Hex literals exempt: Slack-chrome fidelity, not design-system chrome. -->
<template>
    <div class="slk">
        <aside class="slk__rail" aria-hidden="true">
            <div class="slk__workspace">
                <span class="slk__ws-letter">A</span>
            </div>
            <nav class="slk__channels">
                <div class="slk__channel-group">Channels</div>
                <div
                    v-for="c in DUMMY_CHANNELS"
                    :key="c"
                    class="slk__channel"
                    :class="{
                        'slk__channel--active':
                            c === (endpointName || 'ops-alerts')
                    }"
                >
                    <span class="slk__channel-hash">#</span>
                    {{ c }}
                </div>
            </nav>
        </aside>

        <section class="slk__main">
            <header class="slk__main-hdr">
                <span class="slk__hash">#</span>
                <span class="slk__channel-name">
                    {{ endpointName || 'ops-alerts' }}
                </span>
                <span class="slk__channel-sub">
                    2 · {{ dateLabel }}
                </span>
            </header>

            <div class="slk__thread">
                <div class="slk__msg">
                    <div class="slk__avatar" aria-hidden="true">
                        <i class="fas fa-robot" />
                    </div>
                    <div class="slk__body">
                        <div class="slk__meta">
                            <span class="slk__author">Fleet Manager</span>
                            <span class="slk__bot">APP</span>
                            <span class="slk__time">{{ timeLabel }}</span>
                        </div>
                        <div class="slk__content">
                            <p v-if="!rendered" class="slk__empty">
                                <i class="fas fa-eye slk__empty-icon" />
                                Preview will appear here as you edit the
                                Blocks JSON.
                            </p>
                            <pre v-else class="slk__rendered">{{ rendered }}</pre>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    </div>
</template>

<script setup lang="ts">
defineProps<{
    endpointName?: string;
    rendered?: string;
}>();

// Imitation Slack channels — decoration only, never functional.
const DUMMY_CHANNELS = [
    'general',
    'ops-alerts',
    'incidents',
    'platform-eng',
    'release-notes'
];

const dateLabel = (() => {
    const d = new Date();
    return d.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric'
    });
})();

const timeLabel = (() => {
    const d = new Date();
    return d.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit'
    });
})();
</script>

<style scoped>
/* Slack brand colors scoped locally — visual reproduction only, never
   leak into the Fleet Manager palette. */
.slk {
    --slk-bg: #1a1d21;
    --slk-rail-bg: #19171d;
    --slk-rail-hover: #27242c;
    --slk-rail-active: #1164a3;
    --slk-text: #d1d2d3;
    --slk-text-dim: #8b8d91;
    --slk-text-strong: #fff;
    --slk-divider: rgba(255, 255, 255, 0.06);
    --slk-accent: #4a154b;

    display: grid;
    grid-template-columns: 9.5rem 1fr;
    min-height: 20rem;
    border-radius: var(--radius-lg);
    overflow: hidden;
    background: var(--slk-bg);
    color: var(--slk-text);
    font-family: var(--font-sans);
    box-shadow: var(--shadow-lg);
}

.slk__rail {
    display: flex;
    flex-direction: column;
    background: var(--slk-rail-bg);
    padding: var(--gap-xs) 0;
}

.slk__workspace {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    margin: var(--gap-xs) auto var(--gap-sm);
    border-radius: var(--radius-sm);
    background: var(--slk-accent);
    color: var(--slk-text-strong);
    font-weight: var(--font-bold);
    font-size: var(--type-body);
}

.slk__channels {
    display: flex;
    flex-direction: column;
    gap: var(--space-px);
    padding: 0 var(--gap-xs);
}

.slk__channel-group {
    font-size: var(--type-body);
    color: var(--slk-text-dim);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
    padding: var(--space-1) var(--gap-xs);
    opacity: 0.75;
}

.slk__channel {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--gap-xs);
    border-radius: var(--radius-sm);
    color: var(--slk-text);
    font-size: var(--type-body);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.slk__channel--active {
    background: var(--slk-rail-active);
    color: var(--slk-text-strong);
    font-weight: var(--font-semibold);
}

.slk__channel-hash {
    color: var(--slk-text-dim);
}

.slk__channel--active .slk__channel-hash {
    color: rgba(255, 255, 255, 0.7);
}

.slk__main {
    display: flex;
    flex-direction: column;
    padding: var(--gap-sm) var(--gap-md) var(--gap-md);
    min-width: 0;
}

.slk__main-hdr {
    display: inline-flex;
    align-items: center;
    gap: var(--gap-xs);
    padding-bottom: var(--gap-sm);
    border-bottom: 1px solid var(--slk-divider);
    font-weight: var(--font-bold);
    color: var(--slk-text-strong);
    font-size: var(--type-body);
}

.slk__hash {
    color: var(--slk-text-dim);
    font-weight: var(--font-normal);
}

.slk__channel-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.slk__channel-sub {
    font-weight: var(--font-normal);
    color: var(--slk-text-dim);
    margin-left: auto;
}

.slk__thread {
    display: flex;
    flex-direction: column;
    gap: var(--gap-sm);
    padding-top: var(--gap-sm);
    min-height: 0;
    overflow-y: auto;
}

.slk__msg {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: var(--gap-sm);
    align-items: flex-start;
}

.slk__avatar {
    width: 2.25rem;
    height: 2.25rem;
    border-radius: var(--radius-md);
    background: #1264a3;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--slk-text-strong);
    flex-shrink: 0;
}

.slk__body {
    min-width: 0;
}

.slk__meta {
    display: inline-flex;
    align-items: center;
    gap: var(--gap-xs);
    margin-bottom: var(--space-1);
}

.slk__author {
    font-weight: var(--font-bold);
    color: var(--slk-text-strong);
    font-size: var(--type-body);
}

.slk__bot {
    padding: 0 var(--space-1);
    border-radius: var(--radius-sm);
    background: var(--state-hover-bg-strong);
    font-weight: var(--font-bold);
    color: var(--slk-text);
    letter-spacing: var(--tracking-wide);
    font-size: 0.72em;
}

.slk__time {
    font-size: var(--type-body);
    color: var(--slk-text-dim);
}

.slk__content {
    font-size: var(--type-body);
    line-height: 1.5;
    color: var(--slk-text);
}

.slk__empty {
    margin: 0;
    color: var(--slk-text-dim);
    font-style: italic;
    display: inline-flex;
    align-items: center;
    gap: var(--gap-xs);
}

.slk__empty-icon {
    opacity: 0.6;
    font-style: normal;
}

.slk__rendered {
    margin: 0;
    padding: var(--gap-xs) var(--gap-sm);
    background: var(--state-hover-bg);
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: var(--type-body);
    line-height: 1.55;
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--slk-text);
    max-height: 20rem;
    overflow-y: auto;
}

@media (max-width: 640px) {
    .slk {
        grid-template-columns: 1fr;
    }
    .slk__rail {
        display: none;
    }
}
</style>
