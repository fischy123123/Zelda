import * as THREE from 'three';

// Resolves sword hits and enemy contact, returning granular events so the game
// can layer on feedback: sound, spark particles, hit-stop, and camera shake.
export const Combat = {
  resolve(player, enemies, dt) {
    const events = { hits: [], kills: [], playerHit: null, blocked: false };
    const sphere = player.getAttackSphere();

    for (const enemy of enemies) {
      if (enemy.dead) continue;

      // Sword vs enemy.
      if (sphere && !player.hitSet.has(enemy)) {
        const d = enemy.mesh.position.distanceTo(sphere.center);
        if (d < sphere.radius + 0.6) {
          player.hitSet.add(enemy);
          const killed = enemy.takeHit(player.swordDamage, player.position);
          const hp = enemy.mesh.position.clone();
          hp.y += 1;
          events.hits.push({ position: hp });
          if (killed) {
            events.kills.push({
              position: enemy.mesh.position.clone(),
              dropsKey: enemy.dropsKey,
              isBoss: enemy.isBoss,
              rupeeColor: enemy.kind === 'moblin' ? 'blue' : 'green',
              rupeeValue: enemy.kind === 'moblin' ? 5 : 1,
            });
          }
        }
      }

      // Enemy AI + contact vs player.
      const dmg = enemy.update(dt, player.position);
      if (dmg > 0) {
        const result = player.takeDamage(dmg, enemy.mesh.position);
        if (result === 'hit') events.playerHit = enemy.mesh.position.clone();
        else if (result === 'blocked') events.blocked = true;
      }
    }
    return events;
  },
};
