// Curated alert namespace as a factory over injected RPC access.
//
// Every call goes through `call` or `listAll`, which take the method name from
// the generated contract. The hand-written generics they replaced asserted the
// answer and never checked the question, so a parameter the backend does not
// implement went out unnoticed and came back empty. The alert list pages by
// cursor through `rpc` until the contract is regenerated with `cursor`.

import type {
    AlertInstance,
    AlertInstanceGetManyResult,
    AlertInstanceListFilters,
    AlertRuleKindDescriptor,
    AlertTransition
} from '@api/alert';
import type {
    HostMethod,
    HostParams,
    HostResult
} from '../../generated/contract';
import {createFleetSdkError, FLEET_PAGINATION_NO_PROGRESS} from '../errors';
import {namespaceCaller} from '../namespace-caller';
import {
    type CursorPage,
    DEFAULT_PAGE_SIZE,
    paginateByCursor
} from '../pagination';
import type {FleetRpcAccess} from '../types';

type AlertMethod = Extract<HostMethod, `alert.${string}`>;

/** Row type of a paged alert result, so listAll cannot invent one. */
type AlertItem<M extends AlertMethod> =
    HostResult<M> extends {
        items: (infer TItem)[];
    }
        ? TItem
        : never;

/** The backend takes at most this many ids per alert.instance.getmany call. */
const GET_MANY_MAX_IDS = 100;
/** Rows in one listInstancesPage call unless the caller asks (max 1000). */
const INSTANCE_PAGE_SIZE = 100;

/** One page request: the list filters plus where to continue. */
export interface AlertInstancePageRequest extends AlertInstanceListFilters {
    /** `next_cursor` of the previous page, sent with the same filters. */
    cursor?: string;
    /** 1 to 1000; 100 when left out. */
    limit?: number;
}

/** One page. `next_cursor` is null on the last page; `total` is only on the
 *  first page (the server counts only without a cursor). */
export interface AlertInstancePage {
    items: AlertInstance[];
    next_cursor: string | null;
    total?: number;
}

export type FleetAlertDomain = ReturnType<typeof createAlertDomain>;

