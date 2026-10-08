import {
  openDb,
  getAllProductos,
  getProducto,
  updateProducto,
  getConfig,
  saveConfig,
  exportBackup,
  importBackup,
  parseBackupPayload,
  planMerge,
  ESTANCIAS_DEFAULT,
} from './db.js';
import {
  renderChips,
  renderGrid,
  updateBudget,
  showToast,
  setOverlayOpen,
  renderResumenEstancias,
  renderMergePreview,
  buildShareText,
} from './ui.js';
import { initForm } from './form.js';

const filters = {
  estancia: 'Todos',
  categoria: 'Todos',
  estado: 'Todos',
  listaCompra: false,
  query: '',
};

/** @type {'fecha'|'precio-asc'|'precio-desc'|'nombre'} */
let sort = 'fecha';
/** @type {object[]} */
let productos = [];
/** @type {{ id: string, presupuestoTope: number|null, presupuestoTopeUpdatedAt: string|null, estancias: string[], lastBackupAt: string|null }} */
let config = {
  id: 'app',
  presupuestoTope: null,
  presupuestoTopeUpdatedAt: null,
  estancias: [...ESTANCIAS_DEFAULT],
  lastBackupAt: null,
};
let filtersExpanded = false;
/** @type {File|null} */
let pendingImportFile = null;
/** @type {object|null} */
let pendingBackup = null;
/** @type {string[]} */
let draftEstancias = [];
let settingsSnapshot = '';

function clearFilters() {
  filters.estancia = 'Todos';
  filters.categoria = 'Todos';
  filters.estado = 'Todos';
  filters.listaCompra = false;
  filters.query = '';
  const search = /** @type {HTMLInputElement|null} */ (
    document.getElementById('search-input')
  );
  if (search) search.value = '';
  document.getElementById('btn-lista-compra')?.classList.remove('active');
  paint();
}

function recentStores() {
  const counts = new Map();
  for (const p of productos) {
    const t = (p.tienda || '').trim();
    if (!t) continue;
    counts.set(t, (counts.get(t) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name)
    .slice(0, 6);
}

function syncFilterChrome() {
  const extra = document.getElementById('filters-extra');
  const moreBtn = document.getElementById('btn-more-filters');
  const estadoRow = document.getElementById('filter-estado-row');
  const listaBanner = document.getElementById('lista-banner');

  if (extra) extra.hidden = !filtersExpanded;
  if (moreBtn) {
    moreBtn.classList.toggle('active', filtersExpanded);
    moreBtn.textContent = filtersExpanded ? 'Menos filtros' : 'Más filtros';
    const secondaryActive =
      (filters.categoria && filters.categoria !== 'Todos') ||
      (filters.estado && filters.estado !== 'Todos');
    moreBtn.classList.toggle('has-dot', secondaryActive && !filtersExpanded);
  }
  if (estadoRow) estadoRow.hidden = Boolean(filters.listaCompra);
  if (listaBanner) listaBanner.hidden = !filters.listaCompra;
  document
    .getElementById('btn-lista-compra')
    ?.classList.toggle('active', filters.listaCompra);
}

async function refresh() {
  productos = await getAllProductos();
  config = await getConfig();
  updateBudget(productos, config);
  paint();
}

function paint() {
  syncFilterChrome();
  const estancias = config.estancias?.length ? config.estancias : ESTANCIAS_DEFAULT;
  const estanciasExtra = [
    ...new Set(productos.map((p) => p.estancia).filter(Boolean)),
  ];
  renderChips(
    'estancia',
    filters.estancia,
    (value) => {
      filters.estancia = value;
      paint();
    },
    estancias,
    estanciasExtra
  );
  renderChips('categoria', filters.categoria, (value) => {
    filters.categoria = value;
    paint();
  });
  renderChips('estado', filters.estado, (value) => {
    filters.estado = value;
    paint();
  });
  renderGrid(productos, filters, sort, {
    onOpen: (id) => formApi.openDetail(id),
    onEstado: async (id, estado) => {
      const p = await getProducto(id);
      if (!p) return;
      await updateProducto({ ...p, estado });
      showToast(`Estado: ${estado}`);
      await refresh();
    },
    onClearFilters: clearFilters,
  });
}

const formApi = initForm({
  onSaved: refresh,
  getRecentStores: recentStores,
  getEstancias: () => config.estancias || ESTANCIAS_DEFAULT,
});

function renderEstanciasEditor() {
  const box = document.getElementById('settings-estancias');
  if (!box) return;
  box.innerHTML = draftEstancias
    .map(
      (name, i) => `
      <div class="estancia-edit-row">
        <span>${name}</span>
        <button type="button" class="btn-text" data-remove-estancia="${i}">Quitar</button>
      </div>`
    )
    .join('');
  box.querySelectorAll('[data-remove-estancia]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const idx = Number(/** @type {HTMLElement} */ (btn).dataset.removeEstancia);
      if (draftEstancias.length <= 1) {
        showToast('Deja al menos una estancia');
        return;
      }
      const removed = draftEstancias[idx];
      draftEstancias.splice(idx, 1);
      renderEstanciasEditor();
      try {
        await persistEstancias();
        showToast(`Estancia «${removed}» eliminada`);
      } catch (err) {
        console.error(err);
        showToast('No se pudo eliminar la estancia');
      }
    });
  });
}

