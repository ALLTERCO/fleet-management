<template>
    <div class="org-panel">
        <div class="org-panel__head">
            <span class="org-panel__title">Organization</span>
        </div>
        <div class="org-panel__body">
            <div class="org-panel__row">
                <div class="org-panel__row-label">
                    <i class="fas fa-clock" />
                    <span>Timezone</span>
                </div>
                <div class="org-panel__control">
                    <Dropdown
                        :groups="groups"
                        :default="selected"
                        :searchable="true"
                        :disabled="!canEdit || saving"
                        @selected="onSelected"
                    />
                </div>
            </div>
            <p class="org-panel__hint">
                IANA timezone name (e.g. <code>Europe/Sofia</code>). Anchors how
                energy-report billing periods map to a calendar day. Reports can
                still override it per run.
            </p>
        </div>
    </div>
</template>

<script setup lang="ts">
import type {OrganizationProfile} from '@api/organization';
import {computed, onMounted, ref} from 'vue';
import Dropdown from '@/components/core/Dropdown.vue';
import {useAuthStore} from '@/stores/auth';
import {useToastStore} from '@/stores/toast';
import {sendRPC} from '@/tools/websocket';

// Sentinel for "no org default" — distinct from a real zone so clearing maps
// to a null patch (the backend treats null as "clear").
const UNSET = '__unset__';

const toast = useToastStore();
// Org settings are an admin action; the backend also enforces organizations:update.
const auth = useAuthStore();
const canEdit = computed(() => auth.isAdmin);

const zones = ref<string[]>(listTimezones());
const selected = ref<string>(UNSET);
const saving = ref(false);

// IANA / Olson tz database, read from the JS runtime — the standard zone list,
// no extra dependency. Older engines without supportedValuesOf get a small set
// that still covers the common cases; a saved zone is merged in on load.
function listTimezones(): string[] {
    try {
        return Intl.supportedValuesOf('timeZone');
    } catch {
        return ['UTC', 'Europe/London', 'Europe/Sofia', 'America/New_York'];
    }
}

// Region (first path segment) -> its zones, so the searchable dropdown is
// scannable. The "System default" entry leads, mapping to a cleared default.
const groups = computed(() => {
    const byRegion = new Map<string, {value: string; label: string}[]>();
    for (const zone of zones.value) {
        const region = zone.includes('/') ? zone.split('/')[0] : 'Other';
        const items = byRegion.get(region) ?? [];
        items.push({value: zone, label: zone});
        byRegion.set(region, items);
    }
    const regionGroups = [...byRegion.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([label, items]) => ({label, items}));
    return [
        {label: 'Default', items: [{value: UNSET, label: 'System default (UTC)'}]},
        ...regionGroups
    ];
});

async function load(): Promise<void> {
    try {
        const profile = await sendRPC<OrganizationProfile>(
            'FLEET_MANAGER',
            'organization.getprofile',
            {}
        );
        const zone = profile.timezoneDefault;
        if (zone && !zones.value.includes(zone)) zones.value.unshift(zone);
        selected.value = zone ?? UNSET;
    } catch (err) {
        console.error('Failed to load organization profile', err);
    }
}

async function onSelected(zone: string): Promise<void> {
    if (zone === selected.value) return;
    const previous = selected.value;
    selected.value = zone;
    const timezoneDefault = zone === UNSET ? null : zone;
    saving.value = true;
    try {
        await sendRPC('FLEET_MANAGER', 'organization.setprofile', {
            patch: {timezoneDefault}
        });
        toast.success('Timezone updated');
    } catch (err) {
        console.error('Failed to update timezone', err);
        toast.error('Could not update timezone');
        selected.value = previous;
    } finally {
        saving.value = false;
    }
}

onMounted(load);
</script>

<style scoped>
.org-panel {
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background-color: var(--color-surface-1);
    overflow: hidden;
    margin-top: var(--gap-sm);
}
.org-panel__head {
    display: flex;
    align-items: center;
    padding: var(--gap-xs) var(--gap-sm);
    min-height: var(--touch-target-min);
    border-bottom: 1px solid var(--color-border-default);
    background-color: var(--color-surface-2);
}
.org-panel__title {
    font-size: var(--type-body);
    font-weight: 700;
    color: var(--color-text-primary);
}
.org-panel__body {
    padding: var(--gap-sm);
}
.org-panel__row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--gap-sm);
    padding: var(--gap-xs) 0;
}
.org-panel__row-label {
    display: flex;
    align-items: center;
    gap: var(--gap-xs);
    font-size: var(--type-body);
    color: var(--color-text-secondary);
}
.org-panel__control {
    min-width: 14rem;
    max-width: 18rem;
}
.org-panel__hint {
    font-size: var(--type-body);
    color: var(--color-text-quaternary);
    margin-top: var(--gap-xs);
}
.org-panel__hint code {
    font-family: var(--font-mono);
    color: var(--color-text-tertiary);
}
</style>
