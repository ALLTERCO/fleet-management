<template>
    <WizardStep name="parts" :lede="lede">
        <template v-if="draft.profile && !draft.manualMode">
            <div class="pps__roles">
                <FormSection
                    v-for="role in draft.roles"
                    :key="role.roleKey"
                    class="pps__role"
                    :class="{'pps__role--done': role.source !== null}"
                    :icon="roleIcon(role)"
                    :title="role.label"
                    :badge="role.source ? 'Connected' : roleBadge(role)"
                >
                    <SourceComponentPicker
                        :role-key="role.roleKey"
                        :profile-id="draft.profile?.id"
                        :selected="role.source"
                        @select="(source) => draft.bindRole(role.roleKey, source)"
                        @clear="draft.bindRole(role.roleKey, null)"
                    />
                </FormSection>
            </div>
        </template>

        <template v-else>
            <div class="pps__filters">
                <FilterPill
                    v-model="query"
                    placeholder="Search devices or parts"
                    @update:model-value="onQueryInput"
                />
                <FilterSelect
                    v-model="activeTypeLabel"
                    :options="typeLabels"
                    all-label="All types"
                />
            </div>

            <PickRowSkeleton v-if="loading" label="Loading parts" />
            <WizardState v-else-if="error" tone="error">{{ error }}</WizardState>
            <WizardState v-else-if="visibleGroups.length === 0" tone="empty">
                No parts found{{ query ? ' for that search' : '' }}.
            </WizardState>

            <template v-else>
                <div
                    v-for="group in visibleGroups"
                    :key="group.deviceExternalId"
                    class="pps__device"
                >
                    <PickRow
                        :selected="openIds.has(group.deviceExternalId)"
                        @click="toggleGroup(group.deviceExternalId)"
                    >
                        <template #lead>
                            <i
                                v-if="group.logo.kind === 'icon'"
                                :class="group.logo.faClass"
                                :style="deviceGlyphStyle(group.logo)"
                                :aria-label="group.displayName"
                            />
                            <img
                                v-else
                                :src="group.logo.src"
                                :alt="group.displayName"
                                loading="lazy"
                                @error="onLogoError"
                            />
                        </template>
                        {{ group.displayName }}
                        <template #meta>
                            {{ group.parts.length }}
                            part{{ group.parts.length === 1 ? '' : 's' }}
                        </template>
                        <template #trail>
                            <i
                                class="fas pps__chevron"
                                :class="
                                    openIds.has(group.deviceExternalId)
                                        ? 'fa-chevron-up'
                                        : 'fa-chevron-down'
                                "
                                aria-hidden="true"
                            />
                        </template>
                    </PickRow>

                    <div v-if="openIds.has(group.deviceExternalId)" class="pps__parts">
                        <PickRow
                            v-for="part in group.parts"
                            :key="`${part.deviceExternalId}|${part.componentKey}`"
                            dense
                            flat
                            :selected="draft.isPicked(part)"
                            @click="togglePart(part)"
                        >
                            <template #lead>
                                <i
                                    class="fas"
                                    :class="partVisual(part.componentType).icon"
                                    aria-hidden="true"
                                />
                            </template>
                            {{ humaniseLabel(part) }}
                        </PickRow>

                        <Button
                            type="green"
                            size="sm"
                            class="pps__addall"
                            @click="addAllParts(group)"
                        >
                            Add all parts
                        </Button>
                    </div>
                </div>

                <Button
                    v-if="hasMore"
                    type="blue-hollow"
                    size="sm"
                    :loading="loadingMore"
                    @click="loadMore"
                >
                    Load more parts
                </Button>
            </template>
        </template>

        <div class="pps__footer">
            <span class="pps__picked-count">{{ pickedLabel }}</span>
        </div>
    </WizardStep>
</template>

<script setup lang="ts">
import {type SourceComponentCandidate, virtualDevices} from '@host/virtualDevices';
import {computed, onBeforeUnmount, ref, watch} from 'vue';
import Button from '@/components/core/Button.vue';
import FilterPill from '@/components/core/FilterPill.vue';
import FilterSelect from '@/components/core/FilterSelect.vue';
import FormSection from '@/components/core/FormSection.vue';
import PickRow from '@/components/core/wizard/PickRow.vue';
import PickRowSkeleton from '@/components/core/wizard/PickRowSkeleton.vue';
import WizardState from '@/components/core/wizard/WizardState.vue';
import WizardStep from '@/components/core/wizard/WizardStep.vue';
import SourceComponentPicker from '@/components/devices/add/SourceComponentPicker.vue';
import {useDeviceIdentity} from '@/composables/useDeviceIdentity';
import {type DeviceLogo, deviceGlyphStyle} from '@/helpers/deviceLogo';
import {humaniseLabel, partVisual} from '@/helpers/partLabels';
import {actionableError} from '@/helpers/rpcError';
import {
    type RoleDraftRow,
    useVirtualDeviceDraftStore
} from '@/stores/virtualDeviceDraftStore';

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
const activeTypeLabel = ref('');
const nextOffset = ref(0);
const hasMore = ref(false);
const loadingMore = ref(false);