function settingsFormSnapshot() {
  const tope = /** @type {HTMLInputElement} */ (
    document.getElementById('settings-tope')
  ).value.trim();
  return JSON.stringify({ tope, estancias: draftEstancias });
}

function openSettings(focusTope = false) {
  const topeInput = /** @type {HTMLInputElement} */ (
    document.getElementById('settings-tope')
  );
  topeInput.value =
    config.presupuestoTope != null ? String(config.presupuestoTope) : '';
  draftEstancias = [...(config.estancias || ESTANCIAS_DEFAULT)];
  renderEstanciasEditor();
  clearImportUi();
  updateLastBackupLabel();
  settingsSnapshot = settingsFormSnapshot();

  setOverlayOpen('settings-overlay', true, {
    focusSelector: focusTope ? '#settings-tope' : undefined,
  });
}

function consumeNewEstanciaInput() {
  const input = /** @type {HTMLInputElement|null} */ (
    document.getElementById('new-estancia')
  );
  const name = (input?.value || '').trim();
  if (!name) return null;
  if (draftEstancias.includes(name)) {
    if (input) input.value = '';
    showToast('Esa estancia ya existe');
    return null;
  }
  draftEstancias.push(name);
  if (input) input.value = '';
  renderEstanciasEditor();
  return name;
}

async function persistEstancias() {
  const list = draftEstancias.length ? [...draftEstancias] : [...ESTANCIAS_DEFAULT];
  config = await saveConfig({ estancias: list });
  draftEstancias = [...(config.estancias || list)];
  settingsSnapshot = settingsFormSnapshot();
  paint();
}

async function addEstanciaFromInput() {
  const name = consumeNewEstanciaInput();
  if (!name) {
    const input = document.getElementById('new-estancia');
    if (!(/** @type {HTMLInputElement|null} */ (input)?.value || '').trim()) {
      showToast('Escribe un nombre y pulsa Añadir');
    }
    return;
  }
  try {
    await persistEstancias();
    showToast(`Estancia «${name}» guardada`);
  } catch (err) {
    console.error(err);
    showToast(/** @type {Error} */ (err)?.message || 'No se pudo guardar la estancia');
  }
}

