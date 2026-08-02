import express, { Request, Response } from 'express';

const app = express();
app.use(express.json());

// Almacenar el código postal de la sesión en memoria
let sessionPostalCode: string | null = null;

// Endpoint 1: Handshake de código postal
app.post('/api/v1/session/postalcode', (req: Request, res: Response) => {
    const { postal_code } = req.body;
    
    if (!postal_code) {
        return res.status(400).json({ error: "Falta el código postal." });
    }
    
    sessionPostalCode = postal_code;
    console.log(`[Mock Supermarket] Sesión establecida con el CP de referencia: ${postal_code}`);
    
    res.setHeader('Set-Cookie', 'mock_session_id=supermarket-session-12345; Path=/; HttpOnly');
    res.status(200).json({ status: "success", session: { postal_code } });
});

// Base de datos local simulada con categorías unificadas
interface MockProduct {
    id: string;
    display_name: string;
    price: string;
    supermarket: string;
    category: string;
}

const MOCK_PRODUCTS_DATABASE: MockProduct[] = [
    // === MERCADONA ===
    { id: "m01", display_name: "Leche entera Hacendado 1L", price: "0.95", supermarket: "mercadona", category: "Lácteos" },
    { id: "m02", display_name: "Leche semidesnatada Hacendado 1L", price: "0.90", supermarket: "mercadona", category: "Lácteos" },
    { id: "m03", display_name: "Leche desnatada Hacendado 1L", price: "0.92", supermarket: "mercadona", category: "Lácteos" },
    { id: "m04", display_name: "Leche sin lactosa entera Hacendado 1L", price: "1.05", supermarket: "mercadona", category: "Lácteos" },
    { id: "m05", display_name: "Pan de molde familiar Hacendado", price: "1.25", supermarket: "mercadona", category: "Panadería" },
    { id: "m06", display_name: "Pan de molde integral Hacendado", price: "1.35", supermarket: "mercadona", category: "Panadería" },
    { id: "m07", display_name: "Pan rallado Hacendado 500g", price: "0.85", supermarket: "mercadona", category: "Panadería" },
    { id: "m08", display_name: "Baguette Hacendado de horno", price: "0.45", supermarket: "mercadona", category: "Panadería" },
    { id: "m09", display_name: "Tomate frito Hacendado", price: "0.70", supermarket: "mercadona", category: "Conservas y Aceites" },
    { id: "m10", display_name: "Tomate frito estilo casero Hacendado", price: "1.10", supermarket: "mercadona", category: "Conservas y Aceites" },

    // === EROSKI ===
    { id: "e01", display_name: "Leche entera Eroski 1L", price: "0.98", supermarket: "eroski", category: "Lácteos" },
    { id: "e02", display_name: "Leche semidesnatada Eroski 1L", price: "0.93", supermarket: "eroski", category: "Lácteos" },
    { id: "e03", display_name: "Leche desnatada Eroski 1L", price: "0.95", supermarket: "eroski", category: "Lácteos" },
    { id: "e04", display_name: "Leche sin lactosa semidesnatada Eroski 1L", price: "1.08", supermarket: "eroski", category: "Lácteos" },
    { id: "e05", display_name: "Pan rústico Eroski", price: "1.40", supermarket: "eroski", category: "Panadería" },
    { id: "e06", display_name: "Pan de molde Eroski", price: "1.20", supermarket: "eroski", category: "Panadería" },
    { id: "e07", display_name: "Pan rallado Eroski 500g", price: "0.90", supermarket: "eroski", category: "Panadería" },
    { id: "e08", display_name: "Galletas Eroski Basic", price: "1.10", supermarket: "eroski", category: "Dulces y Chocolates" },

    // === DIA ===
    { id: "d01", display_name: "Leche entera Dia Láctea 1L", price: "0.93", supermarket: "dia", category: "Lácteos" },
    { id: "d02", display_name: "Leche semidesnatada Dia Láctea 1L", price: "0.88", supermarket: "dia", category: "Lácteos" },
    { id: "d03", display_name: "Leche desnatada Dia Láctea 1L", price: "0.90", supermarket: "dia", category: "Lácteos" },
    { id: "d04", display_name: "Leche desnatada con calcio Dia Láctea 1L", price: "1.02", supermarket: "dia", category: "Lácteos" },
    { id: "d05", display_name: "Pan de molde Dia", price: "1.19", supermarket: "dia", category: "Panadería" },
    { id: "d06", display_name: "Pan de molde sin corteza Dia", price: "1.45", supermarket: "dia", category: "Panadería" },
    { id: "d07", display_name: "Pan rallado con ajo y perejil Dia 500g", price: "0.99", supermarket: "dia", category: "Panadería" },
    { id: "d08", display_name: "Atún en aceite Dia 3-pack", price: "2.35", supermarket: "dia", category: "Conservas y Aceites" },

    // === ALDI ===
    { id: "a01", display_name: "Leche ecológica GutBio Aldi 1L", price: "1.05", supermarket: "aldi", category: "Lácteos" },
    { id: "a02", display_name: "Leche semidesnatada Milsani Aldi 1L", price: "0.89", supermarket: "aldi", category: "Lácteos" },
    { id: "a03", display_name: "Leche desnatada Milsani Aldi 1L", price: "0.91", supermarket: "aldi", category: "Lácteos" },
    { id: "a04", display_name: "Leche sin lactosa Milsani Aldi 1L", price: "1.00", supermarket: "aldi", category: "Lácteos" },
    { id: "a05", display_name: "Pan de centeno Aldi", price: "1.65", supermarket: "aldi", category: "Panadería" },
    { id: "a06", display_name: "Pan de molde integral Aldi", price: "1.29", supermarket: "aldi", category: "Panadería" },
    { id: "a07", display_name: "Panecillos de Viena Aldi 6-pack", price: "1.15", supermarket: "aldi", category: "Panadería" },
    { id: "a08", display_name: "Chocolate Moser Roth Aldi 125g", price: "1.99", supermarket: "aldi", category: "Dulces y Chocolates" },

    // === CARREFOUR ===
    { id: "c01", display_name: "Leche entera Carrefour 1L", price: "0.96", supermarket: "carrefour", category: "Lácteos" },
    { id: "c02", display_name: "Leche semidesnatada Carrefour 1L", price: "0.91", supermarket: "carrefour", category: "Lácteos" },
    { id: "c03", display_name: "Leche desnatada Carrefour 1L", price: "0.93", supermarket: "carrefour", category: "Lácteos" },
    { id: "c04", display_name: "Leche sin lactosa Carrefour 1L", price: "1.02", supermarket: "carrefour", category: "Lácteos" },
    { id: "c05", display_name: "Pan de molde sin corteza Carrefour", price: "1.30", supermarket: "carrefour", category: "Panadería" },
    { id: "c06", display_name: "Pan rústico de trigo Carrefour", price: "1.25", supermarket: "carrefour", category: "Panadería" },
    { id: "c07", display_name: "Pan rallado tradicional Carrefour 500g", price: "0.80", supermarket: "carrefour", category: "Panadería" }
];

