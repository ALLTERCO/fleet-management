<template>
    <div class="fwa__sidebar">
        <div class="fwa__group">
            <h4 class="fwa__group-title">Update</h4>
            <div class="fwa__pair">
                <Button
                    type="blue"
                    size="sm"
                    :disabled="stableEligibleCount === 0 || updatingCount > 0"
                    @click="$emit('update-stable')"
                >
                    Stable
                    <span class="fwa__btn-badge">
                        {{ stableEligibleCount }}/{{ selectedCount }}
                    </span>
                </Button>
                <Button
                    type="orange-hollow"
                    size="sm"
                    :disabled="betaEligibleCount === 0 || updatingCount > 0"
                    @click="$emit('update-beta')"
                >
                    Beta
                    <span class="fwa__btn-badge">
                        {{ betaEligibleCount }}/{{ selectedCount }}
                    </span>
                </Button>
            </div>
        </div>

        <div class="fwa__group">
            <h4 class="fwa__group-title">Custom Firmware</h4>
            <div class="fwa__pair">
                <Button
                    type="blue-hollow"
                    size="sm"
                    @click="$emit('open-upload')"
                >
                    Upload
                </Button>
                <Button type="blue-hollow" size="sm" @click="$emit('open-url')">
                    URL
                </Button>
            </div>
        </div>

        <div class="fwa__group">
            <h4 class="fwa__group-title">Auto-Update</h4>
            <p class="auto__state">On selected: <strong>{{ autoUpdateLabel }}</strong></p>
            <div class="auto__opts">
                <button
                    type="button"
                    class="auto__opt"
                    :class="{'auto__opt--on': autoUpdateSummary === 'stable'}"
                    @click="$emit('enable-stable-auto')"
                >
                    Stable
                </button>
                <button
                    type="button"
                    class="auto__opt"
                    :class="{'auto__opt--on': autoUpdateSummary === 'beta'}"
                    @click="$emit('enable-beta-auto')"
                >
                    <span class="auto__dot" aria-hidden="true" />Beta
                </button>
                <button
                    type="button"
                    class="auto__opt"
                    :class="{'auto__opt--on': autoUpdateSummary === 'off'}"
                    @click="$emit('disable-auto')"
                >
                    Off
                </button>
            </div>
        </div>

        <div class="fwa__group fwa__group--grow">
            <button
                type="button"
                class="lib__toggle"
                :class="{'lib__toggle--open': libraryOpen}"
                :aria-expanded="libraryOpen"
                @click="toggleLibrary"
            >
                <i class="fas fa-chevron-right lib__chevron" aria-hidden="true" />
                <span class="lib__label">Library</span>
                <span v-if="library.length > 0" class="lib__count">
                    {{ compatibleCount }} of {{ library.length }} fit
                </span>
            </button>

            <div v-if="libraryOpen" class="lib__body">
                <div v-if="loadingLibrary" class="lib__empty">
                    <Spinner size="xs" /> Loading…
                </div>
                <div v-else-if="library.length === 0" class="lib__empty">
                    No files uploaded yet
                </div>
                <div v-else class="lib__list">
                    <button
                        v-for="item in library"
                        :key="item.id"
                        type="button"
                        class="lib__row"
                        :class="{'lib__row--off': !canUseItem(item)}"
                        :disabled="!canUseItem(item)"
                        :title="canUseItem(item)
                            ? 'Flash to compatible devices'
                            : 'No compatible device in the current selection'"
                        @click="$emit('use-library-item', item)"
                    >
                        <span class="lib__name">{{ item.name || item.originalFileName }}</span>
                        <span class="lib__meta"><span
                            v-if="item.channel === 'beta'"
                            class="lib__beta"
                        >beta</span>{{ libMetaRest(item) }}</span>
                        <span class="lib__flash" aria-hidden="true">Flash →</span>
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, ref} from 'vue';
import Button from '@/components/core/Button.vue';
import Spinner from '@/components/core/Spinner.vue';
import type {FirmwareLibraryItem} from '@/components/firmware/FirmwareLibraryModal.vue';

const props = defineProps<{
    selectedCount: number;
    stableEligibleCount: number;
    betaEligibleCount: number;
    updatingCount: number;
    loadingLibrary: boolean;
    library: FirmwareLibraryItem[];
    canUseItem: (item: FirmwareLibraryItem) => boolean;
    autoUpdateSummary: 'stable' | 'beta' | 'off' | 'mixed';
}>();

const AUTO_UPDATE_LABELS: Record<string, string> = {
    stable: 'Stable',
    beta: 'Beta',
    off: 'Off',
    mixed: 'Mixed'
};
const autoUpdateLabel = computed(
    () => AUTO_UPDATE_LABELS[props.autoUpdateSummary] ?? 'Off'
);

defineEmits<{
    'update-stable': [];
    'update-beta': [];
    'open-upload': [];
    'open-url': [];
    'enable-stable-auto': [];
    'enable-beta-auto': [];
    'disable-auto': [];
    'use-library-item': [item: FirmwareLibraryItem];
    'delete-library-item': [item: FirmwareLibraryItem];
}>();

// Library starts collapsed and remembers each user's preference — some users
// flash from here constantly, most never do.
const LIBRARY_OPEN_KEY = 'fw-sidebar-library-open';
const libraryOpen = ref(readLibraryOpen());

function readLibraryOpen(): boolean {
    try {
        return localStorage.getItem(LIBRARY_OPEN_KEY) === '1';
    } catch {
        return false;
    }
}

function toggleLibrary(): void {
    libraryOpen.value = !libraryOpen.value;
    try {
        localStorage.setItem(LIBRARY_OPEN_KEY, libraryOpen.value ? '1' : '0');
    } catch {
        // storage unavailable — keep the in-memory state only
    }
}

