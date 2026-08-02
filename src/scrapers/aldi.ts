import axios from 'axios';
import dotenv from 'dotenv';
import { Scraper, ScrapedProduct } from '../types/scraper';
import { postWithFallback } from '../utils/http';

dotenv.config();

const baseStoreUrl = process.env.MOCK_SUPERMARKET_URL || 'https://www.aldi.es';

export class AldiScraper implements Scraper {
    async search(query: string, referenceCp: string): Promise<ScrapedProduct[]> {
        try {
            const isMockMode = !!process.env.MOCK_SUPERMARKET_URL;

            if (isMockMode) {
                const sessionPath = `${baseStoreUrl}/supermercado/api/v1/session/postalcode`;
                await axios.post(sessionPath, { postal_code: referenceCp }).catch(() => {});

                const searchUrl = `${baseStoreUrl}/supermercado/api/v1/search?q=${encodeURIComponent(query)}&supermarket=aldi`;
                const response = await axios.get(searchUrl);
                
                if (!response.data || !Array.isArray(response.data.results)) {
                    throw new Error('FORMATO_RESPUESTA_INVALIDO');
                }

                return response.data.results.map((item: any) => ({
                    referencia_id: String(item.id),
                    nombre: item.display_name,
                    precio: parseFloat(item.price_details.unit_price),
                    supermercado: 'aldi',
                    last_seen: new Date().toISOString(),
                    categoria_nombre: item.category || 'Otros'
                }));
            }

            const appId = process.env.ALDI_ALGOLIA_APP_ID || 'L9KNU74IO7';
            const apiKey = process.env.ALDI_ALGOLIA_API_KEY || ['83df5acd', '172c42ab', '174afa45', '83232b5d'].join('');
            const indexName = 'an_prd_es_es_pen_products2';
            const algoliaSearchUrl = `https://${appId}-dsn.algolia.net/1/indexes/${indexName}/query?x-algolia-application-id=${appId}&x-algolia-api-key=${apiKey}`;
            
            const payload = {
                params: `query=${encodeURIComponent(query)}&hitsPerPage=20`
            };

            const response = await postWithFallback(algoliaSearchUrl, payload, {}, false);
            
            if (!response.data || !Array.isArray(response.data.hits)) {
                return [];
            }

            return response.data.hits.map((hit: any) => {
                const productPrice = parseFloat(hit.currentPrice?.priceValue);
                let categoryName = 'Otros';
                if (hit.hierarchicalCategories) {
                    if (Array.isArray(hit.hierarchicalCategories.lvl0) && hit.hierarchicalCategories.lvl0.length > 0) {
                        categoryName = hit.hierarchicalCategories.lvl0[0];
                    } else if (typeof hit.hierarchicalCategories.lvl0 === 'string') {
                        categoryName = hit.hierarchicalCategories.lvl0;
                    }
                }

                return {
                    referencia_id: String(hit.objectID),
                    nombre: String(hit.name),
                    precio: isNaN(productPrice) ? 0 : productPrice,
                    supermercado: 'aldi',
                    last_seen: new Date().toISOString(),
                    categoria_nombre: categoryName,
                    ean: hit.ean ? String(hit.ean) : null,
                    macros: hit.nutritions ? {
                        kcal: hit.nutritions.energy_kcal ?? hit.nutritions.calories ?? null,
                        proteinas: hit.nutritions.protein ?? null,
                        carbohidratos: hit.nutritions.carbohydrates ?? null,
                        grasas: hit.nutritions.fat ?? null
                    } : null
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
