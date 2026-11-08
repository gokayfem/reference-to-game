# Sunshine Train Battle

Clear purple robots across six train cars, jump gaps, manage ammo and shield, and reach the engine.

```bash
npm ci
npm run dev
npm test
npm run build
npm run preview
```

Development port: 5174. See package.json for preview ports. Pass a different port if another local app is using it.

## Controls

WASD move · Mouse look · Left click fire (hold) · R reload · Space jump · Shift brief sprint · Q hold defensive shield · M route map · Esc pause.
Click Play to lock the pointer and start audio. If pointer lock is refused, hold the left mouse button and drag to look.


## Source and assets

Game rules, rendering and UI are under src/. Runtime resources are in public/. The original visual reference and full development sheet are in ../references/. Comparisons are in ../review/. Case notes and historical evidence are one directory above. API credentials are not needed to run or build.

The project preserves its original dependency lockfile; this is a working historical example, not a recommendation to start new projects on those exact versions.
