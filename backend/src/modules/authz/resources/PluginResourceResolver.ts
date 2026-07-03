import type {ResourceRef} from '../contracts';
import type {TypedResourceResolver} from './ResourceResolver';

export class PluginResourceResolver implements TypedResourceResolver {
    supports(resourceType: string): boolean {
        return resourceType === 'plugin';
    }

    async resolve(resource: ResourceRef): Promise<ResourceRef> {
        if (resource.pluginKey || resource.id === undefined) return resource;
        return {...resource, pluginKey: String(resource.id)};
    }
}
