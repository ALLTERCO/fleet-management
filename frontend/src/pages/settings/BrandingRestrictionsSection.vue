<template>
    <BasicBlock darker title="Restrictions (instance-wide)">
        <div v-if="restrictions" class="br-form">
            <label class="br-form-checkbox">
                <input
                    v-model="restrictions.disallowPublicOrgRegistration"
                    type="checkbox"
                />
                Disallow public org registration
            </label>
            <label>
                Allowed languages (comma-separated, leave blank to allow all)
                <input
                    v-model="languagesModel"
                    type="text"
                    placeholder="en, de, bg"
                />
            </label>
            <button
                type="button"
                class="br-btn"
                :disabled="busy"
                @click="$emit('save')"
            >
                Save
            </button>
        </div>
    </BasicBlock>
</template>

<script setup lang="ts">
import BasicBlock from '@/components/core/BasicBlock.vue';

export interface RestrictionsPolicyForm {
    disallowPublicOrgRegistration?: boolean;
    allowedLanguages?: string[];
}

defineProps<{
    restrictions: RestrictionsPolicyForm | null;
    busy: boolean;
}>();

const languagesModel = defineModel<string>('languages', {required: true});

defineEmits<{save: []}>();
</script>
