// Methods the Node-RED service account may never run, whatever its token says.
// One home: the node catalog generator should import this list too, so the
// editor hides exactly what the server refuses. A future allowlist replaces
// this file, not its callers.

import type CommandSender from '../../model/CommandSender';
import RpcError from '../../rpc/RpcError';
import {isNodeRedServiceSender} from './serviceIdentity';

// Settings that move a device off Fleet Manager, open it to other networks,
// or reset its security. Ordinary control (Switch.Set, Shelly.Reboot) stays.
const DEVICE_CONNECTIVITY_WRITES = [
    'ble.setconfig',
    'bthome.device.setkey',
    'cloud.setconfig',
    'eth.setconfig',
    'matter.factoryreset',
    'matter.setconfig',
    'modbus.setconfig',
    'mqtt.setconfig',
    'shelly.resetwificonfig',
    'sys.restoresettings',
    'sys.setconfig',
    'sys.setdebugconfig',
    'wifi.savednetworks.delete',
    'wifi.setconfig',
    'ws.setconfig',
    'zigbee.setconfig'
] as const;

// A device script can call any local method, so writing or running one
// would bypass every other line here. Code can hold secrets, so no GetCode.
const DEVICE_SCRIPT_WRITES = [
    'script.create',
    'script.delete',
    'script.eval',
    'script.getcode',
    'script.putcode',
    'script.setconfig',
    'script.start',
    'script.stop'
] as const;

// Flows may send (channel.Test) but never change who gets told what.
const NOTIFICATION_SETUP_WRITES = [
    'channel.create',
    'channel.delete',
    'channel.resethealth',
    'channel.update',
    'notification.bundle.applyimport',
    'notification.destination.addmembers',
    'notification.destination.create',
    'notification.destination.delete',
    'notification.destination.removemembers',
    'notification.destination.update',
    'notification.emailasset.createuploadticket',
    'notification.emailasset.delete',
    'notification.emailtemplate.create',
    'notification.emailtemplate.delete',
    'notification.emailtemplate.update',
    'notification.oncall.delete',
    'notification.oncall.set',
    'notification.preference.set',
    'notification.routing.delete',
    'notification.routing.set',
    'notification.template.create',
    'notification.template.delete',
    'notification.template.update',
    'notification_policy.reset',
    'notification_policy.setpolicy'
] as const;

// Deeper wrapping than this is refused outright rather than walked.
const MAX_CALL_DEPTH = 4;

/** Lowercase; the dispatcher lowercases method names before routing. */
export const NODE_RED_SERVICE_DENYLIST = {
    // Whole areas that hand out access, touch raw data, or change device
    // secrets; an automation has no business in any of them.
    namespaces: [
        'admin',
        'assignment',
        'auth',
        'credential',
        'deviceingress',
        'domain_policy',
        'filetransfer',
        'identity',
        'ota',
        'permission',
        'persona',
        'plugin',
        'security',
        'user',
        'user_group'
    ],
    // Reads are fine; anything that changes these is not. Device webhooks
    // would let a flow point a device at any URL.
    readOnlyNamespaces: ['firmware', 'webhook'],
    methods: [
        'alexa.disable',
        'alexa.enable',
        'certificate.delete',
        'certificate.export',
        'certificate.import',
        'certificate.issuedevicecert',
        'certificate.pushtodevices',
        'certificate.signcsr',
        'notification.listtokens',
        'notification.oauth.start',
        'notification.subscribe',
        'policy.resetdefault',
        'policy.updatedefaults',
        'shelly.factoryreset',
        'shelly.resetauthcode',
        'shelly.setauth',
        'shelly.update',
        'system.bootstrap',
        'system.dbwrites.set',
        'system.log.setlevel',
        'system.observability.reset',
        'system.observability.set',
        'trv.updatefirmware',
        'waitingroom.quarantine',
        ...DEVICE_CONNECTIVITY_WRITES,
        ...DEVICE_SCRIPT_WRITES,
        ...NOTIFICATION_SETUP_WRITES
    ],
    methodPrefixes: ['shelly.put'],
    // These forward params.method to a device; the inner method is checked too.
    forwardingMethods: [
        'bluassist.call',
        'device.call',
        'device.callmany',
        'gattc.call',
        'trv.call'
    ],
    // These store calls[] the device runs later; each one is checked.
    storedCallMethods: ['schedule.create', 'schedule.update']
} as const;

const READ_PREFIXES = ['get', 'list', 'describe', 'check'];

function namespaceOf(method: string): string {
    const dot = method.indexOf('.');
    return dot < 0 ? method : method.slice(0, dot);
}

function isReadMethod(method: string): boolean {
    const submethod = method.slice(method.indexOf('.') + 1);
    return READ_PREFIXES.some((prefix) => submethod.startsWith(prefix));
}

function isDeniedName(method: string): boolean {
    const list = NODE_RED_SERVICE_DENYLIST;
    const namespace = namespaceOf(method);
    if ((list.namespaces as readonly string[]).includes(namespace)) {
        return true;
    }
    if ((list.methods as readonly string[]).includes(method)) return true;
    if (list.methodPrefixes.some((prefix) => method.startsWith(prefix))) {
        return true;
    }
    return (
        (list.readOnlyNamespaces as readonly string[]).includes(namespace) &&
        !isReadMethod(method)
    );
}

interface CallShape {
    method: string;
    params: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}

function callFrom(value: unknown): CallShape | undefined {
    const record = asRecord(value);
    const method = record?.method;
    if (typeof method !== 'string') return undefined;
    return {method, params: record?.params};
}

function forwardedCalls(params: unknown): CallShape[] {
    const inner = callFrom(params);
    return inner ? [inner] : [];
}

function storedCalls(params: unknown): CallShape[] {
    const calls = asRecord(params)?.calls;
    if (!Array.isArray(calls)) return [];
    return calls.map(callFrom).filter((call) => call !== undefined);
}

function includesMethod(list: readonly string[], method: string): boolean {
    return list.includes(method);
}

function nestedCalls(call: CallShape): CallShape[] {
    const method = call.method.trim().toLowerCase();
    const list = NODE_RED_SERVICE_DENYLIST;
    if (includesMethod(list.forwardingMethods, method)) {
        return forwardedCalls(call.params);
    }
    if (includesMethod(list.storedCallMethods, method)) {
        return storedCalls(call.params);
    }
    return [];
}

function isDeniedAtDepth(call: CallShape, depth: number): boolean {
    if (isDeniedName(call.method.trim().toLowerCase())) return true;
    const inner = nestedCalls(call);
    if (inner.length === 0) return false;
    if (depth >= MAX_CALL_DEPTH) return true;
    return inner.some((next) => isDeniedAtDepth(next, depth + 1));
}

/** True when the service account must not run this call, however wrapped. */
export function isDeniedForNodeRedService(call: CallShape): boolean {
    return isDeniedAtDepth(call, 0);
}

/** Refuses a denied call when the caller is the Node-RED service account. */
export function assertNodeRedServiceMayCall(
    sender: CommandSender,
    call: CallShape
): void {
    if (!isNodeRedServiceSender(sender)) return;
    if (!isDeniedForNodeRedService(call)) return;
    throw RpcError.Domain('PermissionDenied', {
        message: 'Node-RED automations may not call this method'
    });
}
