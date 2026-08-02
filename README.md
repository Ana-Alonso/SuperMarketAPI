![CI](https://github.com/Ana-Alonso/SuperMarketAPI/actions/workflows/ci.yml/badge.svg)

# API de Agregación de Supermercados 🛒

Servicio REST que unifica la búsqueda de productos y comparación de precios en tiempo real de los principales supermercados de España: **Mercadona**, **Eroski**, **Dia**, **Carrefour** y **Aldi**.

Desarrollado como el motor de precios de la aplicación *Come y Calla*(https://github.com/Ana-Alonso/CallayCome), utiliza una estrategia **Cache-First** inteligente: consulta primero la base de datos relacional para devolver respuestas en milisegundos y, si los datos no están disponibles, activa motores de extracción *on-demand* sobre los supermercados y almacena los resultados automáticamente para futuras peticiones.

> **URL de Producción:** `https://supermarketapi-z9yb.onrender.com`

---

## 🏗️ Arquitectura

* **Cache-First:** Las búsquedas consultan Supabase antes de realizar scraping externo, minimizando latencia y consumo de cuota.
* **Búsqueda Paralela:** En la búsqueda global, todos los supermercados se consultan simultáneamente con `Promise.all`.
* **Autenticación JWT:** Las rutas de búsqueda están protegidas mediante tokens JWT de Supabase Auth validados en un middleware de Express.
* **Conectividad Resiliente:** Las peticiones de scraping se enrutan a través de un proxy anti-bot con fallback directo en caso de error.

---

## 🛠️ Instalación Local

### 1. Instalar Dependencias
```bash
npm install
```

### 2. Configurar la Base de Datos
Ejecuta el archivo `schema_productos.sql` en el SQL Editor de Supabase para crear las tablas y políticas de Row Level Security (RLS).

### 3. Variables de Entorno (`.env`)
```env
PORT=8000
SUPABASE_URL=https://tu-proyecto.supabase.co
SUPABASE_KEY=tu-clave-supabase
REFERENCE_CP=09200
ZENROWS_APIKEY=tu-clave-de-zenrows
```

### 4. Arrancar el Servidor
```bash
npm run dev
```

---

## 🔒 Autenticación

Todos los endpoints de búsqueda requieren un token Bearer JWT. El flujo es:

1. Llama al endpoint de login con tus credenciales → obtienes un `access_token`.
2. Incluye ese token en la cabecera `Authorization` de cada petición de búsqueda.

---

## 📡 Endpoints

### `POST /api/v1/auth/login`
Autentica al usuario y devuelve el token de acceso.

**Cuerpo:**
```json
{
  "email": "usuario@ejemplo.com",
  "password": "tu-contraseña"
}
```

**Respuesta exitosa (`200`):**
```json
{
  "status": "success",
  "data": {
    "access_token": "eyJhbGciOiJIUzI1...",
    "expires_in": 3600,
    "refresh_token": "e3fe..."
  }
}
```

**Ejemplo curl (Producción):**
```bash
curl -X POST "https://supermarketapi-z9yb.onrender.com/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email": "usuario@ejemplo.com", "password": "tu-contraseña"}'
```

---

### `GET /api/v1/supermercados/search?q={criterio}`
Busca en todos los supermercados en paralelo y devuelve los resultados ordenados por precio ascendente.

**Cabecera requerida:** `Authorization: Bearer <access_token>`

**Respuesta exitosa (`200`):**
```json
{
  "status": "success",
  "data": [
    {
      "referencia_id": "m01",
      "nombre": "Leche entera Hacendado 1L",
      "precio": 0.95,
      "supermercado": "mercadona",
      "last_seen": "2026-07-22T20:00:00.000Z",
      "categoria_nombre": "Lácteos"
    }
  ],
  "meta": {
    "cp": "09200",
    "timestamp": "2026-07-23T10:00:00.000Z",
    "total_results": 12,
    "supermarkets_searched": ["mercadona", "carrefour", "dia", "aldi", "eroski"]
  }
}
```

**Ejemplo curl (Producción):**
```bash
curl -X GET "https://supermarketapi-z9yb.onrender.com/api/v1/supermercados/search?q=leche" \
  -H "Authorization: Bearer <tu_access_token>"
```

---

### `GET /api/v1/supermercados/:id/search?q={criterio}`
Busca en un supermercado específico.

**IDs disponibles:** `mercadona` · `carrefour` · `dia` · `aldi` · `eroski`

**Cabecera requerida:** `Authorization: Bearer <access_token>`

**Ejemplo curl (Producción):**
```bash
curl -X GET "https://supermarketapi-z9yb.onrender.com/api/v1/supermercados/mercadona/search?q=atun" \
  -H "Authorization: Bearer <tu_access_token>"
```

---

## ⚠️ Respuestas de Error

Todos los errores se devuelven en formato JSON con `type` y `description`:

```json
{
  "status": "error",
  "error": {
    "type": "UNAUTHORIZED",
    "description": "Acceso no autorizado. Se requiere token Bearer."
  }
}
```

| Código HTTP | `type`                 | Descripción                                       |
|-------------|------------------------|---------------------------------------------------|
| `400`       | `MISSING_PARAMETER`    | Falta el parámetro `q` en la petición             |
| `400`       | `INVALID_INPUT`        | Faltan `email` o `password` en el body del login  |
| `401`       | `UNAUTHORIZED`         | No se ha enviado cabecera `Authorization`         |
| `401`       | `INVALID_TOKEN`        | Token JWT inválido o expirado                     |
| `401`       | `AUTH_FAILED`          | Credenciales de login incorrectas                 |
| `404`       | `NOT_FOUND`            | El supermercado solicitado no está soportado      |
| `429`       | `RATE_LIMIT_EXCEEDED`  | Límite de peticiones al proveedor externo superado|
| `502`       | `INTERNAL_SERVER_ERROR`| Error interno del servidor                        |

---
