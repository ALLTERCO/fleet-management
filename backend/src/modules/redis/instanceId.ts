// Stable per-process identifier — distinguishes our own pubsub messages.
import {randomUUID} from 'node:crypto';

const id = randomUUID();

export function getInstanceId(): string {
    return id;
}
