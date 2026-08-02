/**
 * Servicio de OpenFoodFacts para SuperMarket API
 *
 * Búsqueda de macros y EAN por:
 *   - Código de barras (EAN) → /api/v2/product/:ean
 *   - Nombre de producto   → /cgi/search.pl?search_terms=...
 *
 * API pública, sin autenticación, con User-Agent obligatorio.
 * Docs: https://openfoodfacts.github.io/openfoodfacts-server/api/
 */

import axios from 'axios';
import { Macros } from '../types/scraper';

const OFF_BASE      = 'https://world.openfoodfacts.org';
const OFF_ES_BASE   = 'https://es.openfoodfacts.org';
const USER_AGENT    = 'SupermarketAPI/2.0 (https://github.com/Ana-Alonso/SuperMarketAPI)';
const TIMEOUT_MS    = 8000;

// ─────────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────────

export interface OFFProduct {
    ean: string;
    nombre: string;
    marca?: string;
    macros: Macros;
    imagen?: string;
    categorias?: string[];
    /** Puntuación Nutri-Score (a/b/c/d/e) si está disponible */
    nutriscore?: string;
}

interface OFFNutriments {
    'energy-kcal_100g'?:    number;
    'proteins_100g'?:        number;
    'carbohydrates_100g'?:   number;
    'fat_100g'?:             number;
    'fiber_100g'?:           number;
    'sugars_100g'?:          number;
    'salt_100g'?:            number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers internos
// ─────────────────────────────────────────────────────────────────────────────

function extractMacros(nutriments: OFFNutriments): Macros {
    return {
        kcal:          nutriments['energy-kcal_100g']    ?? null,
        proteinas:     nutriments['proteins_100g']        ?? null,
        carbohidratos: nutriments['carbohydrates_100g']   ?? null,
        grasas:        nutriments['fat_100g']             ?? null
    };
}

function mapOFFProduct(raw: any): OFFProduct | null {
    if (!raw?.code || !raw?.product) return null;

    const p = raw.product;
    const nutriments: OFFNutriments = p.nutriments ?? {};
    const macros = extractMacros(nutriments);

    // Descarta si no hay ningún macro útil
    if (macros.kcal === null && macros.proteinas === null) return null;

    return {
        ean:        raw.code,
        nombre:     (p.product_name_es || p.product_name || p.abbreviated_product_name || '').trim(),
        marca:      p.brands ?? undefined,
        macros,
        imagen:     p.image_front_url ?? p.image_url ?? undefined,
        categorias: p.categories_tags
            ?.filter((t: string) => t.startsWith('en:') || t.startsWith('es:'))
            .map((t: string) => t.replace(/^(en:|es:)/, ''))
            .slice(0, 3),
        nutriscore: p.nutriscore_grade ?? undefined
    };
}

function mapOFFSearchItem(item: any): OFFProduct | null {
    const nutriments: OFFNutriments = item.nutriments ?? {};
    const macros = extractMacros(nutriments);

    if (!item.code || (macros.kcal === null && macros.proteinas === null)) return null;

    return {
        ean:        item.code,
        nombre:     (item.product_name_es || item.product_name || '').trim(),
        marca:      item.brands ?? undefined,
        macros,
        imagen:     item.image_front_url ?? item.image_url ?? undefined,
        nutriscore: item.nutriscore_grade ?? undefined
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// API pública del módulo
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Busca un producto por código EAN/barcode.
 * Devuelve null si no existe o no tiene macros.
 */
export async function getProductByEAN(ean: string): Promise<OFFProduct | null> {
    try {
        const response = await axios.get(
            `${OFF_BASE}/api/v2/product/${ean}.json`,
            {
                params: {
                    fields: 'code,product_name,product_name_es,brands,nutriments,image_front_url,categories_tags,nutriscore_grade'
                },
                timeout: TIMEOUT_MS,
                headers: { 'User-Agent': USER_AGENT }
            }
        );

        if (response.data?.status !== 1) return null;
        return mapOFFProduct(response.data);
    } catch {
        return null;
    }
}

/**
 * Busca productos por nombre en OpenFoodFacts.
 * Devuelve hasta `limit` resultados con macros disponibles.
 *
 * Estrategia:
 *   1. Busca primero en el índice español (es.openfoodfacts.org)
 *   2. Si hay pocos resultados, completa con el índice mundial
 */
export async function searchByName(
    query: string,
    limit: number = 10
): Promise<OFFProduct[]> {
    const results: OFFProduct[] = [];
    const seenEans = new Set<string>();

    const fetchFromBase = async (base: string, pageSize: number): Promise<void> => {
        try {
            const response = await axios.get(`${base}/cgi/search.pl`, {
                params: {
                    search_terms:   query,
                    json:           1,
                    page_size:      pageSize,
                    page:           1,
                    sort_by:        'unique_scans_n',    // más populares primero
                    action:         'process',
                    fields: 'code,product_name,product_name_es,brands,nutriments,image_front_url,nutriscore_grade'
                },
                timeout: TIMEOUT_MS,
                headers: { 'User-Agent': USER_AGENT }
            });

            const products: any[] = response.data?.products ?? [];
            for (const item of products) {
                if (results.length >= limit) break;
                if (item.code && seenEans.has(item.code)) continue;
                const mapped = mapOFFSearchItem(item);
                if (mapped && mapped.nombre) {
                    results.push(mapped);
                    seenEans.add(item.code);
                }
            }
        } catch {
            // Ignorado — intenta con el otro índice
        }
    };

    // 1. Índice español (más relevante para España)
    await fetchFromBase(OFF_ES_BASE, Math.ceil(limit * 1.5));

    // 2. Complementar con índice mundial si faltan resultados
    if (results.length < limit) {
        await fetchFromBase(OFF_BASE, limit * 2);
    }

    return results.slice(0, limit);
}

/**
 * Enriquece los macros de un producto a partir de su EAN.
 * Devuelve null si no se encuentra o no hay datos nutricionales.
 * Versión exportable para usar desde nutrition-enrichment.ts
 */
export async function fetchMacrosByEAN(ean: string): Promise<Macros | null> {
    const product = await getProductByEAN(ean);
    if (!product) return null;
    const m = product.macros;
    if (m.kcal === null && m.proteinas === null && m.carbohidratos === null && m.grasas === null) {
        return null;
    }
    return m;
}
