const DB_NAME = 'muebles-presupuesto';
const DB_VERSION = 2;
const STORE = 'productos';
const STORE_CONFIG = 'config';
const CONFIG_ID = 'app';

export const ESTANCIAS = [
  'Salón',
  'Dormitorio Principal',
  'Dormitorio Silvia',
  'Dormitorio Invitados',
  'Cocina',
  'Baño 1',
  'Baño 2',
  'Terraza',
  'Recibidor',
  'Gatos',
];

export const CATEGORIAS = [
  'Mueble',
  'Electrodoméstico',
  'Iluminación',
  'Decoración',
  'Otro',
];

export const ESTADOS = ['Candidato', 'Seleccionado', 'Comprado'];

export const TIENDAS_PRESET = [
  'IKEA',
  'Leroy Merlin',
  'Maison du Monde',
  'MediaMarkt',
  'Amazon',
  'Carrefour',
  'Conforama',
];

/** @type {IDBDatabase|null} */
let dbInstance = null;

/**
 * @returns {Promise<IDBDatabase>}
 */
export function openDb() {
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      dbInstance = request.result;
      resolve(dbInstance);
    };
    request.onupgradeneeded = (event) => {
      const db = /** @type {IDBOpenDBRequest} */ (event.target).result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('estancia', 'estancia', { unique: false });
        store.createIndex('categoria', 'categoria', { unique: false });
        store.createIndex('estado', 'estado', { unique: false });
        store.createIndex('fechaCreacion', 'fechaCreacion', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_CONFIG)) {
        db.createObjectStore(STORE_CONFIG, { keyPath: 'id' });
      }
    };
  });
}

export function createId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * @param {object} data
 */
export function normalizeProducto(data) {
  const cantidad = Math.max(1, Math.round(Number(data.cantidad) || 1));
  const now = new Date().toISOString();
  const fechaCreacion = data.fechaCreacion || now;
  return {
    id: data.id || createId(),
    nombre: data.nombre || '',
    estancia: data.estancia || 'Salón',
    categoria: data.categoria || 'Mueble',
    precio: Number(data.precio) || 0,
    cantidad,
    tienda: data.tienda || '',
    medidas: data.medidas || '',
    notas: data.notas || '',
    estado: data.estado || 'Candidato',
    fotoMueble: data.fotoMueble || null,
    fotoEtiqueta: data.fotoEtiqueta || null,
    fechaCreacion,
    fechaActualizacion: data.fechaActualizacion || fechaCreacion,
  };
}

/**
 * @param {object} p
 */
export function productTimestamp(p) {
  const raw = p?.fechaActualizacion || p?.fechaCreacion || 0;
  const t = new Date(raw).getTime();
  return Number.isFinite(t) ? t : 0;
}

/**
 * Elige la versión más reciente. Si empatan, gana la entrante.
 * @param {object} local
 * @param {object} incoming
 * @returns {'local'|'incoming'}
 */
export function pickNewerProducto(local, incoming) {
  const tLocal = productTimestamp(local);
  const tIncoming = productTimestamp(incoming);
  return tIncoming >= tLocal ? 'incoming' : 'local';
}

/**
 * @param {object} p
 */
export function lineTotal(p) {
  const precio = Number(p.precio) || 0;
  const cantidad = Math.max(1, Number(p.cantidad) || 1);
  return precio * cantidad;
}

/**
 * @param {object} data
 */
export async function addProducto(data) {
  const db = await openDb();
  const producto = normalizeProducto(data);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).add(producto);
    tx.oncomplete = () => resolve(producto);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * @param {object} producto
 * @param {{ touch?: boolean }} [opts] touch=false conserva fechaActualizacion (p. ej. import)
 */
