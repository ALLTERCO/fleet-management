// Action V2 webhook config; signing keys are runtime-mutable (see runtimeKeys.ts).

import {envInt} from '../../config/envReader';
import {getGdprKeys, getGrantKeys} from './runtimeKeys';

export async function zitadelGrantSigningKey(): Promise<string> {
    return (await getGrantKeys()).current;
}

export async function zitadelGrantSigningKeyPrevious(): Promise<string> {
    return (await getGrantKeys()).previous;
}

export async function zitadelGdprSigningKey(): Promise<string> {
    return (await getGdprKeys()).current;
}

export async function zitadelGdprSigningKeyPrevious(): Promise<string> {
    return (await getGdprKeys()).previous;
}

// Replay window applied to both targets.
export function zitadelActionReplaySkewMs(): number {
    return envInt('FM_ZITADEL_ACTION_REPLAY_SKEW_MS', 5 * 60 * 1000);
}

// Non-empty keys ordered current → previous for rotation overlap.
export function activeKeys(current: string, previous: string): string[] {
    const out: string[] = [];
    if (current.length > 0) out.push(current);
    if (previous.length > 0 && previous !== current) out.push(previous);
    return out;
}
