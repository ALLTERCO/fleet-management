<template>
    <WizardStep
        name="template"
        lede="Pick what you want to make. Fleet Manager then asks only for the parts it needs."
    >
        <FilterPill
            v-if="!draft.profilesLoading && !draft.profilesError"
            v-model="query"
            placeholder="Search templates"
        />

        <PickRowSkeleton v-if="draft.profilesLoading" :rows="4" label="Loading templates" />

        <WizardState v-else-if="draft.profilesError" tone="error">
            {{ draft.profilesError }}
        </WizardState>

        <WizardState v-else-if="!visibleGroups.length" tone="empty">
            No template matches "{{ query }}".
        </WizardState>

        <!-- Grouped by what the thing is for. Seventeen in one grid was four
             times what anyone holds in their head at the hardest question. -->
        <template v-else>
            <section
                v-for="group in visibleGroups"
                :key="group.key"
                class="vts__group"
            >
                <h4 class="vts__group-title">{{ group.label }}</h4>
                <div class="vts__grid">
                    <PickRow
                        v-for="item in group.items"
                        :key="item.key"
                        :selected="item.active"
                        :data-template="item.key"
                        @click="choose(item)"
                    >
                        <template #lead>
                            <i :class="item.meta.icon" aria-hidden="true" />
                        </template>
                        {{ item.meta.label }}
                        <template #meta>{{ item.meta.hint }}</template>
                    </PickRow>
                </div>
            </section>
        </template>
    </WizardStep>
</template>

<script setup lang="ts">
import type {VirtualDeviceProfile} from '@host/virtualDevices';
import {computed, onMounted, ref} from 'vue';
import FilterPill from '@/components/core/FilterPill.vue';
import PickRow from '@/components/core/wizard/PickRow.vue';
import PickRowSkeleton from '@/components/core/wizard/PickRowSkeleton.vue';
import WizardState from '@/components/core/wizard/WizardState.vue';
import WizardStep from '@/components/core/wizard/WizardStep.vue';
import {
    MANUAL_TEMPLATE,
    MANUAL_TEMPLATE_KEY,
    manualVisual,
    profileVisual,
    sortedProfiles,
    templateMeta,
    type VirtualTemplateMeta
} from '@/helpers/virtualDeviceTemplates';
import {useNameSearch} from '@/composables/useNameSearch';
import {useVirtualDeviceDraftStore} from '@/stores/virtualDeviceDraftStore';

// Order is what an operator reaches for most, not alphabetical.
const CATEGORY_ORDER = ['lighting', 'climate', 'energy', 'safety', 'custom'] as const;

const CATEGORY_LABEL: Record<string, string> = {
    lighting: 'Lighting',
    climate: 'Climate and air',
    energy: 'Energy',
    safety: 'Safety and security',
    custom: 'Anything else'
};

interface TemplateItem {
    key: string;
    meta: VirtualTemplateMeta;
    profile: VirtualDeviceProfile | null;
    active: boolean;
}

interface TemplateGroup {
    key: string;
    label: string;
    items: TemplateItem[];
}

const draft = useVirtualDeviceDraftStore();
const query = ref('');
const {matches} = useNameSearch(query);

onMounted(() => {
    if (draft.availableProfiles.length === 0 && !draft.profilesLoading) {
        void draft.loadProfiles();
    }
});

// The seeded `custom_blank` profile is superseded by MANUAL_TEMPLATE, which
// browses every part instead of offering one generic role. Only one may show.
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

const visibleGroups = computed<TemplateGroup[]>(() => {
    const hits = templateItems.value.filter(
        (item) => matches(item.meta.label) || matches(item.meta.hint)
    );
    return CATEGORY_ORDER.map((key) => ({
        key,
        label: CATEGORY_LABEL[key],
        items: hits.filter((item) => item.meta.categoryKey === key)
    })).filter((group) => group.items.length > 0);
});

function choose(item: TemplateItem): void {
    draft.selectProfile(item.profile);
    draft.details.visual = item.profile
        ? profileVisual(item.profile)
        : manualVisual();
}
</script>

<style scoped>
.vts__group {
    display: grid;
    gap: var(--gap-xs);
}

.vts__group-title {
    margin: 0;
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}

.vts__grid {
    display: grid;
    grid-template-columns: repeat(
        auto-fit,
        minmax(var(--pick-row-grid-min), 1fr)
    );
    gap: var(--gap-xs);
}
</style>
