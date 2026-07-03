import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// Builds the post-processing pipeline:
//   scene render (MSAA) -> ambient occlusion -> bloom -> SMAA -> tone-mapped sRGB
// MSAA + SMAA give crisp edges; GTAO grounds objects with soft contact shadows;
// bloom makes emissive surfaces glow. Everything runs in an HDR (half-float)
// buffer so highlights bloom smoothly.
export function createComposer(renderer, scene, camera, quality = {}) {
  const { samples = 4, ao = true, smaa = true } = quality;
  const size = renderer.getSize(new THREE.Vector2());
  const pr = renderer.getPixelRatio();

  // Hardware multi-sampled, HDR render target → crisp geometry edges.
  const target = new THREE.WebGLRenderTarget(size.x * pr, size.y * pr, {
    type: THREE.HalfFloatType,
    samples,
  });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));

  // Ground-contact ambient occlusion for depth and polish (best-effort, and
  // skipped on low-power devices).
  let gtao = null;
  if (ao) {
    try {
      gtao = new GTAOPass(scene, camera, size.x, size.y);
      gtao.output = GTAOPass.OUTPUT.Default;
      composer.addPass(gtao);
    } catch (e) {
      console.warn('[PostFX] ambient occlusion unavailable, skipping:', e);
    }
  }

  const bloom = new UnrealBloomPass(
    new THREE.Vector2(size.x, size.y),
    0.55, // strength
    0.5,  // radius
    0.85  // threshold
  );
  composer.addPass(bloom);

  // SMAA is a real cost on phone GPUs; mobile relies on the lower DPR instead.
  let smaaPass = null;
  if (smaa) {
    smaaPass = new SMAAPass(size.x * pr, size.y * pr);
    composer.addPass(smaaPass);
  }

  composer.addPass(new OutputPass());

  return { composer, bloom, gtao, smaa: smaaPass };
}
