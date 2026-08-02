![CI](https://github.com/Ana-Alonso/SuperMarketAPI/actions/workflows/ci.yml/badge.svg)

# API de Agregación de Supermercados & OpenFoodFacts 🛒

Servicio REST de alto rendimiento que unifica la búsqueda de productos, comparación de precios en tiempo real de supermercados de España (**Mercadona**, **Eroski**, **Dia**, **Carrefour** y **Aldi**) e integración nativa con la base de datos nutricional de **OpenFoodFacts**.

Desarrollado como el motor de precios e información nutricional de *Calla y Come* (https://github.com/Ana-Alonso/CallayCome), utiliza una estrategia **Cache-First** inteligente con enrutamiento anti-bot y enriquecimiento automático de macronutrientes.

> **URL de Producción:** `https://supermarketapi-z9yb.onrender.com`

---

## 🏗️ Arquitectura & Seguridad

* **Cache-First:** Las búsquedas consultan Supabase antes de realizar scraping externo, minimizando latencia y consumo de cuotas.
* **Búsqueda Paralela:** En la búsqueda global, todos los supermercados se consultan simultáneamente con `Promise.all`.
* **Integración OpenFoodFacts:** Motor propio de consulta nutricional (EAN + búsqueda por nombre) con fallback automático para obtener kcal, proteínas, carbohidratos y grasas de cualquier producto.
* **Seguridad HTTP (Helmet.js):** Cabeceras de seguridad activas (XSS protection, MIME sniffing protection, etc.).
* **Rate Limiting:** Protección global (200 req/15min por IP), búsquedas de supermercado (30 req/15min) y búsquedas de OpenFoodFacts (60 req/15min).
* **Row Level Security (RLS):** Las tablas de productos en Supabase sólo permiten inserciones/modificaciones desde la clave `service_role` (backend exclusivo). Lectura pública controlada.
* **Autenticación JWT:** Endpoints de supermercado protegidos mediante tokens JWT de Supabase Auth.

---

## 🛠️ Instalación Local

### 1. Instalar Dependencias
```bash
npm install
```

### 2. Configurar la Base de Datos
Ejecuta el archivo `schema_productos.sql` y las migraciones de RLS en el SQL Editor de Supabase.

### 3. Variables de Entorno (`.env`)
```env
PORT=8000
SUPABASE_URL=https://tu-proyecto.supabase.co
SUPABASE_KEY=tu-clave-service-role-o-anon
REFERENCE_CP=09200
ZENROWS_APIKEY=tu-clave-de-zenrows
INTERNAL_API_KEY=tu-clave-para-cron-jobs
```

### 4. Arrancar el Servidor
```bash
npm run dev
```

---

## 🔒 Autenticación

Los endpoints de búsqueda de supermercados requieren un token Bearer JWT. El flujo es:

1. Llama al endpoint de login con tus credenciales → obtienes un `access_token`.
2. Incluye ese token en la cabecera `Authorization: Bearer <token>` de cada petición.

Los endpoints de **OpenFoodFacts** son públicos.

---

## 📡 Endpoints REST

### `POST /api/v1/auth/login`
Autentica al usuario y devuelve el token de acceso JWT.

---

### `GET /api/v1/supermercados/search?q={criterio}`
Busca en todos los supermercados en paralelo y devuelve los resultados ordenados por precio ascendente.

**Cabecera requerida:** `Authorization: Bearer <access_token>`

---

### `GET /api/v1/supermercados/:id/search?q={criterio}`
Busca en un supermercado específico (`mercadona` · `carrefour` · `dia` · `aldi` · `eroski`).

**Cabecera requerida:** `Authorization: Bearer <access_token>`

---

### 🥗 Endpoints OpenFoodFacts (Públicos)

#### `GET /api/v1/openfoodfacts/search?q={alimento}&limit=10`
Busca alimentos/ingredientes con desglose nutricional completo en OpenFoodFacts. No requiere token.

**Ejemplo:**
```bash
curl -X GET "https://supermarketapi-z9yb.onrender.com/api/v1/openfoodfacts/search?q=leche&limit=5"
```

**Respuesta (`200 OK`):**
```json
{
  "status": "success",
  "query": "leche",
  "total": 5,
  "products": [
    {
      "ean": "8410000000000",
      "nombre": "Leche entera",
      "marca": "Hacendado",
      "macros": {
        "kcal": 63,
        "proteinas": 3.1,
        "carbohidratos": 4.7,
        "grasas": 3.6
      },
      "nutriscore": "b"
    }
  ]
}
```

#### `GET /api/v1/openfoodfacts/barcode/:ean`
Obtiene los macronutrientes de un producto a partir de su código de barras EAN.

---

## ⚙️ Enriquecimiento Automático de Macros (Cron Job)

### `POST /api/v1/internal/enrich-macros?supermarket={id}&batch=20`
Endpoint interno llamado por GitHub Actions para enriquecer los productos sin información nutricional usando OpenFoodFacts.

**Cabecera requerida:** `x-internal-key: <INTERNAL_API_KEY>`

---

## ⚠️ Respuestas de Error

| Código HTTP | `type`                      | Descripción                                       |
|-------------|-----------------------------|---------------------------------------------------|
| `400`       | `MISSING_PARAMETER`         | Falta el parámetro `q` en la petición             |
| `400`       | `INVALID_INPUT`             | Parámetros inválidos                              |
| `401`       | `UNAUTHORIZED`              | No se ha enviado cabecera `Authorization` o clave |
| `401`       | `INVALID_TOKEN`             | Token JWT inválido o expirado                     |
| `404`       | `NOT_FOUND`                 | Recurso o supermercado no encontrado              |
| `429`       | `RATE_LIMIT_EXCEEDED`       | Límite de peticiones superado por IP              |
| `502`       | `INTERNAL_SERVER_ERROR`     | Error interno del servidor                        |
