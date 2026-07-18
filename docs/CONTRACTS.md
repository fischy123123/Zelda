# Aurelia — Module Contracts

**Game:** *Aurelia — Legend of the Shattered Star.* A stylized cel-shaded 3D
open-world action-adventure in the browser. Three.js r160, ES modules, **no
build step**, **no network fetches at runtime** (three.js is vendored at
`assets/vendor/three.module.js`, mapped to the bare specifier `three`).
Everything — models, textures, audio — is generated procedurally in code.

Read this whole file before writing a module. The core engine
(`js/core/Game.js`, `js/entities/Player.js`, …) is already written and calls
your module exactly as specified here.

## Art direction (all visual modules)

- Cel-shaded, chunky, rounded silhouettes; Breath-of-the-Wild-inspired but
  100% original. Use `toonMaterial()` from `js/gfx/Toon.js` and the shared
  `PALETTE` there. Characters get `addOutline(group)` inverted-hull outlines.
- Saturated but soft palette. Warm sunlight `#fff2d0`, day sky `#6fb7ff`,
  dusk `#ff9a5c`, night `#0b1030`.
- Everything moves: wind sway (`enableWind(material)` or your own shader),
  bobbing, squash & stretch on hits.
- Performance: instance aggressively (`InstancedMesh`), share materials
  (toonMaterial caches by options), respect `game.quality` (`'high'|'low'` —
  low = mobile: roughly halve instance counts / disable expensive passes).
- World scale: 1 unit ≈ 1 m. Hero is 1.7 u tall. World spans ±850, playable
  radius ~700, rim mountains beyond. North is −Z.

## The `game` context object

Every module constructor receives the `Game` instance:

```
game.scene, game.camera, game.renderer          // three.js core
game.canvas
game.events            // Emitter: on(name, fn), emit(name, payload), once, off
game.state             // see State below
game.input             // move{x,z}, look{dx,dy}, pressed(a), held(a), virtual channel
game.player            // position:Vector3, yaw, velocity, horizontalSpeed, grounded,
                       // sprinting, guarding, swimming, alive, invulnerable, radius,
                       // takeDamage(quarterHearts, sourcePos, knockback), heal(qh),
                       // groundProvider (terrain-like; swap via game.setGroundProvider)
game.hero              // HeroModel (visual)
game.terrain           // heightAt(x,z), normalAt(x,z,out), slopeAt(x,z), biomeAt(x,z),
                       // waterLevel, size, heightTexture (see Terrain notes)
game.cameraRig         // yaw, pitch, lockTarget, shake(amount 0..1), getYaw()
game.combat            // spawnProjectile(opts), toggleLockOn(), swordStats()
game.colliders         // add({x,z,r,top?}), addMany, remove, resolve(x,z,r,y)
game.interact          // register({position, radius, prompt, enabled?, onInteract}) -> unregister fn
game.enemies           // array of live enemies (push new ones here)
game.pickups           // array of Pickup (push new ones here)
game.world             // overworld population (camps, chests…)
game.village, game.dungeon, game.quests
game.sky, game.water, game.vegetation, game.particles, game.postfx
game.audio, game.ui
game.mode              // 'title' | 'playing' | 'dead'
game.uiBlocked         // true when any modal/menu/dialogue is open or not playing
game.paused
game.inDungeon         // bool — SET by Dungeon module on enter/exit
game.quality           // 'high' | 'low'
game.debug             // bool (?debug in URL)
game.pushModal(name) / game.popModal(name)      // 'pause'|'dialogue'|'inventory'
game.hitstop(seconds)
game.newGame(), game.continueGame(), game.hasSave(), game.save()
game.respawnPlayer(), game.useItem(id), game.addMaxHeart()
game.setGroundProvider(p)   // p: {heightAt, normalAt?, biomeAt?, waterLevel?} or null→terrain
```

### State (`game.state`)

```
hp, maxHp              // quarter-hearts (12 = 3 hearts)
stamina, maxStamina    // 0..100+
gems, keys
sword                  // 'bronze' | 'sunblade'
items                  // {potion: n, glowshroom: n, ...}
quests                 // {questId: {stage, ...}} — owned by Quests module
flags                  // {'chest:<id>': true, arbitrary flags} — persisted
day, playTime
```

### Terrain notes