// Endpoint 2: Búsqueda de productos
app.get('/api/v1/search', (req: Request, res: Response) => {
    const query = (req.query.q as string || '').toLowerCase();
    const supermarket = (req.query.supermarket as string || 'mercadona').toLowerCase();
    
    if (!query) {
        return res.status(400).json({ error: "Falta parámetro de búsqueda 'q'." });
    }
    
    console.log(`[Mock Supermarket] Búsqueda recibida para '${supermarket}': q="${query}"`);

    // Validamos que se haya establecido el código postal antes de permitir la búsqueda
    if (!sessionPostalCode) {
        return res.status(403).json({ error: "Acceso prohibido. Debe establecer un código postal primero." });
    }

    // Filtrar productos que contengan la consulta en su nombre y correspondan al supermercado
    const results = MOCK_PRODUCTS_DATABASE.filter(item => 
        item.supermarket === supermarket && 
        item.display_name.toLowerCase().includes(query)
    ).map(item => ({
        id: item.id,
        display_name: item.display_name,
        category: item.category, // Incluimos la categoría unificada
        price_details: {
            unit_price: item.price
        }
    }));

    res.status(200).json({ results });
});

const PORT = 8001;
app.listen(PORT, () => {
    console.log(`================================================================`);
    console.log(`📡 Supermercado Mock corriendo en http://localhost:${PORT}`);
    console.log(`Soportando catálogos normalizados para: mercadona, eroski, dia, aldi, carrefour`);
    console.log(`================================================================`);
});
