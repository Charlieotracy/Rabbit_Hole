# Rabbit Hole: Frontend Build Plan

This plan is for Claude Code (or a person) to follow one milestone at a time. Each milestone should leave the app runnable and checkable in the browser, and gets its own commit on `main`.

## 0. What already exists (keep it)

- **Stack:** React 19, Vite 8, no CSS framework. Stay dependency-light: plain CSS with custom properties and CSS keyframes. Add no animation library unless a milestone really needs one.
- **`src/api.js`:** all fetch calls. Components must never call fetch.
- **`src/useRun.js`:** the run state machine. Phases are `start | question | caved_in | broke_through | loading | surfaced`.
- **`src/buildTree.js`:** turns the flat `map` into a tree for the end screen. It has tests.
- **`src/ui/`, `src/styles/`:** the milestone 1 foundation. It gets re-skinned in milestone 1b.
- **Backend contract** (summary only; the full spec is in `/API.md`):
  - `POST /runs {topic}` returns `{run_id, depth, topic, turn}`.
  - `POST /runs/:id/answer {option_index}` returns either `{correct: true, artifact, tunnels}` or `{correct: false, cave_in: turn}`.
  - `POST /runs/:id/dig {tunnel_index}` returns `{depth, topic, turn}`.
  - `GET /runs/:id` returns the summary and map.
  - A `turn` is `{layer, question, options[4]}`. A cave-in turn also has `style`. Answers are **multiple choice**, not typed.
  - An artifact is `{name, icon, depth}`. Errors are `{detail}` (4xx) or `{error}` (503).

## 1. Design direction: a pixel bunny who chats you down the hole

Krillion inspired the descent idea and the pixel look, but Rabbit Hole should be clearly its own game. Its identity comes from three things:

1. **A guide character.** A small pixel bunny talks you through every layer in speech bubbles. The whole game reads like a chat with the bunny.
2. **A warm, earthy palette.** Cream bubbles with dark-brown pixel outlines, carrot orange and grass green, instead of Krillion's dark navy with neon cyan and pink.
3. **Clean pixel art.** No CRT scanlines, no vignette, no chromatic offset on the title.

### What we are deliberately *not* copying from Krillion
- The pink/cyan chromatic title.
- The neon-glow navy panels.
- The scanline overlay.
- The notched HUD tabs with depth on the left and score on the right.
- The "BEGIN DESCENT" button and the search bar with a DIVE button.
- The wide-tracked monospace labels.

### What we keep (genre conventions, not Krillion's)
- A pixel-art world.
- Sky at the top and depth below.
- A camera that moves down as you go deeper.

### The bunny
- An original pixel sprite of about 32×32, drawn at 2× or 3× scale.
- Cream fur, dark-brown outline, pink inner ears.
- A **miner's helmet with a headlamp**: it fits the digging theme, and the lamp's glow matters more as the layers get darker.
- Animation states, as SVG frames with CSS steps():
  - `idle`: blinks and twitches its ear.
  - `talk`: its mouth moves while text types out.
  - `dig`: its paws move fast and dirt flies.
  - `cheer`: it jumps.
  - `dazed`: it shakes after a cave-in, with stars over its head.
  - `pop`: it pops out of the hole when you surface.
- It needs a name. Decide this with the team (ideas: Pip, Clover, Burrow). The examples below say "the bunny".

### Design tokens (`src/styles/tokens.css`)

```css
:root {
  /* World */
  --sky-top: #bfe3f2;   --sky-bottom: #eef7fb;
  --grass: #5fae4e;     --grass-dark: #3d7f35;
  --soil-1: #6b4a2f;    --soil-2: #523621;   --soil-3: #3b2718;
  --rock: #2a2320;      --bedrock: #17131a;  --core: #3a1420;

  /* UI */
  --cream: #fff4dc;        /* bubbles */
  --cream-shade: #f1e2bf;  /* inputs, pressed states */
  --ink: #2b1d14;          /* outlines and text */
  --ink-soft: #6b5443;     /* secondary text */
  --carrot: #f08a24;       /* primary accent: send, focus, selected */
  --carrot-dark: #b85f12;
  --leaf: #4f9a3f;         /* correct, success */
  --berry: #c9473f;        /* cave-in */
  --gold: #f2c25c;         /* artifacts */

  /* Type */
  --font-display: 'Pixelify Sans', system-ui, sans-serif;  /* title, labels, buttons */
  --font-body: 'Nunito', system-ui, sans-serif;            /* bubble text: friendly and readable */

  --px: 4px;               /* pixel unit for stepped corners, outlines and shadows */
}
```

