import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import { supabase } from './supabase';
import { scraperRegistry } from './scrapers/registry';
import { ScrapedProduct } from './types/scraper';
import { requireAuth } from './middleware/auth';
import { enrichMercadonaProductsInBackground, enrichPendingMercadonaProducts } from './services/nutrition-enrichment';

dotenv.config();

if (process.env.NODE_ENV === 'production') {
    console.log = () => {};
    console.warn = () => {};
    console.error = () => {};
}

const REFERENCE_CP = process.env.REFERENCE_CP || '09200';
const CACHE_TTL_HOURS = parseInt(process.env.CACHE_TTL_HOURS || '24', 10);

const appExpress = express();
appExpress.use(express.json());

// ── Rate Limiting (RGPD / protección de cuota de APIs) ──────────────────────
// Límite global: 200 peticiones por IP cada 15 minutos
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: {
        status: 'error',
        error: {
            type: 'RATE_LIMIT_EXCEEDED',
            description: 'Demasiadas peticiones. Por favor, inténtalo de nuevo en 15 minutos.'
        }
    }
});

// Límite estricto para búsquedas (activan scraping + ZenRows): 30/15 min por IP
export const searchLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: {
        status: 'error',
        error: {
            type: 'SEARCH_RATE_LIMIT_EXCEEDED',
            description: 'Límite de búsquedas alcanzado. Por favor, espera 15 minutos antes de continuar.'
        }
    }
});

appExpress.use(globalLimiter);

const categoryIdCache: Record<string, number> = {};

async function resolveCategoryId(categoryName: string): Promise<number | null> {
    const normalizedCategoryName = categoryName.trim();
    if (!normalizedCategoryName) return null;

    if (categoryIdCache[normalizedCategoryName]) {
        return categoryIdCache[normalizedCategoryName];
    }

    try {
        const { data: existingCategory, error: fetchError } = await supabase
            .from('categorias')
            .select('id')
            .eq('nombre', normalizedCategoryName)
            .maybeSingle();

        if (fetchError) {
            return null;
        }

        if (existingCategory) {
            categoryIdCache[normalizedCategoryName] = Number(existingCategory.id);
            return Number(existingCategory.id);
        }

        const { data: newCategory, error: insertError } = await supabase
            .from('categorias')
            .insert({ nombre: normalizedCategoryName })
            .select('id')
            .single();

        if (insertError) {
            return null;
        }

        if (newCategory) {
            categoryIdCache[normalizedCategoryName] = Number(newCategory.id);
            return Number(newCategory.id);
        }
    } catch (exception) {
        // Ignored
    }

    return null;
}

async function searchProductsForSupermarket(supermarketId: string, query: string, referenceCp: string): Promise<ScrapedProduct[]> {
    const normalizedSupermarketId = supermarketId.toLowerCase();
    let dbCachedProducts: any[] | null = null;
    
    try {
        const cacheStaleCutoff = new Date(Date.now() - CACHE_TTL_HOURS * 60 * 60 * 1000).toISOString();

        const { data: cachedItems, error: queryError } = await supabase
            .from('productos')
            .select('id, referencia_id, nombre, precio, supermercado_id, last_seen, categoria_id, categorias (nombre), ean, kcal, proteinas, carbohidratos, grasas')
            .eq('supermercado_id', normalizedSupermarketId)
            .ilike('nombre', `%${query}%`)
            .gt('last_seen', cacheStaleCutoff)
            .limit(15);

        if (!queryError) {
            dbCachedProducts = cachedItems;
        }
    } catch (queryException) {
        // Ignored
    }

    if (dbCachedProducts && dbCachedProducts.length > 0) {
        if (normalizedSupermarketId === 'mercadona') {
            const cachedIdsWithoutMacros = dbCachedProducts
                .filter(item => item.kcal === null || item.kcal === undefined)
                .map(item => item.referencia_id);

            if (cachedIdsWithoutMacros.length > 0) {
                enrichMercadonaProductsInBackground(cachedIdsWithoutMacros);
            }
        }

        return dbCachedProducts.map(item => ({
            referencia_id: item.referencia_id,
            nombre: item.nombre,
            precio: parseFloat(item.precio),
            supermercado: item.supermercado_id,
            last_seen: item.last_seen,
            categoria_nombre: item.categorias?.nombre || 'Otros',
            ean: item.ean ?? null,
            macros: (item.kcal != null || item.proteinas != null)
                ? {
                    kcal: item.kcal ?? null,
                    proteinas: item.proteinas ?? null,
                    carbohidratos: item.carbohidratos ?? null,
                    grasas: item.grasas ?? null
                }
                : null
        }));
    }

    const matchedScraper = scraperRegistry[normalizedSupermarketId];
    if (!matchedScraper) {
        return [];
    }

    const liveScrapedProducts = await matchedScraper.search(query, referenceCp);
    if (liveScrapedProducts.length === 0) {
        return [];
    }

    try {
        const upsertPayload = [];
        for (const product of liveScrapedProducts) {
            const resolvedCategoryId = product.categoria_nombre 
                ? await resolveCategoryId(product.categoria_nombre) 
                : null;

            upsertPayload.push({
                referencia_id: product.referencia_id,
                nombre: product.nombre,
                precio: product.precio,
                supermercado_id: normalizedSupermarketId,
                categoria_id: resolvedCategoryId,
                last_seen: product.last_seen,
                ean: product.ean ?? null,
                kcal: product.macros?.kcal ?? null,
                proteinas: product.macros?.proteinas ?? null,
                carbohidratos: product.macros?.carbohidratos ?? null,
                grasas: product.macros?.grasas ?? null
            });
        }

        await supabase
            .from('productos')
            .upsert(upsertPayload, { onConflict: 'supermercado_id,referencia_id' });
    } catch (upsertException) {
        // Ignored
    }

    if (normalizedSupermarketId === 'mercadona') {
        const liveIdsWithoutMacros = liveScrapedProducts
            .filter(p => !p.macros)
            .map(p => p.referencia_id);

        if (liveIdsWithoutMacros.length > 0) {
            enrichMercadonaProductsInBackground(liveIdsWithoutMacros);
        }
    }

    return liveScrapedProducts;
}

