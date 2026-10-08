// Human-readable summaries for prepared writes plus a param check against
// the Describe schema, so a person approves a sentence, not raw JSON, and
// an invalid action never gets a token. One home per allowlisted method.

import {AUTOMATION_SUMMARY_BUILDERS} from './automationWriteSummary.js';
import {McpError} from './mcpErrors.js';

interface JsonSchema {
    required?: string[];
    properties?: Record<string, unknown>;
}

export interface WriteSummary {
    title: string;
    reversible: boolean;
    affected?: string;
    /** Short extra lines a human needs to judge the write. */
    details?: string[];
    /** True when this write changes what a customer is charged. */
    billingImpact?: boolean;
}

/**
 * What the write acts on, resolved by the caller before the summary is built.
 * A hex id tells an operator nothing: they cannot tell which site it is, what
 * it runs, or whether it is already offline.
 */
export interface WriteTarget {
    name?: string;
    location?: string;
    online?: boolean;
    /**
     * Every device a bulk action would touch. One prompt for many devices is
     * only safer than many prompts if the human can see the list.
     */
    devices?: {externalId: string; name?: string}[];
}

/**
 * Writes that change what a customer pays. Editing a tariff reads like editing
 * any other record right up until an invoice is wrong, so it is called out.
 *
 * Deliberately no estimated figure: projection in this codebase is documented
 * as unreliable, and a confidently wrong amount beside an approve button is
 * worse than an honest warning.
 */
const BILLING_METHODS = new Set([
    'tariff.add',
    'tariff.assign',
    'tariff.update',
    'tariff.delete',
    'tariff.setdefault',
    'bill.set',
    'bill.delete'
]);

export function changesBilling(method: string): boolean {
    return BILLING_METHODS.has(method.trim().toLowerCase());
}

function str(params: Record<string, unknown>, key: string): string {
    const v = params[key];
    return typeof v === 'string' ? v : String(v ?? '?');
}

// Per-method summary builders. Fall back to a generic sentence for any
// allowlisted method without a bespoke builder.
const BUILDERS: Record<
    string,
    (p: Record<string, unknown>, t?: WriteTarget) => WriteSummary
> = {
    'group.create': (p) => ({
        title: `Create group "${str(p, 'name')}".`,
        reversible: true
    }),
    'group.update': (p) => ({
        title: `Update group ${str(p, 'id')}.`,
        reversible: true,
        affected: `group ${str(p, 'id')}`
    }),
    'group.delete': (p) => ({
        title: `Delete group ${str(p, 'id')}. This removes the group.`,
        reversible: false,
        affected: `group ${str(p, 'id')}`
    }),
    'tag.create': (p) => ({
        title: `Create tag "${str(p, 'name')}".`,
        reversible: true
    }),
    'tag.delete': (p) => ({
        title: `Delete tag ${str(p, 'id')}.`,
        reversible: false,
        affected: `tag ${str(p, 'id')}`
    }),
    'location.create': (p) => ({
        title: `Create location "${str(p, 'name')}".`,
        reversible: true
    }),
    'dashboard.create': (p) => ({
        title: `Create dashboard "${str(p, 'name')}".`,
        reversible: true
    }),
    'alert.rule.create': () => ({
        title: 'Create an alert rule. It may trigger notifications.',
        reversible: true
    }),
    // The physical-effect families. These are the ones a generic sentence
    // fails hardest: "FactoryReset on matter.FactoryReset." told an operator
    // nothing about what was at stake.
    'matter.factoryreset': (p, t) => ({
        title: `Factory reset ${device(p, t)}. It loses its configuration and pairing, and must be set up again on site.`,
        reversible: false,
        affected: device(p, t)
    }),
    'ota.update': (p, t) => ({
        title: `Install firmware on ${device(p, t)}. It reboots and is offline while it updates.`,
        reversible: false,
        affected: device(p, t)
    }),
    'shelly.update': (p, t) => ({
        title: `Install firmware on ${device(p, t)}. It reboots and is offline while it updates.`,
        reversible: false,
        affected: device(p, t)
    }),
    'device.replacehardware': (p, t) => ({
        title: `Move this device's identity and history onto replacement hardware ${device(p, t)}.`,
        reversible: false,
        affected: device(p, t)
    }),
    'em1.reverttofactorycalibration': (p, t) => ({
        title: `Revert ${device(p, t)} to factory calibration. Any calibration done on site is lost.`,
        reversible: false,
        affected: device(p, t)
    }),
    ...AUTOMATION_SUMMARY_BUILDERS
};

