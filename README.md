# KioscoPrecio — Comparador de precios para kiosco

## Archivos del proyecto

```
kiosco-precios/
├── index.html          → Estructura de la app
├── style.css           → Estilos (tema oscuro industrial)
├── script.js           → Lógica completa: Gemini -2.5 flash + DB + UI
└── kiosco_precio.sql   → Schema de base de datos para MySQL Workbench
```

---

## Cómo usar la app web

1. Abrí `index.html` en el navegador (doble clic o arrastrá a Chrome/Firefox)
2. En la pestaña **Nueva lista**:
   - Subí la foto de la lista del proveedor
   - Escribí el nombre del proveedor
   - Hacé clic en **Analizar lista**
3. Claude AI lee la imagen, extrae precios y genera el análisis
4. Los resultados aparecen en la pestaña **Análisis**
5. La base de datos se actualiza automáticamente solo con los precios que cambiaron

> **Nota:** La app usa `localStorage` del navegador para guardar los datos. No necesita servidor ni conexión a una base de datos para funcionar.

---

## Importar la base de datos en MySQL Workbench

Si querés tener la base de datos en MySQL para consultas más complejas o para conectar con un backend:

1. Abrí MySQL Workbench
2. Conectate a tu servidor local
3. Menú: **File → Open SQL Script** → seleccioná `kiosco_precio.sql`
4. Ejecutá con **Ctrl+Shift+Enter** (o el rayo ⚡)
5. Se crea la base de datos `kiosco_precio` con:
   - 5 tablas: `proveedores`, `categorias`, `productos`, `historial_precios`, `analisis`, `analisis_detalle`
   - 3 vistas útiles: `v_precios_actuales`, `v_historial_completo`, `v_ultimos_analisis`
   - 9 categorías por defecto

### Consultas útiles

```sql
-- Ver todos los precios actuales
SELECT * FROM v_precios_actuales;

-- Productos que más subieron
SELECT producto, variacion_pct
FROM v_precios_actuales
WHERE variacion_pct > 0
ORDER BY variacion_pct DESC;

-- Historial de un producto
SELECT * FROM v_historial_completo
WHERE producto = 'Coca Cola 2.25L';

-- Últimos análisis realizados
SELECT * FROM v_ultimos_analisis;
```

---

## Criterio de recomendación

| Resultado      | Condición                                              |
|---------------|--------------------------------------------------------|
| ✅ Conviene    | El precio bajó, o es nuevo y parece razonable          |
| ⚠️ Neutro     | Subió entre 0% y 15% (inflación normal)                |
| ❌ No conviene | Subió más del 15%, o es nuevo con precio elevado       |

---

## Tecnologías

- HTML5 / CSS3 / JavaScript vanilla (sin frameworks)
- Claude Sonnet API (visión + análisis)
- localStorage para persistencia local
- MySQL para base de datos de producción
