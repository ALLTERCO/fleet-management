import {getLogger} from 'log4js';
import type AbstractDevice from '../model/AbstractDevice';
import type CommandSender from '../model/CommandSender';
import * as Commander from '../modules/Commander';
import type {event_data_t, json_rpc_event} from '../types';
import * as Observability from './Observability';
import {PluginNotifier} from './plugins';

type split_rule_t = [string, string]; // [core, component]
type options_t = {
    allow: split_rule_t[];
    deny: split_rule_t[];
    shellyIDs: Set<string>;
};

let next_callback_id = 1;
const callback_ids = new Map<
    number,
    [CommandSender, options_t, event_callback_t]
>();
const event_map = new Map<string, number[]>(); // < EventName, Array of callback ids>
const sender_callbacks = new Map<CommandSender, Set<number>>(); // inverse index for fast removeAllForSender
/**
 * Type Aliases:
 * Aliasing doesn’t actually create a new type - it creates a new name to refer to that type.
 * Aliasing a primitive is not terribly useful, though it can be used as a form of documentation.
 */
type callback_id = number; // type alias
type event_callback_t = <T extends json_rpc_event>(
    event: T,
    eventData: event_data_t
) => void;

const logger = getLogger('event-model');

let broadcastMaxMs = 0;
let broadcastLastMs = 0;
let lastSerializeMs = 0;
let serializeMaxMs = 0;

const GROUP_CACHE_TTL = 86_400_000; // 24 hours (safety fallback — primary invalidation is event-based)
const groupMetadataCache = new Map<string, {groups: any; expiresAt: number}>();

let groupVersion = 0;
export function getGroupVersion() {
    return groupVersion;
}

function splitRule(rule: string): split_rule_t {
    const idx = rule.indexOf(':');
    if (idx === -1) return [rule, '*'];
    return [rule.substring(0, idx), rule.substring(idx + 1)];
}

function splitRules(rules: string[] | undefined): split_rule_t[] {
    if (!rules || !Array.isArray(rules)) return [];
    return rules.map(splitRule);
}

export function addEventListener(
    sender: CommandSender,
    eventName: string,
    options: {allow?: string[]; deny?: string[]; shellyIDs?: string[]},
    cb: event_callback_t
): callback_id {
    const callback_id = next_callback_id;
    // Pre-split rules once at subscribe time (avoids string splits on every event)
    const preSplit: options_t = {
        allow: splitRules(options?.allow),
        deny: splitRules(options?.deny),
        shellyIDs: new Set(options?.shellyIDs || [])
    };
    callback_ids.set(callback_id, [sender, preSplit, cb]);
    const listeners = event_map.get(eventName) || [];
    listeners.push(callback_id);
    event_map.set(eventName, listeners);
    // Track sender → callback_id for fast removeAllForSender
    let senderSet = sender_callbacks.get(sender);
    if (!senderSet) {
        senderSet = new Set();
        sender_callbacks.set(sender, senderSet);
    }
    senderSet.add(callback_id);
    next_callback_id++;
    return callback_id;
}

export function removeEventListener(
    callback_id: callback_id,
    eventName: string
) {
    const bundle = callback_ids.get(callback_id);
    if (bundle) {
        const [sender] = bundle;
        callback_ids.delete(callback_id);
        const senderSet = sender_callbacks.get(sender);
        if (senderSet) {
            senderSet.delete(callback_id);
            if (senderSet.size === 0) sender_callbacks.delete(sender);
        }
    }
    if (!event_map.has(eventName)) return;
    const listeners = event_map.get(eventName) || [];
    const index = listeners.indexOf(callback_id);
    if (index > -1) {
        listeners.splice(index, 1);
    }
    if (listeners.length === 0) {
        event_map.delete(eventName);
    }
}

export function removeAllForSender(sender: CommandSender) {
    const senderSet = sender_callbacks.get(sender);
    if (!senderSet || senderSet.size === 0) {
        sender_callbacks.delete(sender);
        return;
    }
    for (const id of senderSet) {
        callback_ids.delete(id);
    }
    for (const [eventName, listenerIds] of event_map) {
        const remaining = listenerIds.filter((id) => !senderSet.has(id));
        if (remaining.length === 0) {
            event_map.delete(eventName);
        } else {
            event_map.set(eventName, remaining);
        }
    }
    sender_callbacks.delete(sender);
}

export async function processAndNotifyAll(
    event: json_rpc_event,
    eventData: event_data_t = {}
) {
    const device = eventData?.device;

    // just send non-device events
    if (!device) {
        return await notifyAll(event, eventData);
    }

    // Skip expensive metadata generation if no listeners
    // (plugins still get notified via notifyAll → PluginNotifier.notifyEvent)
    if (!event_map.has(event.method)) {
        return await notifyAll(event, eventData);
    }

    // send to metadata preprocessor
    try {
        // Add base metadata
        event.params.metadata = await generateMetadata(eventData.device!);
        // Only send to plugin workers if any plugin has metadata handlers
        if (PluginNotifier.hasMetadataHandlers()) {
            const new_event = await PluginNotifier.sendForMetadata(
                event,
                eventData
            );
            return await notifyAll(new_event, eventData);
        }
        return await notifyAll(event, eventData);
    } catch (err) {
        logger.error('failed to generate metadata err:[%s]', String(err));
        return await notifyAll(event, eventData);
    }
}

async function generateMetadata(device: AbstractDevice) {
    const shellyID = device.shellyID;

    // Use cached groups if available
    const cached = groupMetadataCache.get(shellyID);
    let groups: any;
    if (cached && cached.expiresAt > Date.now()) {
        groups = cached.groups;
    } else {
        groups = await Commander.execInternal('Group.Find', {
            shellyID
        });
        groupMetadataCache.set(shellyID, {
            groups,
            expiresAt: Date.now() + GROUP_CACHE_TTL
        });
    }

    return {
        ...device.meta,
        groups
    };
}

