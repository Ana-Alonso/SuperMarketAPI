import axios from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import { supabase } from '../supabase';
import { Macros } from '../types/scraper';
import { fetchMacrosByEAN, searchByName } from './openfoodfacts';

const REFERENCE_CP = process.env.REFERENCE_CP || '09200';
const MERCADONA_PRODUCT_DETAIL_URL = 'https://tienda.mercadona.es/api/products';
const MERCADONA_SESSION_URL = 'https://tienda.mercadona.es/api/postal-codes/actions/change-pc/';
const MAX_PRODUCTS_PER_ENRICHMENT_BATCH = 20;
const DELAY_BETWEEN_REQUESTS_MS = 400;

// ─── Persist ──────────────────────────────────────────────────────────────────

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

// ─── Mercadona: obtiene EAN desde API de detalle ──────────────────────────────

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

async function enrichMercadonaBatch(
    referenciaIds: string[]
): Promise<{ enriched: number; skipped: number; failed: number }> {
    const mercadonaClient = await buildMercadonaSessionClient();
    if (!mercadonaClient) return { enriched: 0, skipped: 0, failed: referenciaIds.length };

    let enriched = 0, skipped = 0, failed = 0;

    for (const productId of referenciaIds) {
        try {
            const { data: existing } = await supabase
                .from('productos')
                .select('ean, kcal, nombre')
                .eq('supermercado_id', 'mercadona')
                .eq('referencia_id', productId)
                .maybeSingle();

            if (existing?.kcal !== null && existing?.kcal !== undefined) { skipped++; continue; }

            let ean: string | null = existing?.ean ?? null;

            // Intenta obtener EAN desde el detalle de Mercadona
            if (!ean) {
                try {
                    const detailResponse = await mercadonaClient.get(`${MERCADONA_PRODUCT_DETAIL_URL}/${productId}/`);
                    ean = detailResponse.data.ean ? String(detailResponse.data.ean) : null;
                } catch {
                    // Continuamos sin EAN
                }
            }

            // 1er intento: OFF por EAN
            let macros: Macros | null = ean ? await fetchMacrosByEAN(ean) : null;

            // 2do intento: OFF por nombre del producto
            if (!macros && existing?.nombre) {
                const offResults = await searchByName(existing.nombre, 3);
                macros = offResults[0]?.macros ?? null;
            }

            await persistEnrichedProductData('mercadona', productId, ean, macros);
            enriched++;

            await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_REQUESTS_MS));
        } catch {
            failed++;
        }
    }

    return { enriched, skipped, failed };
}

// ─── Enriquecimiento genérico por nombre (todos los demás supermercados) ──────

async function enrichGenericBatch(
    supermarketId: string,
    products: Array<{ referencia_id: string; nombre: string; ean: string | null }>
): Promise<{ enriched: number; skipped: number; failed: number }> {
    let enriched = 0, skipped = 0, failed = 0;

    for (const product of products) {
        try {
            // 1er intento: OFF por EAN si existe
            let macros: Macros | null = product.ean
                ? await fetchMacrosByEAN(product.ean)
                : null;

            // 2do intento: OFF por nombre
            if (!macros) {
                const offResults = await searchByName(product.nombre, 3);
                macros = offResults[0]?.macros ?? null;
            }

            if (macros) {
                await persistEnrichedProductData(supermarketId, product.referencia_id, product.ean, macros);
                enriched++;
            } else {
                skipped++;
            }

            await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_REQUESTS_MS));
        } catch {
            failed++;
        }
    }

    return { enriched, skipped, failed };
}

// ─── Exports públicos ─────────────────────────────────────────────────────────

/** Enriquecimiento en background de Mercadona (no bloquea la respuesta HTTP) */
export function enrichMercadonaProductsInBackground(referenciaIds: string[]): void {
    const batchedIds = referenciaIds.slice(0, MAX_PRODUCTS_PER_ENRICHMENT_BATCH);
    if (batchedIds.length === 0) return;
    enrichMercadonaBatch(batchedIds);
}

export interface EnrichmentResult {
    total_pending: number;
    processed: number;
    enriched: number;
    skipped: number;
    failed: number;
}

/** Enriquece un lote de productos pendientes de Mercadona (llamado por el cron) */
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
    const result = await enrichMercadonaBatch(referenciaIds);
    return { total_pending: count ?? 0, processed: referenciaIds.length, ...result };
}

/**
 * Enriquece productos de CUALQUIER supermercado que no tengan macros.
 * Usa OpenFoodFacts por EAN (si existe) o por nombre como fallback.
 */
export async function enrichPendingProductsAllSupermarkets(
    supermarketId: string,
    batchSize: number = 20
): Promise<EnrichmentResult> {
    // Mercadona tiene su propio flujo con el cliente de sesión
    if (supermarketId.toLowerCase() === 'mercadona') {
        return enrichPendingMercadonaProducts(batchSize);
    }

    const { data: pending, count } = await supabase
        .from('productos')
        .select('referencia_id, nombre, ean', { count: 'exact' })
        .eq('supermercado_id', supermarketId.toLowerCase())
        .is('kcal', null)
        .limit(batchSize);

    if (!pending || pending.length === 0) {
        return { total_pending: 0, processed: 0, enriched: 0, skipped: 0, failed: 0 };
    }

    const result = await enrichGenericBatch(supermarketId.toLowerCase(), pending as any);
    return { total_pending: count ?? 0, processed: pending.length, ...result };
}
