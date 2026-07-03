// Type surface shared across the api-scalar.* modules.

export interface OpenApiInfo {
    title?: string;
    description?: string;
    version?: string;
}

export interface OpenApiSpec {
    info?: OpenApiInfo;
    tags?: Array<{name: string; description?: string}>;
    paths?: Record<string, unknown>;
    [extra: string]: unknown;
}

export interface FeaturedNamespace {
    name: string;
    label: string;
    blurb: string;
    icon: string;
}

export interface Category {
    label: string;
    blurb: string;
    icon: string;
    namespaces: readonly string[];
}

export interface PageContext {
    version: string;
    methodCount: number;
    nsCount: number;
    catCount: number;
    featured: string;
    categories: string;
    specJson: string;
    cfgJson: string;
}
