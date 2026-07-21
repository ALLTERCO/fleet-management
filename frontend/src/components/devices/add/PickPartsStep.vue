<template>
    <div class="pps">
        <template v-if="draft.profile && !draft.manualMode">
            <div class="pps__role-head">
                <h4>{{ draft.profile.name }}</h4>
                <p>Connect the parts this virtual device needs.</p>
            </div>
            <div class="pps__roles">
                <section
                    v-for="role in draft.roles"
                    :key="role.roleKey"
                    class="pps__role"
                    :class="{'pps__role--done': role.source !== null}"
                >
                    <div class="pps__role-title">
                        <span
                            class="pps__role-icon"
                            :style="iconTileStyle(roleType(role.roleKey))"
                        >
                            <i
                                class="fas"
                                :class="role.visual?.icon ?? partVisual(roleType(role.roleKey)).icon"
                            />
                        </span>
                        <span>
                            <strong>{{ role.label }}</strong>
                            <small>
                                {{ role.required ? 'Required' : 'Optional' }}
                                <template v-if="role.unit"> · {{ role.unit }}</template>
                            </small>
                        </span>
                    </div>
                    <SourceComponentPicker
                        :role-key="role.roleKey"
                        :selected="role.source"
                        :candidate-filter="(candidate) => roleMatchesCandidate(role, candidate)"
                        @select="(source) => draft.bindRole(role.roleKey, source)"
                        @clear="draft.bindRole(role.roleKey, null)"
                    />
                </section>
            </div>
        </template>

        <template v-else>
            <!-- Search + type filter -->
            <div class="pps__search-row">
                <div class="pps__search-wrap">
                    <i class="fas fa-magnifying-glass pps__search-icon" />
                    <input
                        v-model="query"
                        class="pps__search-input"
                        type="search"
                        placeholder="Search devices or parts…"
                        @input="onQueryInput"
                    />
                </div>
                <div class="pps__filter">
                    <button
                        type="button"
                        class="pps__filter-btn"
                        :class="{ 'pps__filter-btn--active': activeType !== null }"
                        aria-label="Filter by type"
                        @click="filterOpen = !filterOpen"
                    >
                        <i class="fas fa-filter" />
                        <span v-if="activeType !== null" class="pps__filter-badge">1</span>
                    </button>
                    <div v-if="filterOpen" class="pps__filter-menu">
                        <button
                            type="button"
                            class="pps__filter-item"
                            :class="{ 'pps__filter-item--on': activeType === null }"
                            @click="selectType(null)"
                        >
                            All types
                        </button>
                        <button
                            v-for="t in distinctTypes"
                            :key="t.type"
                            type="button"
                            class="pps__filter-item"
                            :class="{ 'pps__filter-item--on': activeType === t.type }"
                            @click="selectType(t.type)"
                        >
                            <i class="fas" :class="t.icon" />
                            {{ t.label }}
                        </button>
                    </div>
                </div>
            </div>

            <div v-if="loading" class="pps__state">
                <Spinner size="sm" /> Loading parts…
            </div>
            <div v-else-if="error" class="pps__state pps__state--error">
                {{ error }}
            </div>
            <div v-else-if="visibleGroups.length === 0" class="pps__state">
                No parts found{{ query ? ' for that search' : '' }}.
            </div>

            <template v-else>
                <p class="pps__section-label">Your devices</p>

                <div
                    v-for="group in visibleGroups"
                    :key="group.deviceExternalId"
                    class="pps__device"
                    :class="{ 'pps__device--open': openIds.has(group.deviceExternalId) }"
                >
                    <button
                        type="button"
                        class="pps__devhead"
                        @click="toggleGroup(group.deviceExternalId)"
                    >
                        <div class="pps__devphoto">
                            <i
                                v-if="group.logo.kind === 'icon'"
                                class="pps__devglyph"
                                :class="group.logo.faClass"
                                :style="deviceGlyphStyle(group.logo)"
                                :aria-label="group.displayName"
                            />
                            <img
                                v-else
                                :src="group.logo.src"
                                :alt="group.displayName"
                                class="pps__devimg"
                                loading="lazy"
                                @error="onLogoError"
                            />
                        </div>
                        <div class="pps__devinfo">
                            <span class="pps__devname">{{ group.displayName }}</span>
                            <span class="pps__devmeta">
                                {{ group.parts.length }} part{{ group.parts.length === 1 ? '' : 's' }}
                            </span>
                        </div>
                        <i
                            class="fas pps__chevron"
                            :class="openIds.has(group.deviceExternalId) ? 'fa-chevron-up' : 'fa-chevron-down'"
                        />
                    </button>

                    <div v-if="openIds.has(group.deviceExternalId)" class="pps__parts">
                        <div
                            v-for="part in group.parts"
                            :key="`${part.deviceExternalId}|${part.componentKey}`"
                            class="pps__prow"
                            :class="{ 'pps__prow--picked': draft.isPicked(part) }"
                            role="button"
                            tabindex="0"
                            @click="togglePart(part)"
                            @keydown.enter.space.prevent="togglePart(part)"
                        >
                            <div class="pps__pic" :style="iconTileStyle(part.componentType)">
                                <i
                                    class="fas pps__pic-icon"
                                    :class="partVisual(part.componentType).icon"
                                />
                            </div>
                            <span class="pps__pname">{{ humaniseLabel(part) }}</span>
                            <div
                                class="pps__chk"
                                :class="{ 'pps__chk--on': draft.isPicked(part) }"
                            >
                                <i
                                    v-if="draft.isPicked(part)"
                                    class="fas fa-check pps__chk-icon"
                                />
                            </div>
                        </div>

                        <button
                            type="button"
                            class="pps__addall"
                            @click.stop="addAllParts(group)"
                        >
                            <i class="fas fa-plus" /> Add all parts
                        </button>
                    </div>
                </div>
                <button
                    v-if="hasMore"
                    type="button"
                    class="pps__load-more"
                    :disabled="loadingMore"
                    @click="loadMore"
                >
                    <i :class="loadingMore ? 'fas fa-spinner fa-spin' : 'fas fa-chevron-down'" />
                    Load more parts
                </button>
            </template>
        </template>

        <div class="pps__footer">
            <span class="pps__picked-count">{{ pickedLabel }}</span>
        </div>
    </div>
