<template>
    <div class="wh">
        <header class="wh__hdr">
            <div class="wh__method-row">
                <span class="wh__method">POST</span>
                <span class="wh__url" :title="url || 'https://example.com/webhook'">
                    {{ url || 'https://example.com/webhook' }}
                </span>
            </div>
            <span class="wh__status">
                <span class="wh__dot" aria-hidden="true" />
                Preview
            </span>
        </header>

        <section class="wh__section">
            <div class="wh__section-hdr">
                <span class="wh__label">Headers</span>
                <span class="wh__count">2</span>
            </div>
            <pre class="wh__code">Content-Type: application/json
User-Agent: fleet-manager</pre>
        </section>

        <section class="wh__section">
            <div class="wh__section-hdr">
                <span class="wh__label">Body</span>
                <span class="wh__lang">JSON</span>
            </div>
            <pre class="wh__code wh__code--body">{{ rendered || '(preview will render here)' }}</pre>
        </section>
    </div>
</template>

<script setup lang="ts">
defineProps<{url?: string; rendered?: string}>();
</script>

<style scoped>
.wh {
    --wh-status: var(--color-status-on);

    display: flex;
    flex-direction: column;
    gap: var(--gap-sm);
    padding: var(--gap-md);
    border-radius: var(--radius-lg);
    background: var(--color-surface-1);
    border: 1px solid var(--color-border-subtle);
    box-shadow: var(--shadow-lg);
    min-width: 0;
}

.wh__hdr {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--gap-sm);
    padding-bottom: var(--gap-sm);
    border-bottom: 1px solid var(--color-border-subtle);
}

.wh__method-row {
    display: inline-flex;
    align-items: center;
    gap: var(--gap-xs);
    padding: var(--space-1-5) var(--gap-sm);
    border-radius: var(--radius-md);
    background: var(--color-surface-0);
    font-family: var(--font-mono);
    min-width: 0;
    overflow: hidden;
}

.wh__method {
    padding: var(--space-0-5) var(--gap-xs);
    border-radius: var(--radius-sm);
    background: var(--color-primary);
    color: #fff;
    font-weight: var(--font-bold);
    letter-spacing: var(--tracking-wide);
    font-size: var(--type-body);
    flex-shrink: 0;
}

.wh__url {
    color: var(--color-text-secondary);
    font-family: var(--font-mono);
    font-size: var(--type-body);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.wh__status {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
    font-weight: var(--font-semibold);
    flex-shrink: 0;
}

.wh__dot {
    display: inline-block;
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    background: var(--wh-status);
    box-shadow: 0 0 8px rgba(var(--color-primary-rgb), 0.45);
}

.wh__section {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
}

.wh__section-hdr {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--gap-xs);
}

.wh__label {
    font-family: var(--font-sans);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-tertiary);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
}

.wh__count,
.wh__lang {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    padding: var(--space-0-5) var(--gap-xs);
    border-radius: var(--radius-full);
    background: var(--color-surface-3);
    color: var(--color-text-tertiary);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
}

.wh__code {
    margin: 0;
    padding: var(--gap-sm);
    border-radius: var(--radius-md);
    background: var(--color-surface-0);
    border: 1px solid var(--color-border-subtle);
    color: var(--color-text-secondary);
    font-family: var(--font-mono);
    font-size: var(--type-body);
    line-height: 1.55;
    white-space: pre-wrap;
    word-break: break-word;
}

.wh__code--body {
    max-height: 24rem;
    overflow-y: auto;
    color: var(--color-text-primary);
}
</style>