// Destructive in the catalog because they change the world, but plainly
// undoable by doing the opposite. Without this every relay toggle would warn
// "this cannot be undone", and a warning on everything is a warning on
// nothing.
const REVERSIBLE_DESPITE_DESTRUCTIVE = new Set([
    'switch.set',
    'switch.toggle',
    'light.set',
    'light.toggle',
    'cover.gotoposition',
    'boolean.set',
    'number.set',
    'text.set',
    'enum.set'
]);

/** The device list, named, with an honest tail when it is long. */
function deviceList(target: WriteTarget): string {
    const devices = target.devices ?? [];
    const shown = devices.slice(0, 8).map((d) => d.name || d.externalId);
    const rest = devices.length - shown.length;
    const tail = rest > 0 ? ` and ${rest} more` : '';
    return `${devices.length} devices: ${shown.join(', ')}${tail}`;
}

/**
 * What this write acts on, in words, or null when the params name nothing
 * recognisable — in which case the method name is the most honest thing left.
 */
function describeSubject(
    params: Record<string, unknown>,
    target?: WriteTarget
): string | null {
    if (target?.devices && target.devices.length > 0) {
        return deviceList(target);
    }
    if (Array.isArray(params.shellyIDs)) {
        return `${(params.shellyIDs as unknown[]).length} devices`;
    }
    const id = params.shellyID ?? params.deviceExternalId;
    if (id === undefined || id === null) return null;
    return device(params, target);
}

function device(params: Record<string, unknown>, target?: WriteTarget): string {
    const id = params.shellyID ?? params.deviceExternalId ?? params.id;
    const idText = id === undefined || id === null ? 'this device' : String(id);
    if (!target?.name) return idText;
    // Name, then where it is, then the id — an operator checks the first two
    // and pastes the third.
    const where = target.location ? `, ${target.location}` : '';
    const state = target.online === false ? ', currently offline' : '';
    return `${target.name}${where} (${idText})${state}`;
}

/**
 * `safety` comes from the catalog entry, which already records whether a
 * method is destructive — so reversibility is derived from the one place that
 * knows, not guessed from the method name. Omitted only by callers that have
 * no entry to hand, where the safe reading is "assume it cannot be undone".
 */
export function buildWriteSummary(
    method: string,
    params: Record<string, unknown>,
    safety?: {destructiveHint: boolean},
    target?: WriteTarget
): WriteSummary {
    const id = method.toLowerCase();
    const billing = changesBilling(id);
    const build = BUILDERS[id];
    // The generic sentence must still say WHAT it acts on. "Set on switch.Set"
    // told an operator nothing, and it is the sentence most methods get.
    const subject = describeSubject(params, target);
    const base = build
        ? build(params, target)
        : {
              title: `${method.split('.').pop() ?? method} on ${subject ?? method}.`,
              reversible:
                  REVERSIBLE_DESPITE_DESTRUCTIVE.has(id) ||
                  safety?.destructiveHint === false
          };
    if (!billing) return base;
    // Said in words, not just a flag: the operator reads the sentence, and a
    // flag they never see protects nobody.
    return {
        ...base,
        billingImpact: true,
        title: `${base.title} This changes what customers are charged; check it against the contract before approving.`
    };
}

/**
 * A bulk call names its devices in `shellyIDs`, and that IS the device
 * selector — the inner method's singular `shellyID` is satisfied by the list.
 *
 * Stated here because this is where the inner method's own schema is checked.
 * Without it, device.CallMany was validated against the single-device schema
 * and every bulk write was refused for a missing `shellyID` it was never going
 * to have.
 */
const DEVICE_SELECTOR_EQUIVALENTS: Readonly<Record<string, string>> = {
    shellyID: 'shellyIDs'
};

// Reject before a token is issued when a required Describe param is absent.
export function assertParamsValid(
    method: string,
    params: Record<string, unknown>,
    schema: unknown
): void {
    const s = schema as JsonSchema | undefined;
    for (const key of s?.required ?? []) {
        const plural = DEVICE_SELECTOR_EQUIVALENTS[key];
        if (plural && Array.isArray(params[plural])) continue;
        if (params[key] === undefined) {
            throw new McpError(
                'invalid_params',
                `${method} requires "${key}"`,
                {tool: 'fm_write', method}
            );
        }
    }
}
