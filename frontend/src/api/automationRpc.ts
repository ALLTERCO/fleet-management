import type {
    HostParams,
    HostResult
} from '@/shell/template-host/generated/contract';
import {sendRPC} from '@/tools/websocket';

const FM = 'FLEET_MANAGER';

export type AutomationListResult = HostResult<'automation.list'>;
export type AutomationListItem = AutomationListResult['items'][number];
export type AutomationSetEnabledParams = HostParams<'automation.setenabled'>;
export type AutomationStatusResult = HostResult<'automation.getstatus'>;
export type AutomationActivityResult = HostResult<'automation.getactivity'>;
export type AutomationFlowActivity = AutomationActivityResult['items'][number];

export function listAutomations(): Promise<AutomationListResult> {
    return sendRPC(FM, 'automation.List', {includeDisabled: true});
}

export function setAutomationEnabled(
    input: AutomationSetEnabledParams
): Promise<HostResult<'automation.setenabled'>> {
    return sendRPC(FM, 'automation.SetEnabled', input);
}

export function getAutomationStatus(): Promise<AutomationStatusResult> {
    return sendRPC(FM, 'automation.GetStatus', {});
}

export function getAutomationActivity(
    flowId?: string
): Promise<AutomationActivityResult> {
    return sendRPC(FM, 'automation.GetActivity', flowId ? {flowId} : {});
}