export function invalidateGroupCache(shellyID?: string) {
    groupVersion++;
    if (shellyID) {
        groupMetadataCache.delete(shellyID);
    } else {
        groupMetadataCache.clear();
    }
}

function matchesSplitRule(
    reasonCore: string,
    reasonComp: string,
    rule: split_rule_t
) {
    const ruleCore = rule[0];
    const ruleComp = rule[1];

    if (ruleCore === '*') {
        return ruleComp === '*' || reasonComp === ruleComp;
    }

    if (ruleComp === '*') {
        return reasonCore === ruleCore;
    }

    return reasonCore === ruleCore && reasonComp === ruleComp;
}

export async function notifyAll(
    event: json_rpc_event,
    eventData: event_data_t
) {
    const broadcastT0 = performance.now();
    Observability.incrementCounter('events_broadcast');
    const eventName = event.method;
    if (eventName !== 'Console.Log') {
        PluginNotifier.notifyEvent(event, eventData);
    }

    if (!event_map.has(eventName)) {
        const broadcastElapsed = performance.now() - broadcastT0;
        broadcastLastMs = broadcastElapsed;
        if (broadcastElapsed > broadcastMaxMs)
            broadcastMaxMs = broadcastElapsed;
        if (Observability.getLevel() >= 2) {
            Observability.recordRpcTiming(
                `event:${eventName}`,
                broadcastElapsed
            );
        }
        return; // No listeners — skip debug log to avoid event loop pressure during connection storms
    }
    // Pre-serialize once — all listeners get the same string (avoids N×JSON.stringify)
    const serT0 = performance.now();
    eventData.serialized = JSON.stringify(event);
    lastSerializeMs = performance.now() - serT0;
    if (lastSerializeMs > serializeMaxMs) serializeMaxMs = lastSerializeMs;

    // Pre-split reasons once before the listener loop
    const {reason, device} = eventData;
    let splitReasons: split_rule_t[] | undefined;
    if (reason !== undefined) {
        const reasonArr = Array.isArray(reason)
            ? reason
            : typeof reason === 'string'
              ? [reason]
              : [];
        if (reasonArr.length > 0) {
            splitReasons = reasonArr.map(splitRule);
        }
    }

    const active_listeners: number[] = [];
    const listener_ids = event_map.get(eventName) || [];
    for (const callback_id of listener_ids) {
        if (callback_ids.has(callback_id)) {
            const bundle = callback_ids.get(callback_id);
            if (!bundle) continue;
            const [sender, options, cb] = bundle;

            active_listeners.push(callback_id);

            // Check device permission for device events
            if (device) {
                const syncResult = sender.canAccessDeviceSync(device.shellyID);
                if (syncResult === false) {
                    Observability.incrementCounter('events_permission_denied');
                    continue;
                }
                if (syncResult === undefined) {
                    try {
                        const hasAccess = await sender.canAccessDevice(
                            device.shellyID
                        );
                        if (!hasAccess) {
                            Observability.incrementCounter(
                                'events_permission_denied'
                            );
                            continue;
                        }
                    } catch (error) {
                        continue;
                    }
                }
            }

            if (options) {
                if (device && options.shellyIDs && options.shellyIDs.size > 0) {
                    if (!options.shellyIDs.has(device.shellyID)) {
                        continue;
                    }
                }

                if (splitReasons !== undefined) {
                    const {allow, deny} = options;
                    // Drop if ANY reason matches a deny rule
                    if (deny.length > 0) {
                        if (
                            splitReasons.some(([rc, rcomp]) =>
                                deny.some((rule) =>
                                    matchesSplitRule(rc, rcomp, rule)
                                )
                            )
                        ) {
                            Observability.incrementCounter('events_filtered');
                            continue;
                        }
                    }
                    // Keep if ANY reason matches an allow rule
                    if (allow.length > 0) {
                        if (
                            !splitReasons.some(([rc, rcomp]) =>
                                allow.some((rule) =>
                                    matchesSplitRule(rc, rcomp, rule)
                                )
                            )
                        ) {
                            Observability.incrementCounter('events_filtered');
                            continue;
                        }
                    }
                }
            }

            // logger.info("SENDING MSG W/ REASON", reason)

            if (typeof cb === 'function') {
                logger.debug(
                    'notifyAll - sending event:[%s] to listener:[%d]',
                    eventName,
                    callback_id
                );
                cb(event, eventData);
            }
        }
    }
    if (active_listeners.length < listener_ids.length) {
        if (active_listeners.length === 0) {
            logger.mark('deleting event_name:[%s]', eventName);
            event_map.delete(eventName);
        } else {
            logger.mark(
                'removing %s listeners from event_name:[%s]',
                listener_ids.length - active_listeners.length,
                eventName
            );
            event_map.set(eventName, active_listeners);
        }
    }
    const broadcastElapsed = performance.now() - broadcastT0;
    broadcastLastMs = broadcastElapsed;
    if (broadcastElapsed > broadcastMaxMs) broadcastMaxMs = broadcastElapsed;
    if (Observability.getLevel() >= 2) {
        Observability.recordRpcTiming(`event:${eventName}`, broadcastElapsed);
    }
}

// Register observability module stats
Observability.registerModule('events', () => {
    const snap = {
        listeners: callback_ids.size,
        eventTypes: event_map.size,
        groupCacheSize: groupMetadataCache.size,
        groupVersion,
        broadcastMaxMs,
        broadcastLastMs,
        lastSerializeMs,
        serializeMaxMs
    };
    broadcastMaxMs = 0;
    serializeMaxMs = 0;
    return snap;
});
