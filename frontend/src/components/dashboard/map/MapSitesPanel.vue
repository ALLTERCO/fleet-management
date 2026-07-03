<template>
    <aside
        class="sites-panel"
        :class="{'sites-panel--collapsed': collapsed}"
        aria-label="Sites in view"
    >
        <header class="sites-panel__head">
            <div v-if="!collapsed" class="sites-panel__head-text">
                <div class="sites-panel__title">Sites in view</div>
                <div class="sites-panel__sub">
                    {{ rows.length }} sites · grouped by country
                </div>
            </div>
            <button
                type="button"
                class="sites-panel__collapse"
                :title="collapsed ? 'Expand panel' : 'Collapse panel'"
                @click="toggle"
            >
                <i
                    class="fas"
                    :class="collapsed ? 'fa-chevron-left' : 'fa-chevron-right'"
                    aria-hidden="true"
                />
            </button>
        </header>
        <div v-if="!collapsed" class="sites-panel__scroll">
            <section
                v-for="group in groups"
                :key="group.countryCode || '__unspec'"
                class="sites-panel__group"
            >
                <header
                    class="sites-panel__country"
                    role="button"
                    tabindex="0"
                    :aria-expanded="!isGroupCollapsed(group.countryCode)"
                    @click="toggleGroup(group.countryCode)"
                    @keydown.enter.prevent="toggleGroup(group.countryCode)"
                    @keydown.space.prevent="toggleGroup(group.countryCode)"
                >
                    <i
                        class="fas sites-panel__country-chevron"
                        :class="isGroupCollapsed(group.countryCode) ? 'fa-chevron-right' : 'fa-chevron-down'"
                        aria-hidden="true"
                    />
                    <span class="sites-panel__country-label">{{ group.countryLabel }}</span>
                    <span class="sites-panel__country-count">{{ group.rows.length }}</span>
                    <span v-if="group.totalAlerts > 0" class="sites-panel__country-alerts">
                        {{ group.totalAlerts }}
                    </span>
                </header>
                <ul
                    v-if="!isGroupCollapsed(group.countryCode)"
                    class="sites-panel__list"
                    role="list"
                >
                    <li
                        v-for="row in group.rows"
                        :key="row.id"
                        tabindex="0"
                        role="button"
                        :aria-label="`Focus ${row.name}`"
                        class="sites-panel__row"
                        :class="{'sites-panel__row--alert': row.alertCount > 0}"
                        @click="select(row)"
                        @keydown.enter.prevent="select(row)"
                        @keydown.space.prevent="select(row)"
                    >
                        <span
                            class="sites-panel__pip"
                            :class="`sites-panel__pip--${row.status}`"
                            aria-hidden="true"
                        />
                        <div class="sites-panel__body">
                            <div class="sites-panel__name">{{ row.name }}</div>
                            <div class="sites-panel__meta">
                                {{ row.online }}/{{ row.total }} devices
                                <span v-if="row.summary"> · {{ row.summary }}</span>
                            </div>
                        </div>
                        <span v-if="row.alertCount > 0" class="sites-panel__badge">
                            {{ row.alertCount }}
                        </span>
                    </li>
                </ul>
            </section>
            <div v-if="rows.length === 0" class="sites-panel__empty">
                No sites to show.
            </div>
        </div>
    </aside>
</template>

<script setup lang="ts">
import {computed, reactive, ref} from 'vue';
import type {
    SitePanelCountryGroup,
    SitePanelRow
} from '@/composables/useSitePanelRows';

const props = defineProps<{
    rows: SitePanelRow[];
    groups?: SitePanelCountryGroup[];
}>();
const emit = defineEmits<{select: [row: SitePanelRow]}>();

const collapsed = ref(false);
const collapsedGroups = reactive(new Set<string>());

const groups = computed<SitePanelCountryGroup[]>(() => props.groups ?? []);

function toggle(): void {
    collapsed.value = !collapsed.value;
}

function isGroupCollapsed(code: string): boolean {
    return collapsedGroups.has(code);
}

function toggleGroup(code: string): void {
    if (collapsedGroups.has(code)) collapsedGroups.delete(code);
    else collapsedGroups.add(code);
}

function select(row: SitePanelRow): void {
    emit('select', row);
}
</script>

