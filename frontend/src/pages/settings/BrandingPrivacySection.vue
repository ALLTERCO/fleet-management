<template>
    <BasicBlock darker title="Privacy / TOS">
        <div v-if="privacy" class="br-form">
            <label>
                TOS link
                <input v-model="privacy.tosLink" type="url" />
            </label>
            <label>
                Privacy link
                <input v-model="privacy.privacyLink" type="url" />
            </label>
            <label>
                Help link
                <input v-model="privacy.helpLink" type="url" />
            </label>
            <label>
                Support email
                <input v-model="privacy.supportEmail" type="email" />
            </label>
            <div class="br-actions">
                <button
                    type="button"
                    class="br-btn"
                    :disabled="busy"
                    @click="$emit('save')"
                >
                    Save
                </button>
                <button
                    type="button"
                    class="br-btn br-btn--danger"
                    :disabled="busy"
                    @click="$emit('reset')"
                >
                    Reset
                </button>
            </div>
        </div>
    </BasicBlock>
</template>

<script setup lang="ts">
import BasicBlock from '@/components/core/BasicBlock.vue';

// Privacy mirrors the Zitadel proto shape — links + support email.
// Optional fields stay optional, so all bindings null-safe via `?`.
export interface PrivacyPolicyForm {
    tosLink?: string;
    privacyLink?: string;
    helpLink?: string;
    supportEmail?: string;
}

defineProps<{
    privacy: PrivacyPolicyForm | null;
    busy: boolean;
}>();

defineEmits<{save: []; reset: []}>();
</script>