// How many uploaded files can flash to the current device selection.
const compatibleCount = computed(
    () => props.library.filter((item) => props.canUseItem(item)).length
);

// Secondary line under the file name; "beta" is rendered separately so it can
// carry its own colour.
function libMetaRest(item: FirmwareLibraryItem): string {
    const parts: string[] = [];
    if (item.ver) parts.push(`v${item.ver}`);
    if (item.model) parts.push(item.model);
    if (parts.length === 0 && item.channel !== 'beta') {
        parts.push(`${(item.fileSize / 1024).toFixed(0)} KB`);
    }
    const joined = parts.join(' · ');
    if (item.channel === 'beta') return joined ? ` · ${joined}` : '';
    return joined;
}
</script>

<style scoped>
/* Sidebar layout and groups. These live here — not in the parent page — so the
   component owns its own styles. A parent's scoped CSS only reaches a child's
   root element, not its internals, so keeping them here is the correct fix. */
.fwa__sidebar {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    padding: var(--space-3);
}
.fwa__sidebar :deep(.core-btn) {
    min-width: 0;
    align-self: flex-start;
}
.fwa__group {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}
.fwa__group--grow {
    flex: 1;
    min-height: 0;
}
.fwa__pair,
.fwa__triple {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
}
.fwa__group-title {
    margin: 0 0 var(--space-1);
    font-size: var(--type-caption);
    font-weight: var(--font-bold);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--color-text-tertiary);
}
.fwa__btn-badge {
    font-size: var(--type-caption);
    font-family: var(--font-mono);
    opacity: 0.7;
}

@media (max-width: 768px) {
    .fwa__sidebar {
        flex: none;
        border-top: 1px solid var(--color-border-medium);
    }
}

/* Auto-update: a mode picker, not three CTAs. Current mode is marked; the
   others are quiet. No green/red — a mode isn't a confirm or a delete. */
.auto__state {
    margin: 0 0 var(--space-2);
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}
.auto__state strong {
    color: var(--color-text-primary);
    font-weight: var(--font-semibold);
}
.auto__opts {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
}
.auto__opt {
    display: inline-flex;
    align-items: center;
    min-height: var(--touch-target-min);
    padding: var(--space-2) var(--space-3);
    background: transparent;
    border: 2px solid var(--color-border-medium);
    border-radius: var(--btn-radius);
    color: var(--color-text-secondary);
    font-family: inherit;
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    cursor: pointer;
    transition:
        border-color var(--duration-fast) var(--ease-default),
        background-color var(--duration-fast) var(--ease-default),
        color var(--duration-fast) var(--ease-default);
}
.auto__opt:hover {
    border-color: var(--color-border-strong);
    color: var(--color-text-primary);
}
.auto__opt--on {
    background: var(--color-surface-4);
    border-color: var(--color-primary);
    color: var(--color-text-primary);
}
.auto__opt--on::after {
    content: "✓";
    margin-left: var(--space-2);
    color: var(--color-primary-text);
    font-size: var(--type-caption);
}
.auto__dot {
    width: 6px;
    height: 6px;
    margin-right: var(--space-2);
    border-radius: var(--radius-full);
    background: var(--color-orange-text);
}

/* Collapsible, minimal library picker. The whole row is the flash target —
   no icon buttons, no chips. */
.lib__toggle {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    min-height: var(--touch-target-min);
    padding: var(--space-2) 0;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--color-primary-text);
    font-family: inherit;
    font-size: var(--type-body);
    font-weight: var(--font-medium);
    text-align: left;
}
.lib__chevron {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    transition: transform var(--duration-fast) var(--ease-default);
}
.lib__toggle--open .lib__chevron {
    transform: rotate(90deg);
}
.lib__label {
    flex: 1;
}
.lib__count {
    font-size: var(--type-caption);
    font-family: var(--font-mono);
    font-weight: var(--font-normal);
    color: var(--color-text-tertiary);
}

.lib__body {
    flex: 1;
    min-height: 0;
    margin-top: var(--space-1);
    overflow-y: auto;
}
.lib__empty {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3) 0;
    color: var(--color-text-disabled);
    font-size: var(--type-caption);
}

.lib__list {
    display: flex;
    flex-direction: column;
}
.lib__row {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    width: 100%;
    min-height: var(--touch-target-min);
    padding: var(--space-2);
    background: none;
    border: none;
    border-radius: var(--radius-sm);
    text-align: left;
    font-family: inherit;
    cursor: pointer;
    transition: background-color var(--duration-fast) var(--ease-default);
}
.lib__row:hover {
    background: color-mix(in srgb, var(--color-text-tertiary) 6%, transparent);
}
.lib__row--off {
    opacity: var(--opacity-disabled);
    cursor: not-allowed;
}
.lib__row--off:hover {
    background: none;
}
.lib__name {
    padding-right: var(--space-12); /* clears the hover "Flash →" label */
    font-size: var(--type-body);
    font-weight: var(--font-medium);
    color: var(--color-text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.lib__meta {
    font-size: var(--type-caption);
    font-family: var(--font-mono);
    color: var(--color-text-tertiary);
}
.lib__beta {
    color: var(--color-orange-text);
}
.lib__flash {
    position: absolute;
    top: 50%;
    right: var(--space-2);
    transform: translateY(-50%);
    font-size: var(--type-caption);
    color: var(--color-primary-text);
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--duration-fast) var(--ease-default);
}
.lib__row:hover .lib__flash {
    opacity: 1;
}
.lib__row--off:hover .lib__flash {
    opacity: 0;
}
</style>
