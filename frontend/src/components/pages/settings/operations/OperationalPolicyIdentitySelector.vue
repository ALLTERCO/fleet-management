<template>
    <Dropdown
        :options="choiceIndexes"
        :labels="choiceLabels"
        :default="selectedIndex"
        :label="label"
        :aria-label="label"
        :searchable="true"
        :disabled="choices.length === 0"
        :placeholder="placeholder"
        @selected="selectChoice"
    />
</template>

<script setup lang="ts">
import type {OperationalPolicySelectorBinding, OperationalPolicySelectorCatalog} from '@api/operations';
import {computed} from 'vue';
import Dropdown from '@/components/core/Dropdown.vue';

type PolicyRecord = Record<string, unknown>;
type CatalogChoice = Record<string, unknown>;

const model = defineModel<PolicyRecord>({required: true});

const props = defineProps<{
    binding: OperationalPolicySelectorBinding;
    catalog: OperationalPolicySelectorCatalog;
}>();

const choices = computed<CatalogChoice[]>(() =>
    props.catalog[props.binding.collection]
        .map((choice) => {
            const record: CatalogChoice = {};
            for (const [key, value] of Object.entries(choice)) {
                record[key] = value;
            }
            return record;
        })
        .filter(
            (choice) =>
                (props.binding.sourceType === undefined ||
                    choice.sourceType === props.binding.sourceType) &&
                (props.binding.locationKinds === undefined ||
                    (typeof choice.kind === 'string' &&
                        props.binding.locationKinds.includes(choice.kind)))
        )
);
const label = computed(() => props.binding.collection === 'locations' ? 'Fleet location' : 'Fleet source');
const choiceIndexes = computed(() => choices.value.map((_choice, index) => index));
const choiceLabels = computed(() => {
    const labelChoices = props.binding.collection === 'locations'
        ? props.catalog.locations.map((choice) => ({...choice}))
        : choices.value;
    return choices.value.map((choice) => choiceLabel(choice, labelChoices));
});
const placeholder = computed(() => choices.value.length === 0
    ? 'No Fleet choices available'
    : `Select a ${label.value.toLowerCase()}`);
const selectedIndex = computed(() => {
    const index = choices.value.findIndex((choice) => Object.entries(props.binding.apply)
        .every(([target, source]) => model.value[target] === choice[source]));
    return index < 0 ? undefined : index;
});

function selectChoice(index: number): void {
    const choice = choices.value[index];
    if (!choice) return;
    model.value = {...model.value, ...Object.fromEntries(
        Object.entries(props.binding.apply).map(([target, source]) => [target, choice[source]])
    )};
}

function choiceKey(choice: CatalogChoice, index: number): string {
    return Object.values(props.binding.apply).map((field) => String(choice[field])).join('|') || String(index);
}

function choiceLabel(choice: CatalogChoice, allChoices: CatalogChoice[]): string {
    if (props.binding.collection === 'locations')
        return locationChoiceLabel(choice, allChoices);
    const label = choice.label ?? choice.name;
    return typeof label === 'string' ? label : choiceKey(choice, 0);
}

function locationChoiceLabel(choice: CatalogChoice, allChoices: CatalogChoice[]): string {
    const byId = new Map(allChoices.map((entry) => [entry.id, entry]));
    const names: string[] = [];
    const visited = new Set<unknown>();
    let current: CatalogChoice | undefined = choice;
    while (current && !visited.has(current.id)) {
        visited.add(current.id);
        if (typeof current.name === 'string') names.unshift(current.name);
        current = current.parentLocationId === null
            ? undefined
            : byId.get(current.parentLocationId);
    }
    return names.join(' / ') || choiceKey(choice, 0);
}
</script>
