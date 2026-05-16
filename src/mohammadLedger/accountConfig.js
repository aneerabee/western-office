import { ACCOUNT_TYPES, VALUE_KINDS } from './accountCatalog.js'

export const accountPresets = [
  {
    key: 'person-cash',
    title: 'شخص أو شركة',
    detail: 'أقبض منه أو أدفع له',
    type: ACCOUNT_TYPES.PERSON,
    valueKind: VALUE_KINDS.RECEIVABLE,
    subAccountName: 'كاش',
    nameTarget: 'ownerName',
    nameLabel: 'اسم الشخص أو الشركة',
    namePlaceholder: 'مثال: سعيد أو المقر',
    detailLabel: 'طريقة التعامل معه',
    detailOptions: ['كاش معه', 'حساب بنكي له'],
  },
  {
    key: 'own-cash',
    title: 'فلوسي كاش',
    detail: 'في اليد أو الخزنة',
    type: ACCOUNT_TYPES.CASH,
    valueKind: VALUE_KINDS.CASH,
    ownerName: 'أنا',
    subAccountName: 'كاش',
    nameTarget: 'subAccountName',
    nameLabel: 'اسم مكان الكاش',
    namePlaceholder: 'مثال: كاش البيت أو الخزنة',
    skipDetail: true,
  },
  {
    key: 'own-bank',
    title: 'حساب بنكي لي',
    detail: 'مصرف أو بطاقة أو محفظة',
    type: ACCOUNT_TYPES.BANK,
    valueKind: VALUE_KINDS.BANK,
    ownerName: 'أنا',
    subAccountName: 'حساب مصرفي',
    nameTarget: 'subAccountName',
    nameLabel: 'اسم البنك أو الحساب',
    namePlaceholder: 'مثال: الجمهورية أو الوحدة',
    skipDetail: true,
  },
  {
    key: 'asset',
    title: 'أصل أملكه',
    detail: 'شيء له قيمة',
    type: ACCOUNT_TYPES.ASSET,
    valueKind: VALUE_KINDS.ASSET,
    subAccountName: 'أصل',
    nameTarget: 'ownerName',
    nameLabel: 'اسم الأصل',
    namePlaceholder: 'مثال: شاحنة أو أرض',
    skipDetail: true,
  },
  {
    key: 'expense',
    title: 'نوع مصروف',
    detail: 'تكلفة نهائية',
    type: ACCOUNT_TYPES.EXPENSE,
    valueKind: VALUE_KINDS.EXPENSE,
    subAccountName: 'مصروف',
    nameTarget: 'ownerName',
    nameLabel: 'اسم المصروف',
    namePlaceholder: 'مثال: مصروف شخصي أو وقود',
    skipDetail: true,
  },
]

export const accountClassificationOptions = accountPresets.map((preset) => ({
  value: `${preset.type}|${preset.valueKind}`,
  label: preset.title,
  type: preset.type,
  valueKind: preset.valueKind,
}))

export function emptyAccountDraft() {
  return {
    ownerName: '',
    subAccountName: 'كاش',
    type: ACCOUNT_TYPES.PERSON,
    valueKind: VALUE_KINDS.RECEIVABLE,
    notes: '',
  }
}

export function accountPresetFor(type, valueKind) {
  return accountPresets.find((preset) => preset.type === type && preset.valueKind === valueKind) || accountPresets[0]
}

export function accountDetailOptionsFor(type, valueKind) {
  const preset = accountPresetFor(type, valueKind)
  return preset.detailOptions || [preset.subAccountName].filter(Boolean)
}

export function accountNameValue(draft = {}) {
  const preset = accountPresetFor(draft.type, draft.valueKind)
  return preset.nameTarget === 'subAccountName' ? draft.subAccountName || '' : draft.ownerName || ''
}

export function applyAccountName(draft = {}, value = '') {
  const preset = accountPresetFor(draft.type, draft.valueKind)
  const cleanValue = String(value || '').trim()
  if (preset.nameTarget === 'subAccountName') {
    return {
      ...draft,
      ownerName: preset.ownerName || draft.ownerName || '',
      subAccountName: cleanValue || preset.subAccountName,
    }
  }
  return {
    ...draft,
    ownerName: cleanValue,
    subAccountName: draft.subAccountName || preset.subAccountName,
  }
}

export function accountDisplayName(account = {}) {
  const ownerName = String(account.ownerName || '').trim()
  const subAccountName = String(account.subAccountName || '').trim()
  const isMine = /^أنا$|^انا$/i.test(ownerName)
  if (account.valueKind === VALUE_KINDS.CASH || (isMine && /كاش|نقد|خزنة|cash/i.test(subAccountName))) return `كاش عندي: ${subAccountName || ownerName || 'كاش'}`
  if (account.valueKind === VALUE_KINDS.BANK || (isMine && /مصرف|بنك|حساب|الجمهورية|الوحدة|bank/i.test(subAccountName))) return `حسابي البنكي: ${subAccountName || ownerName || 'مصرف'}`
  if (account.valueKind === VALUE_KINDS.ASSET) return `أصل: ${ownerName || subAccountName || 'بدون اسم'}`
  if (account.valueKind === VALUE_KINDS.EXPENSE) return `مصروف: ${ownerName || subAccountName || 'بدون اسم'}`
  if (ownerName && subAccountName) return `${ownerName} · ${subAccountName}`
  return ownerName || subAccountName || 'حساب بدون اسم'
}

export function accountKindLabel(account = {}) {
  if (account.valueKind === VALUE_KINDS.CASH) return 'مال نقدي عندي'
  if (account.valueKind === VALUE_KINDS.BANK) return 'حساب بنكي لي'
  if (account.valueKind === VALUE_KINDS.ASSET) return 'أصل أملكه'
  if (account.valueKind === VALUE_KINDS.EXPENSE) return 'مصروف'
  if (account.valueKind === VALUE_KINDS.REVIEW || account.type === ACCOUNT_TYPES.REVIEW) return 'مراجعة'
  return 'شخص أو شركة'
}

export function accountDraftSummary(draft = {}) {
  const preset = accountPresetFor(draft.type, draft.valueKind)
  const nameValue = accountNameValue(draft)
  if (draft.valueKind === VALUE_KINDS.CASH) return `كاش عندي: ${nameValue || preset.subAccountName}`
  if (draft.valueKind === VALUE_KINDS.BANK) return `حسابي البنكي: ${nameValue || preset.subAccountName}`
  if (draft.valueKind === VALUE_KINDS.ASSET) return `أصل أملكه: ${nameValue || 'بدون اسم'}`
  if (draft.valueKind === VALUE_KINDS.EXPENSE) return `مصروف: ${nameValue || 'بدون اسم'}`
  return `${nameValue || 'بدون اسم'} · ${draft.subAccountName || preset.subAccountName}`
}

export function classificationValueFor(account) {
  return `${account?.type || ACCOUNT_TYPES.PERSON}|${account?.valueKind || VALUE_KINDS.RECEIVABLE}`
}

export function parseAccountClassification(value) {
  const [type, valueKind] = String(value || '').split('|')
  const option = accountClassificationOptions.find((item) => item.type === type && item.valueKind === valueKind)
  return option || accountClassificationOptions[0]
}
