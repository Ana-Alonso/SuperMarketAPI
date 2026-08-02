export interface Macros {
    kcal: number | null;
    proteinas: number | null;
    carbohidratos: number | null;
    grasas: number | null;
}

export interface ScrapedProduct {
    referencia_id: string;
    nombre: string;
    precio: number;
    supermercado: string;
    last_seen: string;
    categoria_nombre?: string;
    ean?: string | null;
    macros?: Macros | null;
}

export interface Scraper {
    search(query: string, referenceCp: string): Promise<ScrapedProduct[]>;
}
