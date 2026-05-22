/* ============================
   KIOSCOPRECIO — script.js
   Lógica completa: DB, Claude AI, UI
============================ */

'use strict';

/* ──────────────────────────────
   CONFIGURACIÓN
   Conseguí tu API key GRATIS en:
   https://aistudio.google.com → "Get API key" → "Create API key"
   No requiere tarjeta de crédito.
────────────────────────────── */
const GEMINI_API_KEY = '......';
const GEMINI_MODEL   = 'gemini-2.5-flash';
const API_URL        = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

/* Criterios de conveniencia (%) */
const UMBRAL_SUBE_NEUTRO    = 15;  // > 15% → no conviene
const UMBRAL_BAJA_CONVIENE  = 0;   // cualquier baja → conviene

/* ──────────────────────────────
   BASE DE DATOS (localStorage)
   Estructura:
   db.productos = {
     "Coca Cola 2L": {
       precio: 1500,
       proveedor: "Distribuidora Norte",
       fecha: "2025-05-21",
       historial: [ { precio, fecha, proveedor }, ... ]
     }, ...
   }
   db.historial_analisis = [
     { id, proveedor, fecha, productos_detectados, resumen }
   ]
────────────────────────────── */
const DB_KEY = 'kioscoprecio_db_v1';

function cargarDB() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (!raw) return { productos: {}, historial_analisis: [] };
    return JSON.parse(raw);
  } catch {
    return { productos: {}, historial_analisis: [] };
  }
}

function guardarDB(db) {
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
  } catch (e) {
    mostrarToast('Error al guardar en localStorage', 'error');
  }
}

let db = cargarDB();

/* ──────────────────────────────
   UTILIDADES UI
────────────────────────────── */
function mostrarToast(msg, tipo = 'info') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast ${tipo} show`;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 3200);
}

function setProgress(pct, msg) {
  document.getElementById('progress-fill').style.width = pct + '%';
  document.getElementById('progress-msg').textContent  = msg;
}

function actualizarContadorSidebar() {
  const n = Object.keys(db.productos).length;
  document.getElementById('db-count').textContent = n + ' producto' + (n !== 1 ? 's' : '');
}

/* ──────────────────────────────
   NAVEGACIÓN ENTRE TABS
────────────────────────────── */
document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');

    if (btn.dataset.tab === 'tab-db')       renderTabDB();
    if (btn.dataset.tab === 'tab-analisis') renderTabAnalisis();
    if (btn.dataset.tab === 'tab-historial') renderTabHistorial();
  });
});

/* ──────────────────────────────
   UPLOAD DE IMAGEN
────────────────────────────── */
let fileBase64   = null;
let fileMimeType = 'image/jpeg';

const fileInput  = document.getElementById('file-input');
const uploadZone = document.getElementById('upload-zone');

fileInput.addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  procesarArchivo(file);
});

// Drag & drop
uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.style.borderColor = 'var(--accent)'; });
uploadZone.addEventListener('dragleave', () => { uploadZone.style.borderColor = ''; });
uploadZone.addEventListener('drop', e => {
  e.preventDefault();
  uploadZone.style.borderColor = '';
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) procesarArchivo(file);
});

function procesarArchivo(file) {
  fileMimeType = file.type || 'image/jpeg';
  const reader = new FileReader();
  reader.onload = ev => {
    fileBase64 = ev.target.result.split(',')[1];
    const img  = document.getElementById('preview-img');
    img.src    = ev.target.result;
    img.style.display = 'block';
    document.getElementById('btn-analizar').disabled = false;
    mostrarToast('Imagen cargada correctamente', 'success');
  };
  reader.readAsDataURL(file);
}

/* Fecha de hoy por defecto */
document.getElementById('proveedor-fecha').valueAsDate = new Date();

/* ──────────────────────────────
   ANALIZAR FOTO → CLAUDE AI
────────────────────────────── */
document.getElementById('btn-analizar').addEventListener('click', analizarFoto);

async function analizarFoto() {
  if (!fileBase64) return;

  const proveedor = document.getElementById('proveedor-nombre').value.trim() || 'Proveedor sin nombre';
  const fecha     = document.getElementById('proveedor-fecha').value || new Date().toISOString().slice(0,10);

  // Bloquear botón, mostrar progreso
  document.getElementById('btn-analizar').disabled = true;
  document.getElementById('progress-wrap').style.display = 'block';
  setProgress(10, 'Enviando imagen a Claude AI…');

  // Preparar DB actual como contexto
  const productosDB = JSON.stringify(db.productos, null, 2);

  const systemPrompt = `Sos un asistente de gestión de precios para un kiosco argentino.
