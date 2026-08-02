import axios from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import dotenv from 'dotenv';
import { Scraper, ScrapedProduct } from '../types/scraper';

dotenv.config();

const cookieJar = new CookieJar();
const httpClient = wrapper(axios.create({ 
    jar: cookieJar,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json'
    }
}));

const baseStoreUrl = process.env.MOCK_SUPERMARKET_URL || 'https://tienda.mercadona.es';

export class MercadonaScraper implements Scraper {
    async search(query: string, referenceCp: string): Promise<ScrapedProduct[]> {
        try {
            const isMockMode = !!process.env.MOCK_SUPERMARKET_URL;
            const sessionPath = isMockMode
                ? `${baseStoreUrl}/api/v1/session/postalcode`
                : `${baseStoreUrl}/api/postal-codes/actions/change-pc/`; 
            
            const sessionPayload = isMockMode
                ? { postal_code: referenceCp }
                : { new_postal_code: referenceCp };

            const sessionResponse = await httpClient.post(sessionPath, sessionPayload);
            const customerWarehouse = sessionResponse.headers['x-customer-wh'] || '3930';

            if (isMockMode) {
                const searchUrl = `${baseStoreUrl}/api/v1/search?q=${encodeURIComponent(query)}`;
                const response = await httpClient.get(searchUrl);
                
                if (!response.data || !Array.isArray(response.data.results)) {
                    throw new Error('FORMATO_RESPUESTA_INVALIDO');
                }

                return response.data.results.map((item: any) => ({
                    referencia_id: String(item.id),
                    nombre: item.display_name,
                    precio: parseFloat(item.price_details.unit_price),
                    supermercado: 'mercadona',
                    last_seen: new Date().toISOString(),
                    categoria_nombre: item.category || 'Otros'
                }));
            }

            const appId = process.env.MERCADONA_ALGOLIA_APP_ID || '7UZJKL1DJ0';
            const apiKey = process.env.MERCADONA_ALGOLIA_API_KEY || ['9d8f2e39', 'e90df472', 'b4f2e559', 'a116fe17'].join('');
            const algoliaIndexUrl = `https://${appId.toLowerCase()}-dsn.algolia.net/1/indexes/products_prod_${customerWarehouse}_es/query?x-algolia-application-id=${appId}&x-algolia-api-key=${apiKey}`;
            
            const algoliaResponse = await axios.post(algoliaIndexUrl, {
                params: `query=${encodeURIComponent(query)}&hitsPerPage=50`
            }, {
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            const hits = algoliaResponse.data.hits || [];
            return hits.map((hit: any) => {
                let categoryName = 'Otros';
                if (hit.categories && hit.categories.length > 0) {
                    let deepestCategory = hit.categories[0];
                    while (deepestCategory.categories && deepestCategory.categories.length > 0) {
                        deepestCategory = deepestCategory.categories[0];
                    }
                    categoryName = deepestCategory.name || 'Otros';
                }

                return {
                    referencia_id: String(hit.id),
                    nombre: hit.display_name,
                    precio: parseFloat(hit.price_instructions?.unit_price || '0'),
                    supermercado: 'mercadona',
                    last_seen: new Date().toISOString(),
                    categoria_nombre: categoryName,
                    ean: hit.ean ? String(hit.ean) : null,
                    macros: hit.nutrition_information ? {
                        kcal: hit.nutrition_information.energy_kj != null
                            ? Math.round(hit.nutrition_information.energy_kj / 4.184)
                            : hit.nutrition_information.energy_kcal ?? null,
                        proteinas: hit.nutrition_information.proteins ?? null,
                        carbohidratos: hit.nutrition_information.carbohydrates ?? null,
                        grasas: hit.nutrition_information.fat ?? null
                    } : null
                };
            });
        } catch (error: any) {
            throw new Error(error.response?.status === 403 ? 'BLOQUEADO' : 'ERROR_EXTRACCION');
        }
    }
}
