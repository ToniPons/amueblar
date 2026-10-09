const DB_NAME = 'muebles-presupuesto';
const DB_VERSION = 3;
const STORE = 'productos';
const STORE_CONFIG = 'config';
const CONFIG_ID = 'app';

export const ESTANCIAS_DEFAULT = [
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

/** @deprecated usar getEstancias() / ESTANCIAS_DEFAULT */
export const ESTANCIAS = ESTANCIAS_DEFAULT;

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

const DATA_IMAGE_RE = /^data:image\/(jpeg|jpg|png|webp|gif);base64,[a-z0-9+/=\s]+$/i;

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
 * @param {unknown} value
 * @returns {string|null}
 */
export function sanitizePhoto(value) {
  if (value == null || value === '') return null;
  const s = String(value).trim();
  if (!DATA_IMAGE_RE.test(s.replace(/\s/g, ''))) return null;
  return s;
}

/**
 * @param {object} data
 */
export function normalizeProducto(data) {
  const cantidad = Math.max(1, Math.round(Number(data.cantidad) || 1));
  const now = new Date().toISOString();
  const fechaCreacion = data.fechaCreacion || now;
  const deletedAt =
    data.deletedAt && String(data.deletedAt).trim()
      ? String(data.deletedAt)
      : null;
  return {
    id: data.id || createId(),
    nombre: data.nombre || '',
    estancia: data.estancia || 'Salón',
    categoria: data.categoria || 'Mueble',
    precio: Number(data.precio) || 0,
    cantidad,
    tienda: data.tienda || '',
    medidas: data.medidas || '',
    enlace: data.enlace || '',
    notas: data.notas || '',
    estado: data.estado || 'Candidato',
    fotoMueble: sanitizePhoto(data.fotoMueble),
    fotoEtiqueta: sanitizePhoto(data.fotoEtiqueta),
    fechaCreacion,
    fechaActualizacion: data.fechaActualizacion || fechaCreacion,
    deletedAt,
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
 * @param {unknown} err
 */
export function isQuotaError(err) {
  const name = /** @type {{ name?: string }} */ (err)?.name || '';
  const msg = String(/** @type {{ message?: string }} */ (err)?.message || '');
  return (
    name === 'QuotaExceededError' ||
    name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    /quota/i.test(msg)
  );
}

function idbReject(err) {
  if (isQuotaError(err)) {
    return new Error(
      'Almacenamiento lleno. Exporta un backup o elimina fotos/productos.'
    );
  }
  return err instanceof Error ? err : new Error(String(err));
}

/**
 * @param {object} data
 */
export async function addProducto(data) {
  const db = await openDb();
  const producto = normalizeProducto({
    ...data,
    deletedAt: null,
    fechaActualizacion: new Date().toISOString(),
  });
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(producto);
    tx.oncomplete = () => resolve(producto);
    tx.onerror = () => reject(idbReject(tx.error));
  });
}

/**
 * @param {object} producto
 * @param {{ touch?: boolean }} [opts]
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
    tx.onerror = () => reject(idbReject(tx.error));
  });
}

/**
 * Soft-delete para que el sync propague borrados.
 * @param {string} id
 * @returns {Promise<object|null>} snapshot antes de borrar
 */
export async function deleteProducto(id) {
  const existing = await getProducto(id, { includeDeleted: true });
  if (!existing) return null;
  const now = new Date().toISOString();
  const tombstone = normalizeProducto({
    ...existing,
    deletedAt: now,
    fechaActualizacion: now,
  });
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(tombstone);
    tx.oncomplete = () => resolve(existing);
    tx.onerror = () => reject(idbReject(tx.error));
  });
}

/**
 * @param {object} producto snapshot activo
 */
export async function restoreProducto(producto) {
  return updateProducto({
    ...producto,
    deletedAt: null,
  });
}

/**
 * @param {string} id
 * @param {{ includeDeleted?: boolean }} [opts]
 */
