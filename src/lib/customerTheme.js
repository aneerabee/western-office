const CUSTOMER_PALETTE = [
  { soft: '#edf4ff', strong: '#2f6fed', text: '#17346e', ring: '#c7d8ff' },
  { soft: '#eefbf3', strong: '#2f9d62', text: '#184c31', ring: '#c2ead2' },
  { soft: '#fff6eb', strong: '#c97a21', text: '#704213', ring: '#f0d3ad' },
  { soft: '#fff1f3', strong: '#c85b7c', text: '#6f2039', ring: '#f3c7d3' },
  { soft: '#f4f2ff', strong: '#6a5acd', text: '#372d77', ring: '#d7d2ff' },
  { soft: '#eef9f9', strong: '#2c8b8b', text: '#184b4b', ring: '#c2e5e5' },
]

function stringHash(value) {
  const input = String(value ?? '')
  let hash = 0
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0
  }
  return hash
}

export function getCustomerTheme(customer) {
  const key = customer?.id ?? customer?.name ?? customer ?? ''
  const palette = CUSTOMER_PALETTE[stringHash(key) % CUSTOMER_PALETTE.length]

  return {
    '--customer-soft': palette.soft,
    '--customer-strong': palette.strong,
    '--customer-text': palette.text,
    '--customer-ring': palette.ring,
  }
}

export function getCustomerMonogram(name = '') {
  const trimmed = String(name).trim()
  if (!trimmed) return '؟'
  return trimmed[0]
}
