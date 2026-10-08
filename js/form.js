import {
  ESTANCIAS,
  CATEGORIAS,
  ESTADOS,
  TIENDAS_PRESET,
  addProducto,
  updateProducto,
  getProducto,
  deleteProducto,
  duplicateProducto,
  lineTotal,
} from './db.js';
import {
  fillSelect,
  setOverlayOpen,
  showToast,
  fileToDataUrl,
  formatEuro,
  linkifyText,
} from './ui.js';

const QUICK_MODE_KEY = 'amueblar-quick-mode';

/**
 * @typedef {object} FormCallbacks
 * @property {() => Promise<void>|void} onSaved
 * @property {() => string[]} [getRecentStores]
 * @property {(estancia: string) => string} [getRoomMeasure]
 */

/**
 * @param {FormCallbacks} callbacks
 */
export function initForm(callbacks) {
  const overlay = document.getElementById('form-overlay');
  const detailOverlay = document.getElementById('detail-overlay');
  const form = /** @type {HTMLFormElement} */ (document.getElementById('product-form'));
  const titleEl = document.getElementById('form-title');
  const hintEl = document.getElementById('form-hint');
  const idInput = /** @type {HTMLInputElement} */ (document.getElementById('field-id'));
  const mueblePreview = document.getElementById('preview-mueble');
  const etiquetaPreview = document.getElementById('preview-etiqueta');
  const slotMueble = document.getElementById('slot-mueble');
  const slotEtiqueta = document.getElementById('slot-etiqueta');
  const inputMueble = /** @type {HTMLInputElement} */ (document.getElementById('input-mueble'));
  const inputEtiqueta = /** @type {HTMLInputElement} */ (document.getElementById('input-etiqueta'));
  const detailContent = document.getElementById('detail-content');
  const deleteRow = document.getElementById('form-delete-row');
  const duplicateRow = document.getElementById('form-duplicate-row');
  const quickToggle = /** @type {HTMLInputElement|null} */ (
    document.getElementById('field-quick-mode')
  );
  const tiendaChips = document.getElementById('tienda-chips');
  const roomHint = document.getElementById('room-measure-hint');
  const estanciaSelect = /** @type {HTMLSelectElement} */ (
    document.getElementById('field-estancia')
  );

  let fotoMueble = /** @type {string|null} */ (null);
  let fotoEtiqueta = /** @type {string|null} */ (null);
  let quickMode = false;

  fillSelect(estanciaSelect, ESTANCIAS);
  fillSelect(
    /** @type {HTMLSelectElement} */ (document.getElementById('field-categoria')),
    CATEGORIAS
  );
  fillSelect(
    /** @type {HTMLSelectElement} */ (document.getElementById('field-estado')),
    ESTADOS,
    'Candidato'
  );

  function setPreview(imgEl, slotEl, dataUrl) {
    if (!imgEl || !slotEl) return;
    if (dataUrl) {
      imgEl.src = dataUrl;
      imgEl.hidden = false;
      slotEl.classList.add('has-image');
    } else {
      imgEl.removeAttribute('src');
      imgEl.hidden = true;
      slotEl.classList.remove('has-image');
    }
  }

  function applyQuickMode(on, persist = false) {
    quickMode = on;
    document.querySelectorAll('.full-only').forEach((el) => {
      /** @type {HTMLElement} */ (el).hidden = on;
    });
    if (hintEl) {
      hintEl.textContent = on
        ? 'Modo rápido: foto, nombre, precio, tienda y estancia.'
        : 'Foto del mueble y datos básicos. Activa modo rápido si vas con prisa en tienda.';
    }
    if (persist) {
      try {
        localStorage.setItem(QUICK_MODE_KEY, on ? '1' : '0');
      } catch {
        /* ignore */
      }
    }
  }

  function updateLineTotal() {
    const el = document.getElementById('form-line-total');
    if (!el) return;
    const precio =
      parseFloat(
        /** @type {HTMLInputElement} */ (document.getElementById('field-precio')).value
      ) || 0;
    const cantidad = Math.max(
      1,
      parseInt(
        /** @type {HTMLInputElement} */ (document.getElementById('field-cantidad')).value,
        10
      ) || 1
    );
    el.textContent = `Total línea: ${formatEuro(precio * cantidad)}`;
  }

  function renderTiendaChips(selected) {
    if (!tiendaChips) return;
    const recent = callbacks.getRecentStores?.() || [];
    const merged = [
      ...TIENDAS_PRESET,
      ...recent.filter((t) => t && !TIENDAS_PRESET.includes(t)),
    ].slice(0, 12);

    tiendaChips.innerHTML = '';
    for (const t of merged) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `chip${t === selected ? ' active' : ''}`;
      btn.textContent = t;
      btn.addEventListener('click', () => {
        const input = /** @type {HTMLInputElement} */ (
          document.getElementById('field-tienda')
        );
        input.value = t;
        renderTiendaChips(t);
      });
      tiendaChips.appendChild(btn);
    }
  }

  function updateRoomHint() {
    if (!roomHint) return;
    const estancia = estanciaSelect.value;
    const measure = callbacks.getRoomMeasure?.(estancia) || '';
    if (measure) {
      roomHint.hidden = false;
      roomHint.textContent = `Hueco en ${estancia}: ${measure}`;
    } else {
      roomHint.hidden = true;
      roomHint.textContent = '';
    }
  }

  function preferredQuickMode() {
    try {
      return localStorage.getItem(QUICK_MODE_KEY) === '1';
    } catch {
      return false;
    }
  }

  function resetForm(usePreferredQuick = true) {
    form.reset();
    idInput.value = '';
    fotoMueble = null;
    fotoEtiqueta = null;
    setPreview(mueblePreview, slotMueble, null);
    setPreview(etiquetaPreview, slotEtiqueta, null);
    fillSelect(
      /** @type {HTMLSelectElement} */ (document.getElementById('field-estado')),
      ESTADOS,
      'Candidato'
    );
    fillSelect(estanciaSelect, ESTANCIAS);
    /** @type {HTMLInputElement} */ (document.getElementById('field-cantidad')).value =
      '1';
    if (deleteRow) deleteRow.hidden = true;
    if (duplicateRow) duplicateRow.hidden = true;
    const preferQuick = usePreferredQuick && preferredQuickMode();
    if (quickToggle) quickToggle.checked = preferQuick;
    applyQuickMode(preferQuick);
    renderTiendaChips('');
    updateRoomHint();
    updateLineTotal();
  }

  function estanciaOptions(current) {
    if (current && !ESTANCIAS.includes(current)) {
      return [...ESTANCIAS, current];
    }
    return ESTANCIAS;
  }

  /**
   * @param {object|null} [producto]
   */
  function openForm(producto = null) {
    resetForm(!producto);
    if (producto) {
      if (titleEl) titleEl.textContent = 'Editar producto';
      idInput.value = producto.id;
      /** @type {HTMLInputElement} */ (document.getElementById('field-nombre')).value =
        producto.nombre || '';
      /** @type {HTMLInputElement} */ (document.getElementById('field-precio')).value =
        producto.precio != null ? String(producto.precio) : '';
      /** @type {HTMLInputElement} */ (document.getElementById('field-cantidad')).value =
        String(Math.max(1, Number(producto.cantidad) || 1));
      /** @type {HTMLInputElement} */ (document.getElementById('field-tienda')).value =
        producto.tienda || '';
      /** @type {HTMLInputElement} */ (document.getElementById('field-medidas')).value =
        producto.medidas || '';
      /** @type {HTMLTextAreaElement} */ (document.getElementById('field-notas')).value =
        producto.notas || '';
      fillSelect(estanciaSelect, estanciaOptions(producto.estancia), producto.estancia);
      fillSelect(
        /** @type {HTMLSelectElement} */ (document.getElementById('field-categoria')),
        CATEGORIAS,
        producto.categoria
      );
      fillSelect(
        /** @type {HTMLSelectElement} */ (document.getElementById('field-estado')),
        ESTADOS,
        producto.estado
      );
      fotoMueble = producto.fotoMueble || null;
      fotoEtiqueta = producto.fotoEtiqueta || null;
      setPreview(mueblePreview, slotMueble, fotoMueble);
      setPreview(etiquetaPreview, slotEtiqueta, fotoEtiqueta);
      if (deleteRow) deleteRow.hidden = false;
      if (duplicateRow) duplicateRow.hidden = false;
      renderTiendaChips(producto.tienda || '');
      updateRoomHint();
      updateLineTotal();
    } else if (titleEl) {
      titleEl.textContent = 'Añadir mueble';
    }
    setOverlayOpen('form-overlay', true, { focusSelector: '#field-nombre' });
  }

  function closeForm() {
    setOverlayOpen('form-overlay', false);
    resetForm();
  }

  /**
   * @param {string} id
   */
  async function openDetail(id) {
    const producto = await getProducto(id);
    if (!producto || !detailContent) return;

    const qty = Math.max(1, Number(producto.cantidad) || 1);
    const hero = producto.fotoMueble
      ? `<div class="detail-hero"><img src="${producto.fotoMueble}" alt=""></div>`
      : `<div class="detail-hero" style="display:grid;place-items:center;color:var(--ink-muted)">Sin foto</div>`;
    const label = producto.fotoEtiqueta
      ? `<div class="detail-label"><img src="${producto.fotoEtiqueta}" alt="Etiqueta"></div>`
      : '';
    const room = callbacks.getRoomMeasure?.(producto.estancia) || '';

    detailContent.innerHTML = `
      ${hero}
      ${label}
      <h2 id="detail-title">${escape(producto.nombre || 'Sin nombre')}</h2>
      <p class="detail-price">${formatEuro(lineTotal(producto))}${
        qty > 1
          ? ` <small class="muted">(${qty} × ${formatEuro(producto.precio)})</small>`
          : ''
      }</p>
      <dl class="detail-meta">
        <div class="detail-meta-row"><dt>Tienda</dt><dd>${escape(producto.tienda || '—')}</dd></div>
        <div class="detail-meta-row"><dt>Estancia</dt><dd>${escape(producto.estancia || '—')}</dd></div>
        <div class="detail-meta-row"><dt>Categoría</dt><dd>${escape(producto.categoria || '—')}</dd></div>
        <div class="detail-meta-row"><dt>Medidas</dt><dd>${escape(producto.medidas || '—')}</dd></div>
        <div class="detail-meta-row"><dt>Cantidad</dt><dd>${qty}</dd></div>
        ${
          room
            ? `<div class="detail-meta-row"><dt>Hueco estancia</dt><dd>${escape(room)}</dd></div>`
            : ''
        }
      </dl>
      ${
        producto.notas
          ? `<div class="detail-notes form-group"><label>Notas</label><p>${linkifyText(producto.notas)}</p></div>`
          : ''
      }
      <div class="form-group">
        <label for="detail-estado">Estado</label>
        <select id="detail-estado" class="detail-estado">
          ${ESTADOS.map(
            (e) =>
              `<option value="${e}" ${e === producto.estado ? 'selected' : ''}>${e}</option>`
          ).join('')}
        </select>
      </div>
      <div class="btn-row sticky-actions">
        <button type="button" class="btn btn-secondary" id="detail-edit">Editar</button>
        <button type="button" class="btn btn-primary" id="detail-close">Cerrar</button>
      </div>
      <div class="btn-row">
        <button type="button" class="btn btn-secondary" id="detail-duplicate">Duplicar</button>
        <button type="button" class="btn btn-danger" id="detail-delete">Eliminar</button>
      </div>
    `;

    document.getElementById('detail-close')?.addEventListener('click', closeDetail);
    document.getElementById('detail-edit')?.addEventListener('click', () => {
      closeDetail();
      openForm(producto);
    });
    document.getElementById('detail-duplicate')?.addEventListener('click', async () => {
      await duplicateProducto(producto.id);
      closeDetail();
      showToast('Producto duplicado');
      await callbacks.onSaved();
    });
    document.getElementById('detail-delete')?.addEventListener('click', async () => {
      if (!confirm('¿Eliminar este producto? No se puede deshacer.')) return;
      await deleteProducto(producto.id);
      closeDetail();
      showToast('Producto eliminado');
      await callbacks.onSaved();
    });
    document.getElementById('detail-estado')?.addEventListener('change', async (ev) => {
      const estado = /** @type {HTMLSelectElement} */ (ev.target).value;
      await updateProducto({ ...producto, estado });
      producto.estado = estado;
      showToast(`Estado: ${estado}`);
      await callbacks.onSaved();
    });

    setOverlayOpen('detail-overlay', true);
  }

  function closeDetail() {
    setOverlayOpen('detail-overlay', false);
  }

  function escape(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function readPayload() {
    return {
      id: idInput.value || undefined,
      nombre: /** @type {HTMLInputElement} */ (document.getElementById('field-nombre'))
        .value.trim(),
      precio:
        parseFloat(
          /** @type {HTMLInputElement} */ (document.getElementById('field-precio')).value
        ) || 0,
      cantidad:
        parseInt(
          /** @type {HTMLInputElement} */ (document.getElementById('field-cantidad'))
            .value,
          10
        ) || 1,
      tienda: /** @type {HTMLInputElement} */ (document.getElementById('field-tienda'))
        .value.trim(),
      medidas: quickMode
        ? ''
        : /** @type {HTMLInputElement} */ (document.getElementById('field-medidas'))
            .value.trim(),
      notas: quickMode
        ? ''
        : /** @type {HTMLTextAreaElement} */ (document.getElementById('field-notas'))
            .value.trim(),
      estancia: estanciaSelect.value,
      categoria: quickMode
        ? 'Mueble'
        : /** @type {HTMLSelectElement} */ (document.getElementById('field-categoria'))
            .value,
      estado: quickMode
        ? 'Candidato'
        : /** @type {HTMLSelectElement} */ (document.getElementById('field-estado')).value,
      fotoMueble,
      fotoEtiqueta: quickMode ? fotoEtiqueta : fotoEtiqueta,
    };
  }

  inputMueble.addEventListener('change', async () => {
    const file = inputMueble.files?.[0];
    if (!file) return;
    fotoMueble = await fileToDataUrl(file);
    setPreview(mueblePreview, slotMueble, fotoMueble);
    inputMueble.value = '';
  });

  inputEtiqueta.addEventListener('change', async () => {
    const file = inputEtiqueta.files?.[0];
    if (!file) return;
    fotoEtiqueta = await fileToDataUrl(file);
    setPreview(etiquetaPreview, slotEtiqueta, fotoEtiqueta);
    inputEtiqueta.value = '';
  });

  quickToggle?.addEventListener('change', () => {
    applyQuickMode(Boolean(quickToggle.checked), true);
  });

  document.getElementById('field-precio')?.addEventListener('input', updateLineTotal);
  document.getElementById('field-cantidad')?.addEventListener('input', updateLineTotal);

  estanciaSelect.addEventListener('change', updateRoomHint);

  document.getElementById('field-tienda')?.addEventListener('input', (ev) => {
    renderTiendaChips(/** @type {HTMLInputElement} */ (ev.target).value.trim());
  });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const payload = readPayload();
    if (!payload.nombre) {
      showToast('El nombre es obligatorio');
      document.getElementById('field-nombre')?.focus();
      return;
    }

    const submitBtn = /** @type {HTMLButtonElement} */ (form.querySelector('[type="submit"]'));
    submitBtn.disabled = true;
    try {
      if (payload.id) {
        const existing = await getProducto(payload.id);
        await updateProducto({
          ...existing,
          ...payload,
          // En modo rápido al editar, conservar campos ocultos
          medidas: quickMode ? existing?.medidas || '' : payload.medidas,
          notas: quickMode ? existing?.notas || '' : payload.notas,
          categoria: quickMode ? existing?.categoria || 'Mueble' : payload.categoria,
          estado: quickMode ? existing?.estado || 'Candidato' : payload.estado,
          fechaCreacion: existing?.fechaCreacion || new Date().toISOString(),
        });
        showToast('Producto actualizado');
      } else {
        await addProducto(payload);
        showToast('Producto guardado');
      }
      closeForm();
      await callbacks.onSaved();
    } catch (err) {
      console.error(err);
      showToast('Error al guardar');
    } finally {
      submitBtn.disabled = false;
    }
  });

  document.getElementById('form-cancel')?.addEventListener('click', closeForm);
  document.getElementById('form-close')?.addEventListener('click', closeForm);
  document.getElementById('detail-close-x')?.addEventListener('click', closeDetail);
  document.getElementById('form-delete')?.addEventListener('click', async () => {
    const id = idInput.value;
    if (!id) return;
    if (!confirm('¿Eliminar este producto? No se puede deshacer.')) return;
    await deleteProducto(id);
    closeForm();
    showToast('Producto eliminado');
    await callbacks.onSaved();
  });
  document.getElementById('form-duplicate')?.addEventListener('click', async () => {
    const id = idInput.value;
    if (!id) return;
    await duplicateProducto(id);
    closeForm();
    showToast('Producto duplicado');
    await callbacks.onSaved();
  });
  document.getElementById('fab-add')?.addEventListener('click', () => openForm());

  overlay?.addEventListener('click', (ev) => {
    if (ev.target === overlay) closeForm();
  });
  detailOverlay?.addEventListener('click', (ev) => {
    if (ev.target === detailOverlay) closeDetail();
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    if (overlay?.classList.contains('open')) closeForm();
    else if (detailOverlay?.classList.contains('open')) closeDetail();
  });

  return { openForm, openDetail, closeForm, closeDetail };
}
