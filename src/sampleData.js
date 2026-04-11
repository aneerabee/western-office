export const statusMeta = {
  new: { label: 'جديدة', color: '#64748b' },
  sent_to_operator: { label: 'مرسلة', color: '#2563eb' },
  under_review: { label: 'مراجعة', color: '#8b5cf6' },
  issue: { label: 'مشكلة', color: '#dc2626' },
  approved: { label: 'مقبولة', color: '#0f766e' },
  customer_confirmed: { label: 'مؤكدة', color: '#15803d' },
  sent_to_accountant: { label: 'للمحاسب', color: '#b45309' },
  paid: { label: 'مدفوعة', color: '#166534' },
  closed: { label: 'مغلقة', color: '#1f2937' },
}

export const seedCustomers = []

export const seedTransfers = []

export const issueCatalog = [
  { code: 'name_mismatch', label: 'اسم غير مطابق' },
  { code: 'already_picked', label: 'مسحوبة' },
  { code: 'missing_info', label: 'نقص بيانات' },
  { code: 'system_hold', label: 'معلقة' },
]