The pixel feel comes from the art, the stepped outlines, the hard shadows and the display font. Long explanations stay in a readable body font.

### Visual building blocks
- **Bubble** (replaces the glowing `Panel`):
  - Cream fill, a 4px ink outline with stepped pixel corners, and a hard drop shadow (ink at 25%, offset 0 6px). No glow.
  - It has a pixel **tail** whose direction is `left`, `down` or `up`.
  - Variants:
    - `bunny`: cream, the default.
    - `player`: carrot-tinted and right-aligned.
    - `cave`: berry outline.
    - `artifact`: gold outline with a shine.
- **PixelButton** (restyled):
  - A chunky "pressable" key with a cream or carrot fill, an ink outline and a hard bottom shadow that compresses on `:active`.
  - Variants:
    - `primary`: carrot.
    - `secondary`: cream.
    - `reply`: a chat quick-reply chip.
    - `ghost`: for the HUD.
- **Title:**
  - "RABBIT HOLE" in Pixelify Sans 700, coloured `--ink`.
  - One hard offset shadow in `--grass-dark`, with small pixel grass tufts sprouting from the tops of a few letters, so the title grows out of the ground.
  - The tagline is "Dig into anything", in `--ink-soft`.

## 2. Architecture

```
src/
  styles/   tokens.css, base.css, animations.css, screens.css
  scene/    World.jsx (fixed scene + camera), Sky.jsx, Ground.jsx,
            Strata.jsx, Critters.jsx
            sprites/ Bunny.jsx (all animation states), Cloud.jsx,
                     Carrot.jsx, icons/ (12 artifact icons)
  chat/     ChatLog.jsx      (scrolling list of messages for the current layer)
            BunnySays.jsx    (bunny avatar + bubble, typewriter text)
            PlayerSays.jsx   (right-aligned player bubble)
            Typing.jsx       (bunny "…" typing indicator, used while loading)
            ReplyChips.jsx   (answer options, keys 1–4)
            TopicInput.jsx   (the start bubble's input + carrot send button)
  hud/      Hud.jsx, DepthGauge.jsx, SurfaceButton.jsx
  ui/       Bubble.jsx, PixelButton.jsx, Title.jsx
  screens/  StartScreen.jsx, LayerScreen.jsx, BreakThrough.jsx,
            TunnelPicker.jsx, EndScreen.jsx
  end/      TunnelMap.jsx (SVG tree), ArtifactShelf.jsx
  lib/      strata.js (depth → colours/name), share.js, lines.js (bunny's lines)
```

**The camera model.** `World` is one tall column: sky, then grass, then N strata bands, each `--layer-h` tall (about 70vh). The camera is one `transform: translateY(...)` on that column, driven by `depth`, with an eased transition of about 1.2s. The chat UI renders in a fixed overlay on top. The bunny sprite lives in the world at the current layer, so it travels down with the camera.

**The chat log.** `useRun` stays about server data. A small `useLayerLog()` hook records what happened in the current layer: each turn shown, the option the player picked, and whether it was right. `ChatLog` renders that as messages. The log resets when you dig into a new tunnel, because the previous layer's chat scrolls away with the camera. On a cave-in, earlier messages in the layer dim but stay visible, so you can scroll back.

**Bunny lines.** The bunny's extra words live in `lib/lines.js`. These include greetings, reactions and cave-in intros like "Whoops! Let me try that with an analogy…". Each has a few variants picked at random, so the bunny doesn't repeat itself. They are frontend-only and are never generated by the LLM.

**UI-only animation state.** Add `pendingAction: 'start' | 'answer' | 'dig' | 'surface' | null` to `useRun`, so the UI knows *what* is loading. A correct answer plays the dig animation for **at least about 1.2s**, even if the API is fast.

**LLM latency.** This now fits the chat naturally. While a request is in flight, the bunny shows a **typing bubble (animated "…")** and plays its `dig` animation. Never show a generic spinner. Use `VITE_FAKE_DELAY_MS=2000` while building this.

**Typewriter text.** Bunny messages type out quickly, at about 30–40 characters per second. Clicking the bubble or pressing Space finishes the text instantly. With reduced motion, text appears at once.

## 3. Screens

