import * as THREE from 'three';

// Resolves sword hits against enemies and enemy contact damage against the
// player. Operates on the active area's enemy list each frame.
export const Combat = {
  // Returns an array of { position, key, rupeeColor } drop descriptors for any
  // enemies killed this frame so the caller can spawn pickups.
  resolve(player, enemies, dt) {
    const drops = [];
    const sphere = player.getAttackSphere();

    for (const enemy of enemies) {
      if (enemy.dead) continue;

      // Sword vs enemy.
      if (sphere && !player.hitSet.has(enemy)) {
        const d = enemy.mesh.position.distanceTo(sphere.center);
        if (d < sphere.radius + 0.6) {
          player.hitSet.add(enemy);
          const killed = enemy.takeHit(player.swordDamage, player.position);
          if (killed) {
            drops.push({
              position: enemy.mesh.position.clone(),
              dropsKey: enemy.dropsKey,
              rupeeColor: enemy.kind === 'moblin' ? 'blue' : 'green',
              rupeeValue: enemy.kind === 'moblin' ? 5 : 1,
            });
          }
        }
      }

      // Enemy contact vs player.
      const dmg = enemy.update(dt, player.position);
      if (dmg > 0) {
        player.takeDamage(dmg, enemy.mesh.position);
      }
    }
    return drops;
  },
};
