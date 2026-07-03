<template>
    <BasicBlock darker title="Branding (label policy)">
        <div class="brp">
            <div class="brp__org">
                <FormField label="Org ID" class="brp__org-field">
                    <Input
                        v-model="orgIdModel"
                        placeholder="Zitadel organization id"
                        autocomplete="off"
                    />
                </FormField>
                <Button
                    type="blue-hollow"
                    size="sm"
                    :loading="busy"
                    @click="$emit('load')"
                >
                    Load
                </Button>
            </div>

            <div v-if="branding" class="brp__form">
                <div class="brp__colors">
                    <ColorSwatchField
                        v-model="branding.primaryColor"
                        label="Primary"
                    />
                    <ColorSwatchField
                        v-model="branding.backgroundColor"
                        label="Background"
                    />
                    <ColorSwatchField
                        v-model="branding.warnColor"
                        label="Warn"
                    />
                    <ColorSwatchField
                        v-model="branding.fontColor"
                        label="Font"
                    />
                </div>

                <div class="brp__toggles">
                    <Checkbox
                        v-model="hideLoginNameSuffixModel"
                        label="Hide login name suffix"
                    />
                    <Checkbox
                        v-model="disableWatermarkModel"
                        label="Disable watermark"
                    />
                </div>

                <div class="brp__actions">
                    <Button
                        type="blue"
                        size="sm"
                        :loading="busy"
                        @click="$emit('save')"
                    >
                        Save policy
                    </Button>
                    <Button
                        type="green"
                        size="sm"
                        :loading="busy"
                        @click="$emit('activate')"
                    >
                        Activate
                    </Button>
                    <Button
                        type="blue-hollow"
                        size="sm"
                        :loading="busy"
                        @click="$emit('reset')"
                    >
                        Reset
                    </Button>
                </div>
            </div>
        </div>
    </BasicBlock>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import BasicBlock from '@/components/core/BasicBlock.vue';
import Button from '@/components/core/Button.vue';
import Checkbox from '@/components/core/Checkbox.vue';
import ColorSwatchField from '@/components/core/ColorSwatchField.vue';
import FormField from '@/components/core/FormField.vue';
import Input from '@/components/core/Input.vue';

export interface BrandingPolicyForm {
    primaryColor?: string;
    backgroundColor?: string;
    warnColor?: string;
    fontColor?: string;
    hideLoginNameSuffix?: boolean;
    disableWatermark?: boolean;
}

const props = defineProps<{
    branding: BrandingPolicyForm | null;
    busy: boolean;
}>();

const orgIdModel = defineModel<string>('orgId', {required: true});

const emit = defineEmits<{
    load: [];
    save: [];
    activate: [];
    reset: [];
}>();

const hideLoginNameSuffixModel = computed({
    get: () => props.branding?.hideLoginNameSuffix ?? false,
    set: (v: boolean) => {
        if (props.branding) props.branding.hideLoginNameSuffix = v;
    }
});

const disableWatermarkModel = computed({
    get: () => props.branding?.disableWatermark ?? false,
    set: (v: boolean) => {
        if (props.branding) props.branding.disableWatermark = v;
    }
});

void emit;
</script>

<style scoped>
.brp {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}
.brp__org {
    display: flex;
    align-items: flex-end;
    gap: var(--space-3);
    flex-wrap: wrap;
}
.brp__org-field {
    flex: 1;
    min-width: 240px;
}
.brp__form {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding-top: var(--space-3);
    border-top: 1px solid var(--color-border-subtle);
}
.brp__colors {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: var(--space-3);
}
.brp__toggles {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}
.brp__actions {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
}
</style>
