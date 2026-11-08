# Tasky

Gestor de tareas por proyecto para macOS y Windows, con estética de editor de código:
una línea por tarea, número de línea a la izquierda, el estado al final de la línea y cada
proyecto como una pestaña.

Hecho con **Tauri 2** (Rust + WebView del sistema), **Svelte 5** y **SQLite**. El instalador
pesa unos pocos MB y los datos se guardan solo en tu equipo.

## Uso rápido

- Escribe en la última línea y presiona Enter. Puedes agregar marcas al escribir:
  `Arreglar login #auth !alta @viernes` → etiqueta `#auth`, prioridad alta, fecha límite el viernes.
  Fechas válidas: `@hoy`, `@mañana`, un día de la semana, `@15/11`, `@15/11/27` o `@2026-11-15`.
- El buscador global (⌘⇧F / Ctrl+Shift+F, o el botón "buscar" arriba) busca en títulos, notas,
  etiquetas, estados y nombres de proyecto de todos los proyectos, sin importar acentos ni mayúsculas.
  Al hacer clic en una etiqueta del panel de detalle se buscan todas las tareas con esa etiqueta.
- Los estados por defecto son pendiente ○, en proceso ●, bloqueada ■, por desplegar ◆ y lista ✓.
  Se pueden renombrar, recolorear, reordenar, agregar o quitar en Ajustes (⌘, / Ctrl+,).

| Acción | macOS | Windows |
|---|---|---|
| Moverse entre tareas | ↑ ↓ · j k | ↑ ↓ · j k |
| Editar la tarea | ↵ | Enter |
| Avanzar estado / elegir estado | espacio / S o 1–9 | Espacio / S o 1–9 |
| Cambiar prioridad | P | P |
| Mover tarea | ⌥↑ ⌥↓ | Alt+↑ Alt+↓ |
| Nueva tarea | ⌘N · O | Ctrl+N · O |
| Eliminar / deshacer | ⌘⌫ / ⌘Z | Ctrl+Retroceso / Ctrl+Z |
| Paleta de comandos / ir a proyecto | ⌘K / ⌘P | Ctrl+K / Ctrl+P |
| Buscar en todos los proyectos | ⌘⇧F | Ctrl+Shift+F |
| Filtrar el proyecto actual (texto, `#tag`, `!alta`, estado) | ⌘F | Ctrl+F |
| Nuevo proyecto | ⌘⇧N | Ctrl+Shift+N |
| Pestañas | ⌘1…9 · ⌘W | Ctrl+1…9 · Ctrl+W |
| Barra lateral / detalle | ⌘B / ⌘I | Ctrl+B / Ctrl+I |
| Ocultar terminadas | ⌘⇧H | Ctrl+Shift+H |

## Anotar desde el celular

Desde el iPhone puedes anotar en el Tasky de cualquier equipo (por ejemplo "pc del trabajo" o
"mac de casa") y ver sus pendientes. Las notas pasan por un repo **privado** de GitHub que hace de
bandeja (`AndresL4354/tasky-bandeja`):

- El celular crea un issue con la etiqueta `para:<equipo>`. Ese equipo lo revisa cada ~45 s,
  agrega la tarea al proyecto elegido (o a "bandeja") y cierra el issue. Si el equipo está apagado,
  la nota espera.
- Cada equipo publica `devices/<id>.json` con sus proyectos y tareas sin terminar (sin notas), para
  que el celular pueda listarlos.

Configuración (una vez):

1. Crea un token *fine-grained* en <https://github.com/settings/personal-access-tokens/new> con acceso
   solo al repo `tasky-bandeja` y permisos **Contents** e **Issues** en lectura y escritura.
2. En cada Tasky de escritorio: Ajustes → celular → activa, ponle nombre al equipo y pega el token.
   El token se guarda solo en ese equipo y no viaja en los respaldos.
3. En el iPhone abre <https://andresl4354.github.io/Tasky/> en Safari (o escanea el QR de Ajustes),
   pega el mismo token y usa Compartir → Agregar a inicio.

La app del celular está en `mobile/` y se publica sola en GitHub Pages con
`.github/workflows/pages.yml`. Para probarla sin GitHub: `npm run dev:mobile` y abre
`http://localhost:1430/#demo`.

## Desarrollo

Requisitos: Node LTS y Rust (en esta Mac se instalaron con `nvm` y `rustup`). En Windows además
hacen falta las *Microsoft C++ Build Tools* y WebView2 (viene con Windows 10/11).

```bash
npm install
npm run tauri dev      # app de escritorio con recarga en caliente
npm run dev            # solo la interfaz en el navegador (datos en localStorage)
npm test               # pruebas de la lógica (Vitest)
npm run check          # tipos de Svelte/TypeScript
cd src-tauri && cargo test   # pruebas de la base de datos
```

## Compilar instaladores

- **macOS:**
  - `npm run install:mac` compila e instala (o actualiza) Tasky en `/Applications`. Cierra Tasky antes.
  - `npm run build:dmg` → `src-tauri/target.noindex/release/bundle/dmg/Tasky_<versión>_aarch64.dmg`
    (o `npm run build:app` para generar solo `Tasky.app`).

  Para que Tasky no aparezca repetida en Apps/Spotlight: la carpeta de compilación se llama
  `target.noindex` (configurado en `src-tauri/.cargo/config.toml`), así Spotlight no indexa los
  ejecutables intermedios; y `build:dmg` borra la copia temporal que macOS registra al armar el .dmg.
  Usa estos comandos en vez de `npm run tauri build`.
- **Windows:** no se puede generar desde la Mac. Opciones:
  1. Subir el repo a GitHub y crear un tag (`git tag v0.1.0 && git push --tags`): el workflow
     `.github/workflows/release.yml` compila `.dmg` (Apple Silicon e Intel), `.msi` y `.exe`
     y los deja en un *release* en borrador.
  2. En una PC con Windows: instalar Node, Rust y las Build Tools, y correr `npm install && npm run tauri build`.

Los instaladores no están firmados: la primera vez, en macOS abre la app con clic derecho → Abrir;
en Windows, "Más información" → "Ejecutar de todas formas".

## Dónde están los datos

Una base SQLite en la carpeta de datos de la app:

- macOS: `~/Library/Application Support/com.leomora.tasky/tasky.db`
- Windows: `%APPDATA%\com.leomora.tasky\tasky.db`

Para respaldar o pasar tus tareas a otro equipo usa Ajustes → datos → exportar / importar respaldo (JSON).

## Estructura

```
src/                    interfaz (Svelte 5 + TypeScript)
  lib/state.svelte.ts   estado de la app y todas las acciones
  lib/db/               persistencia: sqlite.ts (Tauri) y memory.ts (navegador/pruebas)
  lib/parse.ts          entrada rápida (#tag !prioridad @fecha)
  lib/keyboard.ts       atajos de teclado
  components/           pestañas, barra lateral, editor, detalle, paleta, ajustes…
src-tauri/              app nativa (Rust)
  src/db.rs             esquema SQLite, migraciones y operaciones
  src/lib.rs            comandos, menú de macOS y respaldo
```
