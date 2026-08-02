import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import dotenv from 'dotenv';

dotenv.config();

export async function fetchWithFallback(
    targetUrl: string,
    config: AxiosRequestConfig = {},
    useRender = false
): Promise<AxiosResponse<any>> {
    const zenRowsApiKey = process.env.ZENROWS_APIKEY;
    const isMockMode = !!process.env.MOCK_SUPERMARKET_URL;
    
    if (isMockMode || !zenRowsApiKey || zenRowsApiKey === 'tu-apikey-de-zenrows') {
        return axios.get(targetUrl, config);
    }
    
    try {
        return await axios({
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
        return axios.get(targetUrl, config);
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
    
    if (isMockMode || !zenRowsApiKey || zenRowsApiKey === 'tu-apikey-de-zenrows') {
        return axios.post(targetUrl, data, config);
    }
    
    try {
        return await axios({
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
        return axios.post(targetUrl, data, config);
    }
}