export async function getProducto(id, opts = {}) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).get(id);
    request.onsuccess = () => {
      const row = request.result;
      if (!row) {
        resolve(null);
        return;
      }
      const p = normalizeProducto(row);
      if (p.deletedAt && !opts.includeDeleted) {
        resolve(null);
        return;
      }
      resolve(p);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * @param {{ includeDeleted?: boolean }} [opts]
 * @returns {Promise<object[]>}
 */
export async function getAllProductos(opts = {}) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).getAll();
    request.onsuccess = () => {
      let items = (request.result || []).map(normalizeProducto);
      if (!opts.includeDeleted) {
        items = items.filter((p) => !p.deletedAt);
      }
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
  const now = new Date().toISOString();
  return addProducto({
    ...original,
    id: createId(),
    nombre: `${original.nombre || 'Producto'} (copia)`,
    estado: 'Candidato',
    deletedAt: null,
    fechaCreacion: now,
    fechaActualizacion: now,
  });
}

/**
 * @param {object[]} productos
 */
export function calcPresupuesto(productos) {
  let totalSeleccionado = 0;
  let gastoReal = 0;

  for (const p of productos) {
    if (p.deletedAt) continue;
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
    if (p.deletedAt) continue;
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
    .sort(
      (a, b) =>
        b.seleccionado - a.seleccionado || a.estancia.localeCompare(b.estancia, 'es')
    );
}

/**
 * @param {object[]} productos
 */
export function groupByTienda(productos) {
  /** @type {Map<string, object[]>} */
  const map = new Map();
  for (const p of productos) {
    if (p.deletedAt) continue;
    const key = (p.tienda || '').trim() || 'Sin tienda';
    if (!map.has(key)) map.set(key, []);
    map.get(key)?.push(p);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], 'es'))
    .map(([tienda, items]) => ({ tienda, items }));
}

/**
 * @returns {Promise<{
 *   id: string,
 *   presupuestoTope: number|null,
 *   presupuestoTopeUpdatedAt: string|null,
 *   estancias: string[],
 *   lastBackupAt: string|null
 * }>}
 */
export async function getConfig() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CONFIG, 'readonly');
    const request = tx.objectStore(STORE_CONFIG).get(CONFIG_ID);
    request.onsuccess = () => {
      const row = request.result;
      const estancias = Array.isArray(row?.estancias) && row.estancias.length
        ? row.estancias.map(String).filter(Boolean)
        : [...ESTANCIAS_DEFAULT];
      resolve({
        id: CONFIG_ID,
        presupuestoTope:
          row?.presupuestoTope != null && row.presupuestoTope !== ''
            ? Number(row.presupuestoTope)
            : null,
        presupuestoTopeUpdatedAt: row?.presupuestoTopeUpdatedAt || null,
        estancias,
        lastBackupAt: row?.lastBackupAt || null,
      });
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * @param {Partial<{
 *   presupuestoTope: number|null,
 *   presupuestoTopeUpdatedAt: string|null,
 *   estancias: string[],
 *   lastBackupAt: string|null
 * }>} patch
 */
export async function saveConfig(patch) {
  const current = await getConfig();
  const next = {
    id: CONFIG_ID,
    presupuestoTope:
      patch.presupuestoTope !== undefined
        ? patch.presupuestoTope
        : current.presupuestoTope,
    presupuestoTopeUpdatedAt:
      patch.presupuestoTopeUpdatedAt !== undefined
        ? patch.presupuestoTopeUpdatedAt
        : patch.presupuestoTope !== undefined &&
            patch.presupuestoTope !== current.presupuestoTope
          ? new Date().toISOString()
          : current.presupuestoTopeUpdatedAt,
    estancias:
      patch.estancias !== undefined ? patch.estancias : current.estancias,
    lastBackupAt:
      patch.lastBackupAt !== undefined
        ? patch.lastBackupAt
        : current.lastBackupAt,
  };
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CONFIG, 'readwrite');
    tx.objectStore(STORE_CONFIG).put(next);
    tx.oncomplete = () => resolve(next);
    tx.onerror = () => reject(idbReject(tx.error));
  });
}