<style scoped>
/* iOS 26 Liquid Glass — detached card, rounded 20px, soft 3-layer shadow. */
.sites-panel {
    display: flex;
    flex-direction: column;
    width: 360px;
    max-height: 100%;
    border-radius: 20px;
    background: rgba(28, 30, 34, 0.72);
    backdrop-filter: blur(28px) saturate(180%);
    -webkit-backdrop-filter: blur(28px) saturate(180%);
    border: 1px solid rgba(255, 255, 255, 0.08);
    box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.08),
        0 2px 8px rgba(0, 0, 0, 0.32),
        0 16px 40px rgba(0, 0, 0, 0.32);
    overflow: hidden;
    transition: width var(--duration-moderate) var(--ease-out-expo);
}
.sites-panel--collapsed {
    width: 52px;
}
.sites-panel__head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-4);
    border-bottom: 1px solid var(--color-border-default);
}
.sites-panel--collapsed .sites-panel__head {
    justify-content: center;
    padding: var(--space-3);
}
.sites-panel__head-text {
    flex: 1;
    min-width: 0;
}
.sites-panel__title {
    font-size: var(--type-body);
    font-weight: var(--font-bold);
    color: var(--color-text-primary);
    margin-bottom: var(--space-0-5);
}
.sites-panel__sub {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}
.sites-panel__collapse {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: rgba(var(--color-frost-rgb), 0.06);
    border: 1px solid var(--color-border-default);
    color: var(--color-text-tertiary);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: all var(--duration-normal) var(--ease-out-expo);
    flex-shrink: 0;
}
.sites-panel__collapse:hover {
    color: var(--color-text-primary);
    background: rgba(var(--color-frost-rgb), 0.12);
}
.sites-panel__scroll {
    overflow-y: auto;
    flex: 1;
    min-height: 0;
    padding-bottom: var(--space-2);
}
.sites-panel__group + .sites-panel__group {
    border-top: 1px solid var(--color-border-subtle);
}
.sites-panel__country {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    background: color-mix(in srgb, var(--color-surface-3) 80%, transparent);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    border-bottom: 1px solid var(--color-border-subtle);
    cursor: pointer;
    user-select: none;
}
.sites-panel__country-chevron {
    color: var(--color-text-quaternary);
    font-size: var(--icon-size-xs);
}
.sites-panel__country-label {
    flex: 1;
    font-size: var(--type-caption);
    font-weight: var(--font-bold);
    color: var(--color-text-primary);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
}
.sites-panel__country-count {
    font-size: var(--type-caption);
    color: var(--color-text-quaternary);
    font-variant-numeric: tabular-nums;
}
.sites-panel__country-alerts {
    min-width: 22px;
    height: 18px;
    padding: 0 var(--space-1-5);
    border-radius: var(--radius-full);
    background: rgba(var(--color-status-off-rgb), 0.18);
    color: var(--color-status-off);
    font-size: var(--type-caption);
    font-weight: var(--font-bold);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-variant-numeric: tabular-nums;
}
.sites-panel__list {
    list-style: none;
    margin: 0;
    padding: var(--space-2);
}
.sites-panel__row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: all 0.25s var(--ease-out-expo);
}
.sites-panel__row:hover,
.sites-panel__row:focus-visible {
    background: rgba(var(--color-frost-rgb), 0.06);
    transform: translateX(2px);
    outline: none;
}
.sites-panel__row:focus-visible {
    box-shadow: 0 0 0 2px rgba(var(--color-primary-rgb), 0.45);
}
.sites-panel__row--alert {
    background: rgba(var(--color-status-off-rgb), 0.06);
}
.sites-panel__pip {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
}
.sites-panel__pip--on {
    background: var(--color-status-on);
    box-shadow: 0 0 6px var(--color-status-on);
}
.sites-panel__pip--warn {
    background: var(--color-status-warn);
    box-shadow: 0 0 6px var(--color-status-warn);
}
.sites-panel__pip--off {
    background: var(--color-status-off);
    box-shadow: 0 0 6px var(--color-status-off);
}
.sites-panel__pip--unknown {
    background: var(--color-text-quaternary);
}
.sites-panel__body {
    flex: 1;
    min-width: 0;
}
.sites-panel__name {
    font-size: var(--type-caption);
    font-weight: var(--font-bold);
    color: var(--color-text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin-bottom: 2px;
}
.sites-panel__meta {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
}
.sites-panel__badge {
    min-width: 22px;
    height: 22px;
    padding: 0 var(--space-1-5);
    border-radius: var(--radius-full);
    background: rgba(var(--color-status-off-rgb), 0.18);
    color: var(--color-status-off);
    font-size: var(--type-caption);
    font-weight: var(--font-bold);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-variant-numeric: tabular-nums;
}
.sites-panel__empty {
    padding: var(--space-4);
    text-align: center;
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}
</style>
