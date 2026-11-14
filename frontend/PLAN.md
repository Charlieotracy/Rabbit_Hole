# Rabbit Hole: Frontend Build Plan

This plan is for Claude Code (or a person) to follow one milestone at a time. Each milestone should leave the app runnable and checkable in the browser.

## 0. What already exists (keep it)

- **Stack:** React 19, Vite 8, no CSS framework. Stay dependency-light: plain CSS with custom properties and CSS keyframes. Add no animation library unless a milestone really needs one.
- **`src/api.js`:** all fetch calls. Components must never call fetch.
- **`src/useRun.js`:** the run state machine. Phases are `start | question | caved_in | broke_through | loading | surfaced`.
- **`src/buildTree.js`:** turns the flat `map` into a tree for the end screen. It has tests.
- **`src/components/*`:** unstyled test views. They will be replaced by the screens below, reusing the same props and handlers.
- **Backend contract today:**
  - `POST /runs {topic}` returns `{run_id, depth, topic, turn}`.
  - `POST /runs/:id/answer {option_index}` returns either `{correct: true, artifact, tunnels}` or `{correct: false, cave_in: turn}`.
  - `POST /runs/:id/dig {tunnel_index}` returns `{depth, topic, turn}`.
  - `GET /runs/:id` returns the summary and map.
  - A `turn` is `{layer, question, options[4]}`. Answers are **multiple choice**, not typed.

## 1. Visual language (borrowed from Krillion, re-themed underground)

These are the Krillion traits to copy, and how each one maps to Rabbit Hole.

