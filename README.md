# tasky

Gestor de tareas de escritorio para Windows: **Rust + egui/eframe**, binario único
nativo, vive en la **bandeja del sistema** y con **~0 % CPU en reposo**. SQLite
como fuente de verdad e integración con git para auto-completar tareas desde commits.

## Características

- **Vistas GTD + Eisenhower**: Inbox · Hoy · Próximas · Proyectos · Matriz
  Eisenhower (2×2, derivada de urgente × importante).
- **Captura rápida** estilo todo.txt: `Comprar café +casa @errand !hoy #compras ~semanal`.
- **Flujo por teclado**: `1`–`5` vistas · `n` nueva · `↑↓`/`jk` mover · `x`
  completar · `e` editar · `u`/`i` urgente/importante · `Supr` borrar.
- **Recurrencia**: al completar una tarea recurrente se genera la siguiente ocurrencia.
- **Dependencias**: una tarea con prerrequisitos pendientes se marca *bloqueada* y
  se oculta de «Hoy».
- **Bandeja del sistema**: cerrar la ventana la oculta (no mata el proceso); se
  reabre desde la bandeja o con el hotkey global **Ctrl+Alt+Espacio**.
- **Auto-completar desde git**: vincula una tarea a un repo local + una palabra
  clave; cuando un commit nuevo la contiene, la tarea se marca hecha.
- **Config + backups**: tema claro/oscuro y arranque con Windows, persistidos en
  `config.toml`; backup consistente (`VACUUM INTO`) fechado al salir.
- **Auto-actualización**: *Ajustes → Buscar actualizaciones* consulta GitHub
  Releases y, si hay versión nueva, descarga y reemplaza el binario.

## Compilar y ejecutar

Requiere [Rust](https://rustup.rs) (edición 2024).

```bash
cargo run              # desarrollo
cargo build --release  # binario optimizado en target/release/tasky.exe
cargo test             # tests (núcleo, almacén, parser, git, render)
```

El `.exe` de release es autocontenido (SQLite y libgit2 estáticos): se copia y
ejecuta en una máquina Windows limpia sin instalar nada más.

## Captura rápida — marcadores

| Marcador | Ejemplo | Efecto |
|---|---|---|
| `+proyecto` | `+casa` | asigna o crea el proyecto |
| `@ctx` / `#tag` | `@errand #compras` | etiquetas |
| `!fecha` | `!hoy` · `!mañana` · `!2026-12-01` | vencimiento |
| `~recurrencia` | `~semanal` · `~diaria` · `~2w` · `~3d` | repetición |

## Auto-completar tareas desde commits

1. Selecciona una tarea → panel derecho → **Repo git**: pega la ruta del repo
   local y una palabra clave → **Vincular**.
2. Trabaja y haz un commit que contenga esa palabra, p. ej.
   `git commit -m "feat: login listo cierra-login"`.
3. Al volver a la ventana (o con **Comprobar commits**), la tarea se marca hecha.

Se escanean los commits **nuevos** desde que vinculaste (no solo el último), así
que la detección no se pierde aunque hagas más commits encima.

## Datos

Todo vive en `%APPDATA%\Tasky\`: `tasky.db` (base), `config.toml` (ajustes) y
`backups\` (copias fechadas al salir).

## Publicar una versión

Al empujar un tag `v*`, GitHub Actions compila el `.exe` de Windows y publica una
Release con el `.exe` suelto (descarga directa) y un `.zip`
(`tasky-x86_64-pc-windows-msvc.zip`) que usa el auto-update in-app:

```bash
git tag v0.1.0 && git push origin v0.1.0
```

## Licencia

Uso personal.
