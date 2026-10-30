<template>
    <BasicBlock darker title="Domain policy">
        <div v-if="policy" class="br-form">
            <label class="br-form-checkbox">
                <input
                    v-model="policy.userLoginMustBeDomain"
                    type="checkbox"
                />
                User login must include org domain suffix
            </label>
            <label class="br-form-checkbox">
                <input
                    v-model="policy.validateOrgDomains"
                    type="checkbox"
                />
                Validate org domains
            </label>
            <label class="br-form-checkbox">
                <input
                    v-model="policy.smtpSenderAddressMatchesInstanceDomain"
                    type="checkbox"
                />
                SMTP sender must match instance domain
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

export interface DomainPolicyForm {
    userLoginMustBeDomain?: boolean;
    validateOrgDomains?: boolean;
    smtpSenderAddressMatchesInstanceDomain?: boolean;
}

defineProps<{
    policy: DomainPolicyForm | null;
    busy: boolean;
}>();

defineEmits<{save: []; reset: []}>();
</script>
