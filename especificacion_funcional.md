# Documento de Especificación Funcional: App de Gestión de Muebles y Presupuesto

## 1. Visión General del Proyecto
* **Propósito:** Crear una Web App ligera, autónoma y de uso personal (PWA) para gestionar el proceso de selección de muebles y electrodomésticos para una mudanza.
* **Objetivo Principal:** Permitir al usuario organizar opciones visualmente por estancia y categoría, capturar datos de productos mediante fotos a sus etiquetas, gestionar estados de decisión y controlar el presupuesto global en tiempo real.
* **Premisas Clave:**
  * **Coste:** 100% Gratuito (sin depender de APIs de pago ni servidores en la nube).
  * **Arquitectura:** HTML/CSS/JavaScript (PWA) ejecutada localmente en el móvil.
  * **Privacidad y Datos:** Almacenamiento local mediante `IndexedDB` en el dispositivo.

---

## 2. Flujo de Trabajo Principal

```
[ Botón + Añadir Mueble ]
           │
           ├──> 1. Foto 1: Mueble en Exposición (Imagen de Portada)
           │
           └──> 2. Foto 2: Etiqueta del Producto
                                 │
                                 ▼
                     [ Procesamiento OCR Local ]
                     (Tesseract.js / API Nativa)
                                 │
                                 ▼
                    Autocompletado de Campos:
                    • Nombre
                    • Precio (€)
                    • Medidas (Ancho x Alto x Fondo)
                                 │
                                 ▼
                    [ Formulario de Confirmación ]
                    • Asignación de Estancia
                    • Asignación de Categoría
                    • Guardar Producto
```

---

## 3. Modelo de Datos (`IndexedDB`)

Cada entidad de producto debe guardarse con la siguiente estructura:

| Campo | Tipo | Descripción / Ejemplo |
| :--- | :--- | :--- |
| `id` | String | Timestamp o UUID único |
| `nombre` | String | Nombre del producto (ej. *Mesa KALLAX*) |
| `estancia` | Enum/String | `Salón`, `Dormitorio Principal`, `Cocina`, `Baño`, `Terraza`, `Recibidor`, `Otro` |
| `categoria` | Enum/String | `Mueble`, `Electrodoméstico`, `Iluminación`, `Decoración`, `Otro` |
| `precio` | Number | Valor numérico decimal (ej. `129.00`) |
| `tienda` | String | Nombre de la tienda/origen (ej. *IKEA*, *Maison du Monde*, *Leroy Merlin*) |
| `medidas` | String | Dimensiones extraídas o manuales (ej. *140x84x75 cm*) |
| `estado` | Enum/String | `Candidato`, `Seleccionado`, `Comprado` |
| `fotoMueble` | Base64/Blob | Foto principal del artículo en exposición |
| `fotoEtiqueta` | Base64/Blob | Foto de la etiqueta técnica/precio como respaldo |
| `fechaCreacion` | Date | Fecha de alta |

---

## 4. Requisitos de Pantallas e Interfaz de Usuario (UI/UX)

### 4.1. Cabecera y Resumen de Presupuesto
* **Contador Total Seleccionado:** Suma del precio de todos los ítems con estado `Seleccionado` + `Comprado`.
* **Contador Gasto Real:** Suma únicamente de los ítems con estado `Comprado`.

### 4.2. Filtros y Navegación
* **Navegación por Estancias:** Pestañas o dropdown (*Todos*, *Salón*, *Dormitorio*, *Cocina*, etc.).
* **Filtro Secundario por Categoría:** Selector rápido (*Todos*, *Muebles*, *Electrodomésticos*, etc.).

### 4.3. Rejilla Visual de Productos (Tarjetas)
* **Visualización:** Tarjetas con la foto principal (`fotoMueble`), el nombre, precio en formato visual y tienda.
* **Indicadores Visuales de Estado:**
  * `Candidato`: Borde/Badge gris o neutro.
  * `Seleccionado`: Borde/Badge verde destacado (Suma al presupuesto).
  * `Comprado`: Borde/Badge azul o con icono de verificación.
* **Acción Rápida:** Selector directo en la tarjeta para cambiar el estado sin entrar al detalle.

### 4.4. Modal / Vista de Detalle
* Muestra la foto del mueble a tamaño completo.
* Muestra la foto de la etiqueta adjunta abajo para consulta rápida de especificaciones originales.
* Permite editar cualquier campo manualmente.
* Opción de eliminar el producto.

---

## 5. Especificaciones Técnicas y Requisitos
1. **Librería OCR Recomendada:** Integración de `Tesseract.js` (vía CDN) o la API nativa de la cámara para la extracción del texto de la etiqueta en el cliente (navegador).
2. **Expresiones Regulares (Regex) para Extracción:**
   * **Precio:** Patrones como `\d+[\.,]\d{2}\s*€?` o `€\s*\d+`.
   * **Medidas:** Patrones como `\d+\s*x\s*\d+(\s*x\s*\d+)?\s*cm`.
3. **PWA (Progressive Web App):**
   * Archivo `manifest.json` configurado para icono de inicio e interfaz a pantalla completa (`display: standalone`).
   * Compatibilidad total con iOS Safari y Android Chrome.
4. **Responsiño y Estilos:** Tailwind CSS (vía CDN) para un diseño móvils-first fluido y estilizado.