/**
 * @param {object[]} productos
 * @param {object} config
 * @param {{ includePhotos?: boolean }} [opts]
 */
export function exportBackup(productos, config, opts = {}) {
  const includePhotos = opts.includePhotos !== false;
  const list = includePhotos
    ? productos
    : productos.map((p) => ({
        ...p,
        fotoMueble: null,
        fotoEtiqueta: null,
      }));
  return {
    version: 4,
    exportedAt: new Date().toISOString(),
    includePhotos,
    config: {
      presupuestoTope: config.presupuestoTope ?? null,
      presupuestoTopeUpdatedAt: config.presupuestoTopeUpdatedAt ?? null,
      estancias: config.estancias || ESTANCIAS_DEFAULT,
      lastBackupAt: config.lastBackupAt ?? null,
    },
    productos: list,
  };
}

/**
 * @param {string} text
 */
export function parseBackupPayload(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) throw new Error('Backup vacío');
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error('No se reconoce el backup');
  }
}

/**
 * @param {object} local
 * @param {object} incoming
 */
export function mergeProductoFields(local, incoming) {
  const localDel = Boolean(local.deletedAt);
  const inDel = Boolean(incoming.deletedAt);

  if (localDel || inDel) {
    const winner =
      pickNewerProducto(local, incoming) === 'incoming' ? incoming : local;
    return normalizeProducto({
      ...winner,
      fotoMueble: sanitizePhoto(winner.fotoMueble || local.fotoMueble || incoming.fotoMueble),
      fotoEtiqueta: sanitizePhoto(
        winner.fotoEtiqueta || local.fotoEtiqueta || incoming.fotoEtiqueta
      ),
    });
  }

  const winner =
    pickNewerProducto(local, incoming) === 'incoming' ? incoming : local;
  const other = winner === incoming ? local : incoming;
  return normalizeProducto({
    ...winner,
    fotoMueble: sanitizePhoto(winner.fotoMueble || other.fotoMueble),
    fotoEtiqueta: sanitizePhoto(winner.fotoEtiqueta || other.fotoEtiqueta),
    fechaActualizacion: winner.fechaActualizacion || winner.fechaCreacion,
    fechaCreacion: winner.fechaCreacion || other.fechaCreacion,
    deletedAt: null,
  });
}

/**
 * @param {object} a
 * @param {object} b
 */
export function softMatchKey(a) {
  return [
    String(a.nombre || '')
      .trim()
      .toLowerCase(),
    String(a.tienda || '')
      .trim()
      .toLowerCase(),
    String(Number(a.precio) || 0),
  ].join('|');
}

/**
 * @param {object} a
 * @param {object} b
 */
function productosDiffer(a, b) {
  return (
    productTimestamp(a) !== productTimestamp(b) ||
    a.fotoMueble !== b.fotoMueble ||
    a.fotoEtiqueta !== b.fotoEtiqueta ||
    a.nombre !== b.nombre ||
    a.precio !== b.precio ||
    a.estado !== b.estado ||
    a.cantidad !== b.cantidad ||
    a.notas !== b.notas ||
    a.tienda !== b.tienda ||
    a.estancia !== b.estancia ||
    a.categoria !== b.categoria ||
    a.medidas !== b.medidas ||
    a.enlace !== b.enlace ||
    Boolean(a.deletedAt) !== Boolean(b.deletedAt)
  );
}

/**
 * Plan de merge sin escribir (para preview).
 * @param {object} backup
 * @param {object[]} localProductos includeDeleted recommended
 */
