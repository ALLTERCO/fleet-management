<template>
    <div class="vts">
        <div class="vts__head">
            <h4>What do you want to make?</h4>
            <p>Choose a template. Fleet Manager will ask only for the parts it needs.</p>
        </div>

        <div v-if="draft.profilesLoading" class="vts__state">
            <Spinner size="sm" /> Loading templates...
        </div>
        <div v-else-if="draft.profilesError" class="vts__state vts__state--error">
            {{ draft.profilesError }}
        </div>

        <div class="vts__grid">
            <button
                v-for="item in templateItems"
                :key="item.key"
                type="button"
                class="vts__card"
                :class="{'vts__card--active': item.active}"
                :data-template="item.key"
                @click="choose(item)"
            >
                <span class="vts__icon" :style="accentStyle(item.meta.accent)">
                    <i :class="item.meta.icon" />
                </span>
                <span class="vts__copy">
                    <strong>{{ item.meta.label }}</strong>
                    <small>{{ item.meta.hint }}</small>
                </span>
                <i v-if="item.active" class="fas fa-check vts__check" />
            </button>
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, onMounted} from 'vue';
import type {VirtualDeviceProfile} from '@host/virtualDevices';
import Spinner from '@/components/core/Spinner.vue';
import {useVirtualDeviceDraftStore} from '@/stores/virtualDeviceDraftStore';
import {
    MANUAL_TEMPLATE,
    MANUAL_TEMPLATE_KEY,
    manualVisual,
    profileVisual,
    sortedProfiles,
    templateMeta,
    type VirtualTemplateMeta
} from '@/helpers/virtualDeviceTemplates';

interface TemplateItem {
    key: string;
    meta: VirtualTemplateMeta;
    profile: VirtualDeviceProfile | null;
    active: boolean;
}

const draft = useVirtualDeviceDraftStore();

onMounted(() => {
    if (draft.availableProfiles.length === 0 && !draft.profilesLoading) {
        void draft.loadProfiles();
    }
});

const templateItems = computed<TemplateItem[]>(() => [
    ...sortedProfiles(draft.availableProfiles)
        .filter((profile) => profile.key !== 'custom_blank')
        .map((profile) => ({
            key: profile.key,
            meta: templateMeta(profile),
            profile,
            active: draft.profile?.id === profile.id
        })),
    {
        key: MANUAL_TEMPLATE_KEY,
        meta: MANUAL_TEMPLATE,
        profile: null,
        active: draft.manualMode
    }
]);

function choose(item: TemplateItem): void {
    draft.selectProfile(item.profile);
    if (item.profile) {
        draft.details.visual = profileVisual(item.profile);
    } else {
        draft.details.visual = manualVisual();
    }
}

function accentStyle(accent: string): Record<string, string> {
    return {
        color: `rgb(var(--accent-${accent}, var(--accent-generic)))`,
        background: `rgba(var(--accent-${accent}, var(--accent-generic)), 0.14)`
    };
}
</script>

<style scoped>
.vts {
    display: grid;
    gap: var(--space-4);
}

.vts__head {
    display: grid;
    gap: var(--space-1);
}

.vts__head h4,
.vts__head p {
    margin: 0;
}

.vts__head h4 {
    font-size: var(--type-title);
    color: var(--color-text-primary);
}

.vts__head p,
.vts__state {
    color: var(--color-text-secondary);
    font-size: var(--type-body);
}

.vts__state {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}

.vts__state--error {
    color: var(--color-danger-text);
}

.vts__grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    gap: var(--space-2);
}

.vts__card {
    display: grid;
    grid-template-columns: 40px 1fr auto;
    align-items: center;
    gap: var(--space-2);
    min-height: 82px;
    padding: var(--space-3);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
    color: var(--color-text-primary);
    text-align: left;
    cursor: pointer;
}

.vts__card:hover,
.vts__card--active {
    border-color: var(--color-border-focus);
    background: var(--color-surface-3);
}

.vts__icon {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: var(--radius-full);
}

.vts__copy {
    display: grid;
    gap: 3px;
    min-width: 0;
}

.vts__copy strong {
    font-size: var(--type-body);
}

.vts__copy small {
    color: var(--color-text-tertiary);
    line-height: var(--leading-snug);
}

.vts__check {
    color: var(--color-success-text);
}
</style>
