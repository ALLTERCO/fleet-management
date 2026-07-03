<template>
    <div class="sf">
        <div v-if="hasSecret && !editing" class="sf__status">
            <span class="sf__masked">
                <i class="fas fa-lock sf__icon" /> configured
            </span>
            <button
                type="button"
                class="sf__toggle"
                @click="startEditing"
            >
                Replace
            </button>
        </div>
        <div v-else class="sf__input-row">
            <!-- :standalone="false" — SecretField is only used inside
                 SchemaForm, which is always rendered inside a modal with
                 its own <form>. Nested forms would be invalid HTML. -->
            <PasswordField
                v-model="model"
                :placeholder="placeholder ?? 'Enter value'"
                autocomplete="off"
                :standalone="false"
                class="sf__input"
            />
            <button
                v-if="hasSecret"
                type="button"
                class="sf__toggle"
                @click="cancelEditing"
            >
                Keep existing
            </button>
        </div>
    </div>
</template>

<script setup lang="ts">
import {ref} from 'vue';
import PasswordField from './PasswordField.vue';

// Write-only secret input: when the backend reports a stored secret,
// we show "configured" instead of echoing anything. User clicks Replace
// to enter a new value. Keep existing cancels the replace.
const model = defineModel<string>({required: true});

defineProps<{
    hasSecret: boolean;
    placeholder?: string;
}>();

const editing = ref(false);

function startEditing() {
    editing.value = true;
    model.value = '';
}

function cancelEditing() {
    editing.value = false;
    model.value = '';
}
</script>

<style scoped>
.sf {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
}
.sf__status {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border: 1px dashed var(--color-border-medium);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
}
.sf__masked {
    flex: 1;
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
}
.sf__icon {
    opacity: 0.7;
}
.sf__input-row {
    display: flex;
    gap: var(--space-2);
    align-items: center;
}
.sf__input {
    flex: 1;
}
.sf__toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-1) var(--space-2);
    font-size: var(--type-body);
    font-weight: 600;
    border: 1px solid var(--color-border-medium);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
    color: var(--color-text-tertiary);
    cursor: pointer;
    white-space: nowrap;
}
.sf__toggle:hover {
    color: var(--color-text-primary);
    border-color: var(--color-border-strong);
}
</style>
