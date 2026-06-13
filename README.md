# Legend of the Verdant Realm

A **3D open-world Zelda-like adventure** that runs entirely in the browser.
Built with [Three.js](https://threejs.org/) loaded from a CDN — **no build tool,
no bundler, no install step**. All 3D "art" is generated procedurally from
primitives, so the project is fully self-contained.

![type: web game](https://img.shields.io/badge/type-web%20game-6fe3c4) ![engine: three.js](https://img.shields.io/badge/engine-three.js-blue)

## ▶️ Running the game

Because the game uses native ES modules, you must serve the folder over HTTP
(opening `index.html` via `file://` will be blocked by the browser). Any static
server works:

```bash
# Option A — Python (no install needed)
python3 -m http.server 8000

# Option B — Node
npx --yes serve -l 8000 .

# Option C — npm script (uses Python under the hood)
npm start
```

Then open **http://localhost:8000** in a modern browser (Chrome, Edge, Firefox).
The only thing fetched from the network is the Three.js module from the CDN
declared in the import map in `index.html`.

## 🎮 Controls

| Action            | Keys                          |
| ----------------- | ----------------------------- |
| Move              | `W` `A` `S` `D` / Arrow keys  |
| Look / orbit cam  | Move the mouse (click to lock)|
| Run               | `Shift`                       |
| Jump              | `Space`                       |
| Swing sword       | Left-click or `F`             |
| Interact          | `E` (chests, doors, portals)  |
| Inventory         | `I`                           |
| Pause             | `Esc`                         |

## ✨ Features

- **Open world** — procedurally generated rolling terrain with grass, sand,
  rocky slopes and snowy peaks, water, and hundreds of scattered trees, rocks,
  bushes and ruin landmarks.
- **Hero character** — third-person follow camera with mouse orbit; walk/run/
  jump with limb animation; gravity and ground-clamping to the terrain.
- **Sword combat** — timed swings with an arc hitbox, knockback, and brief
  invulnerability frames after taking damage.
- **Enemies** — bouncy ChuChus and sturdier Moblins that patrol, spot you,
  give chase, and deal contact damage. Defeated foes drop rupees or hearts.
- **Rupees & hearts** — collectibles that bob, spin, and are vacuumed toward
  you. Coloured rupees are worth more (green 1 / blue 5 / red 20).
- **Chests & items** — open chests for a shield, bow, and bomb bag; an
  inventory overlay lets you view and equip gear.
- **A dungeon** — enter the glowing portal to a torch-lit interior. Defeat the
  guards, claim the **Small Key**, raise the locked golden gate, beat the boss
  Moblin, and open the reliquary for a **Heart Container** and the **Shard of
  Power**.
- **Save system** — progress (position, health, rupees, keys, inventory, opened
  chests, and dungeon state) autosaves to `localStorage`. The title screen
  offers **Continue** whenever a save exists; **New Game** wipes it.

## 🗂️ Project structure

```
index.html            Entry point: import map, canvas, HUD/menu markup
styles.css            HUD, hearts, inventory, and menu styling
js/
  main.js             Bootstraps the Game and runs the render loop
  core/
    Game.js           Orchestrator: scene, state machine, save/load, loop
    Input.js          Keyboard + mouse state, pointer lock
    SaveManager.js    localStorage read/write
  world/
    Terrain.js        Procedural heightmap + getHeightAt() ground query
    Props.js          Tree/rock/bush/ruin/portal factories
    World.js          Builds the overworld (terrain, props, enemies, loot)
    Dungeon.js        Builds the dungeon interior (rooms, gate, boss, reward)
  entities/
    Player.js         Hero: movement, jump, sword swing, health
    Enemy.js          Patrol/chase AI, health, drops
    Pickup.js         Rupees, hearts, keys, items
    Chest.js          Openable container with animated lid
  systems/
    ThirdPersonCamera.js  Orbit follow camera with terrain avoidance
    Inventory.js          Items, rupees, keys, equipped gear
    Combat.js             Sword vs enemies + enemy contact resolution
  ui/
    HUD.js            Hearts, rupee/key counters, prompts, toasts
    InventoryUI.js    Inventory overlay grid
    Menu.js           Title / pause menu
  data/
    items.js          Item definitions
```

## 🧭 Suggested first playthrough

1. From the title screen choose **New Game**.
2. Explore the meadow, swing at a ChuChu, and grab the rupees it drops.
3. Find and open a chest to pick up the **Shield**, then press `I` to view it.
4. Head to the glowing portal (north-east of spawn) and press `E` to enter the
   dungeon.
5. Defeat the key-carrying Moblin, press `E` on the golden gate to use the key,
   beat the boss, and open the reliquary.
6. Reload the page — choose **Continue** and confirm your progress persisted.

## Notes & limitations

- The bow and bombs are collectible and equippable, but firing/throwing
  projectiles is not yet wired up — they are scaffolding for a future update.
- Three.js itself loads from `unpkg.com`; everything else is local. To run fully
  offline, download `three.module.js` and point the import map at a local copy.
