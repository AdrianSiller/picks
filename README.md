# Picks del Día

App de picks para NBA, NFL y soccer (Liga MX, La Liga, Premier League, Bundesliga, Serie A, Ligue 1 y Champions). Se abre en `https://adriansiller.github.io/picks/`.

- **Cada mañana (7:17 am CDMX)** una GitHub Action baja juegos, líneas, props, historial de jugadores y defensas, calcula los picks y guarda `data/latest.json`. También califica los picks del día anterior en `data/results.json`.
- **A las 2:47 pm** vuelve a correr para tomar bajas y líneas nuevas antes de los partidos.
- **Botón "Actualizar"** en la app: revisa en vivo en ESPN bajas, titulares, líneas y momios, y recalcula los picks en tu celular.

Fuentes: ESPN (estadísticas, líneas y props de DraftKings) y SportsGameOdds (momios de props NFL y "ambos anotan"/corners en Champions; la clave va en el secreto `SGO_API_KEY`).

Para correrlo a mano: pestaña **Actions → Actualizar picks → Run workflow**.

Archivos: `index.html` (la app), `model.js` (fórmulas compartidas por la app y la corrida diaria), `scripts/` (la corrida diaria), `data/` (lo que genera).
