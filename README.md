# Rabbit_Hole

Type any topic, dig as deep as you can, and come out knowing something new. A pixel bunny in a miner's helmet explains each layer in a chat, quizzes you, and digs deeper when you get it right.

## Running it locally

You need two terminals, both started from the repo root.

**One-time setup**

```bash
python3 -m pip install -r backend/requirements.txt
echo "FAKE_LLM=1" > .env      # canned content, no model calls (see API.md)
cd frontend && npm install    # requires Node 22 (see frontend/.nvmrc)
```

**Terminal 1: backend (port 8000)**

```bash
python3 -m uvicorn backend.api.main:app --reload --port 8000
```

**Terminal 2: frontend (port 5173, proxies `/runs` to the backend)**

```bash
cd frontend
npm run dev
```

Then open http://localhost:5173. With `FAKE_LLM=1`, the correct option is always the one labelled "Right answer".

## Frontend

- `npm test`: unit tests for the game state, chat transcript, share text and tunnel-map layout.
- `npm run lint` / `npm run build`.
- **Fake latency:** to design loading states, create `frontend/.env.local` containing `VITE_FAKE_DELAY_MS=2000` and restart `npm run dev`.
- **New files and the dev server:** if you add a new CSS file while `npm run dev` is running and the page goes blank with a "no such file" error, restart the dev server. Vite caches directory listings.

**Controls:** keys 1–4 pick an answer, 1–3 pick a tunnel, Space (or a click) finishes the bunny's typing, and Escape cancels "Surface".

**Where things live** (see `frontend/PLAN.md` for the design):

| Path | What |
|---|---|
| `src/useGame.js`, `src/gameReducer.js` | All game state; the only code that calls `api.js` |
| `src/chat/` | The bunny chat: transcript builder, messages, answer chips, tunnel picker |
| `src/scene/` | The world behind the UI (sky, strata, camera) and all pixel sprites |
| `src/screens/` | Start (lives in the sky), run, and end screens |
| `src/hud/`, `src/end/` | Top bar and depth gauge; artifact shelf and tunnel map |
| `src/lib/lines.js` | Everything the bunny says that isn't generated |

Note: the backend stores runs in memory, so a backend restart loses all runs. The UI then says the run was lost and returns to the start screen.
