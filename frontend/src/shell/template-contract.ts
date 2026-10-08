// The one definition of what a client template may be and may import. Read by
// the runtime, the client build and the Node validators, so no copy can drift.

export type TemplateRenderer = 'vue' | 'react';
export type TemplateKind = 'vue-spa' | 'react-spa';
export type TemplateEntryFile = 'index.vue' | 'index.tsx';

export type TemplateKindContract = {
    renderer: TemplateRenderer;
    entryFile: TemplateEntryFile;
};

export const TEMPLATE_KINDS = {
    'vue-spa': {renderer: 'vue', entryFile: 'index.vue'},
    'react-spa': {renderer: 'react', entryFile: 'index.tsx'}
} as const satisfies Record<TemplateKind, TemplateKindContract>;

/** A manifest that predates renderer metadata is a Vue SPA. */
export const DEFAULT_TEMPLATE_KIND: TemplateKind = 'vue-spa';

export const SUPPORTED_TEMPLATE_KINDS = Object.keys(
    TEMPLATE_KINDS
) as TemplateKind[];

export const SUPPORTED_RENDERERS = Object.values(TEMPLATE_KINDS).map(
    (kind) => kind.renderer
);

export const SUPPORTED_ENTRY_FILES = Object.values(TEMPLATE_KINDS).map(
    (kind) => kind.entryFile
);

export function templateKindContract(kind: TemplateKind): TemplateKindContract {
    return TEMPLATE_KINDS[kind];
}

export function rendererForEntryFile(
    entryFile: string
): TemplateRenderer | null {
    const match = Object.values(TEMPLATE_KINDS).find(
        (kind) => kind.entryFile === entryFile
    );
    return match ? match.renderer : null;
}

// Trust gate. Every entry must also be declared in frontend/package.json,
// because the client build resolves template imports from Fleet's tree.
export const NEUTRAL_ALLOWED_IMPORTS = [
    '@base-ui/react',
    '@host/core',
    '@shadcn/react',
    '@template-contract',
    '@shared',
    'class-variance-authority',
    'clsx',
    'cmdk',
    'date-fns',
    'echarts',
    // Client-side report export (DOM -> canvas -> PDF), used by energy-audit.
    'html2canvas',
    'jspdf',
    // Map rendering (GeoMap/PickLocationMap in shared/ui) - bundled so
    // maps work on customer networks that block CDNs.
    'leaflet',
    'leaflet.markercluster',
    'lucide-react',
    'next-themes',
    'radix-ui',
    'react-day-picker',
    'recharts',
    'sonner',
    'shadcn',
    'tailwind-merge',
    'tailwindcss',
    'three',
    'tw-animate-css'
];

/** Closed to templates. `@api` is the backend contract: a template gets it as
 * the shapes `@host/core` publishes, never by importing the contract itself. */
export const FORBIDDEN_HOST_INTERNAL_IMPORTS = [
    '@/stores',
    '@/pages',
    '@/layouts',
    '@/router',
    '@/tools',
    '@/helpers',
    '@/components',
    '@/App',
    '@api'
];

// `@host` and `@host/api` are the legacy Vue-bound surface, so React is not
// offered them; that is what stops a React template reaching Vue through @host.
export const RENDERER_ALLOWED_IMPORTS: Record<TemplateRenderer, string[]> = {
    vue: [
        '@internationalized/date',
        '@number-flow/vue',
        '@tanstack/query-core',
        '@tanstack/vue-form',
        '@tanstack/vue-table',
        '@tanstack/vue-virtual',
        '@host',
        '@host/api',
        '@host/vue',
        'dinero.js',
        'motion-v',
        'reka-ui',
        'valibot',
        'vue',
        'vue-i18n',
        'vue-router',
        '@vueuse/core'
    ],
    react: [
        '@host/react',
        'embla-carousel-react',
        'input-otp',
        'react',
        'react-dom/client',
        'react-hook-form',
        'react-resizable-panels',
        'vaul'
    ]
};

// Out of scope by decision, named so the failure says why.
export const FORBIDDEN_FRAMEWORK_IMPORTS = [
    {name: 'next', reason: 'Next.js is not a Fleet runtime'},
    {name: '@vercel', reason: 'Vercel is not a deployment target'},
    {name: 'react-dom/server', reason: 'server rendering is not supported'},
    {name: 'fs', reason: 'server-only module in a browser template'},
    {name: 'path', reason: 'server-only module in a browser template'},
    {name: 'child_process', reason: 'server-only module in a browser template'}
];

// `@host` subpaths are renderer-specific, so granting the root must not imply
// `@host/react` to a Vue template or `@host/vue` to a React one.
const NO_SUBPATH_IMPORTS = new Set(['@host']);

// A bare prefix match would admit `@hostile` for `@host`.
export function matchesPackage(specifier: string, name: string): boolean {
    if (specifier === name) return true;
    if (NO_SUBPATH_IMPORTS.has(name)) return false;
    return specifier.startsWith(`${name}/`);
}

export function forbiddenFrameworkImport(
    specifier: string
): {name: string; reason: string} | undefined {
    if (specifier.startsWith('node:')) {
        return {
            name: specifier,
            reason: 'server-only module in a browser template'
        };
    }
    return FORBIDDEN_FRAMEWORK_IMPORTS.find((entry) =>
        matchesPackage(specifier, entry.name)
    );
}

export function allowedImportsFor(renderer: string): string[] {
    const rendererImports =
        RENDERER_ALLOWED_IMPORTS[renderer as TemplateRenderer] ?? [];
    return [...NEUTRAL_ALLOWED_IMPORTS, ...rendererImports];
}

/** Renderer-neutral shared code may use either runtime, but never `@host`. */
export function allowedSharedImports(): string[] {
    return [
        ...NEUTRAL_ALLOWED_IMPORTS,
        ...RENDERER_ALLOWED_IMPORTS.vue,
        ...RENDERER_ALLOWED_IMPORTS.react
    ];
}

export function isAllowedImport(
    specifier: string,
    allowed: readonly string[]
): boolean {
    return allowed.some((name) => matchesPackage(specifier, name));
}
