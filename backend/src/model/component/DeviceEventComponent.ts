import {queryDeviceEvents} from '../../modules/deviceEvents/queryDeviceEvents';
import type {DescribeOutput} from '../../rpc/describe';
import {buildListResponse} from '../../rpc/listResponse';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    DEVICE_EVENT_DESCRIBE,
    DEVICE_EVENT_QUERY_PARAMS_SCHEMA
} from '../../types/api/deviceevents';
import type CommandSender from '../CommandSender';
import {canViewAuditLog} from './authzPermissions';
import Component from './Component';
import {
    assertOrderedRange,
    parseDateParam,
    tenantReadScope
} from './readQuerySupport';

interface DeviceEventConfig {
    enabled: boolean;
}

interface DeviceEventQueryParams {
    from?: string;
    to?: string;
    shellyIds?: string[];
    component?: string;
    kind?: string;
    limit?: number;
    offset?: number;
}

// Read access to the device change journal. Append-only; no write methods —
// rows are produced by DeviceEventLogger on the device message path.
export default class DeviceEventComponent extends Component<DeviceEventConfig> {
    constructor() {
        super('deviceevents');
    }

    protected override getDefaultConfig(): DeviceEventConfig {
        return {enabled: true};
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return DEVICE_EVENT_DESCRIBE;
    }

    @Component.NoAudit
    @Component.Expose('Query')
    @Component.CheckPermissions(canViewAuditLog)
    async query(rawParams: unknown, sender: CommandSender) {
        const params = validateOrThrow<DeviceEventQueryParams>(
            rawParams,
            DEVICE_EVENT_QUERY_PARAMS_SCHEMA
        );
        const limit = params.limit ?? 200;
        const offset = params.offset ?? 0;
        const from = parseDateParam(params.from, 'from');
        const to = parseDateParam(params.to, 'to');
        assertOrderedRange(from, to);

        const rows = await queryDeviceEvents({
            organizationId: tenantReadScope(sender),
            from,
            to,
            shellyIds: params.shellyIds,
            component: params.component,
            kind: params.kind,
            limit,
            offset
        });
        // Estimated total — rows.length === limit means there may be more.
        const hasMore = rows.length >= limit;
        return buildListResponse(
            rows,
            hasMore ? offset + rows.length + 1 : offset + rows.length,
            limit,
            offset
        );
    }
}
