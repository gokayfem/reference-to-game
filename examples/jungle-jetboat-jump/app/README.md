# Jungle Jetboat Jump

Steer through ordered gates, collect suns, clear the canyon leap and reach the lagoon.

```bash
npm ci
npm run dev
npm test
npm run build
npm run preview
```

Development port: 5171. See package.json for preview ports. Pass a different port if another local app is using it.

## Controls


| Key | Action |
| --- | --- |
| W / ↑ | Throttle |
| S / ↓ | Brake / reverse |
| A D / ← → | Steer |
| Shift | Boost (100 cap, drains 35/s, refills 12/s after 1 s) |
| C | Chase / cockpit camera |
| M | Route map |
| Esc | Pause (R retries from pause or results) |
| N | Mute; music/effects sliders + quality in the pause menu |


## Source and assets

Game rules, rendering and UI are under src/. Runtime resources are in public/. The original visual reference and full development sheet are in ../references/. Comparisons are in ../review/. Case notes and historical evidence are one directory above. API credentials are not needed to run or build.

The project preserves its original dependency lockfile; this is a working historical example, not a recommendation to start new projects on those exact versions.