appExpress.post('/api/v1/internal/enrich-macros', async (req: Request, res: Response): Promise<void> => {
    const providedKey = req.headers['x-internal-key'];
    const expectedKey = process.env.INTERNAL_API_KEY;

    if (!expectedKey || providedKey !== expectedKey) {
        res.status(401).json({ status: 'error', error: { type: 'UNAUTHORIZED', description: 'Clave interna inválida.' } });
        return;
    }

    const batchSize = Math.min(parseInt(String(req.query.batch ?? '20'), 10), 50);
    const result = await enrichPendingMercadonaProducts(batchSize);
    res.json({ status: 'success', data: result });
});

appExpress.post('/api/v1/auth/login', async (req: Request, res: Response): Promise<void> => {
    const { email, password } = req.body;

    if (!email || !password) {
        res.status(400).json({
            status: "error",
            error: {
                type: "INVALID_INPUT",
                description: "Se requieren email y password."
            }
        });
        return;
    }

    try {
        const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
            email,
            password
        });

        if (authError || !authData.session) {
            res.status(401).json({
                status: "error",
                error: {
                    type: "AUTH_FAILED",
                    description: authError?.message || "Credenciales invalidas."
                }
            });
            return;
        }

        res.status(200).json({
            status: "success",
            data: {
                access_token: authData.session.access_token,
                expires_in: authData.session.expires_in,
                refresh_token: authData.session.refresh_token
            }
        });
    } catch (loginException) {
        res.status(502).json({
            status: "error",
            error: {
                type: "INTERNAL_SERVER_ERROR",
                description: "Fallo interno en el proceso de autenticacion."
            }
        });
    }
});

appExpress.get('/api/v1/supermercados/search', searchLimiter, requireAuth, async (req: Request, res: Response): Promise<void> => {
    const query = req.query.q as string;

    if (!query) {
        res.status(400).json({
            status: "error",
            error: {
                type: "MISSING_PARAMETER",
                description: "Falta parámetro 'q'."
            }
        });
        return;
    }

    try {
        const activeSupermarketIds = Object.keys(scraperRegistry);
        const searchOperations = activeSupermarketIds.map(supermarketId => 
            searchProductsForSupermarket(supermarketId, query, REFERENCE_CP)
                .catch(() => [])
        );

        const resultsPerSupermarket = await Promise.all(searchOperations);
        const combinedResults = resultsPerSupermarket.flat();
        combinedResults.sort((firstItem, secondItem) => firstItem.precio - secondItem.precio);

        res.status(200).json({
            status: "success",
            data: combinedResults,
            meta: { 
                cp: REFERENCE_CP, 
                timestamp: new Date().toISOString(),
                total_results: combinedResults.length,
                supermarkets_searched: activeSupermarketIds
            }
        });
    } catch (globalSearchError) {
        res.status(502).json({
            status: "error",
            error: {
                type: "INTERNAL_SERVER_ERROR",
                description: "Fallo interno en la API de búsqueda global."
            }
        });
    }
});

appExpress.get('/api/v1/supermercados/:id/search', searchLimiter, requireAuth, async (req: Request, res: Response): Promise<void> => {
    const { id: supermarketId } = req.params;
    const query = req.query.q as string;

    if (!query) {
        res.status(400).json({
            status: "error",
            error: {
                type: "MISSING_PARAMETER",
                description: "Falta parámetro 'q'."
            }
        });
        return;
    }

    const matchedScraper = scraperRegistry[supermarketId.toLowerCase()];
    if (!matchedScraper) {
        res.status(404).json({
            status: "error",
            error: {
                type: "NOT_FOUND",
                description: `Supermercado '${supermarketId}' no soportado.`
            }
        });
        return;
    }

    try {
        const results = await searchProductsForSupermarket(supermarketId, query, REFERENCE_CP);
        res.status(200).json({
            status: "success",
            source: "api",
            data: results,
            meta: { cp: REFERENCE_CP, timestamp: new Date().toISOString() }
        });
    } catch (singleSearchError: any) {
        if (singleSearchError.message === 'BLOQUEADO') {
            res.status(429).json({
                status: "error",
                error: {
                    type: "RATE_LIMIT_EXCEEDED",
                    description: "Rate limit excedido."
                }
            });
        } else {
            res.status(502).json({
                status: "error",
                error: {
                    type: "INTERNAL_SERVER_ERROR",
                    description: "Fallo interno en la API."
                }
            });
        }
    }
});

const PORT = process.env.PORT || 8000;
appExpress.listen(PORT, () => {
    if (process.env.NODE_ENV !== 'production') {
        console.log("================================================================");
        console.log(`🚀 Scraper API corriendo en el puerto ${PORT}`);
        console.log(`📍 CP Referencia: ${REFERENCE_CP}`);
        console.log(`🔌 Supermercados soportados: ${Object.keys(scraperRegistry).join(', ')}`);
        console.log("================================================================");
    }
});