export async function updateProducto(producto, opts = {}) {
  const db = await openDb();
  const touch = opts.touch !== false;
  const normalized = normalizeProducto(
    touch
      ? { ...producto, fechaActualizacion: new Date().toISOString() }
      : producto
  );
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(normalized);
    tx.oncomplete = () => resolve(normalized);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * @param {string} id
 */
export async function deleteProducto(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * @param {string} id
 */
export async function getProducto(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).get(id);
    request.onsuccess = () => {
      const row = request.result;
      resolve(row ? normalizeProducto(row) : null);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * @returns {Promise<object[]>}
 */
export async function getAllProductos() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).getAll();
    request.onsuccess = () => {
      const items = (request.result || []).map(normalizeProducto);
      items.sort(
        (a, b) =>
          new Date(b.fechaCreacion).getTime() - new Date(a.fechaCreacion).getTime()
      );
      resolve(items);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * @param {string} id
 */
export async function duplicateProducto(id) {
  const original = await getProducto(id);
  if (!original) throw new Error('Producto no encontrado');
  const copy = {
    ...original,
    id: createId(),
    nombre: `${original.nombre || 'Producto'} (copia)`,
    estado: 'Candidato',
    fechaCreacion: new Date().toISOString(),
  };
  return addProducto(copy);
}

/**
 * @param {object[]} productos
 */
export function calcPresupuesto(productos) {
  let totalSeleccionado = 0;
  let gastoReal = 0;

  for (const p of productos) {
    const total = lineTotal(p);
    if (p.estado === 'Seleccionado' || p.estado === 'Comprado') {
      totalSeleccionado += total;
    }
    if (p.estado === 'Comprado') {
      gastoReal += total;
    }
  }

  return { totalSeleccionado, gastoReal };
}

/**
 * @param {object[]} productos
 */
export function resumenPorEstancia(productos) {
  /** @type {Record<string, { seleccionado: number, comprado: number, items: number }>} */
  const map = {};
  for (const p of productos) {
    const key = p.estancia || 'Sin estancia';
    if (!map[key]) map[key] = { seleccionado: 0, comprado: 0, items: 0 };
    map[key].items += 1;
    const total = lineTotal(p);
    if (p.estado === 'Seleccionado' || p.estado === 'Comprado') {
      map[key].seleccionado += total;
    }
    if (p.estado === 'Comprado') {
      map[key].comprado += total;
    }
  }
  return Object.entries(map)
    .map(([estancia, data]) => ({ estancia, ...data }))
    .sort((a, b) => b.seleccionado - a.seleccionado || a.estancia.localeCompare(b.estancia));
}

/**
 * @returns {Promise<{ id: string, presupuestoTope: number|null, medidasEstancia: Record<string, string> }>}
 */
export async function getConfig() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CONFIG, 'readonly');
    const request = tx.objectStore(STORE_CONFIG).get(CONFIG_ID);
    request.onsuccess = () => {
      const row = request.result;
      resolve({
        id: CONFIG_ID,
        presupuestoTope:
          row?.presupuestoTope != null && row.presupuestoTope !== ''
            ? Number(row.presupuestoTope)
            : null,
        medidasEstancia: row?.medidasEstancia || {},
      });
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * @param {Partial<{ presupuestoTope: number|null, medidasEstancia: Record<string, string> }>} patch
 */
export async function saveConfig(patch) {
  const current = await getConfig();
  const next = {
    id: CONFIG_ID,
    presupuestoTope:
      patch.presupuestoTope !== undefined
        ? patch.presupuestoTope
        : current.presupuestoTope,
    medidasEstancia:
      patch.medidasEstancia !== undefined
        ? patch.medidasEstancia
        : current.medidasEstancia,
  };
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CONFIG, 'readwrite');
    tx.objectStore(STORE_CONFIG).put(next);
    tx.oncomplete = () => resolve(next);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * @param {object[]} productos
 * @param {object} config
 */
export function exportBackup(productos, config) {
  return {
    version: 3,
    exportedAt: new Date().toISOString(),
    config,
    productos,
  };
}

/**
 * @param {object} producto
 */
async function putProductoRaw(producto) {
  const db = await openDb();
  const normalized = normalizeProducto(producto);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(normalized);
    tx.oncomplete = () => resolve(normalized);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * @param {object|null|undefined} incomingConfig
 * @param {'merge'|'replace'} mode
 */
async function applyConfigFromBackup(incomingConfig, mode) {
  if (!incomingConfig) return;

  if (mode === 'replace') {
    await saveConfig({
      presupuestoTope:
        incomingConfig.presupuestoTope != null &&
        incomingConfig.presupuestoTope !== ''
          ? Number(incomingConfig.presupuestoTope)
          : null,
      medidasEstancia: incomingConfig.medidasEstancia || {},
    });
    return;
  }

  const current = await getConfig();
  /** @type {Record<string, string>} */
  const medidas = { ...(current.medidasEstancia || {}) };
  for (const [key, value] of Object.entries(incomingConfig.medidasEstancia || {})) {
    const next = String(value || '').trim();
    if (!next) continue;
    const prev = String(medidas[key] || '').trim();
    if (!prev || prev !== next) medidas[key] = next;
  }

  let presupuestoTope = current.presupuestoTope;
  if (
    incomingConfig.presupuestoTope != null &&
    incomingConfig.presupuestoTope !== '' &&
    !Number.isNaN(Number(incomingConfig.presupuestoTope))
  ) {
    presupuestoTope = Number(incomingConfig.presupuestoTope);
  }

  await saveConfig({ presupuestoTope, medidasEstancia: medidas });
}

/**
 * @param {object} backup
 * @param {'merge'|'replace'} mode
 * @returns {Promise<{ added: number, updated: number, kept: number, total: number }>}
 */
export async function importBackup(backup, mode = 'merge') {
  if (!backup || !Array.isArray(backup.productos)) {
    throw new Error('Backup inválido');
  }

  const db = await openDb();
  const stats = { added: 0, updated: 0, kept: 0, total: 0 };

  if (mode === 'replace') {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    for (const raw of backup.productos) {
      await putProductoRaw({
        ...raw,
        id: raw.id || createId(),
      });
      stats.added += 1;
    }

    await applyConfigFromBackup(backup.config, 'replace');
    stats.total = stats.added;
    return stats;
  }

  const existing = await getAllProductos();
  const byId = new Map(existing.map((p) => [p.id, p]));

  for (const raw of backup.productos) {
    const incoming = normalizeProducto({
      ...raw,
      id: raw.id || createId(),
    });
    const local = byId.get(incoming.id);

    if (!local) {
      await putProductoRaw(incoming);
      byId.set(incoming.id, incoming);
      stats.added += 1;
      continue;
    }

    if (pickNewerProducto(local, incoming) === 'incoming') {
      await putProductoRaw(incoming);
      byId.set(incoming.id, incoming);
      stats.updated += 1;
    } else {
      stats.kept += 1;
    }
  }

  await applyConfigFromBackup(backup.config, 'merge');
  stats.total = stats.added + stats.updated + stats.kept;
  return stats;
}
