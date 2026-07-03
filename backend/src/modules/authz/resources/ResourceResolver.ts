import type {ResourceRef} from '../contracts';

export interface ResourceResolver {
    resolve(resource: ResourceRef): Promise<ResourceRef>;
}

export interface TypedResourceResolver extends ResourceResolver {
    supports(resourceType: string): boolean;
}

export class ResourceResolverRegistry {
    constructor(private readonly resolvers: readonly TypedResourceResolver[]) {}

    supports(resourceType: string): boolean {
        return this.resolvers.some((item) => item.supports(resourceType));
    }

    async resolve(resource: ResourceRef): Promise<ResourceRef> {
        const resolver = this.resolvers.find((item) =>
            item.supports(resource.type)
        );
        if (!resolver) return resource;
        return resolver.resolve(resource);
    }
}
