export {DashboardResourceResolver} from './DashboardResourceResolver';
export {createDefaultResourceResolver} from './DefaultResourceResolver';
export {DeviceResourceResolver} from './DeviceResourceResolver';
export {GroupResourceResolver} from './GroupResourceResolver';
export {LocationResourceResolver} from './LocationResourceResolver';
export {NotificationsResourceResolver} from './NotificationsResourceResolver';
export {PluginResourceResolver} from './PluginResourceResolver';
export {
    type ResourceResolver,
    ResourceResolverRegistry,
    type TypedResourceResolver
} from './ResourceResolver';
export {
    assertScopeRefsBelongToOrg,
    resourcesFromScope
} from './ScopeResourceValidator';
export {TagResourceResolver} from './TagResourceResolver';
