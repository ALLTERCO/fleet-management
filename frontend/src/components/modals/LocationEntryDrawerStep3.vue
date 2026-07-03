<template>
    <section class="lf-section">
        <details v-if="canShowFloorPlan" class="lf-accordion" open>
            <summary class="lf-accordion__head">
                <i
                    class="fas fa-map lf-accordion__icon"
                    aria-hidden="true"
                />
                <span class="lf-accordion__label">Floor plan</span>
                <span class="lf-accordion__tag">Optional</span>
                <i
                    class="fas fa-chevron-down lf-accordion__chev"
                    aria-hidden="true"
                />
            </summary>
            <div class="lf-accordion__body">
                <FloorPlanScaleEditor
                    :model-value="
                        (kindFields.floorPlan as FloorPlanValue | null) ?? null
                    "
                    :location-id="locationId"
                    @update:model-value="
                        $emit('set-kind-field', {key: 'floorPlan', value: $event})
                    "
                />
            </div>
        </details>

        <details v-if="hasOperatingHoursField" class="lf-accordion">
            <summary class="lf-accordion__head">
                <i
                    class="fas fa-clock lf-accordion__icon"
                    aria-hidden="true"
                />
                <span class="lf-accordion__label">Operating hours</span>
                <span class="lf-accordion__tag">Optional</span>
                <i
                    class="fas fa-chevron-down lf-accordion__chev"
                    aria-hidden="true"
                />
            </summary>
            <div class="lf-accordion__body">
                <OperatingHoursGrid
                    :model-value="
                        (kindFields.operatingHours as OperatingHoursValue | null) ??
                        null
                    "
                    :timezone="(kindFields.timezone as string) ?? ''"
                    @update:model-value="
                        $emit('set-kind-field', {
                            key: 'operatingHours',
                            value: $event
                        })
                    "
                />
            </div>
        </details>

        <details
            v-for="group in detailGroups"
            :key="group.key"
            class="lf-accordion"
        >
            <summary class="lf-accordion__head">
                <i
                    :class="group.icon"
                    class="lf-accordion__icon"
                    aria-hidden="true"
                />
                <span class="lf-accordion__label">{{ group.label }}</span>
                <span class="lf-accordion__tag">Optional</span>
                <i
                    class="fas fa-chevron-down lf-accordion__chev"
                    aria-hidden="true"
                />
            </summary>
            <div class="lf-accordion__body">
                <div
                    v-for="field in group.fields"
                    :key="field.key"
                    class="lf-field"
                >
                    <LocationFieldRenderer
                        :field="field"
                        :model-value="kindFields[field.key]"
                        :option-sets="optionSets"
                        :inherited="false"
                        inherited-display=""
                        @update:model-value="
                            $emit('set-kind-field', {key: field.key, value: $event})
                        "
                    />
                </div>
            </div>
        </details>

        <details class="lf-accordion">
            <summary class="lf-accordion__head">
                <i
                    class="fas fa-tags lf-accordion__icon"
                    aria-hidden="true"
                />
                <span class="lf-accordion__label">Tags</span>
                <span class="lf-accordion__tag">Optional</span>
                <i
                    class="fas fa-chevron-down lf-accordion__chev"
                    aria-hidden="true"
                />
            </summary>
            <div class="lf-accordion__body">
                <div class="lf-field">
                    <label class="lf-label">Add tags</label>
                    <div class="lf-tags">
                        <span
                            v-for="(tag, i) in tags"
                            :key="`${tag}-${i}`"
                            class="lf-tag"
                        >
                            {{ tag }}
                            <button
                                type="button"
                                class="lf-tag__x"
                                title="Remove tag"
                                @click="$emit('remove-tag', i)"
                            >
                                <i class="fas fa-xmark" aria-hidden="true" />
                            </button>
                        </span>
                        <input
                            v-model="tagDraftModel"
                            class="lf-tag__input"
                            placeholder="Add tag, press Enter…"
                            @keydown.enter.prevent="$emit('commit-tag')"
                            @keydown.delete="$emit('tag-backspace')"
                            @input="$emit('clear-tag-error')"
                        />
                    </div>
                    <p v-if="tagError" class="lf-error">{{ tagError }}</p>
                    <p class="lf-hint">
                        Press Enter to add. Lowercase letters, numbers, dot,
                        dash, underscore.
                    </p>
                </div>
            </div>
        </details>

        <details class="lf-accordion">
            <summary class="lf-accordion__head">
                <i
                    class="fas fa-pen lf-accordion__icon"
                    aria-hidden="true"
                />
                <span class="lf-accordion__label">Notes</span>
                <span class="lf-accordion__tag">Optional</span>
                <i
                    class="fas fa-chevron-down lf-accordion__chev"
                    aria-hidden="true"
                />
            </summary>
            <div class="lf-accordion__body">
                <textarea
                    v-model="notesModel"
                    class="lf-textarea"
                    :maxlength="MAX_NOTES_LENGTH"
                    placeholder="Internal notes about this location…"
                    rows="4"
                />
                <p v-if="notesError" class="lf-error">{{ notesError }}</p>
                <p class="lf-hint">
                    {{ notesModel.length }} / {{ MAX_NOTES_LENGTH }}
                </p>
            </div>
        </details>
    </section>
</template>

<script setup lang="ts">
import type {FloorPlanValue} from '@/components/core/FloorPlanScaleEditor.vue';
import FloorPlanScaleEditor from '@/components/core/FloorPlanScaleEditor.vue';
import LocationFieldRenderer from '@/components/core/LocationFieldRenderer.vue';
import type {OperatingHoursValue} from '@/components/core/OperatingHoursGrid.vue';
import OperatingHoursGrid from '@/components/core/OperatingHoursGrid.vue';
import {MAX_NOTES_LENGTH} from '@/helpers/location-drawer-steps';
import type {
    LocationFieldDescriptor,
    LocationFieldGroup,
    LocationOptionSet
} from '@/stores/locations';

export interface DetailGroup {
    key: LocationFieldGroup;
    label: string;
    icon: string;
    fields: LocationFieldDescriptor[];
}

defineProps<{
    kindFields: Record<string, unknown>;
    locationId: number | null;
    canShowFloorPlan: boolean;
    hasOperatingHoursField: boolean;
    detailGroups: DetailGroup[];
    optionSets: Record<string, LocationOptionSet>;
    tags: string[];
    tagError: string;
    notesError: string;
}>();

const tagDraftModel = defineModel<string>('tagDraft', {required: true});
const notesModel = defineModel<string>('notes', {required: true});

defineEmits<{
    'set-kind-field': [args: {key: string; value: unknown}];
    'remove-tag': [index: number];
    'commit-tag': [];
    'tag-backspace': [];
    'clear-tag-error': [];
}>();
</script>
