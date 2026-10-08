<template>
    <div class="cfs">
        <FormField label="SMTP source">
            <select v-model="form.mode" class="cfs__input">
                <option value="use_system_smtp">System SMTP</option>
                <option value="custom_smtp">Custom SMTP</option>
            </select>
        </FormField>

        <FormField
            v-if="form.mode === 'custom_smtp'"
            label="From"
            :error="visibleErrors.from"
        >
            <input
                v-model.trim="form.from"
                type="email"
                autocomplete="off"
                class="cfs__input"
            />
        </FormField>

        <FormField label="Recipients" :error="visibleErrors.toAddresses">
            <input
                v-model.trim="form.toAddresses"
                type="text"
                placeholder="ops@example.com, support@example.com"
                autocomplete="off"
                class="cfs__input"
            />
        </FormField>

        <template v-if="form.mode === 'custom_smtp'">
            <div class="cfs__row">
                <FormField label="SMTP host" :error="visibleErrors.host">
                    <input
                        v-model.trim="form.host"
                        type="text"
                        autocomplete="off"
                        class="cfs__input"
                    />
                </FormField>

                <FormField label="SMTP port" :error="visibleErrors.port">
                    <input
                        v-model.number="form.port"
                        type="number"
                        min="1"
                        max="65535"
                        autocomplete="off"
                        class="cfs__input"
                    />
                </FormField>
            </div>

            <div class="cfs__row">
                <FormField label="Username (optional)">
                    <input
                        v-model.trim="form.authUser"
                        type="text"
                        autocomplete="off"
                        class="cfs__input"
                    />
                </FormField>

                <FormField label="Password (optional)">
                    <input
                        v-model="authPass"
                        type="password"
                        autocomplete="new-password"
                        :placeholder="passwordPlaceholder"
                        class="cfs__input"
                    />
                    <p v-if="storedPassword" class="cfs__hint">
                        Stored: {{ storedPassword }} — leave blank to keep it
                    </p>
                </FormField>
            </div>
        </template>
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import FormField from '@/components/core/FormField.vue';
import type {ErrorMap} from '@/helpers/channelValidators';
import type {EmailChannelConfigForm} from '@/helpers/notificationEmailConfig';

const props = defineProps<{
    showErrors: boolean;
    errors: ErrorMap;
    /** Masked secrets from the API, keyed by config path. */
    maskedFields?: Record<string, string>;
}>();

// Shows which password is stored without revealing it, so an operator can tell
// a current credential from a stale one without sending a test.
const storedPassword = computed(() => props.maskedFields?.['auth.pass'] ?? '');
const passwordPlaceholder = computed(() =>
    storedPassword.value ? 'Unchanged' : 'Gmail: use an App Password'
);

const form = defineModel<EmailChannelConfigForm>({required: true});

const visibleErrors = computed<ErrorMap>(() =>
    props.showErrors ? props.errors : {}
);

// Google shows app passwords as four groups of four; the spaces are display
// only and SMTP rejects them. Strip so a straight paste works.
const authPass = computed<string>({
    get: () => form.value.authPass ?? '',
    set: (value) => {
        form.value.authPass = value.replace(/\s+/g, '');
    }
});
</script>

<style src="./channelFieldset.css"></style>
