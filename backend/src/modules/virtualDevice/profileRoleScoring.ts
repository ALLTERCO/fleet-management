// How well one source component fits one profile role. A pure rule with no
// repository or transport behind it, so both the matcher and the source lister
// can import it without dragging a dependency cycle along.

import type {VirtualDeviceProfileRole} from '../../types/api/virtualdevice';
import type {classifySourceComponent} from './sourceClassifier';

export interface CandidateScore {
    score: number;
    reasons: string[];
}

export function scoreCandidate(
    role: VirtualDeviceProfileRole,
    classification: ReturnType<typeof classifySourceComponent>
): CandidateScore {
    const reasons: string[] = [];
    let score = 0;
    const profileType = profileComponentType(role);

    if (profileType && profileType === classification.componentType) {
        score += 0.5;
        reasons.push('component type match');
    } else if (profileType && profileType === classification.rawComponentType) {
        score += 0.35;
        reasons.push('raw component type match');
    } else if (role.valueType === classification.roleValueType) {
        score += 0.25;
        reasons.push('value type match');
    } else {
        return {score: 0, reasons: []};
    }

    if (role.valueType === classification.roleValueType) {
        score += 0.15;
        if (!reasons.includes('value type match')) {
            reasons.push('value type match');
        }
    }

    if (role.writable === true && !classification.writable) {
        return {score: 0, reasons: []};
    }
    if (role.writable === true && classification.writable) {
        score += 0.1;
        reasons.push('writable compatible');
    }

    if (role.unit && classification.unit && role.unit === classification.unit) {
        score += 0.1;
        reasons.push('unit match');
    }

    if (
        role.label &&
        classification.label &&
        labelSimilarity(role.label, classification.label)
    ) {
        score += 0.05;
        reasons.push('label hint');
    }

    return {score: Math.min(score, 1), reasons};
}

function profileComponentType(role: VirtualDeviceProfileRole): string | null {
    const meta = role.metadata as
        | {componentType?: string; entityType?: string}
        | undefined;
    return meta?.componentType ?? meta?.entityType ?? null;
}

function labelSimilarity(a: string, b: string): boolean {
    const norm = (s: string) => s.trim().toLowerCase();
    const left = norm(a);
    const right = norm(b);
    return left === right || left.includes(right) || right.includes(left);
}