Tu tarea es leer imágenes de listas de precios de proveedores, extraer cada producto con su precio, y compararlo con la base de datos del kiosco.

BASE DE DATOS ACTUAL DEL KIOSCO (precios en pesos argentinos):
${productosDB.length > 10 ? productosDB : '(vacía — todos los productos serán nuevos)'}

Proveedor analizado: ${proveedor}
Fecha de análisis: ${fecha}

IMPORTANTE:
- Si no podés leer bien un precio, estimalo o ponelo en 0.
- Los nombres de productos deben ser consistentes con la DB (normalizalos).
- Para decidir la recomendación:
  * "conviene"    → precio bajó respecto al anterior, o es nuevo y el precio parece normal
  * "neutro"      → subió entre 0% y ${UMBRAL_SUBE_NEUTRO}% (inflación normal)
  * "no conviene" → subió más del ${UMBRAL_SUBE_NEUTRO}%, o es nuevo y el precio es elevado
- La razón debe ser concisa, máx 90 caracteres, en español argentino informal.

Devolvé SOLO un JSON válido, sin texto extra, sin bloques markdown:
{
  "productos_detectados": [
    {
      "nombre": "Coca Cola 2.25L",
      "precio_proveedor": 1850,
      "precio_anterior": 1600,
      "cambio": "subio",
      "porcentaje_cambio": 15.6,
      "recomendacion": "no conviene",
      "razon": "Subió más del 15%, considerá buscar otro proveedor"
    }
  ],
  "resumen": {
    "total_productos": 5,
    "suben": 2,
    "bajan": 1,
    "sin_cambio": 1,
    "nuevos": 1
  }
}

Valores posibles para "cambio": "subio" | "bajo" | "igual" | "nuevo"
Si el producto no existe en la DB → cambio = "nuevo", precio_anterior = null, porcentaje_cambio = null`;

  try {
    setProgress(30, 'Gemini está leyendo la imagen…');

    const resp = await fetch(`${API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            {
              inline_data: {
                mime_type: fileMimeType,
                data: fileBase64
              }
            },
            {
              text: systemPrompt + '\n\nAnalizá esta lista de precios del proveedor y devolvé el JSON completo.'
            }
          ]
        }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 1500
        }
      })
    });

    setProgress(70, 'Procesando respuesta…');

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err?.error?.message || `HTTP ${resp.status}`);
    }

    const data  = await resp.json();
    const texto = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const clean = texto.replace(/```json|```/gi, '').trim();

    let resultado;
    try {
      resultado = JSON.parse(clean);
    } catch {
      // Intentar extraer JSON si hay texto extra
      const match = clean.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('Gemini no devolvió JSON válido. Respuesta: ' + texto.slice(0, 200));
      resultado = JSON.parse(match[0]);
    }

    setProgress(90, 'Actualizando base de datos…');

    // Actualizar DB: solo productos que cambiaron o son nuevos
    let actualizados = 0;
    resultado.productos_detectados.forEach(p => {
      if (p.cambio !== 'igual') {
        const anterior = db.productos[p.nombre];
        db.productos[p.nombre] = {
          precio:    p.precio_proveedor,
          proveedor: proveedor,
          fecha:     fecha,
          historial: [
            ...(anterior?.historial || []),
            { precio: p.precio_proveedor, fecha, proveedor }
          ].slice(-20) // guardar últimas 20 entradas
        };
        actualizados++;
      }
    });

    // Guardar en historial de análisis
    db.historial_analisis = db.historial_analisis || [];
    db.historial_analisis.unshift({
      id:       Date.now(),
      proveedor,
      fecha,
      productos_detectados: resultado.productos_detectados,
      resumen: resultado.resumen
    });
    // Máx 50 análisis en historial
    db.historial_analisis = db.historial_analisis.slice(0, 50);

    guardarDB(db);
    actualizarContadorSidebar();

    setProgress(100, `✓ ${resultado.productos_detectados.length} productos procesados — ${actualizados} actualizados en DB`);

    // Guardar último análisis en memoria para el tab
    window.__ultimoAnalisis = { proveedor, fecha, ...resultado };

    mostrarToast(`Análisis completo: ${resultado.productos_detectados.length} productos`, 'success');

    // Ir al tab de análisis
    setTimeout(() => {
      document.querySelector('[data-tab="tab-analisis"]').click();
    }, 800);

  } catch (err) {
    setProgress(0, '');
    document.getElementById('progress-wrap').style.display = 'none';
    mostrarToast('Error: ' + err.message, 'error');
    console.error('Error al analizar:', err);
  } finally {
    document.getElementById('btn-analizar').disabled = false;
  }
}

