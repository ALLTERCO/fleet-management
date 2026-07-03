<template>
    <DetailPageLayout
        back-to="/organize/tags"
        back-label="Back to Tags"
        :loading="loading"
        :missing="!loading && !tag"
        missing-sub="This tag may have been deleted or you don't have access."
    >
        <template v-if="tag">
            <section class="td-summary">
                <div class="td-summary-left">
                    <TagChip :tag="tag" />
                    <div class="td-key">
                        <span class="td-key-label">key</span>
                        <code class="td-key-val">{{ tag.key }}</code>
                    </div>
                </div>
                <div class="td-summary-actions">
                    <Button
                        v-if="canWrite"
                        type="blue-hollow"
                        narrow
                        @click="editVisible = true"
                    >
                        Edit
                    </Button>
                    <Button
                        v-if="canWrite"
                        type="red"
                        narrow
                        @click="askDelete"
                    >
                        Delete
                    </Button>
                </div>
            </section>

            <section class="td-info">
                <h3 class="td-section-title">Name</h3>
                <p class="td-name">{{ tag.name }}</p>
                <h3 v-if="tag.description" class="td-section-title">
                    Description
                </h3>
                <p v-if="tag.description" class="td-desc">
                    {{ tag.description }}
                </p>
            </section>

            <section class="td-assignments">
                <div class="td-section-hdr">
                    <h3 class="td-section-title">Assignments</h3>
                    <Button
                        v-if="canWrite"
                        type="green"
                        narrow
                        title="Assign subjects"
                        aria-label="Assign subjects"
                        @click="assignVisible = true"
                    >
                        <i class="fas fa-plus" aria-hidden="true" />
                    </Button>
                </div>
                <div v-if="assignmentsLoading" class="td-loading">
                    <Spinner />
                </div>
                <EmptyBlock v-else-if="assignments.length === 0">
                    <p>No subjects tagged yet.</p>
                </EmptyBlock>
                <div v-else class="td-assignment-list">
                    <div
                        v-for="group in groupedAssignments"
                        :key="group.type"
                        class="td-assignment-group"
                    >
                        <h4 class="td-assignment-label">
                            {{ subjectTypeLabel(group.type) }}
                        </h4>
                        <ul class="td-assignment-items">
                            <li
                                v-for="item in group.items"
                                :key="`${item.subjectType}:${item.subjectId}`"
                                class="td-assignment-item"
                            >
                                <span class="td-assignment-name">{{ subjectName(item) }}</span>
                                <button
                                    v-if="canWrite"
                                    type="button"
                                    class="td-assignment-remove"
                                    :aria-label="`Unassign ${item.subjectType}`"
                                    @click="removeAssignment(item)"
                                >
                                    <i class="fas fa-xmark" />
                                </button>
                            </li>
                        </ul>
                    </div>
                </div>
            </section>
        </template>

        <Modal :visible="assignVisible" wide @close="assignVisible = false">
            <template #title>
                <h3>Assign subjects to "{{ tag?.name }}"</h3>
            </template>
            <template #default>
                <SubjectPicker
                    v-model="pickedSubjects"
                    :subject-types="['device', 'entity', 'group', 'location']"
                />
            </template>
            <template #footer>
                <div class="td-modal-footer">
                    <Button type="blue-hollow" @click="assignVisible = false">
                        Cancel
                    </Button>
                    <Button
                        type="green"
                        :loading="assigning"
                        :disabled="pickedSubjects.length === 0"
                        @click="confirmAssign"
                    >
                        Assign
                        {{ pickedSubjects.length }}
                    </Button>
                </div>
            </template>
        </Modal>

        <EditTagModal
            v-if="tag"
            v-model="editVisible"
            mode="edit"
            :initial="tag"
            @saved="onEdited"
        />

        <ConfirmationModal ref="deleteConfirmRef">
            <template #title>
                <h3>Delete tag "{{ tag?.name }}"?</h3>
            </template>
            <template #subText>
                <p v-if="assignments.length" class="td-delete-warn">
                    <i class="fas fa-exclamation-triangle" />
                    All {{ assignments.length }} assignment{{
                        assignments.length === 1 ? '' : 's'
                    }}
                    will be removed.
                </p>
            </template>
        </ConfirmationModal>
    </DetailPageLayout>
</template>

<script setup lang="ts">
import type {Tag as ApiTag, TagAssignmentRef, TagSubjectType} from '@api/tag';
import {computed, onMounted, ref, watch} from 'vue';
import {useRoute, useRouter} from 'vue-router';
import Button from '@/components/core/Button.vue';
import DetailPageLayout from '@/components/core/DetailPageLayout.vue';
import EmptyBlock from '@/components/core/EmptyBlock.vue';
import type {SubjectRef} from '@/components/core/SubjectPicker.vue';
import SubjectPicker from '@/components/core/SubjectPicker.vue';
import TagChip from '@/components/core/TagChip.vue';
import  ConfirmationModal from '@/components/modals/ConfirmationModal.vue';
import EditTagModal from '@/components/modals/EditTagModal.vue';
import Modal from '@/components/modals/Modal.vue';
import {usePermissions} from '@/composables/usePermissions';
import {useTagSubjectName} from '@/composables/useTagSubjectName';
import {useTagsStore} from '@/stores/tags';

const store = useTagsStore();
const {canWrite} = usePermissions();

// Assignments carry only (subjectType, subjectId); the shared resolver turns
// each into a friendly name (falls back to the id when not loaded).
const {subjectName} = useTagSubjectName();
const router = useRouter();
const route = useRoute();

