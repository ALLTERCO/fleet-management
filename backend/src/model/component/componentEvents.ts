// Per-component event-descriptor lookup. Walks the FM component class
// (doc-grounded SoT) first, falls back to the per-device live catalog
// fetched from `Webhook.ListAllSupported`. Same shape as Matter cluster
// XML + openHAB thing-type XML: schema lives in code, device data is a
// validation/discovery signal.

import type {DeviceEventCatalog} from '../deviceEventCatalog';
import type {
    ComponentEventAttr,
    ComponentEventDescriptor
} from './componentEventTypes';

// Lazy to avoid a Commander → component-class import cycle. Commander
// pulls every concrete component, and every component extends the base
// Component module.
interface ComponentLookupTarget {
    events: ReadonlyArray<ComponentEventDescriptor>;
}
type GetComponentFn = (name: string) => ComponentLookupTarget | undefined;
let _getComponentFn: GetComponentFn | undefined;
let _commanderRequireFailed = false;
function getComponentLazy(): GetComponentFn | undefined {
    if (_getComponentFn || _commanderRequireFailed) return _getComponentFn;
    try {
        _getComponentFn = require('../../modules/Commander')
            .getComponent as GetComponentFn;
    } catch {
        // Mark failed so we don't re-throw on every hot-path lookup; the
        // fallback (device catalog) still works. A boot-window race that
        // resolves before Commander loads also lands here.
        _commanderRequireFailed = true;
    }
    return _getComponentFn;
}

export interface ResolvedEvent {
    descriptor: ComponentEventDescriptor;
    /** Where the descriptor came from. */
    source: 'component-class' | 'device-catalog';
}

export function componentTypeOf(componentKey: string): string {
    const colon = componentKey.indexOf(':');
    return colon === -1 ? componentKey : componentKey.slice(0, colon);
}

// Component-class lookup. Returns the doc-grounded descriptor declared
// by the FM component class for this component type, or undefined.
function findInComponentClass(
    componentKey: string,
    eventName: string
): ComponentEventDescriptor | undefined {
    const type = componentTypeOf(componentKey);
    if (!type) return undefined;
    const getComponent = getComponentLazy();
    if (!getComponent) return undefined;
    const instance = getComponent(type);
    if (!instance) return undefined;
    return instance.events.find((e) => e.event === eventName);
}

// Device-catalog lookup. Returns the entry the device declared via
// `Webhook.ListAllSupported`, normalized to ComponentEventDescriptor.
function findInDeviceCatalog(
    catalog: DeviceEventCatalog | undefined,
    componentKey: string,
    eventName: string
): ComponentEventDescriptor | undefined {
    if (!catalog) return undefined;
    const type = componentTypeOf(componentKey);
    if (!type) return undefined;
    const entry = catalog.byEventName
        .get(eventName)
        ?.find((d) => d.component === type);
    if (!entry) return undefined;
    return {
        event: entry.event,
        attrs: entry.attrs as ReadonlyArray<ComponentEventAttr>
    };
}

export function findComponentEvent(input: {
    componentKey: unknown;
    eventName: string;
    deviceCatalog: DeviceEventCatalog | undefined;
}): ResolvedEvent | undefined {
    const key =
        typeof input.componentKey === 'string' ? input.componentKey : '';
    if (!key) return undefined;
    const fromClass = findInComponentClass(key, input.eventName);
    if (fromClass) {
        return {descriptor: fromClass, source: 'component-class'};
    }
    const fromCatalog = findInDeviceCatalog(
        input.deviceCatalog,
        key,
        input.eventName
    );
    if (fromCatalog) {
        return {descriptor: fromCatalog, source: 'device-catalog'};
    }
    return undefined;
}
