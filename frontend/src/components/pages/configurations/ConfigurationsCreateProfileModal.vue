<template>
    <Modal :visible="visible" compact @close="$emit('close')">
        <template #title>Create Profile</template>
        <template #default>
            <Input
                v-model="nameModel"
                placeholder="Profile name"
                :error="error"
                @blur="$emit('validate')"
            />
        </template>
        <template #footer>
            <div class="cfg-footer">
                <Button type="blue-hollow" @click="$emit('close')">Cancel</Button>
                <Button type="green" @click="$emit('submit')">
                    Create
                </Button>
            </div>
        </template>
    </Modal>
</template>

<script setup lang="ts">
import Button from '@/components/core/Button.vue';
import Input from '@/components/core/Input.vue';
import Modal from '@/components/modals/Modal.vue';

defineProps<{
    visible: boolean;
    error: string;
}>();

const nameModel = defineModel<string>('name', {required: true});

defineEmits<{
    close: [];
    submit: [];
    validate: [];
}>();
</script>
