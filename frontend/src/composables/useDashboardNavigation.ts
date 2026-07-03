// Cross-page dashboard navigation helpers — single home for /dash/manage.

import {useRouter} from 'vue-router';

export function useDashboardNavigation() {
    const router = useRouter();
    return {
        goToManage: () => router.push('/dash/manage')
    };
}
