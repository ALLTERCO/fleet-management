import type {RouteRecordRaw} from 'vue-router';
import AuthSigninWinZitadel from '@/pages/auth/signinwin/zitadel.vue';
import Callback from '@/pages/callback.vue';
import Login from '@/pages/login.vue';
import NoPermissions from '@/pages/no-permissions.vue';
import TemplateHost from '@/shell/TemplateHost.vue';

export const routes: RouteRecordRaw[] = [
    {path: '/callback', component: Callback, meta: {layout: 'basic'}},
    {path: '/login', component: Login, meta: {layout: 'basic'}},
    {
        path: '/no-permissions',
        component: NoPermissions,
        meta: {layout: 'basic'}
    },
    {
        path: '/auth/signinwin/zitadel',
        component: AuthSigninWinZitadel,
        meta: {layout: 'basic'}
    },
    {
        path: '/:pathMatch(.*)*',
        component: TemplateHost,
        meta: {layout: 'basic'}
    }
];