`terrain.biomeAt(x,z)` → `{id, forest, grass, height, slope}`; id ∈
`meadow|forest|badland|beach|lakebed|peak`. `terrain.heightTexture` is a
256² DataTexture over world ±850; `userData = {heightMin, heightSpan,
worldSize}` (height = texel.r * heightSpan + heightMin).
`js/world/layout.js` exports `WORLD, SITES, LAKE, BADLANDS, FOREST_BAND,
SPAWN, DUNGEON_ORIGIN, regionAt(x,z)` — use these, never hardcode positions.

## Event bus (canonical names)

Emitters in [brackets]. Anyone may listen.

```
'game:start' {fresh}            [Game]
'game:save' {}                  [Save]
'day' {day}                     [Game]
'modal' {name, open}            [Game]
'region:enter' {name}           [World]
'prompt' text|null              [Interact]  // interaction prompt for UI
'toast' {text}                  [anyone]    // small notification line
'sign:read' {text}              [World]     // UI shows a sign panel
'lore' {id}                     [World]

'player:attack' {index 0|1|2|'spin'}  [Player]
'player:jump' {pos} / 'player:land' {hard} / 'player:roll' {pos}
'player:step' {pos, biome, sprint}
'player:damage' {amount, hp, blocked?, drown?}
'player:block' {pos}
'player:heal' {hp, container?}
'player:death' {} / 'player:respawn' {}

'combat:hit' {pos, died, enemy, crit?}   [Combat]
'lockon' {enemy}                          [Combat]
'projectile:pop' {pos, color}             [Combat]
'enemy:death' {type, pos, enemy}          [Enemy]   // enemies MUST emit this
'enemy:aggro' {enemy}                     [Enemy]   // first noticed player

'gems' {total, delta} / 'keys' {total}    [Pickup/Chest]
'pickup' {type, pos}                      [Pickup]
'item:added' {id, name} / 'item:used' {id}
'chest:open' {id, big, loot} / 'chest:locked' {}

'dialogue:start' {name} / 'dialogue:end' {}     [UI]
'quest:started' {id, title, text}               [Quests]
'quest:updated' {id, title, text}               [Quests]
'quest:completed' {id, title}                   [Quests]

'dungeon:enter' {} / 'dungeon:exit' {}          [Dungeon]
'boss:start' {name, maxHp} / 'boss:hp' {frac} / 'boss:end' {victory} [Dungeon]

'ui:sfx' {name}                                 [UI] // menu blips for AudioEngine
```

## Module specs

Uniform rule: **every module is a class whose constructor takes `game`** and
adds its own objects to `game.scene` (or the DOM for UI). Update methods are
called every frame by Game as listed. `dt` is scaled game-time seconds
(0 when frozen by menus); modules listed with `rawDt` still tick in menus.

### Sky — `js/gfx/Sky.js` exports `class Sky`
- Owns: sky dome (custom shader — day/dusk/night gradients, sun disc, moon,
  stars, drifting clouds), `THREE.DirectionalLight` sun with shadows
  (2048 map, follows player, ~90u frustum), hemisphere/ambient light,
  `scene.fog` (colors track time of day + aerial perspective).
- API: `update(dt, playerPos)`, `timeOfDay` (0..1; 0=midnight, .25 dawn, .5
  noon, .75 dusk), `setTimeOfDay(t)`, `isNight` (t<0.23||t>0.77), `daySpeed`
  (full day = `WORLD.dayLength` = 600 s), `dayRolledOver` (true for the one
  frame timeOfDay wraps past 1), `sunLight`, `getSunDirection(out:Vector3)`
  (points FROM sun TO world), `getSunScreenPos(camera)` → `{x, y, visible}`
  in NDC 0..1 for god rays, `setUnderground(bool)` (dungeon: near-black fog,
  sun+shadows off, dome hidden; restore on false).

### Water — `js/gfx/Water.js` exports `class Water`
- Plane at `terrain.waterLevel` (size ~1700) with a custom shader: animated
  fbm waves (vertex or normal-space), fresnel toward sky color, depth-based
  color from `terrain.heightTexture` (shallow teal → deep blue), animated
  shoreline foam where ground ≈ water level, sun glint. Time-of-day tint via
  `game.sky` (read its `timeOfDay`/sun color, do not modify it).
- API: `update(dt, camera)`.

### Vegetation — `js/gfx/Vegetation.js` exports `class Vegetation`
- Instanced grass (≥40k blades high / ~14k low quality) with wind sway +
  bend away from the player (uniform for player pos), placed by `biomeAt`
  grass density; flowers; instanced trees (2–3 species: leafy oak-ish,
  birch-ish, dead/badland snag), bushes, rocks; fireflies NOT here (Particles).
