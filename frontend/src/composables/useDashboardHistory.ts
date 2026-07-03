import {computed, ref} from 'vue';

interface HistoryEntry {
    type: 'move' | 'resize' | 'delete' | 'add';
    undo: () => void;
    redo: () => void;
    label: string;
}

export function useDashboardHistory() {
    const undoStack = ref<HistoryEntry[]>([]);
    const redoStack = ref<HistoryEntry[]>([]);

    function execute(entry: HistoryEntry) {
        entry.redo();
        undoStack.value.push(entry);
        redoStack.value = [];
    }

    function undo() {
        const entry = undoStack.value.pop();
        if (!entry) return;
        entry.undo();
        redoStack.value.push(entry);
    }

    function redo() {
        const entry = redoStack.value.pop();
        if (!entry) return;
        entry.redo();
        undoStack.value.push(entry);
    }

    function clear() {
        undoStack.value = [];
        redoStack.value = [];
    }

    const canUndo = computed(() => undoStack.value.length > 0);
    const canRedo = computed(() => redoStack.value.length > 0);

    return {execute, undo, redo, clear, canUndo, canRedo};
}
