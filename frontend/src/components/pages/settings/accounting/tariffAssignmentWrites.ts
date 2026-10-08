// Both writes this panel makes. tariff.Assign upserts an assignment, and the
// same method removes one when the request carries delete.

import {sendRPC} from '@/tools/websocket';
import {
    type Assignment,
    type AssignmentTarget,
    assignRequest,
    removalRequest
} from './tariffAssignmentView';

export async function saveAssignment(target: AssignmentTarget): Promise<void> {
    await sendRPC('FLEET_MANAGER', 'tariff.assign', assignRequest(target));
}

export async function removeAssignment(row: Assignment): Promise<void> {
    await sendRPC('FLEET_MANAGER', 'tariff.assign', removalRequest(row));
}