export function planMerge(backup, localProductos) {
  if (!backup || !Array.isArray(backup.productos)) {
    throw new Error('Backup inválido');
  }

  const byId = new Map(localProductos.map((p) => [p.id, p]));
  /** @type {Map<string, object>} */
  const softIndex = new Map();
  for (const p of localProductos) {
    if (p.deletedAt) continue;
    const key = softMatchKey(p);
    if (key !== '||0' && !softIndex.has(key)) softIndex.set(key, p);
  }

  const stats = {
    added: 0,
    updated: 0,
    kept: 0,
    deleted: 0,
    restored: 0,
    softLinked: 0,
  };
  /** @type {{ action: string, name: string }[]} */
  const samples = [];

  for (const raw of backup.productos) {
    if (!raw || typeof raw !== 'object') continue;
    let incoming = normalizeProducto({ ...raw, id: raw.id || createId() });
    let local = byId.get(incoming.id);

    if (!local && !incoming.deletedAt) {
      const soft = softIndex.get(softMatchKey(incoming));
      if (soft) {
        local = soft;
        incoming = normalizeProducto({ ...incoming, id: soft.id });
        stats.softLinked += 1;
      }
    }

    if (!local) {
      if (incoming.deletedAt) {
        stats.kept += 1;
        continue;
      }
      stats.added += 1;
      if (samples.length < 8) {
        samples.push({ action: 'nuevo', name: incoming.nombre || 'Sin nombre' });
      }
      continue;
    }

    const merged = mergeProductoFields(local, incoming);
    if (!productosDiffer(merged, local)) {
      stats.kept += 1;
      continue;
    }

    if (merged.deletedAt && !local.deletedAt) {
      stats.deleted += 1;
      if (samples.length < 8) {
        samples.push({ action: 'borrar', name: local.nombre || 'Sin nombre' });
      }
    } else if (!merged.deletedAt && local.deletedAt) {
      stats.restored += 1;
      if (samples.length < 8) {
        samples.push({ action: 'restaurar', name: merged.nombre || 'Sin nombre' });
      }
    } else {
      stats.updated += 1;
      if (samples.length < 8) {
        samples.push({ action: 'actualizar', name: merged.nombre || 'Sin nombre' });
      }
    }
  }

  return { stats, samples, config: backup.config || null };
}

/**
 * @param {object|null|undefined} incomingConfig
 * @param {'merge'|'replace'} mode
 */
async function applyConfigFromBackup(incomingConfig, mode) {
  if (!incomingConfig) return;
  const current = await getConfig();

  if (mode === 'replace') {
    await saveConfig({
      presupuestoTope:
        incomingConfig.presupuestoTope != null &&
        incomingConfig.presupuestoTope !== ''
          ? Number(incomingConfig.presupuestoTope)
          : null,
      presupuestoTopeUpdatedAt:
        incomingConfig.presupuestoTopeUpdatedAt || new Date().toISOString(),
      estancias:
        Array.isArray(incomingConfig.estancias) && incomingConfig.estancias.length
          ? incomingConfig.estancias.map(String)
          : current.estancias,
      lastBackupAt: current.lastBackupAt,
    });
    return;
  }

  let presupuestoTope = current.presupuestoTope;
  let presupuestoTopeUpdatedAt = current.presupuestoTopeUpdatedAt;
  const inTope =
    incomingConfig.presupuestoTope != null &&
    incomingConfig.presupuestoTope !== '' &&
    !Number.isNaN(Number(incomingConfig.presupuestoTope))
      ? Number(incomingConfig.presupuestoTope)
      : null;
  const inTs = incomingConfig.presupuestoTopeUpdatedAt
    ? new Date(incomingConfig.presupuestoTopeUpdatedAt).getTime()
    : 0;
  const localTs = current.presupuestoTopeUpdatedAt
    ? new Date(current.presupuestoTopeUpdatedAt).getTime()
    : 0;
  if (inTope != null && (inTs >= localTs || !current.presupuestoTopeUpdatedAt)) {
    presupuestoTope = inTope;
    presupuestoTopeUpdatedAt =
      incomingConfig.presupuestoTopeUpdatedAt || new Date().toISOString();
  }

  let estancias = current.estancias;
  if (Array.isArray(incomingConfig.estancias) && incomingConfig.estancias.length) {
    const set = new Set([...current.estancias, ...incomingConfig.estancias.map(String)]);
    estancias = [...set];
  }

  await saveConfig({
    presupuestoTope,
    presupuestoTopeUpdatedAt,
    estancias,
  });
}

