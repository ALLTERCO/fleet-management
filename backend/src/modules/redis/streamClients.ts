import {tuning} from '../../config';
import {getSharedRedis} from './RedisClients';
import {RedisStream, type RedisStreamOptions} from './RedisStream';

type LaneStreamOptions = Pick<RedisStreamOptions, 'byteLedger'>;

export type BlockingStreamLane =
    | 'audit'
    | 'device-event'
    | 'em-sync'
    | 'sensor-capture'
    | 'snapshot'
    | 'status';

export type CommandStreamLane =
    | 'audit'
    | 'device-event'
    | 'em-sync'
    | 'sensor-capture'
    | 'snapshot'
    | 'status';

/**
 * Split the existing stream-write allowance between two producer clients.
 * The two limits always add up to the existing process-wide allowance, so
 * isolation cannot silently double the bounded stream-write backlog.
 */
export function commandStreamLaneMaximum(
    lane: CommandStreamLane,
    total: number = tuning.redis.writeMaxPendingCommands
): number {
    if (total <= 0) return total;
    return isDurableLane(lane) ? Math.ceil(total / 2) : Math.floor(total / 2);
}

function isDurableLane(
    lane: CommandStreamLane
): lane is 'audit' | 'device-event' | 'em-sync' | 'sensor-capture' {
    return (
        lane === 'audit' ||
        lane === 'device-event' ||
        lane === 'em-sync' ||
        lane === 'sensor-capture'
    );
}

export function commandStream(
    lane: CommandStreamLane,
    key: string,
    options: LaneStreamOptions = {}
): RedisStream {
    const clients = getSharedRedis();
    return new RedisStream(
        isDurableLane(lane) ? clients.durableWrite : clients.telemetryWrite,
        key,
        {
            ...options,
            maxPendingWrites: commandStreamLaneMaximum(lane)
        }
    );
}

export function blockingStream(
    lane: BlockingStreamLane,
    key: string,
    options: LaneStreamOptions = {}
): RedisStream {
    return new RedisStream(blockingClient(lane), key, options);
}

function blockingClient(lane: BlockingStreamLane) {
    const clients = getSharedRedis();
    switch (lane) {
        case 'audit':
            return clients.auditBlocking;
        case 'device-event':
            return clients.deviceEventBlocking;
        case 'em-sync':
            return clients.emSyncBlocking;
        case 'sensor-capture':
            return clients.sensorCaptureBlocking;
        case 'snapshot':
            return clients.snapshotBlocking;
        case 'status':
            return clients.statusBlocking;
    }
}
