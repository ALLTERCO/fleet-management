<template>
    <Modal :visible="visible" @close="$emit('close')">
        <template #title>
            {{ editingKey ? 'Edit Configuration' : 'Create Configuration' }}
        </template>
        <template #default>
            <div class="cfg-form">
                <div v-for="section in settings" :key="section.title">
                    <Collapse :title="section.title">
                        <div
                            v-for="option in section.options"
                            :key="option.key"
                            class="cfg-form__field"
                        >
                            <Input
                                v-if="option.type === 'input'"
                                :model-value="stringOf(getNestedValue(config, option.key))"
                                :label="option.label"
                                :placeholder="(option as ConfigInputOption).placeholder"
                                @update:model-value="(val) => $emit('update', option.key, val)"
                            />
                            <Dropdown
                                v-else-if="option.type === 'dropdown'"
                                :options="(option as ConfigDropdownOption).options"
                                :label="option.label"
                                :default="getNestedValue(config, option.key) as string | number | undefined"
                                @selected="(val) => $emit('update', option.key, val)"
                            />
                            <Checkbox
                                v-else-if="option.type === 'checkbox'"
                                :id="option.key"
                                :model-value="boolOf(getNestedValue(config, option.key))"
                                @update:model-value="(val) => $emit('update', option.key, val)"
                            >
                                {{ option.label }}
                            </Checkbox>
                        </div>
                    </Collapse>
                </div>
            </div>
        </template>
        <template #footer>
            <div class="cfg-footer">
                <Button type="blue-hollow" @click="$emit('close')">
                    Cancel
                </Button>
                <Button
                    v-if="editingKey"
                    type="green"
                    @click="$emit('save')"
                >
                    Save
                </Button>
                <Button v-else type="green" @click="$emit('create')">
                    Create
                </Button>
            </div>
        </template>
    </Modal>
</template>

<script setup lang="ts">
import Button from '@/components/core/Button.vue';
import Checkbox from '@/components/core/Checkbox.vue';
import Collapse from '@/components/core/Collapse.vue';
import Dropdown from '@/components/core/Dropdown.vue';
import Input from '@/components/core/Input.vue';
import Modal from '@/components/modals/Modal.vue';

export interface ConfigFormOption {
    key: string;
    label: string;
    type: string;
}

export interface ConfigInputOption extends ConfigFormOption {
    placeholder?: string;
}

export interface ConfigDropdownOption extends ConfigFormOption {
    options: (string | number | boolean)[];
}

export interface ConfigFormSection {
    title: string;
    options: readonly ConfigFormOption[];
}

defineProps<{
    visible: boolean;
    editingKey: string | null;
    settings: readonly ConfigFormSection[];
    config: Record<string, unknown>;
    getNestedValue: (obj: Record<string, unknown>, key: string) => unknown;
}>();

defineEmits<{
    close: [];
    save: [];
    create: [];
    update: [key: string, value: unknown];
}>();

function stringOf(value: unknown): string {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return String(value);
    return '';
}

function boolOf(value: unknown): boolean {
    return Boolean(value);
}
</script>