/**
 * @param {IDBObjectStore} store
 * @param {object} producto
 */
function putInStore(store, producto) {
  store.put(normalizeProducto(producto));
}

/**
 * @param {object} backup
 * @param {'merge'|'replace'} mode
 * @returns {Promise<{ added: number, updated: number, kept: number, deleted: number, restored: number, softLinked: number, total: number }>}
 */
export async function importBackup(backup, mode = 'merge') {
  if (!backup || !Array.isArray(backup.productos)) {
    throw new Error('Backup inválido');
  }

  const db = await openDb();

  if (mode === 'replace') {
    const stats = {
      added: 0,
      updated: 0,
      kept: 0,
      deleted: 0,
      restored: 0,
      softLinked: 0,
      total: 0,
    };
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      store.clear();
      for (const raw of backup.productos) {
        if (!raw || typeof raw !== 'object') continue;
        putInStore(store, { ...raw, id: raw.id || createId() });
        stats.added += 1;
      }
      tx.oncomplete = () => resolve(undefined);
      tx.onerror = () => reject(idbReject(tx.error));
    });
    await applyConfigFromBackup(backup.config, 'replace');
    stats.total = stats.added;
    return stats;
  }

  const existing = await getAllProductos({ includeDeleted: true });
  const byId = new Map(existing.map((p) => [p.id, p]));
  /** @type {Map<string, object>} */
  const softIndex = new Map();
  for (const p of existing) {
    if (p.deletedAt) continue;
    const key = softMatchKey(p);
    if (key !== '||0' && !softIndex.has(key)) softIndex.set(key, p);
  }

  const stats = {
    added: 0,
    updated: 0,
    kept: 0,
    deleted: 0,
    restored: 0,
    softLinked: 0,
    total: 0,
  };

  /** @type {object[]} */
  const writes = [];

  for (const raw of backup.productos) {
    if (!raw || typeof raw !== 'object') continue;
    let incoming = normalizeProducto({ ...raw, id: raw.id || createId() });
    let local = byId.get(incoming.id);

    if (!local && !incoming.deletedAt) {
      const soft = softIndex.get(softMatchKey(incoming));
      if (soft) {
        local = soft;
        incoming = normalizeProducto({ ...incoming, id: soft.id });
        stats.softLinked += 1;
      }
    }

    if (!local) {
      if (incoming.deletedAt) {
        stats.kept += 1;
        continue;
      }
      writes.push(incoming);
      byId.set(incoming.id, incoming);
      if (!incoming.deletedAt) {
        const key = softMatchKey(incoming);
        if (key !== '||0') softIndex.set(key, incoming);
      }
      stats.added += 1;
      continue;
    }

    const merged = mergeProductoFields(local, incoming);
    if (!productosDiffer(merged, local)) {
      stats.kept += 1;
      continue;
    }

    if (merged.deletedAt && !local.deletedAt) stats.deleted += 1;
    else if (!merged.deletedAt && local.deletedAt) stats.restored += 1;
    else stats.updated += 1;

    writes.push(merged);
    byId.set(merged.id, merged);
  }

  if (writes.length) {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      for (const p of writes) putInStore(store, p);
      tx.oncomplete = () => resolve(undefined);
      tx.onerror = () => reject(idbReject(tx.error));
    });
  }

  await applyConfigFromBackup(backup.config, 'merge');
  stats.total =
    stats.added +
    stats.updated +
    stats.kept +
    stats.deleted +
    stats.restored;
  return stats;
}
