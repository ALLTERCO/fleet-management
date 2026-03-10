<template>
    <div class="space-y-4">
        <BasicBlock darker>
            <div class="space-y-4">
                <h2 class="heading-section">Audit Log Export</h2>

                <div class="flex flex-col md:flex-row gap-4">
                    <div class="flex-1">
                        <Input
                            v-model="filters.from"
                            type="datetime-local"
                            label="From"
                        />
                    </div>
                    <div class="flex-1">
                        <Input
                            v-model="filters.to"
                            type="datetime-local"
                            label="To"
                        />
                    </div>
                </div>

                <div class="flex flex-col gap-2">
                    <span class="text-sm font-semibold text-white">Event Types</span>
                    <div class="flex flex-wrap gap-4">
                        <Checkbox v-model="filters.logins">User Logins</Checkbox>
                        <Checkbox v-model="filters.rpc">RPC Operations</Checkbox>
                        <Checkbox v-model="filters.deviceOnline">Device Online</Checkbox>
                        <Checkbox v-model="filters.deviceOffline">Device Offline</Checkbox>
                        <Checkbox v-model="filters.deviceAdd">Device Added</Checkbox>
                        <Checkbox v-model="filters.deviceDelete">Device Deleted</Checkbox>
                    </div>
                </div>

                <div class="flex justify-end">
                    <Button
                        type="blue"
                        :loading="isGenerating"
                        :disabled="!isValid"
                        @click="generateExport"
                    >
                        Generate CSV Export
                    </Button>
                </div>

                <div
                    v-if="downloadInfo"
                    class="p-4 bg-[var(--color-surface-2)] rounded-lg space-y-2"
                >
                    <p class="text-[var(--color-success-text)]">
                        Export ready! ({{ downloadInfo.rows }} records)
                    </p>
                    <a
                        :href="downloadUrl"
                        class="text-[var(--color-primary-text)] hover:underline"
                        download
                    >
                        Download {{ downloadInfo.filename }}
                    </a>
                    <p class="text-xs text-[var(--color-text-disabled)]">
                        Note: File will be automatically deleted after 1 hour.
                    </p>
                </div>

                <div v-if="errorMessage" class="p-4 bg-[var(--color-danger-subtle)] rounded-lg">
                    <p class="text-[var(--color-danger-text)]">{{ errorMessage }}</p>
                </div>
            </div>
        </BasicBlock>
    </div>
</template>

<script setup lang="ts">
import {computed, reactive, ref} from 'vue';
import BasicBlock from '@/components/core/BasicBlock.vue';
import Button from '@/components/core/Button.vue';
import Checkbox from '@/components/core/Checkbox.vue';
import Input from '@/components/core/Input.vue';
import {FLEET_MANAGER_HTTP} from '@/constants';
import {sendRPC} from '@/tools/websocket';

interface DownloadInfo {
    filename: string;
    rows: number;
    downloadUrl: string;
}

const filters = reactive({
    from: '',
    to: '',
    logins: true,
    rpc: true,
    deviceOnline: true,
    deviceOffline: true,
    deviceAdd: true,
    deviceDelete: true
});

const isGenerating = ref(false);
const downloadInfo = ref<DownloadInfo | null>(null);
const errorMessage = ref('');

const isValid = computed(() => {
    return (
        filters.from &&
        filters.to &&
        (filters.logins ||
            filters.rpc ||
            filters.deviceOnline ||
            filters.deviceOffline ||
            filters.deviceAdd ||
            filters.deviceDelete)
    );
});

const downloadUrl = computed(() => {
    if (!downloadInfo.value) return '';
    return `${FLEET_MANAGER_HTTP}${downloadInfo.value.downloadUrl}`;
});

async function generateExport() {
    const eventTypes: string[] = [];
    if (filters.logins) eventTypes.push('login');
    if (filters.rpc) eventTypes.push('rpc');
    if (filters.deviceOnline) eventTypes.push('device_online');
    if (filters.deviceOffline) eventTypes.push('device_offline');
    if (filters.deviceAdd) eventTypes.push('device_add');
    if (filters.deviceDelete) eventTypes.push('device_delete');

    isGenerating.value = true;
    downloadInfo.value = null;
    errorMessage.value = '';

    try {
        const result = await sendRPC<DownloadInfo>(
            'FLEET_MANAGER',
            'AuditLog.Export',
            {
                from: new Date(filters.from).toISOString(),
                to: new Date(filters.to).toISOString(),
                eventTypes
            }
        );
        downloadInfo.value = result;
    } catch (error: any) {
        errorMessage.value =
            'Failed to generate export: ' + (error?.message || String(error));
    } finally {
        isGenerating.value = false;
    }
}

// Set default date range (last 7 days)
function setDefaultDates() {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    filters.to = now.toISOString().slice(0, 16);
    filters.from = weekAgo.toISOString().slice(0, 16);
}

setDefaultDates();
</script>