- Trees/rocks MUST register trunk colliders: `game.colliders.add({x,z,r})`.
- Keep clear of all `SITES` (radius `r+6`) and the lake below waterline.
  Deterministic placement (`RNG` from `js/util/rng.js`, seed from
  `WORLD.seed`).
- API: `update(dt, playerPos)`.

### Particles — `js/gfx/Particles.js` exports `class Particles`
- One system, pooled. `emit(type, pos, opts?)` with types at least:
  `hit, slash, death, sparkle, dust, heal, leaf, splash, ember, poof,
  explosion, soul`. Listens to events (`combat:hit`, `enemy:death`,
  `player:step` (dust when sprinting), `player:land`, `player:roll`,
  `pickup`, `chest:open`, `projectile:pop`, `player:heal`…) so gameplay
  modules never call it directly (but they may).
- Ambient layer in `update(rawDt)`: fireflies at night near forest/meadow,
  drifting leaves in forest, embers in badlands, pollen motes in noon sun —
  all near the player, pooled, cheap.
- API: `update(rawDt)`, `emit(type, pos, opts)`.

### PostFX — `js/gfx/PostFX.js` exports `class PostFX`
- Custom pipeline (no three/examples imports!): render scene to target, then
  bloom (bright-pass + separable blur, additive), god rays (radial blur from
  `sky.getSunScreenPos`, skip at night/dungeon), color grade (warm lift,
  slight teal shadows, vignette), subtle film grain. Damage flash: listen
  `player:damage` → brief red vignette pulse; `player:heal` → soft gold.
- Must render the scene even if a pass fails (try/catch fallback to plain
  `renderer.render`). `game.quality==='low'` → half-res bloom, no god rays.
- API: `render(rawDt)` (called INSTEAD of renderer.render), `setSize(w,h)`.

### HeroModel — `js/entities/HeroModel.js` exports `class HeroModel`
- Fully procedural stylized hero (original design: teal tunic PALETTE.heroTunic,
  golden hair, cap, boots, belt, sword + wooden shield on back/off-hand),
  ~1.7u tall, feet at local y=0, faces +Z, built from primitives with
  `toonMaterial` + `addOutline`. Articulated via named pivot groups (head,
  torso, arms 2-seg, legs 2-seg, sword hand, shield arm).
- Procedural animation in `update(dt, pose)` — no keyframe files: idle
  breathe/look, walk↔run↔sprint cycles (arm/leg swing scaled by
  `pose.runBlend`, lean into sprint), jump/fall, roll (tuck+spin driven by
  `pose.roll.t`), 3-swing combo + spin attack driven by `pose.attack`
  ({index:0|1|2|'spin', t:0..1}) with anticipation→strike→recover arcs,
  guard stance (shield up), hurt flinch, death crumple, swim paddle, charge
  glow on sword while `pose.charge>0`, blink `pose.iframes` (flicker
  opacity/emissive, not visibility toggling every frame).
- Pose fields: `{speed, runBlend, sprinting, grounded, yVel, guarding,
  swimming, attack, roll, hurt, dead, charge, idleTime, iframes}`.
- API: `group`, `update(dt, pose)`, `setSword('bronze'|'sunblade')`
  (sunblade = golden, subtle emissive), `getSwordTip(out:Vector3)` (world
  pos, for trails), sword trail mesh during swings (fading ribbon).

### Enemies — `js/entities/Enemy.js` exports `createEnemy(game, type, pos, opts)` + `class Enemy`
- Types: `boglin` (squat goblin, wooden club, hp 6, patrols anchor, aggro 16,
  telegraphed club swing dmg 2), `boglin_brute` (big, hp 14, dmg 4, slow
  overhead slam with ground shock), `skitter` (spider-beetle, hp 4, dmg 2,
  fast darting lunges), `wisp` (night spirit, hp 4, floats, fires magic bolt
  dmg 2 via `game.combat.spawnProjectile`, `banish()` fade-out at dawn).
- Procedural models (toonMaterial + addOutline), squash/stretch, eye glow.
  Personality: idle fidgets, alert "!" moment (emit `enemy:aggro` once),
  circle-strafe, back off after attacks.
