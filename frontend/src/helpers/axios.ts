import axios from 'axios';
import {FLEET_MANAGER_HTTP} from '@/constants';

const apiClient = axios.create({
    baseURL: FLEET_MANAGER_HTTP
});

apiClient.interceptors.request.use(
    (config) => {
        const token = localStorage.getItem('access_token');
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }

        // Set default Content-Type if not already specified in the request
        if (!config.headers['Content-Type']) {
            config.headers['Content-Type'] = 'application/json'; // Default content type
        }
        return config;
    },
    (error) => {
        return Promise.reject(error);
    }
);

export default apiClient;
