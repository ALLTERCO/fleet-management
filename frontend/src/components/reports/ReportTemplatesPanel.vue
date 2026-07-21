<template>
    <div class="rt-panel">
        <div class="rt-panel__head">
            <span class="rt-panel__title">Report templates</span>
            <span class="rt-panel__sub">Saved report configurations you can re-run.</span>
        </div>

        <div v-if="loading" class="rt-empty">Loading…</div>
        <div v-else-if="templates.length === 0" class="rt-empty">
            No saved templates yet. Save a report configuration to re-run it later.
        </div>

        <ul v-else class="rt-list">
            <li v-for="t in templates" :key="t.id" class="rt-row">
                <div class="rt-row__main">
                    <input
                        v-if="editingId === t.id"
                        v-model.trim="editName"
                        class="rt-row__edit"
                        :aria-label="`Rename ${t.name}`"
                        @keyup.enter="commitRename(t)"
                        @keyup.esc="editingId = null"
                    />
                    <span v-else class="rt-row__name">{{ t.name }}</span>
                    <span class="rt-row__kind">{{ t.kind }}</span>
                </div>
                <div class="rt-row__actions">
                    <button
                        type="button"
                        class="rt-btn rt-btn--primary"
                        :disabled="busyId === t.id"
                        title="Run and download"
                        @click="run(t)"
                    >
                        <i
                            class="fas"
                            :class="busyId === t.id ? 'fa-spinner fa-spin' : 'fa-play'"
                        />
                        Run
                    </button>
                    <button
                        v-if="editingId === t.id"
                        type="button"
                        class="rt-btn"
                        @click="commitRename(t)"
                    >
                        Save
                    </button>
                    <button
                        v-else
                        type="button"
                        class="rt-btn"
                        @click="startRename(t)"
                    >
                        Rename
                    </button>
                    <button
                        v-if="t.kind === 'energy'"
                        type="button"
                        class="rt-btn"
                        :class="{'rt-btn--on': sectionEditId === t.id}"
                        @click="
                            sectionEditId === t.id
                                ? (sectionEditId = null)
                                : startSectionEdit(t)
                        "
                    >
                        Sections
                    </button>
                    <button
                        type="button"
                        class="rt-btn rt-btn--danger"
                        :disabled="busyId === t.id"
                        @click="remove(t)"
                    >
                        Delete
                    </button>
                </div>
                <div v-if="sectionEditId === t.id" class="rt-sections">
                    <span class="rt-sections__hint">
                        Role-gated sections to include. All (or none) selected =
                        no restriction.
                    </span>
                    <div class="rt-sections__choices">
                        <label
                            v-for="s in REPORT_SECTIONS"
                            :key="s.id"
                            class="rt-check"
                        >
                            <input
                                type="checkbox"
                                :checked="sectionDraft.has(s.id)"
                                @change="toggleSection(s.id)"
                            />
                            {{ s.label }}
                        </label>
                    </div>
                    <div class="rt-sections__actions">
                        <button
                            type="button"
                            class="rt-btn rt-btn--primary"
                            :disabled="busyId === t.id"
                            @click="applySections(t)"
                        >
                            Apply
                        </button>
                        <button
                            type="button"
                            class="rt-btn"
                            @click="sectionEditId = null"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            </li>
        </ul>
    </div>
</template>

<script setup lang="ts">
import {onMounted, ref} from 'vue';
import {
    deleteReportTemplate,
    downloadReportFile,
    listReportTemplates,
    REPORT_SECTIONS,
    type ReportTemplate,
    runReportTemplate,
    updateReportTemplate
} from '@/api/reportTemplateRpc';
import {useToastStore} from '@/stores/toast';

const toast = useToastStore();
const templates = ref<ReportTemplate[]>([]);
const loading = ref(true);
const busyId = ref<string | null>(null);
const editingId = ref<string | null>(null);
const editName = ref('');
const sectionEditId = ref<string | null>(null);
const sectionDraft = ref<Set<string>>(new Set());

function startSectionEdit(t: ReportTemplate) {
    sectionEditId.value = t.id;
    const all = REPORT_SECTIONS.map((s) => s.id);
    sectionDraft.value = new Set(t.sectionsEnabled ?? all);
}

function toggleSection(id: string) {
    const draft = sectionDraft.value;
    if (draft.has(id)) draft.delete(id);
    else draft.add(id);
}

async function applySections(t: ReportTemplate) {
    if (busyId.value) return;
    const selected = [...sectionDraft.value];
    // All or none selected = no restriction; store null so it stays clean.
    const sectionsEnabled =
        selected.length === 0 || selected.length === REPORT_SECTIONS.length
            ? null
            : selected;
    busyId.value = t.id;
    try {
        const updated = await updateReportTemplate({id: t.id, sectionsEnabled});
        t.sectionsEnabled = updated.sectionsEnabled;
        sectionEditId.value = null;
        toast.success('Sections updated');
    } catch (err: any) {
        toast.error(err?.message ?? 'Could not update sections');
    } finally {
        busyId.value = null;
    }
}