async function saveSettingsFromForm() {
  // Si hay texto pendiente en el campo, lo incorpora antes de guardar
  consumeNewEstanciaInput();

  const topeRaw = /** @type {HTMLInputElement} */ (
    document.getElementById('settings-tope')
  ).value.trim();
  const presupuestoTope = topeRaw === '' ? null : Number(topeRaw);
  if (topeRaw !== '' && Number.isNaN(presupuestoTope)) {
    throw new Error('El tope no es un número válido');
  }
  const prev = config.presupuestoTope;
  const patch = {
    presupuestoTope,
    estancias: draftEstancias.length ? [...draftEstancias] : [...ESTANCIAS_DEFAULT],
  };
  if (presupuestoTope !== prev) {
    patch.presupuestoTopeUpdatedAt = new Date().toISOString();
  }
  config = await saveConfig(patch);
  draftEstancias = [...(config.estancias || patch.estancias)];
  settingsSnapshot = settingsFormSnapshot();
  updateBudget(productos, config);
  paint();
  showToast('Ajustes guardados');
}

async function closeSettings(save) {
  try {
    if (save) {
      await saveSettingsFromForm();
    } else if (settingsFormSnapshot() !== settingsSnapshot) {
      if (!confirm('¿Descartar cambios de ajustes?')) return;
    }
    clearImportUi();
    setOverlayOpen('settings-overlay', false);
  } catch (err) {
    console.error(err);
    showToast(/** @type {Error} */ (err)?.message || 'No se pudieron guardar los ajustes');
  }
}

function getExportFileName(fallbackBase) {
  const input = /** @type {HTMLInputElement|null} */ (
    document.getElementById('export-filename')
  );
  let name = (input?.value || '').trim() || fallbackBase;
  name = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-');
  if (!name.toLowerCase().endsWith('.json')) name += '.json';
  return name;
}

function readFileAsText(file) {
  if (typeof file.text === 'function') {
    return file.text().then((t) => String(t || ''));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('No se pudo leer el archivo'));
    reader.readAsText(file);
  });
}

function clearImportUi() {
  pendingImportFile = null;
  pendingBackup = null;
  const choice = document.getElementById('import-choice');
  if (choice) choice.hidden = true;
  const meta = document.getElementById('import-choice-meta');
  if (meta) meta.textContent = '';
  const preview = document.getElementById('merge-preview');
  if (preview) preview.innerHTML = '';
  const input = /** @type {HTMLInputElement|null} */ (
    document.getElementById('import-file')
  );
  if (input) input.value = '';
}

async function markBackupDone() {
  config = await saveConfig({ lastBackupAt: new Date().toISOString() });
  updateLastBackupLabel();
}

function updateLastBackupLabel() {
  const el = document.getElementById('last-backup-label');
  if (!el) return;
  if (!config.lastBackupAt) {
    el.textContent = 'Último backup: nunca';
    return;
  }
  const d = new Date(config.lastBackupAt);
  el.textContent = `Último backup: ${d.toLocaleString('es-ES')}`;
}

/**
 * @param {object} backup
 * @param {'merge'|'replace'} mode
 */
async function applyBackup(backup, mode) {
  const stats = await importBackup(backup, mode);
  await refresh();
  if (mode === 'replace') {
    showToast(`Reemplazado · ${stats.added} productos`);
  } else {
    showToast(
      `Sync: +${stats.added} · ~${stats.updated} · −${stats.deleted} · =${stats.kept}`
    );
  }
  return stats;
}

