import {createApp, h} from 'vue';
import './styles/style.css';
import App from '@app-root';
import {IS_CLIENT_BUILD} from '@build-mode';
import {createPinia} from 'pinia';
import {LOGIN_PATH} from '@/constants';
import {setLoginRedirectHandler} from '@/helpers/authNavigation';
import {
    installCorruptTokenTrap,
    purgeCorruptOidcStorage
} from '@/helpers/oidcStorage';
import {initWebVitals} from '@/helpers/webVitals';
import {initZitadelAuth} from '@/helpers/zitadelAuth';
import {installCustomization, loadCustomization} from '@/shell/customization';
import {
    EMPTY_OPERATIONAL_BINDINGS,
    installOperationalBindings,
    loadOperationalBindings
} from '@/shell/operational-bindings';
import {initLaunchSync} from '@/tools/launchSync';
import {initPwaInstall} from '@/tools/pwaInstall';
import {initReportAnomalyToasts} from '@/tools/reportAnomalyToast';
import {initSwUpdate} from '@/tools/swUpdate';
import {initSystemAlertBanners} from '@/tools/systemAlertBanners';
import router from './router';

setLoginRedirectHandler(async () => {
    await router.replace(LOGIN_PATH);
});

installCorruptTokenTrap();

function mountBootError(err: unknown): void {
    console.error('[Boot] startup failed:', err);
    const message =
        err instanceof Error ? err.message : 'Unknown startup error';
    createApp({
        render() {
            return h('main', {class: 'boot-error'}, [
                h('section', {class: 'boot-error__panel'}, [
                    h('h1', 'Unable to start Fleet Manager'),
                    h('p', message)
                ])
            ]);
        }
    }).mount('#app');
}

async function init() {
    const [customization, operationalBindings] = await Promise.all([
        loadCustomization(),
        IS_CLIENT_BUILD
            ? loadOperationalBindings()
            : Promise.resolve(EMPTY_OPERATIONAL_BINDINGS)
    ]);
    const pinia = createPinia();

    const app = createApp(App);
    const rtCfg = window.__FM_RUNTIME_CONFIG__;
    app.config.performance = rtCfg?.perfTracing ?? import.meta.env.DEV;

    app.config.errorHandler = (err, _instance, info) => {
        console.error(`[Vue Error] ${info}:`, err);
    };

    app.use(pinia);
    app.use(router);
    installCustomization(app, customization);
    installOperationalBindings(app, operationalBindings);

    // Shared IntersectionObserver for v-lazyload (one observer for all images)
    let lazyObserver: IntersectionObserver | null = null;
    const lazyMap = new WeakMap<Element, string>();

    function getLazyObserver(): IntersectionObserver {
        if (!lazyObserver) {
            lazyObserver = new IntersectionObserver((entries) => {
                for (const entry of entries) {
                    if (entry.isIntersecting) {
                        const url = lazyMap.get(entry.target);
                        if (url) {
                            (entry.target as HTMLImageElement).src = url;
                            lazyMap.delete(entry.target);
                        }
                        lazyObserver!.unobserve(entry.target);
                    }
                }
            });
        }
        return lazyObserver;
    }

    app.directive('lazyload', {
        mounted(el: HTMLImageElement) {
            const url = el.dataset.url;
            if (!url) return;
            lazyMap.set(el, url);
            getLazyObserver().observe(el);
        },
        unmounted(el: HTMLImageElement) {
            lazyMap.delete(el);
            getLazyObserver().unobserve(el);
        }
    });

    // Block first paint until the initial beforeEach redirect resolves.
    await router.isReady();
    app.mount('#app');

    initWebVitals();
    initSwUpdate();
    initPwaInstall();
    initLaunchSync();
    initReportAnomalyToasts();
    initSystemAlertBanners(router);
}

if (!window.__FM_RUNTIME_CONFIG__?.devMode) {
    purgeCorruptOidcStorage();
    initZitadelAuth()
        .then((auth) => auth?.oidcAuth.startup())
        .catch((err) => {
            console.error('Zitadel OIDC startup error:', err);
            purgeCorruptOidcStorage();
        })
        .finally(() => void init().catch(mountBootError));
} else void init().catch(mountBootError);