### Start (`phase === 'start'`)
- The camera is at the top, with blue sky and drifting pixel clouds. The **title** sits near the top in dark ink with grass tufts.
- The **bunny** sits by its burrow on the grass line, blinking.
- A **giant speech bubble** rises from the bunny (tail pointing down at it). The bunny types: *"Hi! What should we dig into today?"*
- The bubble's input area contains:
  - a text input in a cream-shade well with an ink outline (placeholder `type any topic…`);
  - a **carrot send button**: a pixel carrot icon in a carrot-coloured key, with the accessible name "Send". Enter also sends.
- At the bottom of the bubble are 3 or 4 **suggestion chips** that work as quick replies, e.g. "black holes", "the Roman Empire", "jazz" and "how volcanoes work". Clicking one sends it straight away.
- After sending:
  1. The topic appears as a player bubble.
  2. The bunny answers *"Ooh, black holes. Let's dig!"* and switches to the `dig` animation, with the typing indicator showing while `POST /runs` runs.
  3. The bunny hops into the burrow and the camera descends to layer 1.
- Errors, such as a lost run or a 503, appear as a bunny bubble with the `cave` variant: *"Hmm, the tunnel collapsed (message). Want to try again?"*

### Layer: explain, then ask (`question`)
- The bunny sits at the left at the current depth. On mobile it sits above the chat.
- Bunny message 1 has a small header `LAYER 2 · EVENT HORIZON` followed by the explanation (`turn.layer`, up to about 100 words).
- Bunny message 2 is the question (`turn.question`) in larger, bold text.
- **Reply chips** sit on the right, stacked: the 4 options, numbered 1–4, also answerable with the keys 1–4.
- Picking one turns the chosen chip into a sent **player bubble**, and the other chips fade out. Then the bunny shows a typing indicator while `/answer` runs.

### Cave-in (`caved_in`)
- The screen shakes for about 300ms, pixel dirt crumbs fall onto the chat, and the bunny plays `dazed`.
- The player's wrong answer bubble gets a small crack and turns berry-coloured.
- The bunny says: *"Cave-in! Let's try that another way. Here's {an analogy | a concrete example | a step-by-step version}:"*. The wording follows `turn.style`.
- Then it gives the new explanation and the new question, with fresh reply chips.
- A small pickaxe-pip counter in the HUD shows cave-ins on this layer. The tone stays encouraging, and the game never uses "game over" language.

### Break-through (`broke_through`)
1. **Reaction.** The correct player bubble glows leaf-green and the bunny plays `cheer`: *"Yes! You broke through!"*
2. **Dig.** The bunny plays `dig`, and dirt particles burst across the chat for at least about 1.2s.
3. **Artifact.** An `artifact` bubble pops up: *"You unearthed:"* with a large pixel **icon** chosen from `artifact.icon` and the **name** in display type, plus a glint sweep.
4. **Tunnels.** The bunny says *"Three tunnels from here. Which one?"* Below that, three **tunnel mouths** are drawn as dark pixel arches in the dirt wall, each labelled with its subtopic. Each tunnel works as a reply option (keys 1–3).
5. Choosing a tunnel sends it as a player bubble ("Let's go: Hawking radiation"). The bunny runs into that arch, the camera descends one stratum, and the chat log resets for the new layer.

### Surface and end screen (`surfaced`)
- The **Surface ↑** button is always in the HUD during a run. Confirm in the chat: the bunny asks *"Head back up?"* with the reply chips "Yes, surface" and "Keep digging".
- The camera rises quickly to the sky, and the bunny plays `pop` out of the burrow.
- The bunny's summary bubble says *"What a dig! We went 5 layers deep."*, followed by the stats as chunky pixel numbers: **DEPTH**, **LAYERS CLEARED** and **FIRST TRY x/y**.
- **Artifact shelf:** a row of small gold-outlined cards, each showing its pixel icon, name and layer.
- **Tunnel map:** an SVG tree drawn as tunnels in a cross-section of dirt. Dug paths are bright, skipped tunnels are short dim stubs, and layers with cave-ins get small rock-pile markers.
- Two buttons: **Share** (secondary) and **Dig again** (primary, carrot).
- `share.js` copies a text block and shows a "Copied!" toast:
  ```
  🐇 Rabbit Hole: black holes
  ⛏️ 5 layers deep · 3/4 first try
  🟫🟫🟥🟫🟫
  ```
  🟫 means cleared first try. 🟥 means cleared after a cave-in.

## 4. HUD (in run)
- **Depth gauge:** a thin vertical pixel ruler down the left edge, marked with stratum names. A carrot marker shows the current depth and slides when the camera moves. On mobile it collapses to a small cream pill at the top-left reading "⛏ 3".
- **Surface ↑:** a small cream key at the top-right.
- **Trail:** a path breadcrumb under the Surface key (`black holes › event horizon › …`), truncated with an ellipsis.
- **Cave-in pips:** next to the trail, shown only on layers with cave-ins.

