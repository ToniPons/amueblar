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
  ESTANCIAS,
} from './db.js';
import {
  renderChips,
  renderGrid,
  updateBudget,
  showToast,
  setOverlayOpen,
  renderResumenEstancias,
  renderCompare,
  buildShareText,
} from './ui.js';
import { initForm } from './form.js';

const filters = {
  estancia: 'Todos',
  categoria: 'Todos',
  estado: 'Todos',
  listaCompra: false,
};

/** @type {'fecha'|'precio-asc'|'precio-desc'|'nombre'} */
let sort = 'fecha';
/** @type {object[]} */
let productos = [];
/** @type {{ id: string, presupuestoTope: number|null, medidasEstancia: Record<string, string> }} */
let config = { id: 'app', presupuestoTope: null, medidasEstancia: {} };
let compareMode = false;
let filtersExpanded = false;
/** @type {Set<string>} */
const compareIds = new Set();
/** @type {File|null} */
let pendingImportFile = null;
/** @type {'merge-first'|null} */
let pendingImportMode = null;

function clearFilters() {
  filters.estancia = 'Todos';
  filters.categoria = 'Todos';
  filters.estado = 'Todos';
  filters.listaCompra = false;
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

function updateCompareBar() {
  const bar = document.getElementById('compare-bar');
  const countEl = document.getElementById('compare-count');
  const openBtn = /** @type {HTMLButtonElement|null} */ (
    document.getElementById('btn-compare-open')
  );
  if (!bar) return;
  bar.hidden = !compareMode;
  const n = compareIds.size;
  if (countEl) countEl.textContent = `${n} seleccionado${n === 1 ? '' : 's'}`;
  if (openBtn) openBtn.disabled = n < 2;
  document.getElementById('btn-compare')?.classList.toggle('active', compareMode);
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
    compareMode,
    compareIds,
    onToggleCompare: (id) => {
      if (compareIds.has(id)) compareIds.delete(id);
      else {
        if (compareIds.size >= 3) {
          showToast('Máximo 3 productos para comparar');
          paint();
          return;
        }
        compareIds.add(id);
      }
      updateCompareBar();
      paint();
    },
  });
  updateCompareBar();
}

const formApi = initForm({
  onSaved: refresh,
  getRecentStores: recentStores,
  getRoomMeasure: (estancia) => config.medidasEstancia?.[estancia] || '',
});

function openSettings(focusTope = false) {
  const topeInput = /** @type {HTMLInputElement} */ (
    document.getElementById('settings-tope')
  );
  topeInput.value =
    config.presupuestoTope != null ? String(config.presupuestoTope) : '';

  const box = document.getElementById('settings-medidas');
  if (box) {
    box.innerHTML = ESTANCIAS.map((estancia) => {
      const val = config.medidasEstancia?.[estancia] || '';
      return `
        <div class="form-group">
          <label for="medida-${estancia}">${estancia}</label>
          <input id="medida-${estancia}" data-estancia="${estancia}" type="text"
            value="${val.replace(/"/g, '&quot;')}" placeholder="ej. 3,20 × 4,10 m" />
        </div>`;
    }).join('');
  }

  const choice = document.getElementById('import-choice');
  if (choice) choice.hidden = true;
  pendingImportFile = null;

  setOverlayOpen('settings-overlay', true, {
    focusSelector: focusTope ? '#settings-tope' : undefined,
  });
}

async function saveSettingsFromForm() {
  const topeRaw = /** @type {HTMLInputElement} */ (
    document.getElementById('settings-tope')
  ).value.trim();
  const presupuestoTope = topeRaw === '' ? null : Number(topeRaw);
  /** @type {Record<string, string>} */
  const medidasEstancia = {};
  document.querySelectorAll('#settings-medidas input[data-estancia]').forEach((el) => {
    const input = /** @type {HTMLInputElement} */ (el);
    const key = input.dataset.estancia;
    if (key) medidasEstancia[key] = input.value.trim();
  });
  config = await saveConfig({ presupuestoTope, medidasEstancia });
  updateBudget(productos, config);
  showToast('Ajustes guardados');
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
      `Sync: +${stats.added} nuevos · ${stats.updated} actualizados · ${stats.kept} igual`
    );
  }
  return stats;
}

async function runImport(mode) {
  if (!pendingImportFile) return;
  try {
    const text = await pendingImportFile.text();
    const backup = parseBackupPayload(text);
    await applyBackup(backup, mode);
  } catch (err) {
    console.error(err);
    showToast(err?.message || 'No se pudo importar el backup');
  } finally {
    pendingImportFile = null;
    pendingImportMode = null;
    const choice = document.getElementById('import-choice');
    if (choice) choice.hidden = true;
    const input = /** @type {HTMLInputElement|null} */ (
      document.getElementById('import-file')
    );
    if (input) input.value = '';
  }
}

function buildSyncBackup() {
  return exportBackup(productos, config, { includePhotos: false });
}