export function createAlertDomain(access: FleetRpcAccess) {
    const call = namespaceCaller<AlertMethod>(access);

    const listAll = <M extends AlertMethod>(
        method: M,
        params: HostParams<M>
    ): Promise<AlertItem<M>[]> =>
        access.rpcListAll<AlertItem<M>>(method, params as object);

    // Keyset pages: no deep OFFSET re-read and no count after the first page.
    const listInstancesByCursor = async (
        filters: AlertInstanceListFilters
    ): Promise<AlertInstance[]> => {
        const pass = await paginateByCursor((cursor) =>
            access.rpc<CursorPage<AlertInstance>>('alert.instance.list', {
                ...filters,
                limit: DEFAULT_PAGE_SIZE,
                ...(cursor ? {cursor} : {})
            })
        );
        if (!pass.complete) {
            throw createFleetSdkError(
                FLEET_PAGINATION_NO_PROGRESS,
                'alert.instance.list did not reach its last page'
            );
        }
        return pass.items;
    };

    return {
        /** Every matching alert. Filters run on the server, AND between them. */
        listInstances(
            filters: AlertInstanceListFilters = {}
        ): Promise<AlertInstance[]> {
            return listInstancesByCursor(filters);
        },
        /** One page of matching alerts in one call; pass its `next_cursor`
         *  back with the same filters for the next page. */
        async listInstancesPage(
            request: AlertInstancePageRequest = {}
        ): Promise<AlertInstancePage> {
            // The server refuses cursor with a real offset; it counts only without a cursor.
            const first = request.cursor === undefined;
            const page = await access.rpc<
                CursorPage<AlertInstance> & {total?: number}
            >('alert.instance.list', {
                limit: INSTANCE_PAGE_SIZE,
                ...request,
                ...(first ? {offset: 0} : {})
            });
            return first && page.total !== undefined
                ? {
                      items: page.items,
                      next_cursor: page.next_cursor,
                      total: page.total
                  }
                : {items: page.items, next_cursor: page.next_cursor};
        },
        getInstance(id: number): Promise<AlertInstance> {
            return call('alert.instance.get', {id});
        },
        /** Rows for the ids that changed. Ids the caller may not read, or that
         *  are gone, come back in `missingIds`. Large input goes in chunks. */
        async getInstances(
            ids: readonly number[]
        ): Promise<AlertInstanceGetManyResult> {
            const merged: AlertInstanceGetManyResult = {
                items: [],
                missingIds: []
            };
            for (let at = 0; at < ids.length; at += GET_MANY_MAX_IDS) {
                const part = await access.rpc<AlertInstanceGetManyResult>(
                    'alert.instance.getmany',
                    {ids: ids.slice(at, at + GET_MANY_MAX_IDS)}
                );
                merged.items.push(...part.items);
                merged.missingIds.push(...part.missingIds);
            }
            return merged;
        },
        transitions(id: number): Promise<AlertTransition[]> {
            return listAll('alert.instance.listtransitions', {id});
        },
        acknowledge(id: number): Promise<AlertInstance> {
            return call('alert.instance.ack', {id});
        },
        unacknowledge(id: number): Promise<AlertInstance> {
            return call('alert.instance.unack', {id});
        },
        silence(
            id: number,
            until: string,
            reason?: string | null
        ): Promise<AlertInstance> {
            return call('alert.instance.silence', {
                id,
                until,
                ...(reason ? {reason} : {})
            });
        },
        unsilence(id: number): Promise<AlertInstance> {
            return call('alert.instance.unsilence', {id});
        },
        resolve(id: number): Promise<AlertInstance> {
            return call('alert.instance.resolvemanual', {id});
        },
        annotate(
            alertInstanceId: number,
            body: string
        ): Promise<HostResult<'alert.instance.annotate'>> {
            return call('alert.instance.annotate', {alertInstanceId, body});
        },
        async annotations(
            alertInstanceId: number
        ): Promise<HostResult<'alert.instance.listannotations'>['items']> {
            const result = await call('alert.instance.listannotations', {
                alertInstanceId
            });
            return result.items;
        },
        /** Author-only, both of them. Takes the annotation id, not the alert's. */
        editAnnotation(params: HostParams<'alert.instance.editannotation'>) {
            return call('alert.instance.editannotation', params);
        },
        deleteAnnotation(
            params: HostParams<'alert.instance.deleteannotation'>
        ) {
            return call('alert.instance.deleteannotation', params);
        },
        listRules(
            params: HostParams<'alert.rule.list'> = {}
        ): Promise<HostResult<'alert.rule.list'>['items']> {
            return listAll('alert.rule.list', params);
        },
        getRule(id: number): Promise<HostResult<'alert.rule.get'>> {
            return call('alert.rule.get', {id});
        },
        createRule(
            input: HostParams<'alert.rule.create'>
        ): Promise<HostResult<'alert.rule.create'>> {
            return call('alert.rule.create', input);
        },
        updateRule(
            input: HostParams<'alert.rule.update'>
        ): Promise<HostResult<'alert.rule.update'>> {
            return call('alert.rule.update', input);
        },
        deleteRule(id: number): Promise<HostResult<'alert.rule.delete'>> {
            return call('alert.rule.delete', {id});
        },
        async listKinds(): Promise<AlertRuleKindDescriptor[]> {
            const res = await call('alert.rule.listkinds', {});
            return res.items;
        },
        /** Numeric fields seen on live devices. Feeds a threshold builder, so
         *  the user picks a path that exists instead of typing one. */
        listMetricPaths(params: HostParams<'alert.rule.listmetricpaths'> = {}) {
            return call('alert.rule.listmetricpaths', params);
        },
        /** Same, plus the boolean and string state fields. */
        listComponentPaths(
            params: HostParams<'alert.rule.listcomponentpaths'> = {}
        ) {
            return call('alert.rule.listcomponentpaths', params);
        },
        /** Which devices can actually host this kind. A rule scoped to one
         *  that cannot is a rule that never fires and never says why. */
        listEligibleDevices(
            params: HostParams<'alert.rule.listeligibledevices'>
        ) {
            return call('alert.rule.listeligibledevices', params);
        },
        /** Ask before create or update. Two identical rules means every firing
         *  arrives twice, which reads as a storm rather than a mistake. */
        checkDuplicate(params: HostParams<'alert.rule.checkduplicate'>) {
            return call('alert.rule.checkduplicate', params);
        },
        /** Dry run against current state. Side-effect free, and the only way to
         *  see a rule's blast radius before it can wake anybody. */
        previewRule(params: HostParams<'alert.rule.preview'> = {}) {
            return call('alert.rule.preview', params);
        },
        /** When this one rule fired, newest first. */
        listFirings(params: HostParams<'alert.rule.listfirings'>) {
            return call('alert.rule.listfirings', params);
        },
        /** Instantiates a rule from a template: the template brings kind,
         *  severity and throttling, the caller brings name and scope. */
        createRuleFromTemplate(
            params: HostParams<'alert.rule.createfromtemplate'>
        ) {
            return call('alert.rule.createfromtemplate', params);
        },
        /** The reusable definitions themselves, not the rules made from them.
         *  `list` includes the product's built-ins; only an org-authored
         *  template can be changed, and only by its author. */
        templates: {
            list(params: HostParams<'alert.rule.listtemplates'> = {}) {
                return call('alert.rule.listtemplates', params);
            },
            create(params: HostParams<'alert.rule.template.create'>) {
                return call('alert.rule.template.create', params);
            },
            update(params: HostParams<'alert.rule.template.update'>) {
                return call('alert.rule.template.update', params);
            },
            delete(params: HostParams<'alert.rule.template.delete'>) {
                return call('alert.rule.template.delete', params);
            }
        }
    };
}
