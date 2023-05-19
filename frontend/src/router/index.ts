import { createRouter, createWebHistory, RouteRecordRaw } from 'vue-router';

const routes: Array<RouteRecordRaw> = [
    {
        path: '/',
        name: 'Devices',
        component: () => import('../views/Devices.vue')
    },
    {
        path: '/discovered',
        name: 'Discovered',
        component: () => import("../views/Discovered.vue")
    },
    {
        path: '/device/:device_mac',
        name: 'Device',
        component: () => import('../views/SingleDevice.vue')
    },
    {
        path: "/apply-config",
        name: "Apply Config",
        component: () => import("../views/ApplyConfig.vue")
    },
    {
        path: "/login",
        name: "Login",
        component: () => import("../views/Login.vue")
    },
    {
        path: '/settings',
        name: 'Settings',
        component: () => import("../views/Settings.vue")
    },
    {
        path: '/plugins',
        name: 'Plugins',
        component: () => import("../views/Plugins.vue")
    },
    {
        path: '/rpc',
        name: 'RPC',
        component: () => import("../views/RPC.vue")
    }
]

const router = createRouter({
    history: createWebHistory('#'),
    routes,
})

export default router
