# Voiced dialogue

Generated speech for Brindlemere's villagers, produced with the ElevenLabs
text-to-speech API by `tools/gen-voices.mjs` and played back by
`js/core/Voice.js`.

**The game does not need this.** With no voice pack installed, dialogue falls
back to the typewriter blips exactly as before. Everything here is additive.

## Generating a pack

The generator runs on your machine — **your API key never reaches the
browser**, and only the resulting audio files are committed. Putting a key in
client-side JavaScript would expose it to anyone who opens devtools, so don't.

```bash
# 1. Give the script a key (either way works; .env.local is gitignored)
export ELEVENLABS_API_KEY=sk_...
#    …or: echo 'ELEVENLABS_API_KEY=sk_...' > .env.local

# 2. See what it would do and what it would cost — no credits spent
node tools/gen-voices.mjs --dry-run

# 3. See which voices your account has
node tools/gen-voices.mjs --voices

# 4. Generate
node tools/gen-voices.mjs
```

Current script: **51 lines, ~8,000 characters**, which fits inside ElevenLabs'
free monthly allowance. Re-running only generates lines that changed, so
editing one joke costs a few hundred characters, not another full run.

Useful flags: `--only maren` (one character), `--force` (re-record
everything), `--dry-run` (estimate only).

## Casting

`CAST` at the top of `tools/gen-voices.mjs` maps each character to a list of
preferred ElevenLabs voice names plus tuned stability/style settings. The
script matches those names against whatever your account actually has and
falls back to any unused voice, so every villager sounds distinct even if none
of the preferred names are available. To pin an exact voice, add a `voiceId`
to that character's entry.

## How lookup works

`js/util/hash.js` turns `(speaker, line)` into a 16-hex-character id, and both
the generator and the runtime use it — so a line of dialogue always maps to
the same file. Editing a line changes its hash: the old clip is pruned on the
next run and the new text is regenerated. Lines containing live counters
("`Found 3 of 5 so far`") are skipped, since their text changes as you play.

## Layout

```
assets/voice/
  manifest.json      hash → { file, speaker, text } plus the casting used
  maren/<hash>.mp3
  bram/<hash>.mp3
  …
```

Players can set voice volume independently of music and effects in
Settings → Voice, and the score ducks automatically while someone is speaking.
