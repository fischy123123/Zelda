// Branching dialogue for the folk of Brindlemere. Defs are built fresh per
// conversation so text can reflect live quest counts. Each entry returns
// { def, entry } — the dialogue definition plus which node to open with.

export function getDialogue(id, game) {
  const q = game.quests;
  const s = game.state;
  switch (id) {
    // -----------------------------------------------------------------------
    case 'maren': {
      const stage = q.stage('shattered-star');
      const def = {
        name: 'Elder Maren',
        nodes: {
          start: {
            text: [
              'Oh good, another wandering jackass with a sword. Welcome to Brindlemere. I am Maren, elder of this valley, which means I am old as balls and nobody listens to me.',
              'Seventy years ago a star exploded over the northern sky and took a flaming dump all over the Elderwood. Prettiest damn catastrophe I ever saw.',
              'Where it landed, the old shrine — the Hollow Shrine — slammed itself shut like an outhouse door in a windstorm. And ever since, the boglins have been breeding like drunk rabbits.',
            ],
            choices: [
              { label: 'Tell me about the shrine.', next: 'shrine' },
              { label: 'What can I do?', next: 'offer' },
              { label: 'Farewell, you strange old woman.' },
            ],
          },
          shrine: {
            text: [
              'The Hollow Shrine is older than any kingdom, older than my knees, and my knees are ancient pieces of shit. Legend says a blade sleeps inside — the Sunblade, forged from the first dawn.',
              'When the star fell, the shrine drank its light and locked its doors. Whatever woke up in there has been gnawing at the seal ever since. Probably horny, definitely angry. That is usually how it goes.',
            ],
            choices: [
              { label: 'What can I do?', next: 'offer' },
              { label: 'Farewell.' },
            ],
          },
          offer: {
            text: [
              'You carry a sword and you have not tripped over anything since you got here, which puts you ahead of every young man in this village.',
              'Haul your shapely ass north through the Elderwood to the Hollow Shrine. Kick the door in, stab whatever screeches at you, and grab the Sunblade.',
              'Do this, and Brindlemere will owe you everything. Which, fair warning, is mostly stew and compliments.',
            ],
            choices: [
              { label: 'I will go.', next: 'accept', action: (g) => g.quests.startMain() },
              { label: 'I need to prepare first.', next: 'prepare' },
            ],
          },
          accept: {
            text: [
              'Hot damn, an actual volunteer! Follow the north road past the standing stones and keep the peaks on your right. If you end up in the lake, you went wrong somewhere and frankly deserve it.',
              'Rest here whenever you must — the village will patch your wounds and judge your life choices free of charge. Now piss off heroically.',
            ],
          },
          prepare: {
            text: ['Smart. Dead heroes are just expensive fertilizer. Talk to Captain Bram — angry little man, cannot miss him — and Nyla if you need medicine. The shrine has waited seventy years; it can wait for you to get your shit together.'],
          },
          wait: {
            text: [
              'The shrine is STILL north, sweetheart. Past the Elderwood, carved doorway in the rock, big amber sigil. It is not subtle. Neither am I.',
              'Go stab the scary thing and come back in one piece. I am too old to sew anyone back together.',
            ],
          },
          triumph: {
            text: [
              'Well butter my ass and call me a biscuit — the Sunblade! You actually did it! Seventy years of doom and gloom, fixed by some lunatic who walked in off the road!',
              'The valley breathes easier tonight, traveller. You did what no army could, mostly because no army ever bothered to show up.',
            ],
            next: 'reward',
          },
          reward: {
            text: ['Take this blessing. It is the least Brindlemere owes you, and believe me, this village always pays the least it owes.'],
            action: (g) => g.quests.completeMain(),
          },
          after: {
            text: ['Every lantern in Brindlemere burns brighter since you got back. Now sit down and eat some stew before you fall over. Heroes are still idiots on an empty stomach.'],
          },
        },
      };
      const entry = stage === 0 ? 'start' : stage === 1 ? 'wait' : stage === 2 ? 'triumph' : 'after';
      return { def, entry };
    }

    // -----------------------------------------------------------------------
    case 'nyla': {
      const stage = q.stage('mushroom-medicine');
      const n = Math.min(s.items.glowshroom || 0, 5);
      const def = {
        name: 'Healer Nyla',
        nodes: {
          start: {
            text: [
              'Watch the doorway — drying herbs everywhere, and if you knock down my wolfsbane I will heal you and THEN kill you. I am Nyla. Scrapes, fevers and broken hearts mended, in that order, cash up front.',
              'My potion stores are drier than a lizard’s armpit. The good glowshrooms only grow in the Elderwood shade, and I am not going in there — the last thing that skittered at me had way too many legs and zero respect.',
            ],
            choices: [
              { label: 'I could gather them for you.', next: 'task', action: (g) => g.quests.startShrooms() },
              { label: 'Any advice for a traveller?', next: 'advice' },
              { label: 'Farewell.' },
            ],
          },
          task: {
            text: [
              'Oh, bless your reckless little heart. Five glowshrooms — the blue glowing caps under the old trees. And yes, before you ask, people HAVE tried licking them. Those people now speak exclusively to furniture.',
              'Bring the shrooms back un-licked and I will brew you something worth the walk.',
            ],
          },
          advice: {
            text: ['Sleep with your boots on, never trust anything with more eyes than you, and do not swim on an empty stamina wheel unless drowning like a dumbass is on your bucket list. That last one is not a joke. I have pulled three heroes out of that lake. Two were grateful.'],
            choices: [
              { label: 'About those glowshrooms…', next: 'task', cond: () => q.stage('mushroom-medicine') === 0, action: (g) => g.quests.startShrooms() },
              { label: 'Farewell.' },
            ],
          },
          gathering: {
            text: [n >= 5
              ? 'Is that glow coming from your pack, or are you just happy to see me? Hand them over!'
              : `Found ${n} of 5 so far? Keep to the deep shade under the old trees — and if something hisses, that is the forest telling you to run, genius.`],
            choices: [
              { label: 'Here — five glowshrooms.', cond: (g) => g.quests.canTurnInShrooms(), next: 'brew', action: (g) => g.quests.turnInShrooms() },
              { label: 'Still gathering.', cond: (g) => !g.quests.canTurnInShrooms() },
            ],
          },
          brew: {
            text: [
              'Perfect caps, every damn one. Give me a breath… aaand there. Two restoratives, and coin for your trouble. Do not chug them both at once, you absolute animal.',
              'Drink them when the hearts run low — inventory, then use. Even heroes forget, because heroes, as a rule, are gorgeous and stupid.',
            ],
          },
          done: {
            text: ['My shelves glow again, thanks to you. If the wilds chew on you, come straight here. If a boglin chews on you somewhere embarrassing, come here anyway — I have seen worse and I WILL laugh.'],
          },
        },
      };
      const entry = stage === 0 ? 'start' : stage === 1 ? 'gathering' : 'done';
      return { def, entry };
    }

    // -----------------------------------------------------------------------
    case 'bram': {
      const stage = q.stage('thin-the-horde');
      const count = Math.min(q.get('thin-the-horde').count, 10);
      const def = {
        name: 'Captain Bram',
        nodes: {
          start: {
            text: [
              'Hold there — sword arm up, let us see… huh. You hold that thing like you have actually killed something. Around here that makes you a goddamn war hero. I am Bram, captain of a guard that consists of me and a bell.',
              'Boglin camps are creeping closer every moon. Five camps ring this valley now, the cocky little shits, and last week one of them mooned me. MOONED me. A captain of the guard.',
            ],
            choices: [
              { label: 'I can thin them out.', next: 'task', action: (g) => g.quests.startHorde() },
              { label: 'Teach me something first.', next: 'tips' },
              { label: 'Farewell.' },
            ],
          },
          task: {
            text: [
              'HA! Music to my ears. Put down ten of the wretches — that should teach the rest to keep their pants up and their distance.',
              'Watch the big horned ones. When a brute raises that club, you ROLL. Do not block. Blocking a brute is how you become a smear with a sword. ROLL, damn you.',
            ],
          },
          tips: {
            text: [
              'Three lessons, free, because I am bored out of my skull. One: the third swing hits like a divorce — finish your combos.',
              'Two: hold your swing after the first cut and release to spin. Clears a crowd like a fart in a bathhouse.',
              'Three: lock on. Tab, or click the stick. A guard who circles wins the fight. A guard who stands still gets a club suppository.',
            ],
            choices: [
              { label: 'About those boglins…', next: 'task', cond: () => q.stage('thin-the-horde') === 0, action: (g) => g.quests.startHorde() },
              { label: 'Farewell.' },
            ],
          },
          hunting: {
            text: [count >= 10
              ? 'Word travels — the camps are pissing themselves about a green-cloaked demon. That would be you, you magnificent maniac. Report!'
              : `${count} of ten so far. The camps sit east, west, and up in the Elderwood. Mind the brutes, and if one moons you, avenge me.`],
            choices: [
              { label: 'Ten boglins, as ordered.', cond: (g) => g.quests.canTurnInHorde(), next: 'reward', action: (g) => g.quests.turnInHorde() },
              { label: 'Still hunting.', cond: (g) => !g.quests.canTurnInHorde() },
            ],
          },
          reward: {
            text: [
              'Outstanding work, soldier. Here — guard pay, plus a breathing trick I learned from a monk I arm-wrestled. Long story. He cheated. So did I.',
              'Deeper breaths, longer sprints. Now get out of here before I salute you and embarrass us both.',
            ],
          },
          done: {
            text: ['The watchfires burn quiet lately. Your doing. If you ever want honest work, the guard pays like crap and the bell needs polishing, but the company is outstanding. It is me. I am the company.'],
          },
        },
      };
      const entry = stage === 0 ? 'start' : stage === 1 ? 'hunting' : 'done';
      return { def, entry };
    }

    // -----------------------------------------------------------------------
    case 'tam': {
      const def = {
        name: 'Shopkeep Tam',
        nodes: {
          start: {
            text: ['Welcome, welcome! Tam’s Sundries — finest stall between the lake and the peaks, on account of being the only one. Competition is for suckers and towns with more than six people.'],
            next: 'shop',
          },
          shop: {
            text: ['What will it be? And no, the prices are not negotiable. I have a monopoly and a complete lack of shame.'],
            choices: [
              {
                label: 'Buy a Restorative Potion — 30 gems',
                cond: (g) => g.state.gems >= 30,
                next: 'sold',
                action: (g) => {
                  g.state.gems -= 30;
                  g.events.emit('gems', { total: g.state.gems, delta: -30 });
                  g.state.items.potion = (g.state.items.potion || 0) + 1;
                  g.events.emit('item:added', { id: 'potion', name: 'Restorative Potion' });
                  g.events.emit('toast', { text: 'Bought a Restorative Potion.' });
                },
              },
              { label: 'A potion? (need 30 gems)', cond: (g) => g.state.gems < 30, next: 'broke' },
              { label: 'Where do gems come from?', next: 'gems' },
              { label: 'Just browsing.' },
            ],
          },
          sold: {
            text: ['Pleasure doing business! Drink it when the hearts run low, and if it tastes like feet — that is normal. That is how you know it is working.'],
            next: 'shop',
          },
          broke: {
            text: ['Broke, eh? No shame in it — well, some shame. Gems: green ones, blue worth five, red worth twenty. Boglins hoard them because boglins are tiny greedy bastards, and chests hide them. Come back jingling!'],
            next: 'shop',
          },
          gems: {
            text: ['Crack open a boglin camp or a chest and they pour out like rain. The ruins east of the wood are said to hold a fat one. You did not hear that from me, because technically telling you counts as "looting advice" and my permit is… let us say "aspirational."'],
            next: 'shop',
          },
        },
      };
      return { def, entry: 'start' };
    }

    // -----------------------------------------------------------------------
    case 'pip': {
      const cleared = !!s.flags.shrineCleared;
      const def = {
        name: 'Pip',
        nodes: {
          start: {
            text: [cleared
              ? 'You went INSIDE the shrine?! Was there a monster? How big? Bigger than the well? Bigger than TWO wells?! Captain Bram said a word when he heard and mum made him put a coin in the jar!'
              : 'Psst! Traveller! Wanna hear a secret? I know ALL the secrets. Even the ones mum says will get my mouth washed out.'],
            choices: [
              { label: 'Tell me a secret.', next: 'secret1' },
              { label: 'Another secret?', next: 'secret2' },
              { label: 'Stay out of trouble, Pip.' },
            ],
          },
          secret1: {
            text: [
              'The old standing stones east of the woods? If you climb the hill at night, the tops glow a tiny bit. Farmer Rho says it is moss. Rho is FULL OF CRAP. That is swearing but mum is not here so.',
              'Also there is a chest up there. I am too small to open it. You are not! You are HUGE. Like a brute but with better teeth!',
            ],
          },
          secret2: {
            text: [
              'Down by Mirrowmere, way out along the far shore, I saw a chest half-buried in the sand! But the deep water is scary and mum says I will be eaten butt-first.',
              'If you find gems in it I get ten percent. That is the RULE of secrets. I did not make the rule but I enforce the hell out of it. THAT one does not count as swearing, Bram says it constantly.',
            ],
          },
        },
      };
      return { def, entry: 'start' };
    }

    // -----------------------------------------------------------------------
    case 'rho': {
      const def = {
        name: 'Farmer Rho',
        nodes: {
          start: {
            text: ['Grass is good this season. Rain when we need it, sun when we do not. Only things spoiling the view are boglin smoke on the ridges and Bram doing shirtless "patrols" past the widow Hettle’s fence. Nobody is fooled, Bram.'],
            choices: [
              { label: 'Anything strange at night?', next: 'night' },
              { label: 'Good harvest to you.' },
            ],
          },
          night: {
            text: [
              'Aye — wisps. Pale cold lights drifting over the fields once the sun is well down. Pretty, until one spits fire at you. Lost half a haystack and most of my dignity running from one last week.',
              'They fade at dawn like dew. If one takes to hissing at you, put steel through the glowing bit and do not write a ballad about it. Looking at you, every bard ever.',
            ],
          },
        },
      };
      return { def, entry: 'start' };
    }
  }
  return { def: { name: '???', nodes: { start: { text: ['…'] } } }, entry: 'start' };
}
