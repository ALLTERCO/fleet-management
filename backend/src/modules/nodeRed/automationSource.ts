// Which Node-RED flow and node made an RPC call.
//
// Every Node-RED call arrives as the one shared service user, so the audit
// trail could not tell flows apart. The nodes send these headers; the audit
// row carries them. AsyncLocalStorage because the row is written several
// layers below the HTTP handler that sees the headers.

import {AsyncLocalStorage} from 'node:async_hooks';
import type {user_t} from '../../types';
import {isNodeRedServiceUser} from './serviceIdentity';

export interface AutomationSource {
    flowId?: string;
    nodeId?: string;
    flowName?: string;
}

export const AUTOMATION_SOURCE_HEADERS = {
    flowId: 'x-fm-automation-flow-id',
    nodeId: 'x-fm-automation-node-id',
    flowName: 'x-fm-automation-flow-name'
} as const;

const ID_MAX = 64;
const NAME_MAX = 120;

type HeaderBag = Record<string, string | string[] | undefined>;

const storage = new AsyncLocalStorage<AutomationSource>();

function firstValue(value: string | string[] | undefined): string | undefined {
    return Array.isArray(value) ? value[0] : value;
}

function decoded(raw: string): string {
    try {
        return decodeURIComponent(raw);
    } catch {
        return raw;
    }
}

// Ids are Node-RED's own: letters, digits and a few separators.
function cleanId(raw: string | undefined): string | undefined {
    if (!raw) return undefined;
    const value = decoded(raw)
        .replace(/[^A-Za-z0-9._:-]/g, '')
        .slice(0, ID_MAX);
    return value || undefined;
}

// Names are free text; drop control characters so a log line stays one line.
function cleanName(raw: string | undefined): string | undefined {
    if (!raw) return undefined;
    const value = decoded(raw)
        // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point.
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .trim()
        .slice(0, NAME_MAX);
    return value || undefined;
}

/** Reads the three headers; undefined when none carries a usable value. */
export function readAutomationSource(
    headers: HeaderBag
): AutomationSource | undefined {
    const source: AutomationSource = {
        flowId: cleanId(firstValue(headers[AUTOMATION_SOURCE_HEADERS.flowId])),
        nodeId: cleanId(firstValue(headers[AUTOMATION_SOURCE_HEADERS.nodeId])),
        flowName: cleanName(
            firstValue(headers[AUTOMATION_SOURCE_HEADERS.flowName])
        )
    };
    const present = Object.entries(source).filter(([, v]) => v !== undefined);
    return present.length > 0 ? Object.fromEntries(present) : undefined;
}

/** Only the Node-RED service account may tag its calls; anyone else is ignored. */
export function automationSourceForCaller(caller: {
    user?: user_t;
    headers: HeaderBag;
}): AutomationSource | undefined {
    if (!isNodeRedServiceUser(caller.user)) return undefined;
    return readAutomationSource(caller.headers);
}

/** Runs `fn` with every audit row inside it tagged with `source`. */
export function withAutomationSource<T>(
    source: AutomationSource | undefined,
    fn: () => Promise<T>
): Promise<T> {
    return source ? storage.run(source, fn) : fn();
}

/** The current call's source, or undefined when Node-RED did not make it. */
export function currentAutomationSource(): AutomationSource | undefined {
    return storage.getStore();
}