const GENERIC_DEVICE_IMG = '/images/devices/unknown-device.svg';
const PAGE_SIZE = 200;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;

const lede = computed(() =>
    draft.profile && !draft.manualMode
        ? `Connect the parts a ${draft.profile.name.toLowerCase()} needs.`
        : 'Open a device and pick the parts this custom device is made of.'
);

function roleIcon(role: RoleDraftRow): string {
    return role.visual?.icon ?? partVisual(roleType(role.roleKey)).icon;
}

function roleBadge(role: RoleDraftRow): string {
    const required = role.required ? 'Required' : 'Optional';
    return role.unit ? `${required} · ${role.unit}` : required;
}

function onLogoError(e: Event): void {
    (e.target as HTMLImageElement).src = GENERIC_DEVICE_IMG;
}

// Label is what the filter shows and returns, so the map back to the raw
// component type has to live next to the labels that produced it.
const typesByLabel = computed(() => {
    const seen = new Map<string, string>();
    for (const g of groups.value) {
        for (const p of g.parts) {
            const label = humaniseLabel({componentType: p.componentType});
            if (!seen.has(label)) seen.set(label, p.componentType);
        }
    }
    return seen;
});

const typeLabels = computed(() => [...typesByLabel.value.keys()].sort());

const activeType = computed(() =>
    activeTypeLabel.value
        ? (typesByLabel.value.get(activeTypeLabel.value) ?? null)
        : null
);

const visibleGroups = computed<DeviceGroupView[]>(() => {
    const type = activeType.value;
    const base =
        type === null
            ? groups.value
            : groups.value
                  .map((g) => ({
                      ...g,
                      parts: g.parts.filter((p) => p.componentType === type)
                  }))
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

function groupByDevice(items: SourceComponentCandidate[]): DeviceGroup[] {
    const map = new Map<string, DeviceGroup>();
    for (const item of items) {
        const existing = map.get(item.deviceExternalId);
        if (existing) existing.parts.push(item);
        else
            map.set(item.deviceExternalId, {
                deviceExternalId: item.deviceExternalId,
                deviceName: item.deviceName,
                parts: [item]
            });
    }
    return [...map.values()];
}

function mergeGroups(
    current: DeviceGroup[],
    items: SourceComponentCandidate[]
): DeviceGroup[] {
    return groupByDevice([...current.flatMap((group) => group.parts), ...items]);
}

async function loadParts(q?: string, append = false): Promise<void> {
    if (append) loadingMore.value = true;
    else loading.value = true;
    error.value = null;
    try {
        const res = await virtualDevices.bindings.listSources({
            query: q?.trim() || undefined,
            limit: PAGE_SIZE,
            offset: append ? nextOffset.value : 0
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
        error.value = actionableError(
            err,
            'Could not load the parts on your devices. Retry in a moment.'
        );
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
.pps__roles {
    display: grid;
    gap: var(--gap-xs);
}

/* A bound role is done — the border says so without adding a second badge. */
.pps__role--done {
    border-color: color-mix(
        in srgb,
        var(--color-success-text) 40%,
        var(--color-border-subtle)
    );
}

.pps__filters {
    display: flex;
    align-items: center;
    gap: var(--gap-xs);
    flex-wrap: wrap;
}

.pps__filters > :first-child {
    flex: 1;
    min-width: 0;
}

.pps__device {
    display: grid;
    gap: var(--gap-2xs);
}

/* Parts belong to the device above them, so they sit indented under it. */
.pps__parts {
    display: grid;
    gap: var(--gap-2xs);
    padding-left: var(--gap-md);
}

.pps__addall {
    justify-self: start;
}

.pps__chevron {
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}

/* The rule separates, so the space does not have to. */
.pps__footer {
    display: flex;
    align-items: center;
    padding-top: var(--gap-xs);
}

.pps__picked-count {
    font-variant-numeric: tabular-nums;
    font-size: var(--type-caption);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
}
</style>
