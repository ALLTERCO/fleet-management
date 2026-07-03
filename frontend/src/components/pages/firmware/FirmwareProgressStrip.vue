<template>
    <Transition name="bulk-slide">
        <div v-if="committedCount > 0" class="fw-progress">
            <button
                type="button"
                class="fw-progress__header"
                @click="expandedModel = !expandedModel"
            >
                <Spinner v-if="updatingCount > 0" size="xs" />
                <i v-else class="fas fa-check fw-progress__done-icon" />
                <span class="fw-progress__summary">
                    {{ updatingCount > 0 ? 'Updating' : 'Updated' }}
                    {{ committedCount }} device{{ committedCount > 1 ? 's' : '' }}
                </span>
                <span class="fw-progress__counts">
                    {{ successCount }} <i class="fas fa-check" />
                    <template v-if="failedCount > 0">
                        · {{ failedCount }} <i class="fas fa-times" />
                    </template>
                    <template v-if="updatingCount > 0">
                        · {{ updatingCount }}
                        <i class="fas fa-sync-alt fa-spin" />
                    </template>
                </span>
                <div class="fw-progress__bar">
                    <div
                        class="fw-progress__bar-fill"
                        :style="{width: overallProgressPct + '%'}"
                    />
                </div>
                <i
                    class="fas fa-chevron-up fw-progress__chevron"
                    :class="{'fw-progress__chevron--open': expandedModel}"
                />
                <Button
                    v-if="updatingCount === 0"
                    type="blue-hollow"
                    size="sm"
                    narrow
                    class="ml-2"
                    @click.stop="$emit('finish')"
                >
                    Done
                </Button>
                <Button
                    v-if="updatingCount > 0"
                    type="blue-hollow"
                    size="sm"
                    narrow
                    class="ml-1"
                    @click.stop="$emit('finish')"
                >
                    Cancel
                </Button>
            </button>

            <div v-if="expandedModel" class="fw-progress__body">
                <DataList :rows="rows" :columns="columns" row-key="shellyID">
                    <template #cell-progress="{row}">
                        <div class="fwa__progress-track">
                            <div
                                class="fwa__progress-fill"
                                :style="firmwareProgressStyle({
                                    phase: row.updateStatus,
                                    percent: row.progressPercent
                                })"
                            />
                        </div>
                    </template>
                    <template #cell-status="{row}">
                        <span
                            v-if="row.updateStatus === 'downloading'"
                            class="fwa__update-status fwa__update-status--active"
                        >
                            <Spinner size="xs" /> {{ row.progressPercent }}%
                        </span>
                        <span
                            v-else-if="row.updateStatus === 'rebooting'"
                            class="fwa__update-status fwa__update-status--warning"
                        >
                            <Spinner size="xs" /> Rebooting
                        </span>
                        <span
                            v-else-if="row.updateStatus === 'verifying'"
                            class="fwa__update-status fwa__update-status--active"
                        >
                            <Spinner size="xs" /> Verifying
                        </span>
                        <span
                            v-else-if="row.updateStatus === 'success'"
                            class="fwa__update-status fwa__update-status--success"
                        >
                            <i class="fas fa-check" />
                            {{ row.previousVersion }} → {{ row.currentVersion }}
                        </span>
                        <span
                            v-else-if="row.updateStatus === 'failed'"
                            class="fwa__update-status fwa__update-status--error"
                            :title="row.error"
                        >
                            <i class="fas fa-times" />
                            {{ row.error || 'Failed' }}
                        </span>
                        <span
                            v-else
                            class="fwa__update-status fwa__update-status--waiting"
                        >Waiting</span>
                    </template>
                    <template #cell-actions="{row}">
                        <Button
                            v-if="row.updateStatus === 'failed'"
                            type="blue-hollow"
                            size="sm"
                            narrow
                            @click="$emit('retry', row.shellyID)"
                        >
                            Retry
                        </Button>
                    </template>
                </DataList>
                <div v-if="failedCount > 0" class="fw-progress__footer">
                    <Button type="blue-hollow" size="sm" @click="$emit('retry-all-failed')">
                        Retry All Failed ({{ failedCount }})
                    </Button>
                </div>
            </div>
        </div>
    </Transition>
</template>

<script setup lang="ts">
import Button from '@/components/core/Button.vue';
import DataList, {type DataColumn} from '@/components/core/DataList.vue';
import Spinner from '@/components/core/Spinner.vue';
import {firmwareProgressStyle} from '@/helpers/firmwareStatus';
import type {FirmwareDeviceInfo} from '@/stores/firmware';

defineProps<{
    committedCount: number;
    updatingCount: number;
    successCount: number;
    failedCount: number;
    overallProgressPct: number;
    rows: FirmwareDeviceInfo[];
    columns: DataColumn<FirmwareDeviceInfo>[];
}>();

const expandedModel = defineModel<boolean>('expanded', {required: true});

defineEmits<{
    finish: [];
    retry: [shellyID: string];
    'retry-all-failed': [];
}>();
</script>
