<template>
    <section class="spw">
        <header class="spw__header">
            <h3 class="spw__title">
                <i class="fas fa-vial spw__title-icon" />
                Simulate
            </h3>
            <p class="spw__hint">
                Run a what-if check: can this user perform an action on a
                resource? Useful to debug why an assignment is or isn't taking
                effect.
            </p>
        </header>

        <div class="spw__form">
            <FormField label="Action">
                <Input
                    v-model="form.action"
                    placeholder="device.update"
                />
            </FormField>
            <FormField label="Resource type">
                <Input
                    v-model="form.resourceType"
                    placeholder="device"
                />
            </FormField>
            <FormField label="Resource id (optional)">
                <Input
                    v-model="form.resourceId"
                    placeholder="34CDB0A1B2C3 or 42"
                />
            </FormField>
        </div>

        <div class="spw__actions">
            <Button
                type="blue"
                size="sm"
                :loading="loading"
                :disabled="!canSubmit"
                @click="run"
            >
                <i class="fas fa-bolt" />
                {{ loading ? 'Checking…' : 'Run check' }}
            </Button>
            <Button
                v-if="result"
                type="blue-hollow"
                size="sm"
                @click="result = null"
            >
                Clear
            </Button>
        </div>

        <div v-if="result" class="spw__result" :class="resultClass">
            <div class="spw__decision">
                <i
                    class="fas"
                    :class="result.decision ? 'fa-check-circle' : 'fa-circle-xmark'"
                />
                <span>{{ result.decision ? 'Allowed' : 'Denied' }}</span>
            </div>

            <div
                v-if="result.matchedBy.length > 0"
                class="spw__provenance"
            >
                <span class="spw__provenance-label">Matched by:</span>
                <ul class="spw__provenance-list">
                    <li
                        v-for="(m, idx) in result.matchedBy"
                        :key="idx"
                    >
                        <code>{{ m.source }}</code>
                        · persona <code>{{ m.persona }}</code>
                    </li>
                </ul>
            </div>
            <p v-else class="spw__no-match">
                No matching statement — fell through to the default deny.
            </p>
        </div>
    </section>
</template>

<script setup lang="ts">
import {computed, reactive, ref} from 'vue';
import Button from '@/components/core/Button.vue';
import FormField from '@/components/core/FormField.vue';
import Input from '@/components/core/Input.vue';
import {type SimulateResult, useUsersStore} from '@/stores/users';

const props = defineProps<{userId: string}>();

const usersStore = useUsersStore();

const form = reactive({
    action: '',
    resourceType: '',
    resourceId: ''
});
const result = ref<SimulateResult | null>(null);
const loading = ref(false);

const canSubmit = computed(
    () =>
        !!form.action.trim() &&
        !!form.resourceType.trim() &&
        !loading.value
);

const resultClass = computed(() =>
    result.value?.decision ? 'spw__result--allow' : 'spw__result--deny'
);

// Resource-type families and which kind of id they take. These take
// strings (shellyIDs, entity ids, tag names, plugin keys) — never coerce,
// even if the user types something all-digits. Others (location, group,
// dashboard) take numeric ids; coerce all-digit input.
const STRING_ID_TYPES = new Set(['device', 'entity', 'tag', 'plugin']);

async function run(): Promise<void> {
    loading.value = true;
    try {
        const ridRaw = form.resourceId.trim();
        const resType = form.resourceType.trim();
        let resourceId: string | number | undefined;
        if (!ridRaw) {
            resourceId = undefined;
        } else if (STRING_ID_TYPES.has(resType)) {
            resourceId = ridRaw;
        } else if (/^\d+$/.test(ridRaw)) {
            resourceId = Number(ridRaw);
        } else {
            resourceId = ridRaw;
        }
        result.value = await usersStore.simulatePermission({
            userId: props.userId,
            action: form.action.trim(),
            resourceType: resType,
            resourceId
        });
    } finally {
        loading.value = false;
    }
}
</script>

<style scoped>
.spw {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-3);
    background: var(--color-surface-1);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
}
.spw__header {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
}
.spw__title {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}
.spw__title-icon {
    color: var(--color-primary);
}
.spw__hint {
    margin: 0;
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}
.spw__form {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: var(--space-2);
}
.spw__actions {
    display: flex;
    gap: var(--space-2);
}
.spw__result {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-default);
    background: var(--color-surface-0);
}
.spw__result--allow {
    border-left: 3px solid var(--color-status-on);
}
.spw__result--deny {
    border-left: 3px solid var(--color-status-red);
}
.spw__decision {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
}
.spw__result--allow .spw__decision {
    color: var(--color-status-on);
}
.spw__result--deny .spw__decision {
    color: var(--color-status-red);
}
.spw__provenance {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
}
.spw__provenance-label {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
}
.spw__provenance-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    color: var(--color-text-primary);
    font-size: var(--type-caption);
}
.spw__provenance-list code {
    font-family: var(--font-mono);
    background: var(--color-surface-2);
    padding: 0 var(--space-1);
    border-radius: var(--radius-sm);
}
.spw__no-match {
    margin: 0;
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
    font-style: italic;
}
</style>