- Base class handles: hp, `takeDamage(dmg, dir, knockback)` (flash white,
  knockback, hitstun, die → death anim + `enemy:death` + gem/heart drops via
  `Pickup` + `removed=true` after fade), terrain following
  (`game.player.groundProvider` NO — use `game.terrain` unless
  `opts.ground`), separation push between enemies, `opts.anchor`
  {x,z,r} leash, `campIndex` copied from opts.
- Fields the engine relies on: `group` (scene-added), `alive`, `removed`,
  `radius`, `height`, `hp`, `maxHp`, `touchDamage`, `name`, `campIndex?`,
  `update(dt, game)`, `takeDamage(dmg, dirVector3, knockback)`.
- `opts.ground` (dungeon provider) must be respected for boss arena spawns.

### Village — `js/world/Village.js` exports `class Village` (+ NPC/dialogue/quest files)
- Builds Brindlemere at `SITES.village` (use terrain.heightAt for footing):
  5–6 distinct cel-shaded houses (plaster+timber+thatch, chimneys with smoke
  puff hook via particles), a well, lanterns that glow at night (emissive +
  PointLight, budget ≤4 lights), fences, crates, market stall, banners.
  Register building colliders.
- NPCs (`js/entities/NPC.js`): Elder Maren, healer Nyla, Captain Bram,
  shopkeep Tam, kid Pip, farmer Rho. Procedural villager models (varied
  colors/shapes/hats), wander waypoints, face player during dialogue,
  bob/gesture while talking. Each registers with `game.interact`
  (prompt 'Talk') → starts dialogue via `game.ui.dialogue.start(def)`.
- Dialogue defs (`js/data/dialogue.js`): branching nodes
  `{name, nodes:{id:{text:[...], choices?:[{label,next?,action?,cond?}],
  next?, action?}}}` — actions/conds are functions `(game)=>…`. Shop: Tam
  sells potions (30 gems) via choice actions.
- Quests (`js/systems/Quests.js`, exports `class Quests`): quest state in
  `game.state.quests`; ≥3 quests: main 'shattered-star' (Elder → clear the
  Hollow Shrine → return; reward heart container + 100 gems), 'mushroom-medicine'
  (Nyla: 5 glowshrooms → 2 potions + 40 gems), 'thin-the-horde' (Bram:
  defeat 10 boglins → 80 gems + stamina upgrade +25). Track via events
  (`enemy:death`, `item:added`, `boss:end`…), emit `quest:*` events,
  `restore()` re-syncs after load. Objective text exposed via
  `activeObjective()` → `{title, text} | null` for the HUD.
- API: `village.update(dt)` (NPC wander, chimney smoke, lantern flicker).

### Dungeon — `js/world/Dungeon.js` exports `class Dungeon` (+ `js/entities/Boss.js`)
- Overworld shrine door at `SITES.shrine` (weathered stone façade, glowing
  sigil, interact 'Enter') → fade via `game.ui.fadeTo(cb)` → teleport player
  to interior built at `DUNGEON_ORIGIN` (its own ground provider: flat rooms,
  `game.setGroundProvider(dungeon)`, `game.inDungeon=true`,
  `game.sky.setUnderground(true)`, emit `dungeon:enter`).
- Interior: torch-lit stone halls (entry hall → brazier puzzle room: strike
  3 braziers with sword to open door (listen for player attacks nearby or
  use interact), corridor with skitters + chest containing the Shrine Key,
  locked boss door (needs key), boss arena, treasure room). Torch PointLights
  budget ≤6, flickering. Walls = colliders. It's fine to build it as one
  dramatic connected space.
- Boss (`js/entities/Boss.js`): **Bonewrought Colossus** — hulking bone
  construct, hp 60, 3 phases (slams → sweep+charge → enrage shockwave rings
  via projectiles), weak glowing core, emits `boss:start/hp/end`, drops
  heart container + gem shower; defeating it reveals the Sunblade chest
  (`state.sword='sunblade'`, `game.hero.setSword('sunblade')`, sets
  `state.flags.shrineCleared`) and a return portal (teleports out).
- API: `update(dt)`, `enter()`, `exit(silent?)` (also used on death-respawn).

### AudioEngine — `js/core/AudioEngine.js` exports `class AudioEngine`
- Pure WebAudio, all procedural. `resume()` unlocks on first gesture
  (already wired). Master/music/sfx gain buses.
- SFX (synthesized; keep punchy): sword1/2/3, spin, hit, crit, block,
  enemy_hit, enemy_die, hurt, heal, step (per biome variants ok), jump,
  land, roll, splash, pickup, gem, heart, key, chest, chest_big, secret,
  brazier, door, portal, boss_roar, boss_hit, explosion, bolt, ui_move,
  ui_select, ui_open, ui_close, dialogue_blip, quest, save. Play via
  listening to the event bus (preferred) + public `sfx(name)`.
