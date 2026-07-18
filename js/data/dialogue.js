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
              'Ah… a new face in Brindlemere. Welcome, traveller. I am Maren, elder of this valley.',
              'You come at a strange hour. Seventy years ago a star broke apart in the northern sky and fell beyond the Elderwood.',
              'Where it fell, the old shrine — the Hollow Shrine — sealed itself shut. And ever since, the boglins grow bolder each season.',
            ],
            choices: [
              { label: 'Tell me about the shrine.', next: 'shrine' },
              { label: 'What can I do?', next: 'offer' },
              { label: 'Farewell.' },
            ],
          },
          shrine: {
            text: [
              'The Hollow Shrine is older than any kingdom. Our grandmothers said a blade sleeps there — the Sunblade, forged from the first dawn.',
              'When the star fell, the shrine drank its light and shut its doors. Whatever woke inside… it has been gnawing at the seal ever since.',
            ],
            choices: [
              { label: 'What can I do?', next: 'offer' },
              { label: 'Farewell.' },
            ],
          },
          offer: {
            text: [
              'You carry a sword, and your eyes are steady. Perhaps fate sent you.',
              'Travel north through the Elderwood to the Hollow Shrine. Break the seal, face what waits inside, and claim the Sunblade.',
              'Do this, and Brindlemere will owe you everything.',
            ],
            choices: [
              { label: 'I will go.', next: 'accept', action: (g) => g.quests.startMain() },
              { label: 'I need to prepare first.', next: 'prepare' },
            ],
          },
          accept: {
            text: [
              'Brave heart. Follow the north road past the standing stones and keep the peaks on your right.',
              'Rest here whenever you must — the village will keep your wounds bound. Go well, traveller.',
            ],
          },
          prepare: {
            text: ['Wisdom, not cowardice. Speak to Captain Bram about the boglins, and to Nyla if you need medicine. The shrine has waited seventy years; it can wait another day.'],
          },
          wait: {
            text: [
              'The shrine lies north, past the Elderwood. Look for the carved doorway in the rock face, marked with an amber sigil.',
              'Strike true, and come back to us whole.',
            ],
          },
          triumph: {
            text: [
              'You… you carry light on your back. The Sunblade! After seventy years!',
              'The valley breathes easier tonight, traveller. You have done what no army could.',
            ],
            next: 'reward',
          },
          reward: {
            text: ['Take this blessing — it is the least Brindlemere owes its champion.'],
            action: (g) => g.quests.completeMain(),
          },
          after: {
            text: ['Every lantern in Brindlemere burns brighter since you returned. Sit, rest — heroes need stew like anyone else.'],
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
              'Mind the doorway — drying herbs everywhere. I am Nyla; scrapes, fevers and broken hearts mended, in that order.',
              'My potion stores are thin. The good glowshrooms only grow in the Elderwood shade, and I do not fancy the things that skitter there.',
            ],
            choices: [
              { label: 'I could gather them for you.', next: 'task', action: (g) => g.quests.startShrooms() },
              { label: 'Any advice for a traveller?', next: 'advice' },
              { label: 'Farewell.' },
            ],
          },
          task: {
            text: [
              'Would you? Five glowshrooms — the blue-glowing caps under the old trees. You cannot miss the light.',
              'Bring them back and I will brew you something worth the walk.',
            ],
          },
          advice: {
            text: ['Sleep with your boots on, guard against anything with more eyes than you, and never swim on an empty stamina wheel. That last one is not a joke.'],
            choices: [
              { label: 'About those glowshrooms…', next: 'task', cond: () => q.stage('mushroom-medicine') === 0, action: (g) => g.quests.startShrooms() },
              { label: 'Farewell.' },
            ],
          },
          gathering: {
            text: [n >= 5
              ? 'Is that glow coming from your pack? Let me see!'
              : `Found ${n} of 5 so far? Keep to the deep shade under the old trees — and step lightly.`],
            choices: [
              { label: 'Here — five glowshrooms.', cond: (g) => g.quests.canTurnInShrooms(), next: 'brew', action: (g) => g.quests.turnInShrooms() },
              { label: 'Still gathering.', cond: (g) => !g.quests.canTurnInShrooms() },
            ],
          },
          brew: {
            text: [
              'Perfect caps, every one. Give me a breath… there. Two restoratives, and coin for your trouble.',
              'Drink them when the hearts run low — inventory, then use. Even heroes forget.',
            ],
          },
          done: {
            text: ['My shelves glow again, thanks to you. If the wilds chew on you, come straight here.'],
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
              'Hold there — sword arm up, let us see… hm. Decent stance. I am Bram, what passes for the guard around here.',
              'Boglin camps are creeping closer every moon. Five camps ring this valley now, bold as roosters.',
            ],
            choices: [
              { label: 'I can thin them out.', next: 'task', action: (g) => g.quests.startHorde() },
              { label: 'Teach me something first.', next: 'tips' },
              { label: 'Farewell.' },
            ],
          },
          task: {
            text: [
              'Ha! Good. Put down ten of the wretches — that will teach the rest to keep their distance.',
              'Watch the big horned ones. When they raise that club, roll. Do not block. ROLL.',
            ],
          },
          tips: {
            text: [
              'Three lessons, free of charge. One: a third swing hits harder — finish your combos.',
              'Two: hold your swing after the first cut and release to spin — clears a crowd beautifully.',
              'Three: lock on. Tab, or click the stick. A guard who circles wins the fight.',
            ],
            choices: [
              { label: 'About those boglins…', next: 'task', cond: () => q.stage('thin-the-horde') === 0, action: (g) => g.quests.startHorde() },
              { label: 'Farewell.' },
            ],
          },
          hunting: {
            text: [count >= 10
              ? 'Word travels — the camps are wailing about a green-cloaked demon. That would be you. Report!'
              : `${count} of ten so far. The camps sit east, west, and up in the Elderwood. Mind the brutes.`],
            choices: [
              { label: 'Ten boglins, as ordered.', cond: (g) => g.quests.canTurnInHorde(), next: 'reward', action: (g) => g.quests.turnInHorde() },
              { label: 'Still hunting.', cond: (g) => !g.quests.canTurnInHorde() },
            ],
          },
          reward: {
            text: [
              'Outstanding work, soldier. Here — guard pay, and a training trick that will stretch your wind further.',
              'Deeper breaths, longer sprints. You have earned it.',
            ],
          },
          done: {
            text: ['The watchfires burn quiet lately. Your doing. If you ever want honest work, the guard could use you.'],
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
            text: ['Welcome, welcome! Tam’s Sundries — finest stall between the lake and the peaks, on account of being the only one.'],
            next: 'shop',
          },
          shop: {
            text: ['What will it be?'],
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
            text: ['Pleasure doing business! Drink it from your pack when the hearts run low.'],
            next: 'shop',
          },
          broke: {
            text: ['Ah, gems, friend — green ones, blue worth five, red worth twenty. Boglins hoard them and chests hide them. Come back jingling!'],
            next: 'shop',
          },
          gems: {
            text: ['Crack open a boglin camp or a treasure chest and they pour out like rain. The ruins east of the wood are said to hold a fat one. You did not hear that from me.'],
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
              ? 'You went INSIDE the shrine?! Was there a monster? How big? Bigger than the well? Bigger than TWO wells?!'
              : 'Psst! Traveller! Wanna hear a secret? I know ALL the secrets.'],
            choices: [
              { label: 'Tell me a secret.', next: 'secret1' },
              { label: 'Another secret?', next: 'secret2' },
              { label: 'Stay out of trouble, Pip.' },
            ],
          },
          secret1: {
            text: [
              'The old standing stones east of the woods? If you climb the hill at night, the tops glow a tiny bit. Farmer Rho says it is moss. Rho is WRONG.',
              'Also there is a chest up there. I am too small to open it. You are not!',
            ],
          },
          secret2: {
            text: [
              'Down by Mirrowmere, way out along the far shore, I saw a chest half-buried in the sand! But the deep water is scary and mum says I will be eaten.',
              'If you find gems in it I get ten percent. That is the RULE of secrets.',
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
            text: ['Grass is good this season. Rain when we need it, sun when we do not. Only thing spoiling the view is boglin smoke on the ridges.'],
            choices: [
              { label: 'Anything strange at night?', next: 'night' },
              { label: 'Good harvest to you.' },
            ],
          },
          night: {
            text: [
              'Aye — wisps. Pale cold lights drifting over the fields once the sun is well down. Pretty, until one spits fire at you.',
              'They fade at dawn like dew. If one takes to hissing at you, put steel through the glowing bit.',
            ],
          },
        },
      };
      return { def, entry: 'start' };
    }
  }
  return { def: { name: '???', nodes: { start: { text: ['…'] } } }, entry: 'start' };
}
