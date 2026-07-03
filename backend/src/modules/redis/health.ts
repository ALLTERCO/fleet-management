import {getSharedRedis} from './RedisClients';

export async function pingRedis(): Promise<'up' | 'unknown'> {
    const {cmd} = getSharedRedis();
    const pong = await cmd.ping();
    return pong === 'PONG' ? 'up' : 'unknown';
}
