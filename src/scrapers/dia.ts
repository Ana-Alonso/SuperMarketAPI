import axios from 'axios';
import dotenv from 'dotenv';
import { Scraper, ScrapedProduct } from '../types/scraper';
import { fetchWithFallback } from '../utils/http';

dotenv.config();

const baseStoreUrl = process.env.MOCK_SUPERMARKET_URL || 'https://www.dia.es';

export class DiaScraper implements Scraper {
    async search(query: string, referenceCp: string): Promise<ScrapedProduct[]> {
        try {
            const isMockMode = !!process.env.MOCK_SUPERMARKET_URL;

            if (isMockMode) {
                const sessionPath = `${baseStoreUrl}/supermercado/api/v1/session/postalcode`;
                await axios.post(sessionPath, { postal_code: referenceCp }).catch(() => {});

                const searchUrl = `${baseStoreUrl}/supermercado/api/v1/search?q=${encodeURIComponent(query)}&supermarket=dia`;
                const response = await axios.get(searchUrl);
                
                if (!response.data || !Array.isArray(response.data.results)) {
                    throw new Error('FORMATO_RESPUESTA_INVALIDO');
                }

                return response.data.results.map((item: any) => ({
                    referencia_id: String(item.id),
                    nombre: item.display_name,
                    precio: parseFloat(item.price_details.unit_price),
                    supermercado: 'dia',
                    last_seen: new Date().toISOString(),
                    categoria_nombre: item.category || 'Otros'
                }));
            }

            const searchUrl = `${baseStoreUrl}/search?q=${encodeURIComponent(query)}`;
            const response = await fetchWithFallback(searchUrl, {}, true);
            const html = response.data || '';
            const products: ScrapedProduct[] = [];
            
            const productCardRegex = /data-test-id="product-card"[\s\S]*?l1_category_description="([^"]*)"[\s\S]*?object_id="(\d+)"[\s\S]*?alt="([^"]+)"[\s\S]*?class="search-product-card__active-price">([^&<]+)/g;
            let match;
            
            while ((match = productCardRegex.exec(html)) !== null) {
                const productCategory = match[1] || 'Otros';
                const productId = match[2];
                const productName = match[3];
                const productPrice = parseFloat(match[4].replace(',', '.').trim());
                
                if (productName && productPrice > 0) {
                    products.push({
                        referencia_id: String(productId),
                        nombre: String(productName),
                        precio: productPrice,
                        supermercado: 'dia',
                        last_seen: new Date().toISOString(),
                        categoria_nombre: productCategory
                    });
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
