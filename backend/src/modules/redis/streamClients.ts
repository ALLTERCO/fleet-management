import {getSharedRedis} from './RedisClients';
import {RedisStream} from './RedisStream';

export type BlockingStreamLane =
    | 'audit'
    | 'device-event'
    | 'em-sync'
    | 'snapshot'
    | 'status';

export function commandStream(key: string): RedisStream {
    return new RedisStream(getSharedRedis().cmd, key);
}

export function blockingStream(
    lane: BlockingStreamLane,
    key: string
): RedisStream {
    const clients = getSharedRedis();
    switch (lane) {
        case 'audit':
            return new RedisStream(clients.auditBlocking, key);
        case 'device-event':
            return new RedisStream(clients.deviceEventBlocking, key);
        case 'em-sync':
            return new RedisStream(clients.emSyncBlocking, key);
        case 'snapshot':
            return new RedisStream(clients.snapshotBlocking, key);
        case 'status':
            return new RedisStream(clients.statusBlocking, key);
    }
}
