<template>
    <div class="lgr">
        <header class="lgr__hdr">
            <h3 class="lgr__title">Groups in this {{ scopeLabel }}</h3>
            <span class="lgr__count">{{ assignedGroups.length }}</span>
            <span class="lgr__spacer" />
            <Button
                v-if="canWrite"
                type="green"
                size="sm"
                title="Assign groups"
                aria-label="Assign groups"
                @click="openPicker"
            >
                <i class="fas fa-plus" aria-hidden="true" />
            </Button>
        </header>

        <ul v-if="assignedGroups.length > 0" class="lgr__list">
            <li v-for="group in assignedGroups" :key="group.id" class="lgr__row">
                <span class="lgr__row-name">{{ group.name }}</span>
                <span class="lgr__row-meta">
                    {{ group.deviceCount }}
                    {{ group.deviceCount === 1 ? 'device' : 'devices' }}
                </span>
                <button
                    v-if="canWrite"
                    type="button"
                    class="lgr__row-remove"
                    :title="`Unassign ${group.name}`"
                    @click="removeGroup(group.id)"
                >
                    <i class="fas fa-xmark" aria-hidden="true" />
                </button>
                <span v-else class="lgr__row-remove lgr__row-remove--placeholder" />
            </li>
        </ul>

        <p v-else class="lgr__empty">
            No groups assigned to this {{ scopeLabel }}. Assigning a group puts
            every device in it at this {{ scopeLabel }}.
        </p>

        <Modal :visible="pickerVisible" wide @close="pickerVisible = false">
            <template #title>Assign groups to this {{ scopeLabel }}</template>
            <SubjectPicker v-model="picked" :subject-types="['group']" />
            <template #footer>
                <div class="lgr__picker-foot">
                    <Button type="blue-hollow" @click="pickerVisible = false">
                        Cancel
                    </Button>
                    <span class="lgr__spacer" />
                    <Button
                        type="green"
                        :loading="assigning"
                        :disabled="picked.length === 0"
                        :requires-write="true"
                        @click="assignPicked"
                    >
                        Assign {{ picked.length || '' }}
                    </Button>
                </div>
            </template>
        </Modal>
    </div>
</template>

<script setup lang="ts">
import {computed, onMounted, ref} from 'vue';
import Button from '@/components/core/Button.vue';
import SubjectPicker, {
    type SubjectRef
} from '@/components/core/SubjectPicker.vue';
import Modal from '@/components/modals/Modal.vue';
import {usePermissions} from '@/composables/usePermissions';
import {useGroupsStore} from '@/stores/groups';
import {useLocationsStore} from '@/stores/locations';

const props = defineProps<{
    locationId: number;
    scopeLabel: string;
}>();

const locations = useLocationsStore();
const groups = useGroupsStore();
const {canWrite} = usePermissions();

onMounted(() => {
    void groups.fetchGroups();
});

interface GroupRow {
    readonly id: number;
    readonly name: string;
    readonly deviceCount: number;
}

// Only groups assigned directly to THIS location. Unlike devices, a group is
// not rolled up from descendants — it is an explicit edge on one location.
const assignedGroupIds = computed<number[]>(() => {
    const items = locations.assignmentsByLocation[props.locationId] ?? [];
    return items
        .filter((a) => a.subjectType === 'group')
        .map((a) => Number(a.subjectId))
        .filter((id) => Number.isInteger(id));
});

const assignedGroups = computed<GroupRow[]>(() =>
    assignedGroupIds.value.map((id) => {
        const group = groups.groups[id];
        return {
            id,
            name: group?.name ?? `Group ${id}`,
            deviceCount: group?.devices?.length ?? 0
        };
    })
);

// ── Assign picker ──
const pickerVisible = ref(false);
const picked = ref<SubjectRef[]>([]);
const assigning = ref(false);

function openPicker(): void {
    picked.value = [];
    pickerVisible.value = true;
}

async function assignPicked(): Promise<void> {
    if (picked.value.length === 0) return;
    assigning.value = true;
    try {
        const ids = picked.value
            .map((ref_) => Number(ref_.subjectId))
            .filter((id) => Number.isInteger(id));
        await locations.assignGroups(ids, props.locationId);
        pickerVisible.value = false;
        picked.value = [];
    } finally {
        assigning.value = false;
    }
}

function removeGroup(id: number): void {
    void locations.removeAssignment('group', String(id));
}
</script>

<style scoped>
.lgr {
    padding: var(--space-5);
}

.lgr__hdr {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-bottom: var(--space-4);
    padding-bottom: var(--space-3);
    border-bottom: 1px solid var(--color-border-default);
}

.lgr__title {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
    margin: 0;
}

.lgr__count {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    font-variant-numeric: tabular-nums;
}

.lgr__spacer {
    flex: 1;
}

.lgr__list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
}

.lgr__row {
    display: grid;
    grid-template-columns: 1fr auto auto;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm-plus);
    background: var(--color-surface-1);
    border: 1px solid var(--color-border-default);
    align-items: center;
}

.lgr__row-name {
    font-size: var(--type-body);
    color: var(--color-text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.lgr__row-meta {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    font-variant-numeric: tabular-nums;
}

.lgr__row-remove {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-6);
    height: var(--space-6);
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-tertiary);
    cursor: pointer;
    transition: background var(--motion-state), color var(--motion-state);
}
.lgr__row-remove:hover {
    background: var(--color-danger-subtle);
    color: var(--color-danger-text);
}
.lgr__row-remove--placeholder {
    cursor: default;
}

.lgr__empty {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    text-align: center;
    padding: var(--space-12) 0;
    margin: 0;
}

.lgr__picker-foot {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
}
</style>