const loading = ref(true);
const assignmentsLoading = ref(true);
const editVisible = ref(false);
const assignVisible = ref(false);
const assigning = ref(false);
const pickedSubjects = ref<SubjectRef[]>([]);
const deleteConfirmRef = ref<InstanceType<typeof ConfirmationModal>>();

const tagId = computed(() => {
    const params = route.params as Record<
        string,
        string | string[] | undefined
    >;
    const raw = Array.isArray(params.id) ? params.id[0] : params.id;
    const n = Number.parseInt(String(raw ?? ''), 10);
    return Number.isFinite(n) ? n : null;
});

const tag = computed<ApiTag | null>(() =>
    tagId.value != null ? (store.tags[tagId.value] ?? null) : null
);

const assignments = computed<TagAssignmentRef[]>(() =>
    tagId.value != null ? (store.assignments[tagId.value] ?? []) : []
);

interface AssignmentGroup {
    type: TagSubjectType;
    items: TagAssignmentRef[];
}
const groupedAssignments = computed<AssignmentGroup[]>(() => {
    const map: Partial<Record<TagSubjectType, TagAssignmentRef[]>> = {};
    for (const a of assignments.value) {
        (map[a.subjectType] ??= []).push(a);
    }
    return Object.entries(map)
        .filter(([, items]) => items && items.length > 0)
        .map(([type, items]) => ({
            type: type as TagSubjectType,
            items: items as TagAssignmentRef[]
        }));
});

function subjectTypeLabel(type: TagSubjectType): string {
    // Humanize enum value for display. Backend owns the enum; we just format.
    return type
        .split('_')
        .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
        .join(' ');
}

async function refresh() {
    if (tagId.value == null) return;
    loading.value = true;
    try {
        // Subject stores (devices/entities/groups/locations/tags) are loaded
        // app-wide on WS connect, so subjectName() resolves names from them.
        await store.fetchTag(tagId.value);
    } finally {
        loading.value = false;
    }
    assignmentsLoading.value = true;
    try {
        await store.fetchAssignments(tagId.value);
    } finally {
        assignmentsLoading.value = false;
    }
}

onMounted(refresh);
watch(tagId, refresh);

function onEdited() {
    // Store already updated the row; component re-reads via computed.
}

// SubjectPicker uses its own SubjectType; all its values are valid TagSubjectTypes.
async function confirmAssign() {
    if (!tag.value || pickedSubjects.value.length === 0) return;
    assigning.value = true;
    try {
        const refs: TagAssignmentRef[] = pickedSubjects.value.map((s) => ({
            subjectType: s.subjectType as TagSubjectType,
            subjectId: s.subjectId
        }));
        const ok = await store.assignSubjects(tag.value.id, refs);
        if (ok) {
            assignVisible.value = false;
            pickedSubjects.value = [];
        }
    } finally {
        assigning.value = false;
    }
}

async function removeAssignment(item: TagAssignmentRef) {
    if (!tag.value) return;
    await store.unassignSubjects(tag.value.id, [item]);
}

function askDelete() {
    if (!tag.value) return;
    deleteConfirmRef.value?.storeAction(async () => {
        const ok = await store.deleteTag(tag.value!.id);
        if (ok) router.push('/organize/tags');
    });
}
</script>

<style scoped>
.tag-detail {
    display: flex;
    flex-direction: column;
    gap: var(--gap-md);
    padding-top: var(--gap-sm);
}
.td-hdr {
    display: flex;
    align-items: center;
}
.td-back {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    text-decoration: none;
}
.td-back:hover {
    color: var(--color-text-primary);
}
.td-back:hover, .td-back:focus-visible {
    text-decoration: underline;
}

.td-summary {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-4);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background: var(--color-surface-1);
}
.td-summary-left {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex: 1;
    min-width: 0;
}
.td-key {
    display: flex;
    gap: var(--space-2);
    align-items: baseline;
}
.td-key-label {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
}
.td-key-val {
    font-family: var(--font-mono, monospace);
    font-size: var(--type-body);
    color: var(--color-text-secondary);
    background: var(--color-surface-2);
    padding: var(--space-0-5) var(--space-2);
    border-radius: var(--radius-sm);
}
.td-summary-actions {
    display: flex;
    gap: var(--space-2);
}

.td-info {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-4);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background: var(--color-surface-1);
}
.td-section-title {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-top: var(--space-2);
}
.td-section-title:first-child {
    margin-top: 0;
}
.td-name {
    font-size: var(--type-subheading);
    font-weight: 700;
    color: var(--color-text-primary);
}
.td-desc {
    font-size: var(--type-body);
    color: var(--color-text-secondary);
    max-width: 72ch;
}

.td-assignments {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background: var(--color-surface-1);
}
.td-assignment-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}
.td-assignment-group {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}
.td-assignment-label {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
}
.td-assignment-items {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
}
.td-assignment-item {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--type-body);
    padding: var(--space-0-5) var(--space-2);
    border: 1px solid var(--color-border-medium);
    border-radius: var(--radius-sm);
    background: var(--color-surface-2);
    color: var(--color-text-secondary);
    font-family: var(--font-mono, monospace);
}
.td-assignment-remove {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-4);
    height: var(--space-4);
    border: none;
    background: transparent;
    color: var(--color-text-tertiary);
    cursor: pointer;
    border-radius: var(--radius-full);
    font-size: var(--type-body);
}
.td-assignment-remove:hover {
    color: var(--color-danger-text);
}

.td-section-hdr {
    display: flex;
    align-items: center;
    justify-content: space-between;
}

.td-modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
}

.td-loading {
    display: flex;
    justify-content: center;
    padding: var(--space-6);
}

.td-delete-warn {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--color-status-warn);
    font-size: var(--type-body);
}
</style>
