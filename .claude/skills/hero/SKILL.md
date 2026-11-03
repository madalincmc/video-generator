---
name: hero
description: Generate a live three.js animation for a website header or hero section from a text prompt, built into one self-contained hero.js. Use when the user asks for a website animation, animated header or hero background. For rendered MP4 files, use the video skill instead.
argument-hint: <what the animation should show, plus any brand colors>
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(node src/hero/build.mjs:*), PowerShell(node src/hero/build.mjs:*)
---

Make a live website hero animation of: **$ARGUMENTS**

This runs on visitors' devices, behind real page content, for as long as the page stays open.
Everything on screen must come from code you write: no image or video models, API keys,
downloads or external assets. Decoration must never compete with the page's text.

## 1. Plan

Pick a short kebab-case slug and create `heroes/<slug>/scene.js`. If the user is revising a
hero, edit its existing scene instead.

Decide before writing code:

- **Colors.** Use any brand colors in the prompt. Define a palette for both `dark` and `light`,
  since each must work on its page background.
- **Composition.** Assume text covers the left half on desktop and most of the width on phones.
  Keep the visual interest low-contrast or towards the edges, and leave most of the frame
  transparent so the page shows through.
- **Motion.** Slow and ambient. It plays forever, so it needs no beginning or end. Nothing should
  flash, strobe or move quickly.

## 2. Write the scene

Read `heroes/example-field/scene.js` for a working reference. The contract:

```js
import * as THREE from 'three';

export const config = { stillAt: 6 }; // moment shown as a still for reduced-motion visitors

export default function create({ renderer, width, height, pixelRatio, theme }) {
  return {
    scene,
    camera,
    update(t, { dt, pointer }) {},        // pointer: { x, y } in -1..1, active in 0..1, already smoothed
    resize(width, height, pixelRatio) {}, // required: update the camera, and anything sized in pixels
    setTheme(theme) {},                   // 'dark' or 'light', required
    dispose() {},                         // free geometries, materials and textures
    render(t) {},                         // optional, replaces renderer.render
  };
}
```

Rules:

- **Stay pure:** the look at a given `t` must depend only on `t` and `pointer`. Don't accumulate
  state across frames. Use `sin`/`cos` so everything stays bounded forever.
- **Stay transparent:** never set `scene.background` or draw a full-screen opaque layer.
- **Check light mode:** additive blending vanishes on a light background. Use normal blending,
  or switch blending in `setTheme`.
- **Stay cheap:** prefer one or a few draw calls, with motion in vertex shaders. Avoid
  post-processing and heavy full-screen fragment shaders.
- `create` is synchronous, and `Math.random` isn't seeded here. Don't use `fetch`, `eval`,
  `new Function` or workers, since site security policies commonly block them.

## 3. Check it

```
node src/hero/build.mjs heroes/<slug>/scene.js
```

This builds `heroes/<slug>/dist/hero.js` and enforces the budgets on the integrated GPU under a
strict security policy. It exits non-zero if any are missed. Then use Read on
`heroes/<slug>/preview.png`: rows are dark, light and phone width, and the last column is the
scene after an hour. Check honestly:

- Is the sample headline fully readable over every frame, in both themes?
- Is the animation visible in light mode as well as dark?
- Does the phone row still look intentional?
- Does the last column match the others?

Fix what's wrong and rerun, up to 3 rounds. If you can't meet a budget, simplify the scene.
Never report success while the check is failing.

## 4. Report

Finish with the path to `heroes/<slug>/dist/hero.js`, the measured frame time and gzipped size,
one sentence describing the result, and anything you couldn't achieve. Only copy the file into
another project if the user asks, using `--out <dir>` on the same command, which copies it only
when the checks pass.

The page only needs an element with a position set, sized to fill the hero:

```js
const { mount } = await import('/hero/hero.js');
const hero = mount(element, { theme: 'dark' }); // then hero.setTheme('light'), hero.destroy()
```

It handles resizing, pausing off-screen, reduced motion and slow devices, and does nothing if
WebGL is unavailable, so whatever is behind it stays visible.
