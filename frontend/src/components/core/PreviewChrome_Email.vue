<!-- Hex literals exempt: mail-client chrome fidelity, not design-system chrome. -->
<template>
    <div class="em">
        <!-- Mail-client style header — gives the preview a realistic frame -->
        <div class="em__hdr">
            <div class="em__hdr-row">
                <span class="em__hdr-label">From</span>
                <span class="em__hdr-val">
                    <span class="em__hdr-chip">Fleet Manager</span>
                    &lt;alerts@fleet-manager&gt;
                </span>
            </div>
            <div class="em__hdr-row">
                <span class="em__hdr-label">To</span>
                <span class="em__hdr-val">
                    {{ endpointName || 'recipient@example.com' }}
                </span>
            </div>
            <div class="em__hdr-row em__hdr-row--subject">
                <span class="em__hdr-label">Subject</span>
                <span class="em__hdr-val em__hdr-subject">
                    {{ subject || '(preview will render here)' }}
                </span>
            </div>
        </div>

        <!-- HTML/plain toggle. Body below swaps the rendered view; with
             no dedicated tabpanel element, aria-pressed (toggle pattern)
             is more accurate than role=tab. -->
        <div class="em__tabs" role="group" aria-label="Email preview format">
            <button
                type="button"
                class="em__tab"
                :aria-pressed="tab === 'html'"
                :class="{'em__tab--active': tab === 'html'}"
                @click="tab = 'html'"
            >
                <i class="fas fa-code em__tab-icon" />
                HTML
            </button>
            <button
                type="button"
                class="em__tab"
                :aria-pressed="tab === 'text'"
                :class="{'em__tab--active': tab === 'text'}"
                @click="tab = 'text'"
            >
                <i class="fas fa-align-left em__tab-icon" />
                Plain text
            </button>
        </div>

        <!-- Body -->
        <div class="em__body">
            <p v-if="!html && !text" class="em__empty">
                <i class="fas fa-envelope-open em__empty-icon" />
                Email preview will render here once subject or body is typed.
            </p>
            <iframe
                v-else-if="tab === 'html'"
                class="em__iframe"
                :srcdoc="
                    html ||
                    `<p style='font-family:sans-serif;color:#888;padding:24px'>No HTML body — the branded default will be used.</p>`
                "
                sandbox=""
                title="Email HTML preview"
            />
            <pre v-else class="em__text">{{ text || '(no plain-text fallback)' }}</pre>
        </div>

        <!-- Attachment chips with reachability probe results -->
        <div v-if="attachments && attachments.length > 0" class="em__attach">
            <span class="em__attach-label">
                <i class="fas fa-paperclip" />
                Attachments
                <span class="em__attach-count">{{ attachments.length }}</span>
            </span>
            <ul class="em__attach-list">
                <li
                    v-for="(a, i) in attachments"
                    :key="i"
                    class="em__attach-chip"
                    :class="a.reachable ? 'em__attach-chip--ok' : 'em__attach-chip--err'"
                    :title="a.reachable ? a.url : (a.error ?? 'Unreachable')"
                >
                    <i
                        class="fas"
                        :class="a.reachable ? 'fa-circle-check' : 'fa-circle-xmark'"
                    />
                    <span class="em__attach-name">{{ a.filename }}</span>
                </li>
            </ul>
        </div>
    </div>
</template>

<script setup lang="ts">
import {ref} from 'vue';
import type {ProbedAttachment} from '@/stores/notifications';

defineProps<{
    endpointName?: string;
    subject?: string;
    html?: string;
    text?: string;
    attachments?: ProbedAttachment[];
}>();

type EmailTab = 'html' | 'text';
const tab = ref<EmailTab>('html');
</script>

<style scoped>
/* Local visual tokens. Email preview imitates a mail client's reading pane —
   header rows mirror Gmail/Apple Mail, body sits in its own card. */
