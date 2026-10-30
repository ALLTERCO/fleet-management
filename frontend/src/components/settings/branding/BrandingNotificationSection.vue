<template>
    <BasicBlock darker title="Notification policy">
        <div v-if="policy" class="br-form">
            <label class="br-form-checkbox">
                <input v-model="policy.passwordChange" type="checkbox" />
                Notify on password change
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

export interface NotificationPolicyForm {
    passwordChange?: boolean;
}

defineProps<{
    policy: NotificationPolicyForm | null;
    busy: boolean;
}>();

defineEmits<{save: []; reset: []}>();
</script>
