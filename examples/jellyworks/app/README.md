# Jellyworks

Repair conveyor routes, combine ingredients, transform candy and satisfy three puzzles.

```bash
npm ci
npm run dev
npm test
npm run build
npm run preview
```

Development port: 5172. See package.json for preview ports. Pass a different port if another local app is using it.

## Controls

- Click a tool (or keys **1–7**: BELT, TURN, SPLIT, MERGE, MIX, MOLD, ERASE), then click a tile.
- **R** rotate clockwise / **Shift+R** (or **Q**) counter-clockwise. Over an existing editable belt this rotates it (1 move); over an empty tile it rotates the placement ghost (free). **Right-click** rotates too.
- **F** mirrors a turn. **Ctrl/Cmd+Z** undo, **Ctrl/Cmd+Shift+Z** or **Ctrl+Y** redo.
- **Space** / RUN FACTORY runs; STOP & EDIT returns to build (clears in-flight candy and counts, keeps layout and moves).
- **P** or the round button pauses while running; when building, the round button is RESET (restores the original puzzle).
- **Esc** / gear: settings (music, effects, mute, quality, level select, restart). **H** hides the HUD.
- MIX / MOLD inspect the fixed machines and their recipes (machines are fixed in these puzzles).


## Source and assets

Game rules, rendering and UI are under src/. Runtime resources are in public/. The original visual reference and full development sheet are in ../references/. Comparisons are in ../review/. Case notes and historical evidence are one directory above. API credentials are not needed to run or build.

The project preserves its original dependency lockfile; this is a working historical example, not a recommendation to start new projects on those exact versions.