async function sendSync() {
  const backup = buildSyncBackup();
  const text = JSON.stringify(backup);
  const file = new File([text], `amueblar-sync-${new Date().toISOString().slice(0, 10)}.json`, {
    type: 'application/json',
  });

  try {
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      await navigator.share({
        files: [file],
        title: 'Amueblar sync',
        text: 'Sync Amueblar (sin fotos). En Ajustes → Pegar sync o Recibir archivo.',
      });
      showToast('Sync listo para enviar');
      return;
    }
  } catch (err) {
    if (err?.name === 'AbortError') return;
  }

  try {
    if (navigator.share) {
      await navigator.share({
        title: 'Amueblar sync',
        text: `Amueblar sync — pega esto en Ajustes → Pegar sync:\n\n${text}`,
      });
      showToast('Sync compartido');
      return;
    }
  } catch (err) {
    if (err?.name === 'AbortError') return;
  }

  try {
    await navigator.clipboard.writeText(text);
    showToast('Sync copiado. Pégalo en el otro móvil');
  } catch {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Archivo sync descargado');
  }
}

async function pasteSync() {
  try {
    let text = '';
    try {
      text = await navigator.clipboard.readText();
    } catch {
      text =
        window.prompt(
          'Pega aquí el texto del sync que te han enviado:'
        ) || '';
    }
    if (!text.trim()) {
      showToast('No hay nada que pegar');
      return;
    }
    const backup = parseBackupPayload(text);
    await applyBackup(backup, 'merge');
  } catch (err) {
    console.error(err);
    showToast(err?.message || 'No se pudo leer el sync');
  }
}

document.getElementById('clear-filters')?.addEventListener('click', clearFilters);

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
    showToast('Vista lista de la compra');
  }
  paint();
});

document.getElementById('btn-compare')?.addEventListener('click', () => {
  compareMode = !compareMode;
  if (!compareMode) compareIds.clear();
  updateCompareBar();
  paint();
  showToast(compareMode ? 'Marca 2–3 productos' : 'Comparar desactivado');
});

document.getElementById('btn-compare-clear')?.addEventListener('click', () => {
  compareIds.clear();
  updateCompareBar();
  paint();
});

document.getElementById('btn-compare-open')?.addEventListener('click', () => {
  renderCompare(productos, [...compareIds]);
  setOverlayOpen('compare-overlay', true);
});

document.getElementById('compare-close')?.addEventListener('click', () => {
  setOverlayOpen('compare-overlay', false);
});
document.getElementById('compare-done')?.addEventListener('click', () => {
  setOverlayOpen('compare-overlay', false);
});
document.getElementById('compare-overlay')?.addEventListener('click', (ev) => {
  if (ev.target === ev.currentTarget) setOverlayOpen('compare-overlay', false);
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

document.getElementById('settings-close')?.addEventListener('click', async () => {
  await saveSettingsFromForm();
  setOverlayOpen('settings-overlay', false);
});
document.getElementById('settings-done')?.addEventListener('click', async () => {
  await saveSettingsFromForm();
  setOverlayOpen('settings-overlay', false);
});
document.getElementById('settings-overlay')?.addEventListener('click', async (ev) => {
  if (ev.target === ev.currentTarget) {
    await saveSettingsFromForm();
    setOverlayOpen('settings-overlay', false);
  }
});

document.getElementById('btn-sync-send')?.addEventListener('click', () => {
  sendSync();
});
document.getElementById('btn-sync-paste')?.addEventListener('click', () => {
  pasteSync();
});
document.getElementById('btn-sync-file')?.addEventListener('click', () => {
  pendingImportMode = 'merge-first';
  document.getElementById('import-file')?.click();
});

document.getElementById('btn-export')?.addEventListener('click', () => {
  const backup = exportBackup(productos, config, { includePhotos: true });
  const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `amueblar-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Backup con fotos exportado');
});

document.getElementById('btn-import')?.addEventListener('click', () => {
  pendingImportMode = null;
  document.getElementById('import-file')?.click();
});

document.getElementById('import-file')?.addEventListener('change', async (ev) => {
  const file = /** @type {HTMLInputElement} */ (ev.target).files?.[0];
  if (!file) return;
  pendingImportFile = file;

  if (pendingImportMode === 'merge-first') {
    await runImport('merge');
    return;
  }

  const choice = document.getElementById('import-choice');
  if (choice) {
    choice.hidden = false;
    choice.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
});

document.getElementById('btn-import-merge')?.addEventListener('click', () => {
  runImport('merge');
});
document.getElementById('btn-import-replace')?.addEventListener('click', () => {
  if (
    !confirm(
      'Se borrarán todos los productos actuales y se sustituirán por el backup. ¿Continuar?'
    )
  )
    return;
  runImport('replace');
});
document.getElementById('btn-import-cancel')?.addEventListener('click', () => {
  pendingImportFile = null;
  pendingImportMode = null;
  const choice = document.getElementById('import-choice');
  if (choice) choice.hidden = true;
  const input = /** @type {HTMLInputElement|null} */ (
    document.getElementById('import-file')
  );
  if (input) input.value = '';
});

document.getElementById('btn-share')?.addEventListener('click', async () => {
  const text = buildShareText(productos, config);
  const waUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Amueblar', text });
      return;
    } catch {
      /* fall through */
    }
  }
  window.open(waUrl, '_blank');
});

document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Escape') return;
  for (const id of [
    'settings-overlay',
    'resumen-overlay',
    'compare-overlay',
  ]) {
    const el = document.getElementById(id);
    if (el?.classList.contains('open')) {
      if (id === 'settings-overlay') saveSettingsFromForm();
      setOverlayOpen(id, false);
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