| Krillion | Rabbit Hole |
|---|---|
| Pastel sky, pixel clouds, a pixel boat on the waterline | Pastel sky, pixel clouds, a pixel **rabbit** at a burrow on a **grass** line (original sprite, not a copy of Krillion's) |
| The ocean gets darker the deeper you go | **Soil strata** get darker by depth: topsoil, clay, rock, bedrock, then glowing deep core |
| Fish silhouettes and drifting particles | Roots, worms, pebbles, fossils, falling dust motes |
| Full-screen CRT scanline overlay | Same: a subtle scanline overlay plus a slight vignette |
| Pixel title with pink/cyan chromatic offset | "RABBIT HOLE" in the same style, using different colours where needed (see tokens) |
| Wide-tracked monospace labels ("THE DAILY DIVE") | "DIG INTO ANYTHING" tagline and wide-tracked HUD labels |
| Dark navy panels, notched pixel corners, glowing cyan border | Same panel component, retuned to dark earth and a glowing accent border |
| Top HUD: depth tab on the left, score tab on the right, segmented progress in the centre | Depth tab "−3 LAYERS" on the left, **SURFACE ↑** button on the right, a breadcrumb trail of the tunnel path in the centre |
| Bottom bar: timer ring, input, pink DIVE button | Bottom bar: a 2×2 grid of answer options (keys 1–4). **No timer**, because this is a learning game |

### Design tokens (`src/styles/tokens.css`)

```css
:root {
  --sky-top: #bfe3f2;   --sky-bottom: #eef7fb;
  --grass: #5fae4e;     --grass-dark: #3d7f35;
  --soil-1: #6b4a2f;    --soil-2: #523621;   --soil-3: #3b2718;
  --rock: #2a2320;      --bedrock: #17131a;  --core: #3a1420;
  --panel: #14161f;     --panel-edge: #0b0c12;
  --accent: #5fd3ea;    /* cyan glow: borders, focus, primary text accents */
  --danger: #ef6b86;    /* pink: cave-in, the DIG button, flag */
  --gold: #f2c25c;      /* artifacts */
  --text: #e9ecf2;      --text-dim: #8a90a3;
  --font-display: 'Silkscreen', monospace;   /* title, big labels */
  --font-mono: 'Space Mono', monospace;      /* body, HUD */
  --px: 4px;            /* pixel unit for notches and borders */
}
```

Load the fonts from Google Fonts in `index.html`. Set the `<title>` to "Rabbit Hole".

### Pixel-art approach

Draw sprites (rabbit, clouds, pickaxe, artifacts frame, critters) as **inline SVG** with `shape-rendering="crispEdges"` on a small grid. Do not use image files. Give panels notched corners with `clip-path: polygon(...)` stepped by `--px`.

## 2. Architecture

```
src/
  styles/   tokens.css, base.css, crt.css, animations.css
  scene/    World.jsx      (fixed full-screen scene + camera)
            Sky.jsx, Ground.jsx, Strata.jsx, Critters.jsx
            sprites/ Rabbit.jsx, Cloud.jsx, Pickaxe.jsx
  hud/      Hud.jsx, DepthTab.jsx, TrailBar.jsx, SurfaceButton.jsx
  ui/       Panel.jsx, PixelButton.jsx, Title.jsx
  screens/  StartScreen.jsx, LayerScreen.jsx, CaveIn.jsx,
            BreakThrough.jsx, TunnelPicker.jsx, EndScreen.jsx
  end/      TunnelMap.jsx (SVG tree), ArtifactShelf.jsx
  lib/      strata.js (depth → colours/name), share.js
```

**The camera model.** `World` is one tall column: sky, then grass, then N strata bands, each `--layer-h` tall (about 70vh). The camera is a single `transform: translateY(...)` on the column, driven by `depth`, with a slow eased transition of about 1.2s. Screens render in a fixed overlay on top of the world. This one mechanism produces every "scroll down into dirt" moment for free: start to layer 1, digging a tunnel, and surfacing (camera back to 0).

**UI-only animation state.** `useRun` should stay about data. Add a small `useStage()` in `App`, or extend `useRun` with `pendingAction: 'start' | 'answer' | 'dig' | 'surface' | null`, so that:
- loading visuals know *what* is loading (digging versus checking an answer);
- a correct answer plays the **dig animation for at least about 1.2s** before the artifact shows, even if the API was fast.

**LLM latency.** Generated layers will be slow. Every `loading` state needs a themed animation (the rabbit digging, dust falling, "DIGGING…" with an animated ellipsis) instead of a spinner. Use `VITE_FAKE_DELAY_MS=2000` while building these states.

## 3. Screens

### Start (`phase === 'start'`)
- The camera is at the top: sky, clouds drifting slowly, the rabbit sitting by a burrow on the grass line.
- Centre: the chromatic pixel title **RABBIT HOLE**, the tagline **D I G   I N T O   A N Y T H I N G**, and the subline `any topic · one layer at a time · earn your depth`.
- Below the grass: a panel containing a topic input (placeholder `type any topic…`) and a big button **▼ START DIGGING ▼** (the "BEGIN DESCENT" style).
- Under it: 3 or 4 suggestion chips such as "black holes", "the Roman Empire" and "jazz", which fill the input when clicked.
- Show any error (for example "run was lost") as a pink-bordered strip above the panel.

### Layer and question (`question`)
- On start, the camera descends to layer `depth`. The HUD slides in.
- A centre panel, styled like Krillion's prompt card:
  - small pink wide label: `LAYER 2 · EVENT HORIZON`
  - the explanation text (`turn.layer`), up to about 100 words, in readable 16–18px mono
  - a divider, then the question in large bold text
- The bottom bar has 4 option buttons in a 2×2 grid (1 column on mobile). Number keys 1–4 also answer. While the answer is being checked, the selected option pulses.

### Cave-in (`caved_in`)
- Play a screen shake of about 300ms, then a pink flash. Dirt particles fall from the top of the panel and a few rocks "settle".
- The panel border turns `--danger` for this layer and the label becomes `CAVE-IN · TRY ANOTHER ANGLE`.
- The new explanation and question replace the old ones. If the backend later adds `turn.style` (analogy, example or step by step), show it as a tag.
- Show a small cave-in counter in the HUD for this layer (pick pips) and keep the tone friendly. Never use "game over" language.

### Break-through (`broke_through`)
Run this as a sequence:
1. **Dig.** The pickaxe swings 2 or 3 times, the panel cracks (a CSS crack overlay), and the panel crumbles away.
2. **Artifact.** A gold-bordered card rises with `UNEARTHED` and the artifact name, with a glint sweep animation. Ask the backend to add `artifact.description` and an optional `artifact.emoji` when the real generator lands.
3. **Tunnels.** Draw three tunnel mouths as dark arched holes in the dirt wall, each labelled with its subtopic. Highlight on hover or focus. Keys 1–3 also choose.
4. Choosing a tunnel zooms into that hole, the camera descends one stratum, and the next layer appears.

### Surface and end screen (`surfaced`)
- The **SURFACE ↑** button is always present in the HUD while in a run. Ask for confirmation with a small inline "Surface now? Yes / Keep digging", not a browser `confirm`.
- The camera rises quickly back to the sky and the rabbit pops out of the burrow.
- The results panel shows:
  - big stats in Krillion's style: **DEPTH 5**, **LAYERS CLEARED 4**, **FIRST TRY 3/4**
  - **Artifact shelf:** a row of gold cards, each with its depth
  - **Tunnel map:** an SVG vertical tree from `buildTree(summary.map)`. Dug nodes are solid and accented, skipped tunnels are dim and dashed, and a node with cave-ins gets small pink pips
  - buttons **SHARE** and **DIG AGAIN**
- `share.js` copies a Wordle-style text block to the clipboard and shows a "Copied!" toast:
  ```
  🐇 Rabbit Hole: black holes
  ⛏️ 5 layers deep · 3/4 first try
  🟫🟫🟥🟫🟫
  ```
  🟫 means cleared first try. 🟥 means cleared after a cave-in.

## 4. HUD (in run)
- **Left tab:** `−N` with the label `LAYERS`, using Krillion's notched tab shape at the top-left.
- **Centre:** a breadcrumb of the path (`black holes › event horizon › …`), truncated with an ellipsis, plus one segment per layer: filled when cleared, pink when it caved in.
- **Right tab:** the SURFACE ↑ button.

## 5. Polish and accessibility
- `prefers-reduced-motion`: no shake, no scanline flicker, and instant camera moves using fades instead.
- Every control works by keyboard, has visible cyan focus rings, and has `aria-live="polite"` on cave-in and break-through messages.
- Mobile layout below 640px: the HUD shrinks, options go to one column, and tunnels stack vertically.
- Optional: 8-bit sound effects (dig, cave-in, unearth) behind a mute toggle that defaults to **off**, with the choice stored in `localStorage`.

## 6. Milestones (do in order, verify each in the browser)

1. **Foundation.** Add tokens, fonts, base and CRT CSS, and the `Panel`, `PixelButton` and `Title` components. Restyle the existing test page with them, with no logic changes.
2. **World and camera.** Build Sky, Ground and Strata with `strata.js`, and drive the camera translateY from `depth`. Verify that changing depth from 0 to 5 by hand scrolls smoothly.
3. **Start screen.** Add the title, input, chips and START DIGGING. Starting a run descends to layer 1.
4. **HUD and layer screen.** Add the depth tab, trail, surface button, the question panel and the options bar with keys 1–4.
5. **Loading states.** Add `pendingAction` and themed digging animations, and test with `VITE_FAKE_DELAY_MS=2000`.
6. **Cave-in.** Add the shake, the pink state, falling dirt and the pips.
7. **Break-through.** Add the dig sequence, the artifact card and the tunnel picker, then the descent into the chosen tunnel.
8. **Surface and end screen.** Add the confirmation, the camera rising, the stats, the artifact shelf, the SVG tunnel map, share and dig again.
9. **Ambient and polish.** Add critters and dust, reduced motion, mobile, and optional sound.
10. **Cleanup.** Delete the old `src/components/*` test views, run `npm run lint`, `npm test` and `npm run build`.

## 7. Backend notes: two APIs exist

**`backend/api/main.py`** is the stub API. The frontend calls it today and the contract in section 0 describes it.

**`backend/LLM/app.py`** is the real LLM service, and it has a **different contract**:

| Route | Body | Returns |
|---|---|---|
| `POST /runs` | `{topic}` | `{run_id, layer}` |
| `POST /runs/:id/answer` | `{chosen_index}` | `{correct, answer_index}` |
| `POST /runs/:id/cave-in` | `{chosen_index}` | `{explanation, style, question}` |
| `POST /runs/:id/dig` | `{tunnel: "<tunnel string>"}` | `{layer}` |

A `layer` has these fields:
- `topic`, `depth`, `explanation`
- `question: {text, options[4], answer_index}`
- `artifact: {name, icon}`
- `tunnels: [3 strings]`

Details that affect the frontend:
- **The artifact arrives with the layer**, before the player answers. Keep it hidden until break-through.
- **A wrong answer takes two calls:** `/answer`, then `/cave-in`. The UI should play the cave-in animation while the second call is in flight.
- **`style`** is one of `analogy`, `concrete example` or `step by step`. Show it as a tag on the cave-in panel.
- **`artifact.icon`** is one of `fossil, scroll, gear, telescope, flask, book, map, gem, camera, atom, leaf, coin`. Draw one pixel-art SVG per keyword in `scene/sprites/icons/`, with `gem` as the fallback.
- **There is no `GET /runs/:id` summary.** The frontend must build the end-screen stats and map itself from what it has seen. Track the path, cave-ins per layer and the skipped tunnels in `useRun`.
- **`/dig` is fast** most of the time because the next layers are generated in the background. The first `/runs` call is the slow one.
- **The layer includes `answer_index`,** so a player could read the correct answer in DevTools. That's acceptable for a hackathon, but don't render it.

**Plan.** Only `src/api.js` and `src/useRun.js` should know which contract is in use. Before milestone 4, agree with the backend person which API is final. Then adapt `api.js` to return the same shapes the screens expect, so the UI components don't care which backend is behind them.

Still nice to have from the backend: a "why that's right" line after a correct answer, and a one-line teaser per tunnel.