</template>

<script setup lang="ts">
import {type SourceComponentCandidate, virtualDevices} from '@host/virtualDevices';
import {computed, onBeforeUnmount, ref, watch} from 'vue';
import Spinner from '@/components/core/Spinner.vue';
import SourceComponentPicker from '@/components/devices/add/SourceComponentPicker.vue';
import {useDeviceIdentity} from '@/composables/useDeviceIdentity';
import {type DeviceLogo, deviceGlyphStyle} from '@/helpers/deviceLogo';
import {humaniseLabel, partVisual} from '@/helpers/partLabels';
import {roleMatchesCandidate} from '@/helpers/virtualDeviceTemplates';
import {useVirtualDeviceDraftStore} from '@/stores/virtualDeviceDraftStore';

interface DeviceGroup {
    deviceExternalId: string;
    deviceName: string;
    parts: SourceComponentCandidate[];
}

interface DeviceGroupView extends DeviceGroup {
    logo: DeviceLogo;
    displayName: string;
}

const draft = useVirtualDeviceDraftStore();
const {deviceLogoById, deviceNameById} = useDeviceIdentity();

const loading = ref(false);
const error = ref<string | null>(null);
const query = ref('');
const groups = ref<DeviceGroup[]>([]);
const openIds = ref(new Set<string>());
const activeType = ref<string | null>(null);
const filterOpen = ref(false);
const nextOffset = ref(0);
const hasMore = ref(false);
const loadingMore = ref(false);

const GENERIC_DEVICE_IMG = '/images/devices/unknown-device.svg';
const PAGE_SIZE = 200;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;

const ACCENT_RGB_VARS: Record<string, string> = {
    switch: '--accent-switch',
    energy: '--accent-energy',
    temp: '--accent-temp',
    humidity: '--accent-humidity',
    generic: '--accent-generic',
};

