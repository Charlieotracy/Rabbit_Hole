// Builds the spoiler-free share text and copies it to the clipboard.
//
//   🐇 Rabbit Hole: black holes
//   ⛏️ 5 layers deep · 3/4 first try
//   🟫🟫🟥🟫
//
// 🟫 = layer cleared first try, 🟥 = cleared after a cave-in.

export function shareText({ topic, depth, history }) {
  const cleared = history.length
  const firstTry = history.filter((h) => h.caveIns === 0).length
  const squares = history.map((h) => (h.caveIns === 0 ? '🟫' : '🟥')).join('')
  const lines = [
    `🐇 Rabbit Hole: ${topic}`,
    `⛏️ ${depth} ${depth === 1 ? 'layer' : 'layers'} deep · ${firstTry}/${cleared} first try`,
  ]
  if (squares) lines.push(squares)
  return lines.join('\n')
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Older browsers or no clipboard permission: fall back to a hidden textarea.
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  }
}
