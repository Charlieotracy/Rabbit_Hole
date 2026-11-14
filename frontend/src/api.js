// All backend calls live here. Components must never call fetch directly.

// Change to "/api" (and the Vite proxy) if the backend adds a prefix later.
export const API_BASE = ''

// Dev-only artificial latency, e.g. VITE_FAKE_DELAY_MS=2000 in frontend/.env.local
const FAKE_DELAY_MS = Number(import.meta.env.VITE_FAKE_DELAY_MS) || 0

export class ApiError extends Error {
  constructor(status, detail) {
    super(detail)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function request(method, path, body) {
  const options = { method, headers: {} }
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json'
    options.body = JSON.stringify(body)
  }
  const response = await fetch(`${API_BASE}${path}`, options)
  if (!response.ok) {
    let detail = `Request failed (${response.status})`
    try {
      const data = await response.json()
      if (typeof data.detail === 'string') detail = data.detail
      else if (data.detail !== undefined) detail = JSON.stringify(data.detail)
    } catch {
      // no JSON body; keep the default message
    }
    throw new ApiError(response.status, detail)
  }
  return response.json()
}

export async function createRun(topic) {
  await sleep(FAKE_DELAY_MS)
  return request('POST', '/runs', { topic })
}

export async function submitAnswer(runId, optionIndex) {
  await sleep(FAKE_DELAY_MS)
  return request('POST', `/runs/${encodeURIComponent(runId)}/answer`, {
    option_index: optionIndex,
  })
}

export async function dig(runId, tunnelIndex) {
  await sleep(FAKE_DELAY_MS)
  return request('POST', `/runs/${encodeURIComponent(runId)}/dig`, {
    tunnel_index: tunnelIndex,
  })
}

export function getRun(runId) {
  return request('GET', `/runs/${encodeURIComponent(runId)}`)
}
