import {computed, ref, toValue, type MaybeRefOrGetter} from 'vue';
import {
    type TagRejectionReason,
    tagRejectionReason
} from '@/helpers/location-drawer-steps';
import type {
    LocationFieldDescriptor,
    LocationFieldGroup
} from '@/stores/locations';

export interface LocationDetailGroup {
    key: LocationFieldGroup;
    label: string;
    icon: string;
    fields: LocationFieldDescriptor[];
}

const GROUP_LABELS: Record<LocationFieldGroup, string> = {
    identity: 'Identity',
    physical: 'Physical',
    contact: 'Contact',
    hours: 'Hours',
    operational: 'Operational',
    compliance: 'Compliance',
    environmental: 'Environmental',
    custom: 'Other'
};

const GROUP_ICONS: Record<LocationFieldGroup, string> = {
    identity: 'fas fa-id-card',
    physical: 'fas fa-cube',
    contact: 'fas fa-address-book',
    hours: 'fas fa-clock',
    operational: 'fas fa-gears',
    compliance: 'fas fa-shield-halved',
    environmental: 'fas fa-leaf',
    custom: 'fas fa-tags'
};

const BESPOKE_FIELD_WIDGETS = new Set([
    'address',
    'geo',
    'floorPlan',
    'operatingHours'
]);

export function buildLocationDetailGroups(
    fields: readonly LocationFieldDescriptor[]
): LocationDetailGroup[] {
    const buckets = new Map<LocationFieldGroup, LocationFieldDescriptor[]>();
    for (const field of fields) {
        if (BESPOKE_FIELD_WIDGETS.has(field.widget)) continue;
        const groupFields = buckets.get(field.group) ?? [];
        groupFields.push(field);
        buckets.set(field.group, groupFields);
    }
    return [...buckets].map(([key, groupFields]) => ({
        key,
        label: GROUP_LABELS[key] ?? key,
        icon: GROUP_ICONS[key] ?? 'fas fa-circle',
        fields: groupFields
    }));
}

export function tagRejectionMessage(reason: TagRejectionReason): string {
    switch (reason) {
        case 'empty':
            return 'Tags cannot be empty.';
        case 'length':
            return 'Tag is too long.';
        case 'format':
            return 'Tags must start with a letter or number; only letters, numbers, dot, dash, and underscore are allowed.';
        case 'duplicate':
            return 'That tag is already in the list.';
        case 'count':
            return 'You have reached the maximum number of tags.';
    }
}

export function useLocationDetails(
    fields: MaybeRefOrGetter<readonly LocationFieldDescriptor[] | undefined>
) {
    const tags = ref<string[]>([]);
    const tagDraft = ref('');
    const tagError = ref('');

    const detailGroups = computed(() =>
        buildLocationDetailGroups(toValue(fields) ?? [])
    );
    const hasOperatingHoursField = computed(
        () =>
            toValue(fields)?.some(
                (field) => field.widget === 'operatingHours'
            ) ?? false
    );

    function commitTag(): void {
        const tag = tagDraft.value.trim().toLowerCase();
        if (!tag) return;
        const reason = tagRejectionReason({candidate: tag, existing: tags.value});
        if (reason) {
            tagError.value = tagRejectionMessage(reason);
            return;
        }
        tags.value = [...tags.value, tag];
        tagDraft.value = '';
        tagError.value = '';
    }

    function removeTag(index: number): void {
        const next = [...tags.value];
        next.splice(index, 1);
        tags.value = next;
    }

    function onTagBackspace(): void {
        if (tagDraft.value.length === 0 && tags.value.length > 0) {
            tags.value = tags.value.slice(0, -1);
        }
    }

    function clearTagError(): void {
        tagError.value = '';
    }

    function resetTags(value?: unknown): void {
        tags.value = Array.isArray(value)
            ? value.filter((tag): tag is string => typeof tag === 'string')
            : [];
        tagDraft.value = '';
        tagError.value = '';
    }

    return {
        detailGroups,
        hasOperatingHoursField,
        tags,
        tagDraft,
        tagError,
        commitTag,
        removeTag,
        onTagBackspace,
        clearTagError,
        resetTags
    };
}