- Music: generative layered score with moods
  `title|explore|village|night|combat|dungeon|boss|victory` — pentatonic
  motifs (lead + pad + bass + light percussion), ambient beds (birds by day,
  crickets at night, wind, lake lap near water), smooth crossfades. Chooses
  mood itself each frame from game context (title mode, village radius,
  enemies aggroed nearby, dungeon/boss events…), with boss/victory driven by
  events.
- API: `update(rawDt)`, `sfx(name, opts?)`, `setMood(m)` (override),
  `resume()`, `setVolumes({master, music, sfx})`, `volumes` getter.

### UI — `js/ui/UI.js` exports `class UI` (+ files under js/ui/, owns styles.css)
- Builds ALL DOM inside `#ui-root`. Owns `styles.css` entirely (keep the
  existing `#boot-splash` / `#boot-error` rules working; body background
  dark; canvas fullscreen underneath).
- Title menu (mode 'title'): dramatic logo "AURELIA — Legend of the
  Shattered Star", New Game / Continue (only if `game.hasSave()`), controls
  card, settings (volume sliders → `audio.setVolumes`, quality toggle note).
  Buttons call `game.newGame()` / `game.continueGame()`.
- HUD: hearts row (quarter-heart states, damage wobble, low-hp pulse),
  stamina wheel (radial, appears when < max, flashes red when empty), gems +
  keys counters (count-up animation), interaction prompt (from 'prompt'
  event, shows key glyph E / A-button), objective line (from
  `game.quests.activeObjective()`), region splash (big serif fade text on
  'region:enter'), boss bar ('boss:*'), toasts, sign panel ('sign:read'),
  damage/heal fullscreen tints if PostFX misses them is NOT needed (PostFX
  handles), day/time-of-day mini sun-dial (reads `sky.timeOfDay`).
- Minimap: corner canvas, prerendered terrain colors (sample
  `terrain.biomeAt`/`heightAt` once at build), player arrow, village/shrine/
  ruins markers, quest marker, north-up rotation optional. Hidden in dungeon.
- Dialogue system: `ui.dialogue.start(def, startNode='start')` — bottom
  letterboxed panel, name tag, typewriter text (blip via 'ui:sfx'
  {name:'dialogue_blip'}), ▼ advance (interact/attack/Enter key), choice
  list navigable by keys/touch. Sets modal: `game.pushModal('dialogue')` on
  start, `popModal` + emit 'dialogue:end' on end. Runs node
  `action(game)` / filters by `cond(game)`.
- Inventory (modal 'inventory', key I): grid of items with procedural CSS
  icons (potion, glowshroom, keys, sword), item use (potion →
  `game.useItem('potion')`), equipment line showing current sword, quest log
  list from `game.state.quests` + Quests titles.
- Pause menu (modal 'pause'): Resume / Save / Settings / Quit-to-title
  (`game.mode='title'` + emit sensible events). Death screen (mode 'dead'):
  fade-in "The light fades…", button → `game.respawnPlayer()`.
- Touch controls when `game.input.usingTouch` or coarse pointer: left
  virtual stick (writes `game.input.virtual.x/z`), right side buttons
  (attack big, jump, roll, guard, interact contextual, lock-on), camera
  drag on empty right-half (writes `virtual.lookDx/lookDy`), all wired via
  `game.input.virtualPress(action)` / `virtual.held` set. Buttons ≥56px,
  safe-area insets respected.
- `ui.fadeTo(cb, ms=400)`: fade to black, run cb, fade back — used by
  Dungeon; make it robust (always clears even if cb throws).
- API: `update(rawDt)`, `dialogue`, `fadeTo`.

## Coding conventions

- ES modules; import three as `import * as THREE from 'three'`; relative
  imports with explicit `.js` extension. No TypeScript syntax, no external
  fetches/CDNs, no `three/examples` imports.
- Deterministic randomness only (`RNG`/noise utils) for world placement;
  `Math.random()` is fine for transient VFX.
- Reuse scratch Vector3s; zero per-frame allocations in hot loops.
- Every file must pass `node --check`. Do not leave TODOs or stubs.
- Do not modify files outside your module's list (styles.css belongs to UI;
  Toon.js/layout.js/core files are read-only to module teams).
