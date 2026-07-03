import {localClock} from './localClock';
import {readObjects} from './rowReaders';

export interface OnCallSchedule {
    id: string | number;
    timezone: string;
    rotationRules: unknown[];
    overrides?: unknown[];
    target?: unknown;
}

export interface OnCallResolution {
    scheduleId: string;
    userIds: string[];
    source: 'override' | 'rotation' | 'target' | 'empty';
}

export function resolveOnCallSchedule(input: {
    schedule: OnCallSchedule;
    at: Date;
}): OnCallResolution {
    const scheduleId = String(input.schedule.id);
    const overrideUsers = resolveOverride(input.schedule.overrides, input.at);
    if (overrideUsers.length > 0) {
        return {scheduleId, userIds: overrideUsers, source: 'override'};
    }

    const rotationUsers = resolveRotation({
        rules: input.schedule.rotationRules,
        at: input.at,
        timezone: input.schedule.timezone
    });
    if (rotationUsers.length > 0) {
        return {scheduleId, userIds: rotationUsers, source: 'rotation'};
    }

    const targetUsers = readUserIds(input.schedule.target);
    if (targetUsers.length > 0) {
        return {scheduleId, userIds: targetUsers, source: 'target'};
    }

    return {scheduleId, userIds: [], source: 'empty'};
}

function resolveOverride(overrides: unknown, at: Date): string[] {
    return readObjects(overrides).flatMap((override) => {
        const start = readDate(override.start ?? override.startsAt);
        const end = readDate(override.end ?? override.endsAt);
        if (!start || !end) return [];
        if (at < start || at >= end) return [];
        return readUserIds(override);
    });
}

function resolveRotation(input: {
    rules: unknown[];
    at: Date;
    timezone: string;
}): string[] {
    for (const rule of readObjects(input.rules)) {
        const users = readUserIds(rule);
        if (users.length === 0) continue;
        const active = activeUserForRule({
            rule,
            users,
            at: input.at,
            timezone: input.timezone
        });
        if (active) return [active];
    }
    return [];
}

function activeUserForRule(input: {
    rule: Record<string, unknown>;
    users: string[];
    at: Date;
    timezone: string;
}): string | null {
    const startsAt = readDate(input.rule.startsAt ?? input.rule.start);
    if (!startsAt || input.at < startsAt) return null;
    const stepHours = readPositiveNumber(input.rule.stepHours) ?? 24;
    const elapsedMs = input.at.getTime() - startsAt.getTime();
    const stepMs = stepHours * 60 * 60 * 1000;
    const dayEpoch = (at: Date): number =>
        localClock(at, input.timezone || 'UTC')?.dayEpoch ?? 0;
    const offset = dayEpoch(input.at) - dayEpoch(startsAt);
    const index =
        stepHours === 24 ? Math.floor(offset) : Math.floor(elapsedMs / stepMs);
    return input.users[index % input.users.length] ?? null;
}

function readUserIds(value: unknown): string[] {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const record = value as Record<string, unknown>;
    const raw = record.userIds ?? record.users;
    if (!Array.isArray(raw)) return [];
    return raw
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter(Boolean);
}

function readDate(value: unknown): Date | null {
    if (value instanceof Date && Number.isFinite(value.getTime())) return value;
    if (typeof value !== 'string') return null;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed) : null;
}

function readPositiveNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) && value > 0
        ? value
        : null;
}