async function prepareBackupPreview(backup, metaText) {
  pendingBackup = backup;
  const all = await getAllProductos({ includeDeleted: true });
  const plan = planMerge(backup, all);
  const meta = document.getElementById('import-choice-meta');
  if (meta) meta.textContent = metaText || '';
  renderMergePreview(plan);
  const choice = document.getElementById('import-choice');
  if (choice) {
    choice.hidden = false;
    choice.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

async function runImport(mode) {
  const backup = pendingBackup;
  if (!backup) return;
  showToast(mode === 'replace' ? 'Reemplazando…' : 'Fusionando…');
  try {
    if (mode === 'replace') {
      await autoBackupBeforeReplace();
    }
    await applyBackup(backup, mode);
  } catch (err) {
    console.error(err);
    showToast(/** @type {Error} */ (err)?.message || 'No se pudo importar');
  } finally {
    clearImportUi();
  }
}

async function autoBackupBeforeReplace() {
  const full = await getAllProductos({ includeDeleted: true });
  const backup = exportBackup(full, config, { includePhotos: true });
  const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `amueblar-auto-antes-reemplazar-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  await markBackupDone();
  showToast('Backup de seguridad descargado');
}

function downloadBackup(includePhotos) {
  const backup = exportBackup(productos, config, { includePhotos });
  const name = getExportFileName(includePhotos ? 'amueblar-backup' : 'amueblar-sync');
  const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  markBackupDone();
  showToast(includePhotos ? `Exportado: ${name}` : `Sync exportado: ${name}`);
}

async function sendSync() {
  const all = await getAllProductos({ includeDeleted: true });
  const backup = exportBackup(all, config, { includePhotos: false });
  const text = JSON.stringify(backup);
  const name = getExportFileName('amueblar-sync');
  const file = new File([text], name, { type: 'application/json' });

  try {
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      await navigator.share({
        files: [file],
        title: 'Amueblar sync',
        text: 'Sync Amueblar. En el otro móvil: Pegar sync o Importar → Fusionar.',
      });
      await markBackupDone();
      showToast('Sync listo para enviar');
      return;
    }
  } catch (err) {
    if (/** @type {any} */ (err)?.name === 'AbortError') return;
  }

  try {
    if (navigator.share) {
      await navigator.share({
        title: 'Amueblar sync',
        text: `Amueblar sync — Pegar sync en el otro móvil:\n\n${text}`,
      });
      await markBackupDone();
      showToast('Sync compartido');
      return;
    }
  } catch (err) {
    if (/** @type {any} */ (err)?.name === 'AbortError') return;
  }

  try {
    await navigator.clipboard.writeText(text);
    await markBackupDone();
    showToast('Sync copiado. Pégalo en el otro móvil');
  } catch {
    downloadBackup(false);
  }
}

async function pasteSync() {
  try {
    let text = '';
    try {
      text = await navigator.clipboard.readText();
    } catch {
      text =
        window.prompt('Pega aquí el texto del sync que te han enviado:') || '';
    }
    if (!text.trim()) {
      showToast('No hay nada que pegar');
      return;
    }
    const backup = parseBackupPayload(text);
    if (!document.getElementById('settings-overlay')?.classList.contains('open')) {
      openSettings();
    }
    await prepareBackupPreview(backup, 'Sync pegado desde el portapapeles');
  } catch (err) {
    console.error(err);
    showToast(/** @type {Error} */ (err)?.message || 'No se pudo leer el sync');
  }
}

document.getElementById('clear-filters')?.addEventListener('click', clearFilters);

document.getElementById('search-input')?.addEventListener('input', (ev) => {
  filters.query = /** @type {HTMLInputElement} */ (ev.target).value;
  paint();
});

document.getElementById('btn-more-filters')?.addEventListener('click', () => {
  filtersExpanded = !filtersExpanded;
  syncFilterChrome();
});

document.getElementById('sort-select')?.addEventListener('change', (ev) => {
  sort = /** @type {any} */ (/** @type {HTMLSelectElement} */ (ev.target).value);
  paint();
});

document.getElementById('btn-lista-compra')?.addEventListener('click', () => {
  filters.listaCompra = !filters.listaCompra;
  if (filters.listaCompra) {
    filters.estado = 'Todos';
    showToast('Lista por tienda');
  }
  paint();
});

document.getElementById('btn-resumen')?.addEventListener('click', () => {
  renderResumenEstancias(productos, (estancia) => {
    filters.estancia = estancia;
    setOverlayOpen('resumen-overlay', false);
    paint();
    showToast(`Filtro: ${estancia}`);
  });
  setOverlayOpen('resumen-overlay', true);
});
document.getElementById('resumen-close')?.addEventListener('click', () => {
  setOverlayOpen('resumen-overlay', false);
});
document.getElementById('resumen-done')?.addEventListener('click', () => {
  setOverlayOpen('resumen-overlay', false);
});
document.getElementById('resumen-overlay')?.addEventListener('click', (ev) => {
  if (ev.target === ev.currentTarget) setOverlayOpen('resumen-overlay', false);
});

document.getElementById('btn-settings')?.addEventListener('click', () => openSettings());
document.getElementById('btn-set-tope')?.addEventListener('click', () => openSettings(true));
document.getElementById('settings-close')?.addEventListener('click', () => closeSettings(false));
document.getElementById('settings-cancel')?.addEventListener('click', () => closeSettings(false));
document.getElementById('settings-done')?.addEventListener('click', () => closeSettings(true));
document.getElementById('settings-overlay')?.addEventListener('click', (ev) => {
  if (ev.target === ev.currentTarget) closeSettings(false);
});

document.getElementById('btn-add-estancia')?.addEventListener('click', () => {
  addEstanciaFromInput();
});
document.getElementById('new-estancia')?.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter') {
    ev.preventDefault();
    addEstanciaFromInput();
  }
});

document.getElementById('btn-sync-send')?.addEventListener('click', () => sendSync());
document.getElementById('btn-sync-paste')?.addEventListener('click', () => pasteSync());
document.getElementById('btn-export-sync')?.addEventListener('click', () => downloadBackup(false));
document.getElementById('btn-export')?.addEventListener('click', () => downloadBackup(true));

document.getElementById('btn-import')?.addEventListener('click', () => {
  const input = /** @type {HTMLInputElement|null} */ (
    document.getElementById('import-file')
  );
  if (!input) return;
  input.value = '';
  input.click();
});

document.getElementById('import-file')?.addEventListener('change', async (ev) => {
  const file = /** @type {HTMLInputElement} */ (ev.target).files?.[0];
  if (!file) return;
  pendingImportFile = file;
  try {
    const text = await readFileAsText(file);
    if (!text.trim()) throw new Error('El archivo está vacío');
    const backup = parseBackupPayload(text);
    const kb = Math.max(1, Math.round(file.size / 1024));
    await prepareBackupPreview(
      backup,
      `Archivo: ${file.name || 'sin nombre'} · ${kb} KB`
    );
  } catch (err) {
    console.error(err);
    showToast(/** @type {Error} */ (err)?.message || 'Archivo no válido');
    clearImportUi();
  }
});

document.getElementById('btn-import-merge')?.addEventListener('click', () => {
  runImport('merge');
});
document.getElementById('btn-import-replace')?.addEventListener('click', () => {
  if (
    !confirm(
      'Se descargará un backup de seguridad y luego se reemplazarán todos los productos. ¿Continuar?'
    )
  )
    return;
  runImport('replace');
});
document.getElementById('btn-import-cancel')?.addEventListener('click', () => {
  clearImportUi();
});

document.getElementById('btn-share')?.addEventListener('click', async () => {
  const text = buildShareText(productos, config);
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Amueblar', text });
      return;
    } catch {
      /* fall through */
    }
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
});

document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Escape') return;
  for (const id of ['settings-overlay', 'resumen-overlay']) {
    const el = document.getElementById(id);
    if (el?.classList.contains('open')) {
      if (id === 'settings-overlay') closeSettings(false);
      else setOverlayOpen(id, false);
      break;
    }
  }
});

async function boot() {
  await openDb();
  await refresh();

  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('./sw.js');
    } catch (err) {
      console.warn('SW no registrado:', err);
    }
  }
}

boot().catch((err) => {
  console.error(err);
  showToast('Error al iniciar la app');
});
