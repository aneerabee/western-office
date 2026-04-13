const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
})

function normalizeDigits(value) {
  return String(value ?? '')
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/,/g, '')
    .replace(/،/g, '')
    .trim()
}

export function formatMoney(value) {
  return currency.format(Number(value || 0))
}

export function normalizeNumberInput(value) {
  const raw = normalizeDigits(value).replace(/[^\d.-]/g, '')
  let result = ''
  let hasDot = false
  let hasSign = false

  for (const char of raw) {
    if (char >= '0' && char <= '9') {
      result += char
      continue
    }
    if (char === '.' && !hasDot) {
      hasDot = true
      result += char
      continue
    }
    if (char === '-' && !hasSign && result.length === 0) {
      hasSign = true
      result += char
    }
  }

  return result
}

export function formatEditableNumber(value) {
  const normalized = normalizeNumberInput(value)
  if (!normalized) return ''

  const sign = normalized.startsWith('-') ? '-' : ''
  const unsigned = sign ? normalized.slice(1) : normalized
  const hasTrailingDot = unsigned.endsWith('.')
  const [integerPartRaw, decimalPart = ''] = unsigned.split('.')
  const integerPart = integerPartRaw || '0'
  const formattedInteger = new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
    useGrouping: true,
  }).format(Number(integerPart))

  if (hasTrailingDot) return `${sign}${formattedInteger}.`
  if (decimalPart) return `${sign}${formattedInteger}.${decimalPart}`
  return `${sign}${formattedInteger}`
}
