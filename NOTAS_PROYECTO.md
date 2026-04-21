# Notas del Proyecto: Reproductor MP3

## Información General
- **Descripción:** Un reproductor de música MP3 basado en web (Progressive Web App).
- **Tecnologías principales:**
  - HTML5 (Estructura en `index.html`)
  - CSS3 (Estilos en `styles.css`)
  - JavaScript Vanilla (Lógica en `app.js`)
  - Funcionalidad PWA (Definida en `manifest.json` y manejada mediante Service Workers si corresponde).

## Estado Actual
*(Describe aquí el estado general en el que se encuentra el proyecto. Por ejemplo: "Interfaz básica implementada y lógica de reproducción funcional" o "Iniciando la construcción de la UI").*

## Tareas Pendientes (TODO)
- [ ] Revisión del código en `app.js` para organizar funciones.
- [ ] Validar que la interfaz sea totalmente responsiva mediante `styles.css`.
- [ ] Probar la persistencia o instalación PWA comprobando el `manifest.json`.
- [ ] *(Agrega aquí nuevas funcionalidades a desarrollar)*

## Estructura de Archivos (Referencia)
- `index.html`: La vista principal del reproductor.
- `app.js`: Contiene toda la lógica de reproducción, manejo de eventos de la interfaz y probablemente la carga de archivos.
- `styles.css`: Todos los estilos para la interfaz del usuario.
- `manifest.json`: Configuración de la aplicación web progresiva y definición de iconos.
- `icon-192.png` / `icon-512.png`: Iconos para la instalación PWA.

## Ideas a Futuro (Backlog)
- Añadir un ecualizador o visualizador de audio integrado.
- Soporte para listas de reproducción guardadas localmente (usando `localStorage` o `IndexedDB`).
- Controles multimedia desde notificaciones si estuviese minimizado en móvil.
- Implementación completa offline usando un Service Worker.

## Recursos e Inspiración
- *(Añade aquí enlaces a recursos de diseño, librerías, foros, o documentación consultados)*

---
*Nota: Este archivo sirve como bitácora y registro vivo del proyecto. Actualízalo frecuentemente a medida que se desarrolla el Reproductor MP3.*
