import axios from 'axios';
import dotenv from 'dotenv';
import { Scraper, ScrapedProduct } from '../types/scraper';
import { fetchWithFallback } from '../utils/http';

dotenv.config();

const baseStoreUrl = process.env.MOCK_SUPERMARKET_URL || 'https://supermercado.eroski.es';

export class EroskiScraper implements Scraper {
    async search(query: string, referenceCp: string): Promise<ScrapedProduct[]> {
        try {
            const isMockMode = !!process.env.MOCK_SUPERMARKET_URL;

            if (isMockMode) {
                const sessionPath = `${baseStoreUrl}/supermercado/api/v1/session/postalcode`;
                await axios.post(sessionPath, { postal_code: referenceCp }).catch(() => {});

                const searchUrl = `${baseStoreUrl}/supermercado/api/v1/search?q=${encodeURIComponent(query)}&supermarket=eroski`;
                const response = await axios.get(searchUrl);
                
                if (!response.data || !Array.isArray(response.data.results)) {
                    throw new Error('FORMATO_RESPUESTA_INVALIDO');
                }

                return response.data.results.map((item: any) => ({
                    referencia_id: String(item.id),
                    nombre: item.display_name,
                    precio: parseFloat(item.price_details.unit_price),
                    supermercado: 'eroski',
                    last_seen: new Date().toISOString(),
                    categoria_nombre: item.category || 'Otros'
                }));
            }

            const searchUrl = `${baseStoreUrl}/es/search/results/?q=${encodeURIComponent(query)}`;
            const response = await fetchWithFallback(searchUrl, {}, false);
            const html = response.data || '';

            const products: ScrapedProduct[] = [];
            const dataMetricsRegex = /data-metrics="({[^"]+})"/g;
            let match;
            const processedIds = new Set<string>();

            while ((match = dataMetricsRegex.exec(html)) !== null) {
                try {
                    const decodedJsonString = match[1].replace(/&quot;/g, '"');
                    const productMetrics = JSON.parse(decodedJsonString);
                    if (productMetrics.ecommerce && productMetrics.ecommerce.items && productMetrics.ecommerce.items[0]) {
                        const item = productMetrics.ecommerce.items[0];
                        const itemId = String(item.item_id);
                        if (itemId && !processedIds.has(itemId)) {
                            processedIds.add(itemId);
                            
                            const productPrice = parseFloat(item.price);
                            products.push({
                                referencia_id: itemId,
                                nombre: String(item.item_name),
                                precio: isNaN(productPrice) ? 0 : productPrice,
                                supermercado: 'eroski',
                                last_seen: new Date().toISOString(),
                                categoria_nombre: 'Otros'
                            });
                        }
                    }
                } catch (parsingError) {
                    // Ignore malformed items
                }
            }

            return products;
        } catch (error: any) {
            if (!process.env.MOCK_SUPERMARKET_URL) {
                return [];
            }
            throw new Error(error.response?.status === 403 ? 'BLOQUEADO' : 'ERROR_EXTRACCION');
        }
    }
}
