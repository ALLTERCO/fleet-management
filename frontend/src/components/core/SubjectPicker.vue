<template>
    <div class="sp">
        <div class="sp__tabs">
            <button
                v-for="tab in availableTabs"
                :key="tab.key"
                type="button"
                class="sp__tab"
                :class="{'sp__tab--active': activeType === tab.key}"
                @click="activeType = tab.key"
            >
                <i :class="tab.icon" />
                {{ tab.label }}
                <span v-if="selectedByType[tab.key]" class="sp__tab-count">
                    {{ selectedByType[tab.key] }}
                </span>
            </button>
        </div>

        <div class="sp__search">
            <i class="fas fa-search sp__search-icon" />
            <input
                v-model="query"
                type="text"
                class="core-input sp__search-input"
                :placeholder="`Search ${activeTabLabel.toLowerCase()}…`"
            />
        </div>

        <EmptyBlock v-if="currentItems.length === 0">
            <p>No {{ activeTabLabel.toLowerCase() }} match.</p>
        </EmptyBlock>
        <ul v-else class="sp__list">
            <li
                v-for="item in currentItems"
                :key="item.id"
                class="sp__item"
                :class="{'sp__item--selected': isPicked(activeType, item.id)}"
                @click="toggle(activeType, item.id)"
            >
                <div class="sp__item-main">
                    <div class="sp__item-name">{{ item.name }}</div>
                    <code v-if="item.sublabel" class="sp__item-sub">{{ item.sublabel }}</code>
                </div>
                <i
                    v-if="isPicked(activeType, item.id)"
                    class="fas fa-check sp__check"
                />
            </li>
        </ul>

        <div v-if="multiple && model.length > 0" class="sp__summary">
            {{ model.length }} selected across
            {{ Object.keys(selectedByType).length }}
            {{ Object.keys(selectedByType).length === 1 ? 'type' : 'types' }}
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, onMounted, ref} from 'vue';
import EmptyBlock from '@/components/core/EmptyBlock.vue';
import {useFuzzySearch} from '@/composables/useFuzzySearch';
import {getDeviceName} from '@/helpers/device';
import {useDevicesStore} from '@/stores/devices';
import {useEntityStore} from '@/stores/entities';
import {useGroupsStore} from '@/stores/groups';
import {useLocationsStore} from '@/stores/locations';
import {useTagsStore} from '@/stores/tags';

// Picker-supported subject types. Superset that covers tag + location
// assignment callers; the `subjectTypes` prop narrows per use site.
export type SubjectType = 'device' | 'entity' | 'group' | 'location' | 'tag';

export interface SubjectRef {
    subjectType: SubjectType;
    subjectId: string;
}

const model = defineModel<SubjectRef[]>({required: true});

const props = withDefaults(
    defineProps<{
        subjectTypes: SubjectType[];
        multiple?: boolean;
    }>(),
    {multiple: true}
);

const TAB_META: Record<SubjectType, {label: string; icon: string}> = {
    device: {label: 'Devices', icon: 'fas fa-microchip'},
    entity: {label: 'Entities', icon: 'fas fa-puzzle-piece'},
    group: {label: 'Groups', icon: 'fas fa-folder-tree'},
    location: {label: 'Locations', icon: 'fas fa-location-dot'},
    tag: {label: 'Tags', icon: 'fas fa-tag'}
};

const devicesStore = useDevicesStore();
const entitiesStore = useEntityStore();
const groupsStore = useGroupsStore();
const locationsStore = useLocationsStore();
const tagsStore = useTagsStore();

const availableTabs = computed(() =>
    props.subjectTypes.map((key) => ({key, ...TAB_META[key]}))
);

const activeType = ref<SubjectType>(props.subjectTypes[0] ?? 'device');
const query = ref('');

const activeTabLabel = computed(() => TAB_META[activeType.value]?.label ?? '');

interface Row {
    id: string;
    name: string;
    sublabel?: string;
}

onMounted(() => {
    if (props.subjectTypes.includes('group')) groupsStore.fetchGroups();
    if (props.subjectTypes.includes('location'))
        locationsStore.fetchLocations();
    if (props.subjectTypes.includes('tag')) tagsStore.fetchTags();
});

const sortedRows = computed<Row[]>(() =>
    rowsFor(activeType.value).sort((a, b) => a.name.localeCompare(b.name))
);

