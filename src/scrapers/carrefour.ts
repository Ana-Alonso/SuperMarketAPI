import axios from 'axios';
import dotenv from 'dotenv';
import { Scraper, ScrapedProduct } from '../types/scraper';
import { fetchWithFallback } from '../utils/http';

dotenv.config();

const baseStoreUrl = process.env.MOCK_SUPERMARKET_URL || 'https://www.carrefour.es';

export class CarrefourScraper implements Scraper {
    async search(query: string, referenceCp: string): Promise<ScrapedProduct[]> {
        try {
            const isMockMode = !!process.env.MOCK_SUPERMARKET_URL;

            if (isMockMode) {
                const sessionPath = `${baseStoreUrl}/supermercado/api/v1/session/postalcode`;
                await axios.post(sessionPath, { postal_code: referenceCp }).catch(() => {});

                const searchUrl = `${baseStoreUrl}/supermercado/api/v1/search?q=${encodeURIComponent(query)}&supermarket=carrefour`;
                const response = await axios.get(searchUrl);
                
                if (!response.data || !Array.isArray(response.data.results)) {
                    throw new Error('FORMATO_RESPUESTA_INVALIDO');
                }

                return response.data.results.map((item: any) => ({
                    referencia_id: String(item.id),
                    nombre: item.display_name,
                    precio: parseFloat(item.price_details.unit_price),
                    supermercado: 'carrefour',
                    last_seen: new Date().toISOString(),
                    categoria_nombre: item.category || 'Otros'
                }));
            }

            const empathySearchUrl = `https://api.empathy.co/search/v1/query/carrefour/search?query=${encodeURIComponent(query)}&lang=es`;
            const response = await fetchWithFallback(empathySearchUrl, {}, false);
            
            if (!response.data || !response.data.catalog || !Array.isArray(response.data.catalog.content)) {
                return [];
            }

            return response.data.catalog.content.map((item: any) => {
                const productPrice = parseFloat(item.active_price);
                return {
                    referencia_id: String(item.product_id),
                    nombre: String(item.display_name),
                    precio: isNaN(productPrice) ? 0 : productPrice,
                    supermercado: 'carrefour',
                    last_seen: new Date().toISOString(),
                    categoria_nombre: 'Otros'
                };
            }).filter((p: ScrapedProduct) => p.nombre && p.precio > 0);
        } catch (error: any) {
            if (!process.env.MOCK_SUPERMARKET_URL) {
                return [];
            }
            throw new Error(error.response?.status === 403 ? 'BLOQUEADO' : 'ERROR_EXTRACCION');
        }
    }
}
