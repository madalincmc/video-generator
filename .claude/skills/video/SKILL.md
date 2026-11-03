---
name: video
description: Generate a short video from a text prompt by writing a three.js scene and rendering it locally to MP4. Use when the user asks to make, generate or revise a video or animation.
argument-hint: <what the video should show>
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(node src/video/render.mjs:*), PowerShell(node src/video/render.mjs:*)
---

Make a short video of: **$ARGUMENTS**

You are the only AI in this pipeline. Everything on screen must come from code you write:
geometry, shaders, procedural textures, canvas-drawn text. No image or video models, no API
keys, no downloads, no external assets. The renderer fails on any network request.

## 1. Plan

Pick a short kebab-case slug and create `videos/<slug>/scene.js`. If the folder already exists
and the prompt is a new idea, pick a different slug. If the user is revising a video, edit its
existing scene.

Decide before writing code:

- **Format.** Default 1920x1080, 8 seconds, 30 fps. Use 1080x1920 if the prompt mentions
  vertical, shorts, reels or TikTok. Respect any duration given; otherwise keep it under 15s.
- **Beats.** Write 2 to 4 timed beats as a comment at the top of the scene, such as
  `0-2s reveal, 2-6s orbit, 6-8s title`. Every video needs a beginning, a change and an ending.
- **Look.** Choose a specific palette, lighting setup and camera language that suit the prompt.

If the prompt asks for something that can't be photorealistic in procedural 3D (real people,
live footage), make a stylized interpretation and say so in your final message.

## 2. Write the scene

Read `videos/example-planet/scene.js` for a working reference. The contract:

```js
import * as THREE from 'three';
import { ease, segment, remap, smoothstep, lerp, clamp, textPlane } from 'kit';
// Anything in three/addons/ is available, e.g. three/addons/postprocessing/EffectComposer.js

export const config = { duration: 8, fps: 30, width: 1920, height: 1080, seed: 1 };

export default async function create({ renderer, width, height, config }) {
  // Build everything here. Use width/height, not config.width: previews render smaller.
  return {
    scene,
    camera,
    update(t, { frame, dt, progress }) {}, // called once per frame, in order, t in seconds
    render(t) {},                          // optional, replaces renderer.render (e.g. composer.render())
  };
}
```

Rules:

- Drive all motion from `t`. Don't use `requestAnimationFrame`, timers or `new Date()`.
  `Math.random`, `Date.now` and `performance.now` are already deterministic here.
- Don't call `renderer.setSize`; the renderer is already sized.
- Keep the composition legible at every moment: subject in frame, background not empty,
  motion eased rather than linear, and no pop-in unless intended.
- Spell text exactly as the prompt does, and only add text if the prompt calls for it.

## 3. Check it with your own eyes

```
node src/video/render.mjs videos/<slug>/scene.js --preview
```

Then use Read on `videos/<slug>/preview.png`. It's a 4x3 contact sheet of evenly spaced frames,
left to right, top to bottom. Critique it honestly:

- Does it show what was asked for? Would someone recognize the subject without the prompt?
- Is anything blown out, too dark, cropped, clipped by the camera or hidden?
- Does the sheet show real change over time, and does the ending resolve?

Fix what's wrong and preview again, up to 3 rounds. To inspect detail at full resolution, run
`node src/video/render.mjs videos/<slug>/scene.js --at <seconds>` and Read the `frame-<seconds>.png`.
If the render reports a scene error, fix it and rerun.

## 4. Render and report

```
node src/video/render.mjs videos/<slug>/scene.js
```

Finish with the path to `videos/<slug>/video.mp4`, one sentence describing the result, and
anything you couldn't achieve from the prompt.
