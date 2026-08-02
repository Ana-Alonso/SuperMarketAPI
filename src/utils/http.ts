import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import http from 'http';
import https from 'https';
import dotenv from 'dotenv';

dotenv.config();

// HTTP & HTTPS Keep-Alive Connection Pooling for ultra-low latency
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 50 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 50 });

const defaultAxiosConfig: AxiosRequestConfig = {
    httpAgent,
    httpsAgent,
    timeout: 15000
};

export async function fetchWithFallback(
    targetUrl: string,
    config: AxiosRequestConfig = {},
    useRender = false
): Promise<AxiosResponse<any>> {
    const zenRowsApiKey = process.env.ZENROWS_APIKEY;
    const isMockMode = !!process.env.MOCK_SUPERMARKET_URL;
    
    const mergedConfig: AxiosRequestConfig = {
        ...defaultAxiosConfig,
        ...config,
        headers: { ...config.headers }
    };

    if (isMockMode || !zenRowsApiKey || zenRowsApiKey === 'tu-apikey-de-zenrows') {
        return axios.get(targetUrl, mergedConfig);
    }
    
    try {
        return await axios({
            ...defaultAxiosConfig,
            url: 'https://api.zenrows.com/v1/',
            method: 'GET',
            params: {
                'url': targetUrl,
                'apikey': zenRowsApiKey,
                'mode': 'auto',
                ...(useRender ? { 'js_render': 'true', 'premium_proxy': 'true' } : {})
            },
            headers: config.headers,
            timeout: config.timeout || 30000
        });
    } catch (proxyError: any) {
        return axios.get(targetUrl, mergedConfig);
    }
}

export async function postWithFallback(
    targetUrl: string,
    data: any,
    config: AxiosRequestConfig = {},
    useRender = false
): Promise<AxiosResponse<any>> {
    const zenRowsApiKey = process.env.ZENROWS_APIKEY;
    const isMockMode = !!process.env.MOCK_SUPERMARKET_URL;
    
    const mergedConfig: AxiosRequestConfig = {
        ...defaultAxiosConfig,
        ...config,
        headers: { ...config.headers }
    };

    if (isMockMode || !zenRowsApiKey || zenRowsApiKey === 'tu-apikey-de-zenrows') {
        return axios.post(targetUrl, data, mergedConfig);
    }
    
    try {
        return await axios({
            ...defaultAxiosConfig,
            url: 'https://api.zenrows.com/v1/',
            method: 'POST',
            params: {
                'url': targetUrl,
                'apikey': zenRowsApiKey,
                'mode': 'auto',
                ...(useRender ? { 'js_render': 'true', 'premium_proxy': 'true' } : {})
            },
            data: data,
            headers: config.headers,
            timeout: config.timeout || 30000
        });
    } catch (proxyError: any) {
        return axios.post(targetUrl, data, mergedConfig);
    }
}