.em {
    --em-body-bg: #fff;
    --em-body-fg: #111;
    --em-header-chip: color-mix(
        in srgb,
        var(--color-primary) 25%,
        var(--color-surface-1)
    );

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

.em__hdr {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding-bottom: var(--gap-sm);
    border-bottom: 1px solid var(--color-border-subtle);
}

.em__hdr-row {
    display: grid;
    grid-template-columns: 5rem 1fr;
    gap: var(--gap-xs);
    align-items: baseline;
    font-size: var(--type-body);
    color: var(--color-text-secondary);
    min-width: 0;
}

.em__hdr-row--subject {
    margin-top: var(--space-1);
    padding-top: var(--gap-xs);
    border-top: 1px solid var(--color-border-subtle);
}

.em__hdr-label {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-tertiary);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
}

.em__hdr-val {
    color: var(--color-text-primary);
    min-width: 0;
    word-break: break-word;
    line-height: 1.4;
}

.em__hdr-chip {
    display: inline-block;
    padding: 0 var(--space-1-5);
    margin-right: var(--space-1);
    background: var(--em-header-chip);
    border-radius: var(--radius-sm);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}

.em__hdr-subject {
    font-weight: var(--font-semibold);
    font-size: var(--type-body);
    color: var(--color-text-primary);
}

.em__tabs {
    display: flex;
    gap: var(--space-1);
    padding: var(--space-1);
    background: var(--color-surface-2);
    border-radius: var(--radius-md);
    align-self: flex-start;
}

.em__tab {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--gap-sm);
    border: none;
    background: transparent;
    color: var(--color-text-secondary);
    font-size: var(--type-body);
    font-weight: var(--font-medium);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition:
        background var(--motion-hover),
        color var(--motion-hover);
}

.em__tab:hover {
    color: var(--color-text-primary);
}

.em__tab--active {
    background: var(--color-surface-0);
    color: var(--color-text-primary);
    box-shadow: var(--shadow-brand-ring);
}

.em__tab-icon {
    font-size: 0.85em;
    opacity: 0.7;
}

.em__body {
    min-height: 18rem;
    display: flex;
    flex-direction: column;
}

.em__empty {
    margin: 0;
    padding: var(--gap-lg) var(--gap-md);
    text-align: center;
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
    font-style: italic;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--gap-sm);
}

.em__empty-icon {
    font-size: var(--icon-size-xl);
    opacity: 0.35;
    font-style: normal;
}

.em__iframe {
    flex: 1;
    min-height: 22rem;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--em-body-bg);
}

.em__text {
    margin: 0;
    padding: var(--gap-md);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-surface-0);
    color: var(--color-text-secondary);
    font-family: var(--font-mono);
    font-size: var(--type-body);
    line-height: 1.55;
    white-space: pre-wrap;
    max-height: 22rem;
    overflow-y: auto;
}

.em__attach {
    display: flex;
    flex-direction: column;
    gap: var(--gap-xs);
    padding-top: var(--gap-sm);
    border-top: 1px solid var(--color-border-subtle);
}

.em__attach-label {
    display: inline-flex;
    align-items: center;
    gap: var(--gap-xs);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-tertiary);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
}

.em__attach-count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.25rem;
    height: 1.25rem;
    padding: 0 var(--space-1-5);
    background: var(--color-surface-3);
    border-radius: var(--radius-full);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-secondary);
    text-transform: none;
    letter-spacing: normal;
}

.em__attach-list {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1-5);
    margin: 0;
    padding: 0;
    list-style: none;
}

.em__attach-chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-0-5) var(--gap-xs);
    border-radius: var(--radius-full);
    font-size: var(--type-body);
    font-weight: var(--font-medium);
    max-width: 22ch;
    border: 1px solid transparent;
}

.em__attach-chip--ok {
    background: var(--color-success-subtle);
    color: var(--color-success-text);
    border-color: var(--color-success);
}

.em__attach-chip--err {
    background: var(--color-danger-subtle);
    color: var(--color-danger-text);
    border-color: var(--color-danger);
}

.em__attach-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
</style>
