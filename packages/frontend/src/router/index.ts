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
        path: '/data',
        name: 'Data',
        component: () => import('../views/Data.vue')
    },
    {
        path: '/mass-rpc',
        name: 'MassRPC',
        component: () => import("../views/MassRPC.vue")
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
    }
]

const router = createRouter({
    history: createWebHistory(process.env['VUE_APP_BASE_URL']),
    routes,
})

export default router