async function load() {
    loading.value = true;
    try {
        templates.value = (await listReportTemplates()).templates;
    } catch (err) {
        console.error('Failed to load report templates', err);
        toast.error('Could not load report templates');
    } finally {
        loading.value = false;
    }
}

async function run(t: ReportTemplate) {
    if (busyId.value) return;
    busyId.value = t.id;
    try {
        await downloadReportFile(await runReportTemplate(t.id, t.name));
        toast.success(`Ran '${t.name}'`);
    } catch (err: any) {
        toast.error(err?.message ?? 'Run failed');
    } finally {
        busyId.value = null;
    }
}

function startRename(t: ReportTemplate) {
    editingId.value = t.id;
    editName.value = t.name;
}

async function commitRename(t: ReportTemplate) {
    const name = editName.value.trim();
    editingId.value = null;
    if (!name || name === t.name) return;
    try {
        const updated = await updateReportTemplate({id: t.id, name});
        t.name = updated.name;
        toast.success('Renamed');
    } catch (err: any) {
        toast.error(err?.message ?? 'Rename failed');
    }
}

async function remove(t: ReportTemplate) {
    if (busyId.value) return;
    if (!window.confirm(`Delete report template '${t.name}'?`)) return;
    busyId.value = t.id;
    try {
        await deleteReportTemplate(t.id);
        templates.value = templates.value.filter((x) => x.id !== t.id);
    } catch (err: any) {
        toast.error(err?.message ?? 'Delete failed');
    } finally {
        busyId.value = null;
    }
}

onMounted(load);
defineExpose({load});
</script>

<style scoped>
.rt-panel {
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background-color: var(--color-surface-1);
    overflow: hidden;
}
.rt-panel__head {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    padding: var(--gap-sm);
    border-bottom: 1px solid var(--color-border-default);
    background-color: var(--color-surface-2);
}
.rt-panel__title {
    font-size: var(--type-body);
    font-weight: 700;
    color: var(--color-text-primary);
}
.rt-panel__sub {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}
.rt-empty {
    padding: var(--gap-md);
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
}
.rt-list {
    list-style: none;
    margin: 0;
    padding: 0;
}
.rt-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--gap-sm);
    padding: var(--gap-xs) var(--gap-sm);
    border-bottom: 1px solid var(--color-border-default);
}
.rt-row:last-child {
    border-bottom: none;
}
.rt-row__main {
    display: flex;
    align-items: center;
    gap: var(--gap-xs);
    min-width: 0;
}
.rt-row__name {
    font-size: var(--type-body);
    color: var(--color-text-primary);
    font-weight: 600;
}
.rt-row__edit {
    min-height: var(--touch-target-min);
    padding: var(--gap-xs) var(--gap-sm);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-default);
    background: var(--color-surface-2);
    color: var(--color-text-primary);
    font-size: var(--type-body);
}
.rt-row__kind {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
}
.rt-row__actions {
    display: flex;
    gap: var(--gap-xs);
    flex-shrink: 0;
}
.rt-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--gap-xs);
    min-height: var(--touch-target-min);
    padding: var(--gap-xs) var(--gap-sm);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-default);
    background: transparent;
    color: var(--color-text-secondary);
    font-size: var(--type-body);
    font-family: inherit;
    cursor: pointer;
}
.rt-btn:hover:not(:disabled) {
    background: var(--color-surface-3);
    color: var(--color-text-primary);
}
.rt-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}
.rt-btn--on {
    background: var(--color-surface-3);
    color: var(--color-text-primary);
    border-color: var(--color-primary);
}
.rt-sections {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: var(--gap-xs);
    padding: var(--gap-sm) 0 var(--space-0-5);
}
.rt-sections__hint {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}
.rt-sections__choices {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gap-sm);
}
.rt-check {
    display: inline-flex;
    align-items: center;
    gap: var(--gap-xs);
    font-size: var(--type-body);
    color: var(--color-text-secondary);
    cursor: pointer;
}
.rt-sections__actions {
    display: flex;
    gap: var(--gap-xs);
}
.rt-btn--primary {
    background: var(--color-primary);
    border-color: var(--color-primary);
    color: var(--color-text-on-primary);
    font-weight: 600;
}
.rt-btn--primary:hover:not(:disabled) {
    background: var(--color-primary-hover);
    color: var(--color-text-on-primary);
}
.rt-btn--danger:hover:not(:disabled) {
    background: color-mix(in srgb, var(--color-danger) 14%, transparent);
    color: var(--color-danger);
    border-color: var(--color-danger);
}
</style>
