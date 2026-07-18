# ⚔️ Aurelia — Legend of the Shattered Star

A **3D open-world action-adventure** that runs entirely in your browser.
No build step, no downloads, no external assets — every model, texture,
animation, sound effect, and piece of music is generated procedurally from
code the moment the game boots.

Seventy years ago a star broke apart over the valley of Aurelia. Where it
fell, the ancient Hollow Shrine sealed itself shut — and something has been
gnawing at the seal ever since. Take up your sword, traveller.

## Playing

```bash
npm start          # python http server on :8000
# or
npm run serve      # npx http-server on :8000
```

Open **http://localhost:8000** in a modern browser. Best with sound on.

### Controls

| Action | Keyboard / Mouse | Gamepad |
| --- | --- | --- |
| Move | `WASD` / arrows | Left stick |
| Camera | Mouse (click to capture) | Right stick |
| Attack / combo | `LMB` or `J` | X |
| Charged spin | Hold attack, release | Hold X |
| Guard | `RMB` or `K` (hold) | LT |
| Dodge roll | `C` / `Ctrl` | B |
| Jump | `Space` | A |
| Sprint | `Shift` (hold) | RT |
| Lock-on | `Tab` / `Q` | RB |
| Interact | `E` / `F` | Y |
| Inventory | `I` | Back |
| Pause | `Esc` | Start |

On phones and tablets a full touch layout appears automatically:
left virtual stick, drag-to-look, and action buttons.

## The world

- **Brindlemere** — a hand-laid village of timbered cottages, a stone well,
  market stall, and six villagers with branching, quest-aware dialogue.
- **Aurel Fields** — rolling meadows of 46,000 wind-blown grass blades that
  part around you as you run.
- **The Elderwood** — deep forest, glowing flowers, skittering things.
- **Mirrowmere** — a lake with animated waves, depth-tinted water and foam
  shorelines. Mind your stamina in deep water.
- **Cinder Flats** — stepped badland mesas, embers on the wind.
- **Skywatch Ruins** — standing stones with a story to tell.
- **The Hollow Shrine** — a torch-lit dungeon: a brazier puzzle, a locked
  boss door, and the **Bonewrought Colossus** — a three-phase boss guarding
  the Sunblade.

Also: a full day/night cycle (dawn god rays, star fields, nocturnal wisps),
five boglin camps that repopulate, treasure chests, heart containers, three
quests, a shop, autosave + manual save (localStorage), and a generative
soundtrack that shifts between exploration, village, night, combat, dungeon,
boss, and victory moods.

## Under the hood

- **Three.js r160** (vendored at `assets/vendor/`, MIT) — the only
  dependency; imported via an import map, zero build tooling.
- Cel-shaded look: shared toon ramps, inverted-hull outlines, a hand-rolled
  post pipeline (bloom, god rays, color grade, vignette, grain) in
  `js/gfx/PostFX.js`.
- Deterministic worldgen: value-noise terrain with six biomes
  (`js/world/Terrain.js`), seeded scatter for every tree, rock and camp.
- Procedural character animation — locomotion, sword combos, rolls, guard,
  swimming, deaths — no keyframe files (`js/entities/HeroModel.js`).
- Generative audio — every SFX synthesized, music sequenced on the WebAudio
  clock around one leitmotif (`js/core/AudioEngine.js`).
- Module contracts in [`docs/CONTRACTS.md`](docs/CONTRACTS.md).

### Development

```bash
npm run check        # syntax-check every module
node tools/e2e.mjs   # headless end-to-end gameplay test (needs `playwright`)
npm run screenshot   # boot + screenshot tour (needs `playwright`)
```

All game code is original. Inspired by the spirit of classic adventure
games; contains no third-party game assets.
