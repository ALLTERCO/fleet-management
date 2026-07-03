<template>
    <div class="lpp">
        <Dropdown
            :options="options"
            :default="currentLabel"
            @selected="onSelected"
        />
    </div>
</template>

<script setup lang="ts">
import type {Location as ApiLocation} from '@api/location';
import {computed} from 'vue';
import Dropdown from '@/components/core/Dropdown.vue';
import {collectDescendants} from '@/helpers/locationTree';
import {useLocationsStore} from '@/stores/locations';

const NONE_LABEL = '— Root (no parent) —';
const LABEL_SEP = '\u2003›\u2003'; // em-space + › + em-space

const props = defineProps<{excludeId?: number}>();

const model = defineModel<number | null>({required: true});

const store = useLocationsStore();

const forbidden = computed<Set<number>>(() => {
    if (props.excludeId == null) return new Set();
    const descendants = collectDescendants(props.excludeId, store.locations);
    descendants.add(props.excludeId);
    return descendants;
});

function pathLabel(loc: ApiLocation): string {
    const chain: string[] = [];
    let cursor: ApiLocation | undefined = loc;
    const seen = new Set<number>();
    while (cursor && !seen.has(cursor.id)) {
        seen.add(cursor.id);
        chain.unshift(cursor.name);
        const parentId: number | null = cursor.parentLocationId;
        cursor = parentId != null ? store.locations[parentId] : undefined;
    }
    return chain.join(LABEL_SEP);
}

// Label → id map, also including the "none" option.
const labelToId = computed<Record<string, number | null>>(() => {
    const out: Record<string, number | null> = {[NONE_LABEL]: null};
    for (const loc of Object.values(store.locations)) {
        if (forbidden.value.has(loc.id)) continue;
        out[pathLabel(loc)] = loc.id;
    }
    return out;
});

const options = computed<string[]>(() => {
    const labels = Object.keys(labelToId.value).filter((l) => l !== NONE_LABEL);
    labels.sort((a, b) => a.localeCompare(b));
    return [NONE_LABEL, ...labels];
});

const currentLabel = computed(() => {
    if (model.value == null) return NONE_LABEL;
    const loc = store.locations[model.value];
    return loc ? pathLabel(loc) : NONE_LABEL;
});

function onSelected(label: string | number | boolean) {
    const id = labelToId.value[String(label)];
    model.value = id ?? null;
}
</script>

<style scoped>
.lpp {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
}
</style>