function iconTileStyle(componentType: string): Record<string, string> {
    const accent = partVisual(componentType).accent;
    const varName = ACCENT_RGB_VARS[accent] ?? '--accent-generic';
    return {
        background: `rgba(var(${varName}), 0.14)`,
        color: `rgb(var(${varName}))`,
    };
}

function onLogoError(e: Event): void {
    (e.target as HTMLImageElement).src = GENERIC_DEVICE_IMG;
}

const distinctTypes = computed(() => {
    const seen = new Map<string, {type: string; label: string; icon: string}>();
    for (const g of groups.value) {
        for (const p of g.parts) {
            if (!seen.has(p.componentType)) {
                seen.set(p.componentType, {
                    type: p.componentType,
                    label: humaniseLabel({componentType: p.componentType}),
                    icon: partVisual(p.componentType).icon,
                });
            }
        }
    }
    return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
});

const visibleGroups = computed<DeviceGroupView[]>(() => {
    const base =
        activeType.value === null
            ? groups.value
            : groups.value
                  .map((g) => ({...g, parts: g.parts.filter((p) => p.componentType === activeType.value)}))
                  .filter((g) => g.parts.length > 0);
    // Identity via the shared grid pipeline, not the raw backend fields.
    return base.map((g) => ({
        ...g,
        logo: deviceLogoById(g.deviceExternalId),
        displayName: deviceNameById(g.deviceExternalId, g.deviceName)
    }));
});

const pickedLabel = computed(() => {
    if (draft.profile && !draft.manualMode) {
        const bound = draft.roles.filter((role) => role.source !== null).length;
        return `${bound} of ${draft.roles.length} connected`;
    }
    return `${draft.pickedParts.length} picked`;
});

function roleType(roleKey: string): string {
    return roleKey.split('_')[0] || roleKey;
}

function selectType(type: string | null): void {
    activeType.value = type;
    filterOpen.value = false;
}

function groupByDevice(items: SourceComponentCandidate[]): DeviceGroup[] {
    const map = new Map<string, DeviceGroup>();
    for (const item of items) {
        const existing = map.get(item.deviceExternalId);
        if (existing) existing.parts.push(item);
        else
            map.set(item.deviceExternalId, {
                deviceExternalId: item.deviceExternalId,
                deviceName: item.deviceName,
                parts: [item],
            });
    }
    return [...map.values()];
}

function mergeGroups(
    current: DeviceGroup[],
    items: SourceComponentCandidate[]
): DeviceGroup[] {
    return groupByDevice([
        ...current.flatMap((group) => group.parts),
        ...items,
    ]);
}

async function loadParts(q?: string, append = false): Promise<void> {
    if (append) loadingMore.value = true;
    else loading.value = true;
    error.value = null;
    try {
        const res = await virtualDevices.bindings.listSources({
            query: q?.trim() || undefined,
            limit: PAGE_SIZE,
            offset: append ? nextOffset.value : 0,
        });
        const next = append
            ? mergeGroups(groups.value, res.items)
            : groupByDevice(res.items);
        groups.value = next;
        nextOffset.value = res.offset + res.items.length;
        hasMore.value = res.has_more;
        if (!q && next.length > 0 && openIds.value.size === 0) {
            openIds.value = new Set([next[0].deviceExternalId]);
        }
    } catch (err) {
        error.value = err instanceof Error ? err.message : String(err);
        if (!append) groups.value = [];
        hasMore.value = false;
    } finally {
        loading.value = false;
        loadingMore.value = false;
    }
}

function onQueryInput(): void {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => loadParts(query.value), 250);
}

function toggleGroup(id: string): void {
    const next = new Set(openIds.value);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    openIds.value = next;
}

function togglePart(candidate: SourceComponentCandidate): void {
    if (draft.isPicked(candidate)) {
        const row = draft.pickedParts.find(
            (p) =>
                p.source?.deviceExternalId === candidate.deviceExternalId &&
                p.source?.componentKey === candidate.componentKey
        );
        if (row) draft.removePart(row.roleKey);
    } else {
        draft.addPart(candidate);
    }
}