## 5. Polish and accessibility
- `prefers-reduced-motion`: no shake, no particles, instant typewriter text, and camera moves become fades.
- Every control works by keyboard, with visible focus rings in carrot orange. The chat log is a live region (`role="log"`, `aria-live="polite"`) so screen readers announce new bunny messages. Each bunny sprite has an `aria-hidden` decorative image, and its words are real text.
- Contrast: ink on cream passes AA easily. Never put cream text on the light sky.
- Mobile layout below 640px: the bunny sits above the chat, reply chips are full width, tunnels stack vertically and the depth gauge becomes the pill.
- Optional, later: 8-bit sound effects behind a mute toggle that defaults to **off**.

## 6. Milestones (do in order, verify each in the browser, one commit each)

1. ✅ **Foundation** (done). This milestone delivered tokens, base CSS, the Panel, PixelButton and Title components, and the restyled test page.
2. ✅ **1b. Re-skin and bunny** (done).
   - Add the warm palette tokens, swap the fonts to Pixelify Sans and Nunito, and **remove the CRT overlay**.
   - Rebuild the Title, the Bubble component (replacing Panel) and PixelButton's pressable style.
   - Draw the Bunny sprite with `idle` and `talk`.
   - Rebuild the start screen as the bunny, a giant bubble, the topic input, the carrot send button and the suggestion chips.
3. **World and camera.** Build Sky, Ground and Strata with `strata.js`, and drive the camera translateY from `depth`. The bunny lives in the world. Verify that changing depth from 0 to 5 by hand scrolls smoothly.
4. **Chat engine.** Build `useLayerLog`, ChatLog, BunnySays with the typewriter effect, PlayerSays, ReplyChips (keys 1–4) and `lines.js`. The layer screen becomes explanation, question, chips, then the player bubble.
5. **Loading.** Add `pendingAction`, the Typing indicator and the bunny's `dig` animation, and test with `VITE_FAKE_DELAY_MS=2000`.
6. **Cave-in.** Add the shake, the dirt crumbs, `dazed`, the cracked player bubble, the style-aware intro line and the pips.
7. **Break-through.** Add `cheer`, the dig burst, the artifact bubble and **12 pixel artifact icons**. Then add the tunnel arches, the descent and the log reset.
8. **HUD.** Add the depth gauge, the Surface key with in-chat confirmation, and the trail.
9. **Surface and end screen.** Add the camera rising, `pop`, the summary bubble, the stats, the artifact shelf, the SVG tunnel map, share and dig again.
10. **Ambient and polish.** Add critters, dust and clouds, plus reduced motion and the mobile pass.
11. **Cleanup.** Delete the leftover `Panel` and old test views, run `npm run lint`, `npm test` and `npm run build`, and update the README.

## 7. Backend notes

**`API.md` at the repo root is the source of truth** for every endpoint, request, response and error. If this plan and `API.md` disagree, follow `API.md`.

`backend/api/main.py` now gets content from the LLM code in `backend/LLM/llm.py` through `llm_adapter.py`. The frontend only ever talks to `backend/api` and never calls `backend/LLM` directly.

Details that matter for the UI:
- **Error shapes:** 4xx errors are `{detail}`. A 503 means LLM generation failed, and its body is `{error}`. `api.js` handles both.
- **Cave-ins:** a cave-in turn includes `style`, one of `analogy`, `concrete example` or `step by step`. The bunny's cave-in intro line uses it.
- **Artifacts:** `artifact` is `{name, icon, depth}`. `icon` is one of `fossil, scroll, gear, telescope, flask, book, map, gem, camera, atom, leaf, coin`. Draw one pixel-art SVG per keyword in `scene/sprites/icons/`, with `gem` as the fallback.
- **Correct answer:** the server never sends it to the frontend.
- **Response times:**
  - The first `POST /runs` is slow, because a real layer is being generated. The bunny's typing and digging state needs to be charming here.
  - `dig` is usually instant, because the three tunnels are pre-generated in the background.
  - A cave-in is slow, because a new explanation is generated.
- **The `topic` field:** it can reword what the player typed. Display the returned `topic`, not the input.
- **Local testing without the model:** put `FAKE_LLM=1` in `Rabbit_Hole/.env`. You get canned content, and the correct option is always the one labelled "Right answer".

Still nice to have from the backend: a "why that's right" line after a correct answer, and a one-line teaser per tunnel.
