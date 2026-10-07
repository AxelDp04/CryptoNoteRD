# CryptoNote 📊

**Plataforma P2P de control financiero y libro diario contable para comercio de criptomonedas USDT/DOP.**

Registra cada operación de compra y venta, calcula automáticamente el P&L realizado, el costo promedio ponderado y los saldos por banco en tiempo real.

---

## ✨ Funcionalidades

- 📈 **Dashboard** con KPIs en tiempo real (USDT en custodia, P&L realizado, tasa promedio)
- 💼 **Mis Activos** con precios live vía CoinGecko
- 📋 **Historial P2P** con filtros por tipo y búsqueda
- 🏦 **Caja y Bancos (DOP)** con saldos por cuenta bancaria
- 🔐 **Auth completa**: Email/Contraseña + Google OAuth + Recuperación de contraseña
- 📱 **PWA instalable** — funciona offline, Add to Home Screen
- 🌐 **Backend**: Supabase (Auth + PostgreSQL con RLS)

---

## 🚀 Despliegue en Vercel

### Paso 1 — Subir a GitHub

```bash
# En la carpeta del proyecto:
git init
git add .
git commit -m "feat: CryptoNote v1.0 — PWA P2P Crypto Tracker"

# Crea un repo en github.com/new y luego:
git remote add origin https://github.com/TU_USUARIO/cryptonote.git
git branch -M main
git push -u origin main
```

### Paso 2 — Conectar con Vercel

1. Ve a [vercel.com](https://vercel.com) → **Add New Project**
2. Importa tu repositorio de GitHub `cryptonote`
3. En la configuración del proyecto:
   - **Framework Preset**: `Other`
   - **Build Command**: *(dejar vacío)*
   - **Output Directory**: `.` *(punto — directorio raíz)*
   - **Install Command**: *(dejar vacío)*
4. Haz clic en **Deploy** ✅

> El archivo `vercel.json` ya configura todo automáticamente.

---

## 🔧 Variables de Entorno en Vercel

> **Este proyecto NO requiere variables de entorno en Vercel.**

CryptoNote es un frontend estático puro. Las credenciales de Supabase están en `js/supabase.js`:

```js
const SUPABASE_URL    = 'https://TU_PROJECT.supabase.co';
const SUPABASE_ANON_KEY = 'eyJ...';
```

La **`ANON_KEY` de Supabase es pública por diseño** — Supabase la expone al cliente intencionalmente. La seguridad real la proveen las **Row Level Security (RLS) policies** en tu base de datos (ya configuradas en `supabase_schema.sql`).

---

## ⚙️ Configuración post-despliegue en Supabase

Una vez que Vercel te dé tu URL de producción (ej: `https://cryptonote.vercel.app`), debes agregar esa URL en dos lugares dentro de Supabase:

### 1. Authentication → URL Configuration
```
Site URL:        https://cryptonote.vercel.app
Redirect URLs:   https://cryptonote.vercel.app/
                 http://localhost:8000/
```

### 2. Authentication → Providers → Google
```
Authorized redirect URIs: https://TU_PROJECT.supabase.co/auth/v1/callback
```
*(Este ya debería estar configurado desde la integración inicial con Google Cloud)*

---

## 🗄️ Base de Datos (Supabase)

Ejecuta el SQL de `supabase_schema.sql` en el **SQL Editor** de Supabase:

```sql
-- Incluye:
-- ✅ Tabla transactions con columnas: bank, commission, dop_amount
-- ✅ Row Level Security (RLS) activada
-- ✅ Policies para que cada usuario solo vea sus datos
```

---

## 🛠️ Desarrollo Local

```bash
# Sirve el proyecto localmente (necesitas un servidor HTTP, no doble-clic)
npx serve . -p 8000
# o con Python:
python -m http.server 8000
```

Luego abre: `http://localhost:8000`

---

## 📁 Estructura del Proyecto

```
cryptonote/
├── index.html          # App principal (SPA)
├── manifest.json       # PWA manifest
├── sw.js               # Service Worker (offline/cache)
├── vercel.json         # Configuración de Vercel
├── supabase_schema.sql # SQL para crear la BD
├── .gitignore
├── .env.example        # Referencia de variables (sin valores reales)
├── css/
│   └── styles.css      # Design system completo
└── js/
    ├── supabase.js     # Cliente Supabase + Auth
    ├── storage.js      # Capa de datos (local + cloud)
    ├── api.js          # CoinGecko API
    ├── charts.js       # Chart.js wrappers
    └── app.js          # Lógica principal de la app
```

---

## 🔒 Seguridad

| Capa | Mecanismo |
|---|---|
| Autenticación | Supabase Auth (JWT) |
| Autorización | Row Level Security — cada usuario solo accede a sus datos |
| HTTPS | Forzado por Vercel automáticamente |
| Headers | `X-Frame-Options`, `X-XSS-Protection`, `Referrer-Policy` (en `vercel.json`) |
| Anon Key | Es pública por diseño de Supabase — no es un secreto |

---

## 📄 Licencia

MIT — Úsalo libremente para tu negocio P2P.