function addAllParts(group: DeviceGroup): void {
    for (const part of group.parts) if (!draft.isPicked(part)) draft.addPart(part);
}

function loadMore(): void {
    void loadParts(query.value, true);
}

// KeepAlive caches this step, so load on mode — template→custom must refetch.
watch(
    () => draft.manualMode || !draft.profile,
    (manual) => {
        if (manual) void loadParts(query.value);
    },
    {immediate: true}
);

onBeforeUnmount(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
});
</script>

<style scoped>
.pps {
    display: flex;
    flex-direction: column;
    gap: var(--gap-sm);
}
.pps__search-row {
    display: flex;
    gap: var(--gap-xs);
    align-items: center;
}
.pps__role-head {
    display: grid;
    gap: var(--space-1);
}
.pps__role-head h4,
.pps__role-head p {
    margin: 0;
}
.pps__role-head h4 {
    font-size: var(--type-heading);
    color: var(--color-text-primary);
}
.pps__role-head p {
    color: var(--color-text-secondary);
    font-size: var(--type-body);
}
.pps__roles {
    display: grid;
    gap: var(--space-2);
}
.pps__role {
    display: grid;
    gap: var(--space-2);
    padding: var(--space-3);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
}
.pps__role--done {
    border-color: color-mix(
        in srgb,
        var(--color-success-text) 40%,
        var(--color-border-subtle)
    );
}
.pps__role-title {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}
.pps__role-title span:last-child {
    display: grid;
    gap: 2px;
}
.pps__role-title strong {
    color: var(--color-text-primary);
}
.pps__role-title small {
    color: var(--color-text-tertiary);
}
.pps__role-icon {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: var(--radius-full);
}
.pps__search-wrap {
    flex: 1;
    position: relative;
    display: flex;
    align-items: center;
}
.pps__search-icon {
    position: absolute;
    left: 13px;
    color: var(--color-text-tertiary);
    font-size: 13px;
    pointer-events: none;
}
.pps__search-input {
    width: 100%;
    height: 46px;
    padding: 0 13px 0 36px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    color: var(--color-text-primary);
    font-size: var(--type-body);
    outline: none;
    appearance: none;
    transition: border-color var(--duration-fast);
}
.pps__search-input::placeholder {
    color: var(--color-text-tertiary);
}
.pps__search-input:focus {
    border-color: var(--color-border-focus);
}
.pps__search-input::-webkit-search-cancel-button {
    display: none;
}
.pps__filter {
    position: relative;
    flex-shrink: 0;
}
.pps__filter-btn {
    position: relative;
    width: 46px;
    height: 46px;
    display: grid;
    place-items: center;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    color: var(--color-text-secondary);
    cursor: pointer;
    transition: border-color var(--duration-fast);
}
.pps__filter-btn:hover,
.pps__filter-btn--active {
    border-color: var(--color-border-focus);
    color: var(--brand-light);
}
.pps__filter-badge {
    position: absolute;
    top: 6px;
    right: 6px;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    background: var(--color-primary);
    border-radius: var(--radius-full);
    color: var(--color-text-on-primary);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    line-height: 16px;
    text-align: center;
}
.pps__filter-menu {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: var(--z-dropdown);
    min-width: 180px;
    background: var(--glass-4-bg);
    backdrop-filter: blur(var(--glass-4-blur));
    border: 1px solid var(--color-border-medium);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    padding: var(--space-1);
    display: flex;
    flex-direction: column;
}
.pps__filter-item {
    display: flex;
    align-items: center;
    gap: var(--gap-xs);
    padding: 10px 12px;
    background: transparent;
    border: none;
    border-radius: var(--radius-md);
    color: var(--color-text-secondary);
    font-size: var(--type-body);
    text-align: left;
    cursor: pointer;
}
.pps__filter-item:hover {
    background: var(--glass-hover);
    color: var(--color-text-primary);
}
.pps__filter-item--on {
    color: var(--brand-light);
}
.pps__filter-item i {
    width: 16px;
    text-align: center;
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}
.pps__section-label {
    margin: 0;
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    color: var(--color-text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.03em;
}
.pps__state {
    display: flex;
    align-items: center;
    gap: var(--gap-xs);
    padding: var(--gap-sm);
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}
.pps__state--error {
    color: var(--color-warning-text);
}
.pps__device {
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    overflow: hidden;
    transition: border-color var(--duration-fast);
}
.pps__device--open {
    border-color: var(--color-border-strong);
    background: rgba(var(--brand-blue-rgb), 0.05);
}
.pps__devhead {
    width: 100%;
    display: flex;
    align-items: center;
    gap: var(--gap-sm);
    padding: var(--gap-sm);
    background: transparent;
    border: none;
    color: var(--color-text-primary);
    cursor: pointer;
    text-align: left;
    transition: background var(--duration-fast);
}
.pps__devhead:hover {
    background: rgba(255, 255, 255, 0.03);
}
.pps__devphoto {
    width: 48px;
    height: 48px;
    flex-shrink: 0;
    display: grid;
    place-items: center;
    border-radius: var(--radius-md);
    background: var(--color-surface-3);
    overflow: hidden;
}
.pps__devimg {
    width: 40px;
    height: 40px;
    object-fit: contain;
}
.pps__devglyph {
    font-size: var(--type-subheading);
    color: var(--color-text-secondary);
}
.pps__devinfo {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
}
.pps__devname {
    font-weight: var(--font-semibold);
    font-size: var(--type-body);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.pps__devmeta {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}
.pps__chevron {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    flex-shrink: 0;
}
.pps__parts {
    padding: 2px var(--gap-sm) var(--gap-sm);
    border-top: 1px solid var(--color-border-default);
    display: flex;
    flex-direction: column;
    gap: 4px;
}
.pps__prow {
    display: flex;
    align-items: center;
    gap: var(--gap-sm);
    padding: 8px;
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: background var(--duration-fast);
    user-select: none;
}
.pps__prow:hover {
    background: rgba(255, 255, 255, 0.04);
}
.pps__prow--picked {
    background: rgba(var(--brand-blue-rgb), 0.08);
}
.pps__pic {
    width: 30px;
    height: 30px;
    flex-shrink: 0;
    display: grid;
    place-items: center;
    border-radius: var(--radius-sm-plus);
}
.pps__pic-icon {
    font-size: 13px;
}
.pps__pname {
    flex: 1;
    font-size: var(--type-body);
    color: var(--color-text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.pps__chk {
    width: 22px;
    height: 22px;
    flex-shrink: 0;
    border-radius: var(--radius-full);
    border: 2px solid var(--color-border-medium);
    display: grid;
    place-items: center;
    transition: background var(--duration-fast), border-color var(--duration-fast);
}
.pps__chk--on {
    background: var(--gradient-brand);
    border-color: transparent;
    box-shadow: 0 0 0 3px rgba(var(--brand-blue-rgb), 0.25);
}
.pps__chk-icon {
    font-size: var(--type-caption);
    color: #fff;
}
.pps__addall {
    display: inline-flex;
    align-items: center;
    gap: var(--gap-xs);
    margin-top: 4px;
    padding: 8px 13px;
    background: transparent;
    border: 1px solid var(--color-border-medium);
    border-radius: var(--radius-md);
    color: var(--brand-light);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    cursor: pointer;
    transition: border-color var(--duration-fast), background var(--duration-fast);
}
.pps__addall:hover {
    border-color: var(--brand-blue);
    background: rgba(var(--brand-blue-rgb), 0.08);
}
.pps__load-more {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-2);
    border: 1px solid var(--color-border-medium);
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
    color: var(--color-text-secondary);
    cursor: pointer;
}
.pps__load-more:hover:not(:disabled) {
    color: var(--color-text-primary);
    border-color: var(--color-border-strong);
}
.pps__load-more:disabled {
    opacity: 0.6;
    cursor: wait;
}
.pps__footer {
    display: flex;
    align-items: center;
    padding-top: var(--gap-xs);
    border-top: 1px solid var(--color-border-subtle);
}
.pps__picked-count {
    font-size: var(--type-caption);
    color: var(--color-text-secondary);
    font-weight: var(--font-medium);
}
</style>