const fuzzyRows = useFuzzySearch<Row>(sortedRows, query, {
    keys: ['name', 'sublabel']
});

const currentItems = computed<Row[]>(() => fuzzyRows.value.slice(0, 200));

function rowsFor(type: SubjectType): Row[] {
    switch (type) {
        case 'device':
            return Object.values(devicesStore.devices).map((d) => ({
                id: d.shellyID,
                name: getDeviceName(d.info, d.shellyID),
                sublabel: d.shellyID
            }));
        case 'entity':
            return Object.values(entitiesStore.entities).map((e: any) => ({
                id: e.id as string,
                name: (e.name as string) || (e.id as string),
                sublabel: e.id as string
            }));
        case 'group':
            return Object.values(groupsStore.groups).map((g) => ({
                id: String(g.id),
                name: g.name
            }));
        case 'location':
            return Object.values(locationsStore.locations).map((l) => ({
                id: String(l.id),
                name: l.name
            }));
        case 'tag':
            return Object.values(tagsStore.tags).map((t) => ({
                id: String(t.id),
                name: t.name,
                sublabel: t.key
            }));
    }
}

const selectedByType = computed<Partial<Record<SubjectType, number>>>(() => {
    const out: Partial<Record<SubjectType, number>> = {};
    for (const ref_ of model.value) {
        out[ref_.subjectType] = (out[ref_.subjectType] ?? 0) + 1;
    }
    return out;
});

function isPicked(type: SubjectType, id: string): boolean {
    return model.value.some(
        (r) => r.subjectType === type && r.subjectId === id
    );
}

function toggle(type: SubjectType, id: string) {
    if (isPicked(type, id)) {
        model.value = model.value.filter(
            (r) => !(r.subjectType === type && r.subjectId === id)
        );
        return;
    }
    if (!props.multiple) {
        model.value = [{subjectType: type, subjectId: id}];
        return;
    }
    model.value = [...model.value, {subjectType: type, subjectId: id}];
}
</script>

<style scoped>
.sp {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}
.sp__tabs {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
}
.sp__tab {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-3);
    font-size: var(--type-body);
    font-weight: 600;
    color: var(--color-text-tertiary);
    background: var(--color-surface-1);
    border: 1px solid var(--color-border-medium);
    border-radius: var(--radius-full);
    cursor: pointer;
    transition:
        color var(--duration-fast),
        border-color var(--duration-fast);
}
.sp__tab:hover {
    color: var(--color-text-primary);
}
.sp__tab--active {
    color: var(--color-primary);
    border-color: var(--color-primary);
    background: color-mix(in srgb, var(--color-primary) 8%, transparent);
}
.sp__tab-count {
    font-size: var(--type-body);
    font-weight: 700;
    padding: var(--space-0-5) var(--space-1);
    border-radius: var(--radius-full);
    background: color-mix(in srgb, var(--color-primary) 18%, transparent);
    color: var(--color-primary);
}
.sp__search {
    position: relative;
    display: flex;
    align-items: center;
}
.sp__search-icon {
    position: absolute;
    left: var(--space-3);
    color: var(--color-text-tertiary);
    opacity: 0.7;
    pointer-events: none;
}
.sp__search-input {
    flex: 1;
    padding-left: var(--space-8);
}
.sp__list {
    list-style: none;
    padding: var(--space-1);
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    max-height: 280px;
    overflow-y: auto;
    border: 1px solid var(--color-border-medium);
    border-radius: var(--radius-md);
}
.sp__item {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: background var(--duration-fast);
}
.sp__item:hover {
    background: var(--color-surface-2);
}
.sp__item--selected {
    background: color-mix(in srgb, var(--color-primary) 10%, transparent);
    border: 1px solid
        color-mix(in srgb, var(--color-primary) 30%, transparent);
    padding: calc(var(--space-2) - 1px) calc(var(--space-3) - 1px);
}
.sp__item-main {
    flex: 1;
    min-width: 0;
}
.sp__item-name {
    font-size: var(--type-body);
    font-weight: 600;
    color: var(--color-text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.sp__item-sub {
    font-family: var(--font-mono, monospace);
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
}
.sp__check {
    color: var(--color-primary);
}
.sp__summary {
    align-self: flex-end;
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
}
</style>
