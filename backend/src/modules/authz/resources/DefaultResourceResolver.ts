import {DashboardResourceResolver} from './DashboardResourceResolver';
import {DeviceResourceResolver} from './DeviceResourceResolver';
import {GroupResourceResolver} from './GroupResourceResolver';
import {LocationResourceResolver} from './LocationResourceResolver';
import {NotificationsResourceResolver} from './NotificationsResourceResolver';
import {PluginResourceResolver} from './PluginResourceResolver';
import {ResourceResolverRegistry} from './ResourceResolver';
import {TagResourceResolver} from './TagResourceResolver';

export function createDefaultResourceResolver(): ResourceResolverRegistry {
    return new ResourceResolverRegistry([
        new DeviceResourceResolver(),
        new DashboardResourceResolver(),
        new GroupResourceResolver(),
        new LocationResourceResolver(),
        new TagResourceResolver(),
        new PluginResourceResolver(),
        new NotificationsResourceResolver()
    ]);
}