/* ──────────────────────────────
   TAB: BASE DE DATOS
────────────────────────────── */
function renderTabDB() {
  const q         = (document.getElementById('search-db')?.value || '').toLowerCase();
  const filtProv  = document.getElementById('filter-proveedor')?.value || '';
  const container = document.getElementById('db-table-wrap');

  // Actualizar select de proveedores
  const proveedores = [...new Set(Object.values(db.productos).map(p => p.proveedor))].sort();
  const sel = document.getElementById('filter-proveedor');
  const selVal = sel.value;
  sel.innerHTML = '<option value="">Todos los proveedores</option>';
  proveedores.forEach(prov => {
    const opt = document.createElement('option');
    opt.value = prov;
    opt.textContent = prov;
    if (prov === selVal) opt.selected = true;
    sel.appendChild(opt);
  });

  const productos = Object.entries(db.productos)
    .filter(([nombre, info]) => {
      const matchQ    = nombre.toLowerCase().includes(q) || info.proveedor.toLowerCase().includes(q);
      const matchProv = !filtProv || info.proveedor === filtProv;
      return matchQ && matchProv;
    })
    .sort((a, b) => a[0].localeCompare(b[0]));

  if (!productos.length) {
    container.innerHTML = `<div class="empty-state">
      <i class="ti ti-database-off"></i>
      <p>${Object.keys(db.productos).length ? 'No se encontraron resultados.' : 'La base de datos está vacía.'}</p>
      <p class="empty-sub">Analizá tu primera lista para empezar.</p>
    </div>`;
    return;
  }

  let rows = '';
  productos.forEach(([nombre, info]) => {
    // Calcular cambio respecto a penúltimo registro
    const hist     = info.historial || [];
    const anterior = hist.length >= 2 ? hist[hist.length - 2].precio : null;
    let cambioHTML = '';
    if (anterior !== null && anterior > 0) {
      const pct = ((info.precio - anterior) / anterior * 100).toFixed(1);
      if (info.precio > anterior)
        cambioHTML = `<span class="change-up"><i class="ti ti-trending-up"></i> +${pct}%</span>`;
      else if (info.precio < anterior)
        cambioHTML = `<span class="change-down"><i class="ti ti-trending-down"></i> ${pct}%</span>`;
      else
        cambioHTML = `<span class="change-eq">—</span>`;
    } else {
      cambioHTML = `<span class="change-eq" title="Primer registro">Nuevo</span>`;
    }

    rows += `<tr>
      <td style="font-weight:500">${nombre}</td>
      <td class="price-cell">$${info.precio.toLocaleString('es-AR')}</td>
      <td>${cambioHTML}</td>
      <td style="color:var(--text2)">${info.proveedor}</td>
      <td style="color:var(--text3)">${formatearFecha(info.fecha)}</td>
      <td>${hist.length} registro${hist.length !== 1 ? 's' : ''}</td>
    </tr>`;
  });

  container.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>Producto</th>
          <th>Precio actual</th>
          <th>Variación</th>
          <th>Proveedor</th>
          <th>Última actualización</th>
          <th>Historial</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

document.getElementById('search-db').addEventListener('input', renderTabDB);
document.getElementById('filter-proveedor').addEventListener('change', renderTabDB);

/* Exportar CSV */
document.getElementById('btn-export-csv').addEventListener('click', exportarCSV);
function exportarCSV() {
  const productos = Object.entries(db.productos);
  if (!productos.length) { mostrarToast('No hay datos para exportar', 'error'); return; }

  const filas = [['Producto','Precio','Proveedor','Fecha','Registros'].join(',')];
  productos.forEach(([nombre, info]) => {
    filas.push([
      `"${nombre}"`,
      info.precio,
      `"${info.proveedor}"`,
      info.fecha,
      (info.historial || []).length
    ].join(','));
  });

  const blob = new Blob([filas.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `kiosco_precios_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  mostrarToast('CSV exportado', 'success');
}

/* Limpiar DB */
document.getElementById('btn-clear-db').addEventListener('click', () => {
  if (!confirm('¿Seguro que querés limpiar toda la base de datos? Esta acción no se puede deshacer.')) return;
  db.productos = {};
  guardarDB(db);
  actualizarContadorSidebar();
  renderTabDB();
  mostrarToast('Base de datos limpiada', 'success');
});

/* ──────────────────────────────
   TAB: ANÁLISIS
────────────────────────────── */
function renderTabAnalisis() {
  const analisis = window.__ultimoAnalisis || (db.historial_analisis || [])[0];
  if (!analisis) return;

  window.__ultimoAnalisis = analisis;

  const { proveedor, fecha, productos_detectados, resumen } = analisis;

  document.getElementById('analisis-meta').textContent =
    `${proveedor} · ${formatearFecha(fecha)} · ${resumen.total_productos} productos`;

  const sg = document.getElementById('summary-grid');
  sg.style.display = 'grid';

  const conviene   = productos_detectados.filter(p => p.recomendacion === 'conviene').length;
  const noConviene = productos_detectados.filter(p => p.recomendacion === 'no conviene').length;
  const neutro     = productos_detectados.filter(p => p.recomendacion === 'neutro').length;

  document.getElementById('s-conviene').textContent    = conviene;
  document.getElementById('s-no-conviene').textContent = noConviene;
  document.getElementById('s-neutro').textContent      = neutro;
  document.getElementById('s-total').textContent       = resumen.total_productos;

  // Ordenar: no conviene primero, conviene al final
  const orden = { 'no conviene': 0, 'neutro': 1, 'conviene': 2 };
  const sorted = [...productos_detectados].sort((a, b) => orden[a.recomendacion] - orden[b.recomendacion]);

  let html = '<div class="analysis-list">';
  sorted.forEach(p => {
    const claseVeredicto = p.recomendacion === 'conviene' ? 'conviene' :
                           p.recomendacion === 'no conviene' ? 'no-conviene' : 'neutro';

    let cambioTexto = '';
    let cambioColor = '';
    if (p.cambio === 'subio') {
      cambioTexto = `↑ +${p.porcentaje_cambio?.toFixed(1)}%`;
      cambioColor = 'color:var(--red)';
    } else if (p.cambio === 'bajo') {
      cambioTexto = `↓ ${p.porcentaje_cambio?.toFixed(1)}%`;
      cambioColor = 'color:var(--green)';
    } else if (p.cambio === 'nuevo') {
      cambioTexto = 'Nuevo';
      cambioColor = 'color:var(--blue)';
    } else {
      cambioTexto = 'Sin cambio';
      cambioColor = 'color:var(--text3)';
    }

    html += `<div class="analysis-card ${claseVeredicto}">
      <div>
        <p class="a-product">${p.nombre}</p>
        <div class="a-prices">
          <span>Precio: <b>$${p.precio_proveedor.toLocaleString('es-AR')}</b></span>
          ${p.precio_anterior ? `<span>Anterior: <b>$${Number(p.precio_anterior).toLocaleString('es-AR')}</b></span>` : ''}
        </div>
        <p class="a-reason">${p.razon}</p>
      </div>
      <div class="a-right">
        <span class="badge ${claseVeredicto}">${p.recomendacion === 'no conviene' ? 'No conviene' : p.recomendacion.charAt(0).toUpperCase() + p.recomendacion.slice(1)}</span>
        <p class="a-change" style="${cambioColor}">${cambioTexto}</p>
      </div>
    </div>`;
  });
  html += '</div>';

  document.getElementById('analisis-cards').innerHTML = html;
}

/* ──────────────────────────────
   TAB: HISTORIAL
────────────────────────────── */
function renderTabHistorial() {
  const lista = db.historial_analisis || [];
  const container = document.getElementById('historial-list');

  if (!lista.length) {
    container.innerHTML = `<div class="empty-state">
      <i class="ti ti-history"></i>
      <p>Todavía no hay historial.</p>
      <p class="empty-sub">Cada análisis queda guardado acá.</p>
    </div>`;
    return;
  }

  container.innerHTML = lista.map(item => {
    const conviene   = (item.productos_detectados || []).filter(p => p.recomendacion === 'conviene').length;
    const noConviene = (item.productos_detectados || []).filter(p => p.recomendacion === 'no conviene').length;
    const neutro     = (item.productos_detectados || []).filter(p => p.recomendacion === 'neutro').length;
    return `<div class="historial-card" onclick="cargarAnalisisHistorial(${item.id})">
      <div class="historial-header">
        <span class="historial-prov">${item.proveedor}</span>
        <span class="historial-fecha">${formatearFecha(item.fecha)}</span>
      </div>
      <div class="historial-badges">
        <span class="badge conviene">${conviene} convienen</span>
        <span class="badge no-conviene">${noConviene} no convienen</span>
        <span class="badge neutro">${neutro} neutros</span>
      </div>
    </div>`;
  }).join('');
}

function cargarAnalisisHistorial(id) {
  const item = (db.historial_analisis || []).find(a => a.id === id);
  if (!item) return;
  window.__ultimoAnalisis = item;
  document.querySelector('[data-tab="tab-analisis"]').click();
}

/* ──────────────────────────────
   UTILIDADES
────────────────────────────── */
function formatearFecha(iso) {
  if (!iso) return '—';
  try {
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  } catch { return iso; }
}

/* ──────────────────────────────
   INICIALIZACIÓN
────────────────────────────── */
actualizarContadorSidebar();