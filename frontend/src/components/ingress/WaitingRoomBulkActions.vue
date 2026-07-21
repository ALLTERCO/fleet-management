<template>
    <!-- Browsing: refresh, then start a selection. Hidden once a selection
         is active so the bar stays focused on the bulk task. Adding devices
         lives on the Devices tab — the waiting room only triages arrivals. -->
    <template v-if="!hasSelection">
        <Button
            type="blue-hollow"
            size="sm"
            narrow
            title="Refresh"
            @click="state.refresh()"
        >
            <i class="fas fa-sync-alt" />
        </Button>
        <Button
            v-if="state.allEntries.value.length > 0"
            type="blue-hollow"
            size="sm"
            @click="state.toggleSelectAll"
        >
            Select All
        </Button>
    </template>

    <!-- Selecting: bulk accept / reject only earn a spot for 2+ (a single
         device is handled by its own card buttons); grow or clear otherwise. -->
    <template v-else>
        <Button
            v-if="multiSelected"
            type="green"
            size="sm"
            :loading="state.accepting.value"
            :disabled="!canAccept || state.accepting.value"
            :title="!canAccept ? NO_WRITE_TITLE : undefined"
            @click="state.handleAccept"
        >
            {{ acceptLabel }}
        </Button>
        <Button
            v-if="mode === 'pending' && multiSelected"
            type="red"
            size="sm"
            :disabled="!canReject || state.accepting.value"
            :title="!canReject ? NO_WRITE_TITLE : undefined"
            @click="state.handleReject"
        >
            {{ rejectLabel }}
        </Button>
        <Button
            type="blue-hollow"
            size="sm"
            @click="state.clearSelection"
        >
            Clear
        </Button>
    </template>

</template>

<script setup lang="ts">
import {computed} from 'vue';
import Button from '@/components/core/Button.vue';
import type {
    WaitingRoomListState,
    WaitingRoomMode
} from '@/composables/useWaitingRoomList';

// Shared bulk-action bar for the Waiting Room page — refresh, select,
// bulk accept/reject, driven by the shared composable.
const props = defineProps<{
    state: WaitingRoomListState;
    mode: WaitingRoomMode;
    canAccept: boolean;
    canReject: boolean;
}>();

const NO_WRITE_TITLE = 'You do not have permission to perform this action';

// One selection drives the whole bar: browsing actions vs. bulk actions.
const hasSelection = computed(() => props.state.selected.value.length > 0);
// Bulk accept/reject only matter for 2+ — a single device uses its card buttons.
const multiSelected = computed(() => props.state.selected.value.length > 1);

// One verb for taking devices in — "Accept" — on both tabs.
const acceptLabel = computed(() => {
    const verb = 'Accept';
    const n = props.state.selected.value.length;
    if (n === 0) return verb;
    if (props.state.allSelected.value) return `${verb} All`;
    return `${verb} (${n})`;
});

const rejectLabel = computed(() => {
    const n = props.state.selected.value.length;
    if (n === 0) return 'Reject';
    if (props.state.allSelected.value) return 'Reject All';
    return `Reject (${n})`;
});
</script>
