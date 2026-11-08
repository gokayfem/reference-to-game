# Petal Pals

Observe, feed, photograph and befriend three companions while recording meadow wildlife and habitats.

```bash
npm ci
npm run dev
npm test
npm run build
npm run preview
```

Development port: 5173. See package.json for preview ports. Pass a different port if another local app is using it.

## Controls


| Key | Action |
| --- | --- |
| W A S D / arrows | Walk (relative to the fixed camera) |
| Shift | Stroll faster |
| E | Interact with the nearest valid target (pick fruit, default creature action) |
| Tab | Cycle nearby targets |
| 1 / 2 / 3 / 4 | Observe / Offer Fruit / Photograph / Befriend (also clickable tiles) |
| F | Play the flute (gathers the three pals) |
| J | Journal · M map (click map to set a waypoint, right-click to clear) |
| Esc | Close overlay / exit photo mode / pause (mute, volumes, quality, New Day) |
| H | Hide HUD (screenshots) |
| Photo mode | A/D turn · W/S tilt · Q/E zoom · mouse drag aim · wheel zoom · Space/click shutter |

No pointer lock is used. Overlays block world movement while open.


## Source and assets

Game rules, rendering and UI are under src/. Runtime resources are in public/. The original visual reference and full development sheet are in ../references/. Comparisons are in ../review/. Case notes and historical evidence are one directory above. API credentials are not needed to run or build.

The project preserves its original dependency lockfile; this is a working historical example, not a recommendation to start new projects on those exact versions.
