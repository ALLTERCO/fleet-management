import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {parse} from '@vue/compiler-sfc';
import {describe, expect, it} from 'vitest';

const DASH_SOURCE = readFileSync(join(__dirname, '..', 'src/pages/dash.vue'), 'utf8');
const MAP_SOURCE = readFileSync(
    join(__dirname, '..', 'src/pages/dash/map/[id].vue'),
    'utf8'
);

const dash = parse(DASH_SOURCE).descriptor;
const map = parse(MAP_SOURCE).descriptor;

function styleText(descriptor: typeof dash): string {
    return descriptor.styles.map((style) => style.content).join('\n');
}

function cssRule(css: string, selector: string): string {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
    expect(match, `missing CSS rule ${selector}`).not.toBeNull();
    return match?.[1] ?? '';
}

describe('REGRESSION: map dashboard keeps a non-zero flex height chain', () => {
    it('enables the fill layout only for /dash/map routes', () => {
        const template = dash.template?.content ?? '';
        const script = dash.scriptSetup?.content ?? '';

        expect(script).toContain(
            "const isMapDashboard = computed(() => route.path.startsWith('/dash/map/'));"
        );
        expect(template).toContain(
            `class="dash-surface" :class="{'dash-surface--map': isMapDashboard}"`
        );
        expect(template).toContain(
            `class="dash-body" :class="{'dash-body--map': isMapDashboard}"`
        );
    });

    it('lets the map root consume the dashboard body height without changing other dashboards', () => {
        const dashCss = styleText(dash);
        const mapCss = styleText(map);

        expect(cssRule(dashCss, '.dash-surface')).toContain('flex: 0 1 auto;');
        expect(cssRule(dashCss, '.dash-surface--map')).toContain('flex: 1 1 0;');
        expect(cssRule(dashCss, '.dash-body--map')).toContain('display: flex;');
        expect(cssRule(dashCss, '.dash-body--map')).toContain(
            'flex-direction: column;'
        );
        expect(cssRule(mapCss, '.map-dash')).toContain('flex: 1;');
        expect(cssRule(mapCss, '.map-dash__map')).toContain('position: absolute;');
        expect(cssRule(mapCss, '.map-dash__map')).toContain('inset: 0;');
    });
});
