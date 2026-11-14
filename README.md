# Rabbit_Hole

## Frontend

Requires Node 22 (see `frontend/.nvmrc`).

```bash
cd frontend
npm install
npm run dev
```

The backend must be running at the same time on port 8000 (Vite proxies `/runs` to it), for example:

```bash
cd backend/api
uvicorn main:app --reload --port 8000
```

Other commands: `npm run build` (production build), `npm test` (buildTree tests).

**Fake latency:** to design loading states, create `frontend/.env.local` containing `VITE_FAKE_DELAY_MS=2000` and restart `npm run dev`. It delays createRun, submitAnswer and dig. Default is 0.

Note: the backend stores runs in memory, so a backend restart loses all runs; the UI shows a "run was lost" message and lets you start over.
