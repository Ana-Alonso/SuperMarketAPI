import axios from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import { supabase } from '../supabase';
import { Macros } from '../types/scraper';

const REFERENCE_CP = process.env.REFERENCE_CP || '09200';
const OPEN_FOOD_FACTS_BASE_URL = 'https://world.openfoodfacts.org/api/v2/product';
const MERCADONA_PRODUCT_DETAIL_URL = 'https://tienda.mercadona.es/api/products';
const MERCADONA_SESSION_URL = 'https://tienda.mercadona.es/api/postal-codes/actions/change-pc/';
const MAX_PRODUCTS_PER_ENRICHMENT_BATCH = 20;
const DELAY_BETWEEN_REQUESTS_MS = 300;

async function fetchMacrosFromOpenFoodFacts(ean: string): Promise<Macros | null> {
    try {
        const response = await axios.get(`${OPEN_FOOD_FACTS_BASE_URL}/${ean}.json`, {
            params: { fields: 'nutriments' },
            timeout: 8000,
            headers: { 'User-Agent': 'SupermarketAPI/1.0 (contact@supermarket-api.com)' }
        });

        if (response.data.status !== 1 || !response.data.product?.nutriments) return null;

        const nutriments = response.data.product.nutriments;
        return {
            kcal: nutriments['energy-kcal_100g'] ?? null,
            proteinas: nutriments['proteins_100g'] ?? null,
            carbohidratos: nutriments['carbohydrates_100g'] ?? null,
            grasas: nutriments['fat_100g'] ?? null
        };
    } catch {
        return null;
    }
}

async function persistEnrichedProductData(
    supermarketId: string,
    referenciaId: string,
    ean: string | null,
    macros: Macros | null
): Promise<void> {
    await supabase
        .from('productos')
        .update({
            ean: ean ?? null,
            kcal: macros?.kcal ?? null,
            proteinas: macros?.proteinas ?? null,
            carbohidratos: macros?.carbohidratos ?? null,
            grasas: macros?.grasas ?? null
        })
        .eq('supermercado_id', supermarketId)
        .eq('referencia_id', referenciaId);
}

async function buildMercadonaSessionClient(): Promise<ReturnType<typeof wrapper> | null> {
    try {
        const jar = new CookieJar();
        const client = wrapper(axios.create({ jar, timeout: 6000 }));
        await client.post(MERCADONA_SESSION_URL, { new_postal_code: REFERENCE_CP });
        return client;
    } catch {
        return null;
    }
}

async function enrichBatch(referenciaIds: string[]): Promise<{ enriched: number; skipped: number; failed: number }> {
    const mercadonaClient = await buildMercadonaSessionClient();
    if (!mercadonaClient) return { enriched: 0, skipped: 0, failed: referenciaIds.length };

    let enriched = 0;
    let skipped = 0;
    let failed = 0;

    for (const productId of referenciaIds) {
        try {
            const { data: existingProduct } = await supabase
                .from('productos')
                .select('ean, kcal')
                .eq('supermercado_id', 'mercadona')
                .eq('referencia_id', productId)
                .maybeSingle();

            if (existingProduct?.kcal !== null && existingProduct?.kcal !== undefined) {
                skipped++;
                continue;
            }

            let ean: string | null = existingProduct?.ean ?? null;

            if (!ean) {
                const detailResponse = await mercadonaClient.get(`${MERCADONA_PRODUCT_DETAIL_URL}/${productId}/`);
                ean = detailResponse.data.ean ? String(detailResponse.data.ean) : null;
            }

            const macros = ean ? await fetchMacrosFromOpenFoodFacts(ean) : null;
            await persistEnrichedProductData('mercadona', productId, ean, macros);
            enriched++;

            await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_REQUESTS_MS));
        } catch {
            failed++;
        }
    }

    return { enriched, skipped, failed };
}

export function enrichMercadonaProductsInBackground(referenciaIds: string[]): void {
    const batchedIds = referenciaIds.slice(0, MAX_PRODUCTS_PER_ENRICHMENT_BATCH);
    if (batchedIds.length === 0) return;
    enrichBatch(batchedIds);
}

export interface EnrichmentResult {
    total_pending: number;
    processed: number;
    enriched: number;
    skipped: number;
    failed: number;
}

export async function enrichPendingMercadonaProducts(batchSize: number = 20): Promise<EnrichmentResult> {
    const { data: pendingProducts, count } = await supabase
        .from('productos')
        .select('referencia_id', { count: 'exact' })
        .eq('supermercado_id', 'mercadona')
        .is('kcal', null)
        .limit(batchSize);

    if (!pendingProducts || pendingProducts.length === 0) {
        return { total_pending: 0, processed: 0, enriched: 0, skipped: 0, failed: 0 };
    }

    const referenciaIds = pendingProducts.map(p => p.referencia_id);
    const result = await enrichBatch(referenciaIds);

    return {
        total_pending: count ?? 0,
        processed: referenciaIds.length,
        ...result
    };
}
