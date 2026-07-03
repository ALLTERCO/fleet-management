<template>
    <section class="lf-section">
        <div class="lf-field">
            <label class="lf-label">Kind</label>
            <div
                class="lf-segmented"
                role="group"
                aria-label="Location kind"
            >
                <button
                    v-for="opt in kindOptions"
                    :key="opt.value"
                    type="button"
                    class="lf-seg"
                    :class="{'lf-seg--on': kindModel === opt.value}"
                    :disabled="kindDisabled"
                    :aria-pressed="kindModel === opt.value"
                    @click="kindModel = opt.value"
                >
                    <i :class="opt.icon" aria-hidden="true" />
                    <span>{{ opt.label }}</span>
                </button>
            </div>
            <p class="lf-hint">{{ kindHint }}</p>
        </div>

        <div class="lf-field">
            <label class="lf-label" for="lf-name">Name</label>
            <Input
                id="lf-name"
                v-model="nameModel"
                placeholder="e.g. Paris HQ"
                @blur="$emit('blur-name')"
            />
            <p v-if="nameError" class="lf-error">{{ nameError }}</p>
        </div>

        <div
            v-if="parentRequired || parentModel != null"
            class="lf-field"
        >
            <label class="lf-label">
                Parent
                <span v-if="parentRequired" class="lf-required">
                    Required
                </span>
            </label>
            <LocationParentPicker
                v-model="parentModel"
                :exclude-id="excludeParentId"
            />
            <p v-if="parentError" class="lf-error">{{ parentError }}</p>
        </div>
    </section>
</template>

<script setup lang="ts">
import type {LocationKind} from '@api/location';
import Input from '@/components/core/Input.vue';
import LocationParentPicker from '@/components/core/LocationParentPicker.vue';

export interface KindOption {
    value: LocationKind;
    label: string;
    icon: string;
}

defineProps<{
    kindOptions: KindOption[];
    kindHint: string;
    kindDisabled: boolean;
    parentRequired: boolean;
    excludeParentId?: number;
    nameError: string;
    parentError: string;
}>();

const kindModel = defineModel<LocationKind>('kind', {required: true});
const nameModel = defineModel<string>('name', {required: true});
const parentModel = defineModel<number | null>('parent', {required: true});

defineEmits<{'blur-name': []}>();
</script>
