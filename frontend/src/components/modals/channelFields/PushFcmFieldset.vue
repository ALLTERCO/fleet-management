<template>
    <div class="cfs">
        <FormField label="Device token" :error="visibleErrors.token">
            <input
                v-model.trim="form.token"
                type="text"
                name="off-token"
                autocomplete="off"
                spellcheck="false"
                class="cfs__input cfs__input--mono"
                placeholder="cYZkP0…"
            />
        </FormField>

        <FormField label="Platform" :error="visibleErrors.platform">
            <div class="cfs__segmented" role="radiogroup" aria-label="Platform">
                <button
                    v-for="opt in PLATFORM_OPTIONS"
                    :key="opt.value"
                    type="button"
                    role="radio"
                    class="cfs__seg-btn"
                    :class="{'cfs__seg-btn--on': form.platform === opt.value}"
                    :aria-checked="form.platform === opt.value"
                    @click="selectPlatform(opt.value)"
                >
                    <i :class="['fas', opt.icon]" aria-hidden="true" />
                    {{ opt.label }}
                </button>
            </div>
        </FormField>

        <FormField label="Environment">
            <select v-model="form.env" class="cfs__input">
                <option value="prod">Production</option>
                <option value="sandbox">Sandbox</option>
            </select>
        </FormField>

    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import FormField from '@/components/core/FormField.vue';
import type {ErrorMap} from '@/helpers/channelValidators';

export type PushPlatform = 'ios' | 'android' | 'webpush';
export type PushEnv = 'prod' | 'sandbox';

export interface PushFcmFieldsetForm {
    token: string;
    platform: PushPlatform;
    env: PushEnv;
}

const PLATFORM_OPTIONS: ReadonlyArray<{
    value: PushPlatform;
    label: string;
    icon: string;
}> = [
    {value: 'ios', label: 'iOS', icon: 'fa-apple'},
    {value: 'android', label: 'Android', icon: 'fa-android'},
    {value: 'webpush', label: 'Web', icon: 'fa-globe'}
];

const props = defineProps<{
    showErrors: boolean;
    errors: ErrorMap;
}>();

const form = defineModel<PushFcmFieldsetForm>({required: true});

const visibleErrors = computed<ErrorMap>(() =>
    props.showErrors ? props.errors : {}
);

function selectPlatform(value: PushPlatform): void {
    form.value = {...form.value, platform: value};
}
</script>

<style src="./channelFieldset.css"></style>
