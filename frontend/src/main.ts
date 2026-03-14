import {createApp} from 'vue';
import './style.css';
import '@/constants';
import {createPinia} from 'pinia';
import {initWebVitals} from '@/helpers/webVitals';
import {initZitadelAuth} from '@/helpers/zitadelAuth';
import App from './App.vue';
import {USE_LOGIN_ZITADEL} from './constants';
import router from './router';

function init() {
    const pinia = createPinia();

    const app = createApp(App);
    const rtCfg = (window as any).__FM_RUNTIME_CONFIG__;
    app.config.performance = rtCfg?.perfTracing ?? import.meta.env.DEV;

    app.config.errorHandler = (err, instance, info) => {
        console.error(`[Vue Error] ${info}:`, err);
    };

    app.use(pinia);
    app.use(router);
    app.mount('#app');

    initWebVitals();

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
}

if (USE_LOGIN_ZITADEL) {
    console.debug('using zitadel login strategy');
    initZitadelAuth()
        .then((auth) => {
            if (!auth) {
                console.warn('Zitadel auth init returned undefined — app will mount without session');
                return;
            }
            return auth.oidcAuth
                .startup()
                .then((ok) => {
                    if (ok) {
                        console.debug('Zitadel started OK');
                    } else {
                        console.warn('Zitadel OIDC startup returned false — app will mount without session');
                    }
                });
        })
        .catch((err) => {
            console.error('Zitadel OIDC startup error:', err);
        })
        .finally(() => {
            init();
        });
} else init();
