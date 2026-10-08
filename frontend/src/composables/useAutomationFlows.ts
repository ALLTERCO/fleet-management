import {type Ref, ref} from 'vue';
import {
    type AutomationActivityResult,
    type AutomationListItem,
    type AutomationListResult,
    getAutomationActivity,
    listAutomations,
    setAutomationEnabled
} from '@/api/automationRpc';
import {
    type FlowActivityByFlowId,
    indexFlowActivity
} from '@/helpers/automationActivity';
import {
    automationErrorText,
    isWrongOrganizationError
} from '@/helpers/nodeRedAccess';
import {createStaleGuard} from '@/stores/staleGuard';

export interface FlowRow {
    id: string;
    label: string;
    enabled: boolean;
    nodeCount: number;
    usesFleetManager: boolean;
    /** Devices its Fleet Manager nodes name directly. */
    deviceIds: string[];
    /** True while an on/off change waits for the server. */
    saving: boolean;
}

export interface FlowListProblem {
    message: string;
    canRetry: boolean;
}

export interface AutomationFlows {
    flows: Ref<FlowRow[]>;
    loading: Ref<boolean>;
    loadError: Ref<FlowListProblem | null>;
    unavailableNote: Ref<string | null>;
    activity: Ref<FlowActivityByFlowId>;
    activitySupported: Ref<boolean>;
    load: () => Promise<void>;
    setEnabled: (flowId: string, enabled: boolean) => Promise<string | null>;
}

/**
 * The Node-RED flow list, with on/off switching and per-flow activity.
 * Call only for users who hold automation:update.
 */
export function useAutomationFlows(): AutomationFlows {
    const flows = ref<FlowRow[]>([]);
    const loading = ref(false);
    const loadError = ref<FlowListProblem | null>(null);
    const unavailableNote = ref<string | null>(null);
    const activity = ref<FlowActivityByFlowId>(new Map());
    const activitySupported = ref(true);
    const guard = createStaleGuard();

    async function load(): Promise<void> {
        const token = guard.bump();
        loading.value = true;
        loadError.value = null;
        const [list, recent] = await Promise.allSettled([
            listAutomations(),
            getAutomationActivity()
        ]);
        if (guard.isStale(token)) return;
        applyList(list);
        applyActivity(recent);
        loading.value = false;
    }

    function applyList(list: PromiseSettledResult<AutomationListResult>): void {
        if (list.status === 'rejected') {
            loadError.value = listProblem(list.reason);
            return;
        }
        unavailableNote.value = list.value.available
            ? null
            : (list.value.note ?? 'Node-RED is not available right now.');
        flows.value = list.value.items.map(toFlowRow);
    }

    function applyActivity(
        recent: PromiseSettledResult<AutomationActivityResult>
    ): void {
        if (recent.status === 'fulfilled') {
            activitySupported.value = true;
            activity.value = indexFlowActivity(recent.value);
            return;
        }
        activitySupported.value = false;
        activity.value = new Map();
        console.warn('[automations] activity load failed', recent.reason);
    }

    async function setEnabled(
        flowId: string,
        enabled: boolean
    ): Promise<string | null> {
        const row = flows.value.find((flow) => flow.id === flowId);
        if (!row || row.saving) return null;
        const previous = row.enabled;
        row.enabled = enabled;
        row.saving = true;
        const failure = await sendEnabled(flowId, enabled);
        row.saving = false;
        if (failure) row.enabled = previous;
        return failure;
    }

    return {
        flows,
        loading,
        loadError,
        unavailableNote,
        activity,
        activitySupported,
        load,
        setEnabled
    };
}

function toFlowRow(item: AutomationListItem): FlowRow {
    return {
        id: item.id,
        label: item.label,
        enabled: !item.disabled,
        nodeCount: item.nodeCount,
        usesFleetManager: item.usesFleetManager,
        deviceIds: item.deviceIds,
        saving: false
    };
}

function listProblem(err: unknown): FlowListProblem {
    return {
        message: automationErrorText(err, 'Could not load the Node-RED flows.'),
        canRetry: !isWrongOrganizationError(err)
    };
}

/** Error text when the switch failed, null when the server accepted it. */
async function sendEnabled(
    flowId: string,
    enabled: boolean
): Promise<string | null> {
    try {
        await setAutomationEnabled({flowId, enabled});
        return null;
    } catch (err) {
        return automationErrorText(
            err,
            `Could not turn the flow ${enabled ? 'on' : 'off'}.`
        );
    }
}
