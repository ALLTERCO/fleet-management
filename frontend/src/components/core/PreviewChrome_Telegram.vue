<!-- Hex literals exempt: Telegram-chrome fidelity, not design-system chrome. -->
<template>
    <div class="tg">
        <header class="tg__hdr">
            <div class="tg__avatar" aria-hidden="true">
                <i class="fas fa-paper-plane" />
            </div>
            <div class="tg__id">
                <div class="tg__name">
                    {{ endpointName || 'Fleet Manager bot' }}
                </div>
                <div class="tg__status">bot · online</div>
            </div>
            <div class="tg__nav" aria-hidden="true">
                <i class="fas fa-magnifying-glass" />
                <i class="fas fa-ellipsis-vertical" />
            </div>
        </header>

        <div class="tg__thread">
            <div class="tg__date-chip">Today</div>

            <div class="tg__message">
                <div class="tg__bubble">
                    <p v-if="!rendered" class="tg__empty">
                        <i class="fas fa-comment-dots tg__empty-icon" />
                        Message preview will appear here.
                    </p>
                    <pre v-else class="tg__rendered">{{ rendered }}</pre>
                    <span class="tg__time">
                        {{ timeLabel }}
                        <i class="fas fa-check-double tg__ticks" />
                    </span>
                </div>
            </div>
        </div>
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
/* Telegram brand tokens scoped locally. */
.tg {
    --tg-bg: #17212b;
    --tg-hdr: #17212b;
    --tg-divider: rgba(255, 255, 255, 0.06);
    --tg-bubble: #2b5278;
    --tg-avatar: #5288c1;
    --tg-text: #fff;
    --tg-text-dim: #8a99a8;
    --tg-ticks: #64baf0;

    display: flex;
    flex-direction: column;
    border-radius: var(--radius-lg);
    overflow: hidden;
    background: var(--tg-bg);
    color: var(--tg-text);
    font-family: var(--font-sans);
    box-shadow: var(--shadow-lg);
}

.tg__hdr {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: var(--gap-sm);
    align-items: center;
    padding: var(--gap-sm) var(--gap-md);
    background: var(--tg-hdr);
    border-bottom: 1px solid var(--tg-divider);
}

.tg__avatar {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.5rem;
    height: 2.5rem;
    border-radius: 50%;
    background: var(--tg-avatar);
    color: var(--tg-text);
    font-size: var(--icon-size-sm);
}

.tg__id {
    display: flex;
    flex-direction: column;
    gap: var(--space-px);
    min-width: 0;
}

.tg__name {
    font-size: var(--type-body);
    font-weight: var(--font-bold);
    color: var(--tg-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.tg__status {
    font-size: var(--type-body);
    color: var(--tg-text-dim);
}

.tg__nav {
    display: inline-flex;
    gap: var(--gap-sm);
    color: var(--tg-text-dim);
    font-size: var(--icon-size-sm);
}

.tg__thread {
    display: flex;
    flex-direction: column;
    gap: var(--gap-sm);
    padding: var(--gap-md);
    min-height: 14rem;
    background: var(--tg-bg);
}

.tg__date-chip {
    align-self: center;
    padding: var(--space-0-5) var(--gap-xs);
    background: var(--state-hover-bg-strong);
    border-radius: var(--radius-full);
    font-size: var(--type-body);
    color: var(--tg-text-dim);
}

.tg__message {
    display: flex;
    justify-content: flex-start;
}

.tg__bubble {
    position: relative;
    max-width: 85%;
    padding: var(--gap-xs) var(--gap-sm) var(--gap-sm);
    border-radius: var(--radius-xl) var(--radius-xl) var(--radius-xl) var(--radius-sm);
    background: var(--tg-bubble);
    color: var(--tg-text);
    font-size: var(--type-body);
    line-height: 1.5;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
}

.tg__empty {
    margin: 0;
    color: var(--color-text-primary);
    font-style: italic;
    display: inline-flex;
    align-items: center;
    gap: var(--gap-xs);
}

.tg__empty-icon {
    opacity: 0.6;
    font-style: normal;
}

.tg__rendered {
    margin: 0;
    font-family: var(--font-sans);
    font-size: var(--type-body);
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
}

.tg__time {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    margin-top: var(--space-1);
    font-size: var(--type-body);
    color: var(--color-text-secondary);
    justify-content: flex-end;
    width: 100%;
}

.tg__ticks {
    color: var(--tg-ticks);
    font-size: var(--type-caption);
}
</style>
