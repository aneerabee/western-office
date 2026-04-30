import { useEffect, useMemo, useState } from 'react'
import {
  ACCOUNT_STATUSES,
  ACCOUNT_TYPES,
  VALUE_KINDS,
  getActivePostingAccounts,
  knownExternalAccounts,
  mohammadAccountCatalog,
} from './accountCatalog'
import {
  CURRENCIES,
  MOVEMENT_STATUSES,
  MOVEMENT_TYPES,
  buildPostingEntries,
  createAccount,
  createOpeningMovements,
  postMovement,
  previewMovement,
  summarizeBalances,
  validateAccount,
  voidMovement,
} from './ledgerCore'

const STORAGE_KEY = 'mohammad-ledger-v1'

const movementLabels = {
  [MOVEMENT_TYPES.TRANSFER]: 'تحويل',
  [MOVEMENT_TYPES.EXPENSE]: 'صرف',
  [MOVEMENT_TYPES.TRUCK_EXPENSE]: 'صرف شاحنة',
  [MOVEMENT_TYPES.TRUCK_INCOME]: 'دخل شاحنة',
  [MOVEMENT_TYPES.USD_SALE]: 'بعت دولار',
  [MOVEMENT_TYPES.USD_PURCHASE]: 'اشتريت دولار',
  [MOVEMENT_TYPES.EXTERNAL_INCOME]: 'دخل',
  [MOVEMENT_TYPES.CORRECTION]: 'تعديل رصيد',
}

const sectionTabs = [
  { key: 'overview', label: 'ملخص' },
  { key: 'accounts', label: 'الأرصدة' },
  { key: 'review', label: 'مراجعة' },
  { key: 'history', label: 'السجل' },
]

const accountGroupTabs = [
  { key: 'people', label: 'الناس', title: 'الناس', subtitle: 'كل الأشخاص والجهات، حتى الحسابات المسكرة تظهر هنا للتأكد.' },
  { key: 'money', label: 'مالي', title: 'أماكن مالي', subtitle: 'الكاش والمصرفي الخاص بي فقط.' },
  { key: 'assets', label: 'أشياء', title: 'أشياء لها قيمة', subtitle: 'أصول وممتلكات.' },
  { key: 'expenses', label: 'صرف', title: 'الصرف', subtitle: 'فلوس خرجت نهائيًا.' },
]

const accountTypeLabels = {
  [ACCOUNT_TYPES.PERSON]: 'شخص/جهة',
  [ACCOUNT_TYPES.CASH]: 'كاش',
  [ACCOUNT_TYPES.BANK]: 'مصرفي',
  [ACCOUNT_TYPES.EXPENSE]: 'صرف',
  [ACCOUNT_TYPES.ASSET]: 'شيء',
  [ACCOUNT_TYPES.PROJECT]: 'مشروع',
  [ACCOUNT_TYPES.REVIEW]: 'يحتاج حل',
}

const valueKindLabels = {
  [VALUE_KINDS.RECEIVABLE]: 'حساب شخص',
  [VALUE_KINDS.CASH]: 'كاش عندي',
  [VALUE_KINDS.BANK]: 'مصرفي عندي',
  [VALUE_KINDS.EXPENSE]: 'صرف نهائي',
  [VALUE_KINDS.ASSET]: 'شيء له قيمة',
  [VALUE_KINDS.REVIEW]: 'يحتاج حل',
}

function normalizeStoredAccounts(accounts = []) {
  return accounts.map((account) => {
    if (account.id === 'saeed-bank' && account.type === ACCOUNT_TYPES.BANK && account.valueKind === VALUE_KINDS.BANK) {
      return {
        ...account,
        type: ACCOUNT_TYPES.PERSON,
        valueKind: VALUE_KINDS.RECEIVABLE,
        notes: account.notes || 'فرع مصرفي لشخص، وليس مكان مال خاص بي.',
      }
    }
    return account
  })
}

function loadInitialLedgerState() {
  const fallback = {
    accounts: normalizeStoredAccounts(mohammadAccountCatalog),
    movements: createOpeningMovements(mohammadAccountCatalog),
  }
  if (typeof window === 'undefined') return fallback

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed.accounts) || !Array.isArray(parsed.movements)) return fallback
    return { ...parsed, accounts: normalizeStoredAccounts(parsed.accounts) }
  } catch {
    return fallback
  }
}

function money(value, currency = CURRENCIES.DINAR) {
  const unit = currency === CURRENCIES.USD ? '$' : 'د.ل'
  const rounded = Math.round(Number(value || 0))
  return `${rounded.toLocaleString('en-US')} ${unit}`
}

function signedMoney(value, currency = CURRENCIES.DINAR) {
  const rounded = Math.round(Number(value || 0))
  const prefix = rounded > 0 ? '+' : rounded < 0 ? '-' : ''
  return `${prefix}${Math.abs(rounded).toLocaleString('en-US')} ${currency === CURRENCIES.USD ? '$' : 'د.ل'}`
}

function emptyMovementDraft(type = MOVEMENT_TYPES.TRANSFER) {
  return {
    type,
    amount: '',
    currency: type === MOVEMENT_TYPES.USD_SALE || type === MOVEMENT_TYPES.USD_PURCHASE ? CURRENCIES.USD : CURRENCIES.DINAR,
    sourceAccountId: 'me-cash',
    destinationAccountId: 'saeed-cash',
    rate: '',
    note: '',
  }
}

function emptyAccountDraft() {
  return {
    ownerName: '',
    subAccountName: 'حساب عادي',
    type: ACCOUNT_TYPES.PERSON,
    valueKind: VALUE_KINDS.RECEIVABLE,
    notes: '',
  }
}

function accountLabel(account) {
  return account ? `${account.ownerName} / ${account.subAccountName}` : ''
}

function nonZero(bucket) {
  return Math.abs(bucket.dinar) > 0.000001 || Math.abs(bucket.usd) > 0.000001
}

function MetricChip({ label, value, tone = 'neutral', currency = CURRENCIES.DINAR }) {
  return (
    <article className={`ml3-metric ml3-metric--${tone}`}>
      <span>{label}</span>
      <strong>{money(value, currency)}</strong>
    </article>
  )
}

function visualKind(account) {
  if (account.status === ACCOUNT_STATUSES.NEEDS_REVIEW || account.valueKind === VALUE_KINDS.REVIEW) return 'review'
  if (account.valueKind === VALUE_KINDS.CASH) return 'cash'
  if (account.valueKind === VALUE_KINDS.BANK) return 'bank'
  if (account.valueKind === VALUE_KINDS.EXPENSE) return 'expense'
  if (account.valueKind === VALUE_KINDS.ASSET) return 'asset'
  return 'person'
}

function AccountRow({ bucket, muted = false, onConfirm, onDisable, onOpen }) {
  const { account, dinar, usd } = bucket
  const balanceTone = dinar > 0 ? 'is-positive' : dinar < 0 ? 'is-negative' : 'is-zero'
  return (
    <article className={`ml3-account-row ml3-account-row--${visualKind(account)} ${muted ? 'is-muted' : ''}`}>
      <button type="button" className="ml3-account-main" onClick={() => onOpen?.(account.id)}>
        <strong>{account.ownerName}</strong>
        <span>{account.subAccountName}</span>
      </button>
      <div className="ml3-account-meta">
        <span>{accountTypeLabels[account.type] || account.type}</span>
        {account.status === ACCOUNT_STATUSES.NEEDS_REVIEW ? <b>تأكيد</b> : null}
      </div>
      <div className={`ml3-account-values ${balanceTone}`}>
        {Math.abs(dinar) > 0.000001 ? <strong>{formatDisplayMeaning(account, dinar)}</strong> : <span>لا يوجد رصيد</span>}
        {Math.abs(usd) > 0.000001 ? <strong>{money(usd, CURRENCIES.USD)}</strong> : null}
      </div>
      {(onConfirm || onDisable) && (
        <div className="ml3-row-actions">
          {onConfirm ? (
            <button type="button" className="ml3-mini-action is-confirm" onClick={() => onConfirm(account.id)}>
              تأكيد
            </button>
          ) : null}
          {onDisable ? (
            <button type="button" className="ml3-mini-action is-muted" onClick={() => onDisable(account.id)}>
              تعطيل
            </button>
          ) : null}
        </div>
      )}
    </article>
  )
}

function formatDisplayMeaning(account, amount) {
  const rounded = Math.round(Number(amount || 0))
  if (!rounded) return 'صفر'
  if (account?.valueKind === VALUE_KINDS.EXPENSE) return `مصروف ${money(Math.abs(rounded))}`
  if (account?.valueKind === VALUE_KINDS.ASSET) return `قيمة ${money(Math.abs(rounded))}`
  if (account?.valueKind === VALUE_KINDS.CASH || account?.valueKind === VALUE_KINDS.BANK) {
    return rounded > 0 ? `موجود ${money(rounded)}` : `ناقص ${money(Math.abs(rounded))}`
  }
  return rounded > 0 ? `أقبض منه ${money(rounded)}` : `أدفع له ${money(Math.abs(rounded))}`
}

function AccountList({ title, subtitle, rows, emptyText = 'لا توجد عناصر في هذا القسم.', onConfirm, onDisable, onOpen, embedded = false }) {
  const Tag = embedded ? 'div' : 'section'
  return (
    <Tag className={embedded ? 'ml3-list-block' : 'ml3-panel'}>
      <div className="ml3-panel-head">
        <div>
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        <span>{rows.length}</span>
      </div>
      <div className="ml3-list">
        {rows.length === 0 ? (
          <p className="ml3-empty">{emptyText}</p>
        ) : (
          rows.map((bucket) => (
            <AccountRow
              key={bucket.account.id}
              bucket={bucket}
              onConfirm={onConfirm}
              onDisable={onDisable}
              onOpen={onOpen}
            />
          ))
        )}
      </div>
    </Tag>
  )
}

function AccountSearchSelect({ label, value, accounts, onChange, allowEmpty = true }) {
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim().toLowerCase()
  const selectedAccount = accounts.find((account) => account.id === value)
  const filteredAccounts = accounts
    .filter((account) => {
      if (!normalizedQuery) return true
      return `${account.ownerName} ${account.subAccountName} ${account.legacyName || ''}`.toLowerCase().includes(normalizedQuery)
    })
    .slice(0, 18)
  const visibleAccounts = selectedAccount && !filteredAccounts.some((account) => account.id === selectedAccount.id)
    ? [selectedAccount, ...filteredAccounts]
    : filteredAccounts

  return (
    <label className="ml3-account-picker">
      {label}
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="ابحث بالاسم"
      />
      <select value={value || ''} onChange={(event) => onChange(event.target.value || null)}>
        {allowEmpty ? <option value="">بدون</option> : null}
        {visibleAccounts.map((account) => (
          <option key={account.id} value={account.id}>
            {accountLabel(account)}
          </option>
        ))}
      </select>
    </label>
  )
}

function movementAccountImpact(movement, accountId) {
  return buildPostingEntries(movement).filter((entry) => entry.accountId === accountId)
}

function AccountProfile({ bucket, movements, accounts, onClose, onEditMovement, onUpdateAccount }) {
  if (!bucket) return null

  const { account, dinar, usd, postedCount } = bucket
  const relatedMovements = movements
    .filter((movement) => movement.status === MOVEMENT_STATUSES.POSTED && movementAccountImpact(movement, account.id).length)
    .slice()
    .reverse()
  const accountMap = new Map(accounts.map((item) => [item.id, item]))

  return (
    <div className="ml3-profile-layer" role="dialog" aria-modal="true" aria-label="ملف الحساب" onClick={onClose}>
      <aside className="ml3-profile" onClick={(event) => event.stopPropagation()}>
        <div className="ml3-profile-head">
          <button type="button" onClick={onClose}>إغلاق</button>
          <div>
            <span>{accountTypeLabels[account.type] || account.type}</span>
            <h2>{account.ownerName}</h2>
            <p>{account.subAccountName}</p>
          </div>
        </div>

        <div className={`ml3-profile-balance ${dinar > 0 ? 'is-positive' : dinar < 0 ? 'is-negative' : 'is-zero'}`}>
          <strong>{formatDisplayMeaning(account, dinar)}</strong>
          <span>{Math.abs(usd) > 0.000001 ? money(usd, CURRENCIES.USD) : 'لا يوجد دولار'}</span>
        </div>

        <div className="ml3-profile-facts">
          <div>
            <span>قراءة الحساب</span>
            <strong>{valueKindLabels[account.valueKind] || account.valueKind}</strong>
          </div>
          <div>
            <span>عدد التأثيرات</span>
            <strong>{postedCount}</strong>
          </div>
          <div>
            <span>الحالة</span>
            <strong>{account.status === ACCOUNT_STATUSES.ACTIVE ? 'فعال' : account.status}</strong>
          </div>
        </div>

        <form className="ml3-profile-editor" onSubmit={(event) => onUpdateAccount(event, account.id)}>
          <h3>تعديل التصنيف</h3>
          <div className="ml3-profile-editor-grid">
            <label>
              الاسم
              <input name="ownerName" defaultValue={account.ownerName} />
            </label>
            <label>
              تفصيل الحساب
              <input name="subAccountName" defaultValue={account.subAccountName} />
            </label>
            <label>
              نوع الحساب
              <select name="type" defaultValue={account.type}>
                <option value={ACCOUNT_TYPES.PERSON}>شخص / جهة</option>
                <option value={ACCOUNT_TYPES.CASH}>كاش</option>
                <option value={ACCOUNT_TYPES.BANK}>مصرف خاص بي</option>
                <option value={ACCOUNT_TYPES.EXPENSE}>مصروف</option>
                <option value={ACCOUNT_TYPES.ASSET}>أصل</option>
                <option value={ACCOUNT_TYPES.PROJECT}>مشروع</option>
              </select>
            </label>
            <label>
              يظهر كـ
              <select name="valueKind" defaultValue={account.valueKind}>
                <option value={VALUE_KINDS.RECEIVABLE}>دين / رصيد شخص</option>
                <option value={VALUE_KINDS.CASH}>مكان كاش</option>
                <option value={VALUE_KINDS.BANK}>مكان مصرفي</option>
                <option value={VALUE_KINDS.EXPENSE}>مصروف نهائي</option>
                <option value={VALUE_KINDS.ASSET}>أصل / قيمة</option>
              </select>
            </label>
          </div>
          <button type="submit">حفظ التصنيف</button>
        </form>

        <div className="ml3-profile-movements">
          <h3>حركات الحساب</h3>
          {relatedMovements.length === 0 ? <p className="ml3-empty">لا توجد حركات لهذا الحساب.</p> : null}
          {relatedMovements.map((movement) => {
            const impacts = movementAccountImpact(movement, account.id)
            const source = accountMap.get(movement.sourceAccountId)
            const destination = accountMap.get(movement.destinationAccountId)
            return (
              <article className="ml3-profile-movement" key={movement.id}>
                <div>
                  <strong>{movementLabels[movement.type] || movement.type}</strong>
                  <span>{accountLabel(source) || 'بدون مصدر'} ← {accountLabel(destination) || 'بدون وجهة'}</span>
                  {movement.note ? <small>{movement.note}</small> : null}
                </div>
                <div className="ml3-profile-impact">
                  {impacts.map((impact) => (
                    <b key={`${movement.id}-${impact.currency}`}>{signedMoney(impact.delta, impact.currency)}</b>
                  ))}
                  {!movement.id?.startsWith('opening-') ? (
                    <button type="button" onClick={() => onEditMovement(movement)}>تعديل</button>
                  ) : null}
                </div>
              </article>
            )
          })}
        </div>
      </aside>
    </div>
  )
}

function ReviewAccountCard({ bucket, activeAccounts, onResolve, onMerge, onDisable }) {
  const { account, dinar, usd } = bucket
  const mergeTargets = activeAccounts.filter((target) => target.id !== account.id)

  return (
    <article className="ml3-review-card">
      <div className="ml3-review-card-head">
        <div>
          <strong>{account.ownerName}</strong>
          <span>{account.notes || 'يحتاج تحديد طريقة التعامل معه.'}</span>
        </div>
        <b>{formatDisplayMeaning(account, dinar)}</b>
      </div>
      {Math.abs(usd) > 0.000001 ? <p className="ml3-review-usd">{money(usd, CURRENCIES.USD)}</p> : null}
      <form className="ml3-decision-grid" onSubmit={(event) => onResolve(event, account.id)}>
        <label>
          الاسم
          <input name="ownerName" defaultValue={account.ownerName} />
        </label>
        <label>
          تفصيل الحساب
          <input name="subAccountName" defaultValue={account.subAccountName} />
        </label>
        <label>
          نوع الحساب
          <select name="type" defaultValue={account.type === ACCOUNT_TYPES.REVIEW ? ACCOUNT_TYPES.PERSON : account.type}>
            <option value={ACCOUNT_TYPES.PERSON}>شخص / جهة</option>
            <option value={ACCOUNT_TYPES.CASH}>كاش</option>
            <option value={ACCOUNT_TYPES.BANK}>مصرف</option>
            <option value={ACCOUNT_TYPES.EXPENSE}>مصروف</option>
            <option value={ACCOUNT_TYPES.ASSET}>أصل</option>
            <option value={ACCOUNT_TYPES.PROJECT}>مشروع</option>
          </select>
        </label>
        <label>
          طريقة القراءة
          <select name="valueKind" defaultValue={account.valueKind === VALUE_KINDS.REVIEW ? VALUE_KINDS.RECEIVABLE : account.valueKind}>
            <option value={VALUE_KINDS.RECEIVABLE}>دين / رصيد شخص</option>
            <option value={VALUE_KINDS.CASH}>مال كاش</option>
            <option value={VALUE_KINDS.BANK}>مال مصرفي</option>
            <option value={VALUE_KINDS.EXPENSE}>مصروف نهائي</option>
            <option value={VALUE_KINDS.ASSET}>أصل / قيمة</option>
          </select>
        </label>
        <label className="ml3-decision-wide">
          ملاحظة القرار
          <input name="notes" defaultValue={account.notes || ''} placeholder="سبب التصنيف أو أي توضيح" />
        </label>
        <div className="ml3-decision-actions">
          <button type="submit" className="ml3-mini-action is-confirm">اعتماد بهذا التصنيف</button>
          <button type="button" className="ml3-mini-action is-muted" onClick={() => onDisable(account.id)}>إخفاء كغير مستخدم</button>
        </div>
      </form>
      <div className="ml3-merge-box">
        <label>
          دمج بدل إنشاء حساب مستقل
          <select defaultValue="" onChange={(event) => event.target.value && onMerge(account.id, event.target.value)}>
            <option value="">اختر حسابًا موجودًا للدمج</option>
            {mergeTargets.map((target) => (
              <option key={target.id} value={target.id}>{accountLabel(target)}</option>
            ))}
          </select>
        </label>
      </div>
    </article>
  )
}

function ExternalAccountCard({ account, onCreate }) {
  return (
    <article className="ml3-review-card">
      <div className="ml3-review-card-head">
        <div>
          <strong>{account.ownerName}</strong>
          <span>{account.notes}</span>
        </div>
        <b>اسم جديد</b>
      </div>
      <form className="ml3-decision-grid" onSubmit={(event) => onCreate(event, account)}>
        <label>
          تفصيل الحساب
          <input name="subAccountName" defaultValue={account.subAccountName} />
        </label>
        <label>
          نوع الحساب
          <select name="type" defaultValue={ACCOUNT_TYPES.PERSON}>
            <option value={ACCOUNT_TYPES.PERSON}>شخص / جهة</option>
            <option value={ACCOUNT_TYPES.CASH}>كاش</option>
            <option value={ACCOUNT_TYPES.BANK}>مصرف</option>
            <option value={ACCOUNT_TYPES.EXPENSE}>مصروف</option>
            <option value={ACCOUNT_TYPES.ASSET}>أصل</option>
            <option value={ACCOUNT_TYPES.PROJECT}>مشروع</option>
          </select>
        </label>
        <label>
          طريقة القراءة
          <select name="valueKind" defaultValue={VALUE_KINDS.RECEIVABLE}>
            <option value={VALUE_KINDS.RECEIVABLE}>دين / رصيد شخص</option>
            <option value={VALUE_KINDS.CASH}>مال كاش</option>
            <option value={VALUE_KINDS.BANK}>مال مصرفي</option>
            <option value={VALUE_KINDS.EXPENSE}>مصروف نهائي</option>
            <option value={VALUE_KINDS.ASSET}>أصل / قيمة</option>
          </select>
        </label>
        <div className="ml3-decision-actions">
          <button type="submit" className="ml3-mini-action is-confirm">إنشاء بهذا التصنيف</button>
        </div>
      </form>
    </article>
  )
}

function ReviewMovementCard({ movement, activeAccounts, onResolve, onEdit, onCancel }) {
  const errors = movement.validation?.errors || []

  return (
    <article className="ml3-review-card">
      <div className="ml3-review-card-head">
        <div>
          <strong>{movementLabels[movement.type] || 'حركة غير محددة'}</strong>
          <span>{errors.length ? errors.map((error) => error.message).join(' ') : 'تحتاج مراجعة قبل الاعتماد.'}</span>
        </div>
        <b>{movement.amount ? money(movement.amount, movement.currency) : 'لا مبلغ'}</b>
      </div>
      <div className="ml3-issue-chips">
        {errors.map((error) => <span key={`${movement.id}-${error.field}-${error.message}`}>{error.field}</span>)}
      </div>
      <form className="ml3-decision-grid" onSubmit={(event) => onResolve(event, movement)}>
        <label>
          نوع الحركة
          <select name="type" defaultValue={movement.type || MOVEMENT_TYPES.TRANSFER}>
            {Object.entries(movementLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <label>
          المبلغ
          <input name="amount" inputMode="decimal" defaultValue={movement.amount || ''} placeholder="0" />
        </label>
        <label>
          العملة
          <select name="currency" defaultValue={movement.currency || CURRENCIES.DINAR}>
            <option value={CURRENCIES.DINAR}>دينار</option>
            <option value={CURRENCIES.USD}>دولار</option>
          </select>
        </label>
        <label>
          سعر الصرف
          <input name="rate" inputMode="decimal" defaultValue={movement.rate || ''} placeholder="اختياري" />
        </label>
        <label>
          من
          <select name="sourceAccountId" defaultValue={movement.sourceAccountId || ''}>
            <option value="">بدون مصدر</option>
            {activeAccounts.map((account) => (
              <option key={account.id} value={account.id}>{accountLabel(account)}</option>
            ))}
          </select>
        </label>
        <label>
          إلى
          <select name="destinationAccountId" defaultValue={movement.destinationAccountId || ''}>
            <option value="">بدون وجهة</option>
            {activeAccounts.map((account) => (
              <option key={account.id} value={account.id}>{accountLabel(account)}</option>
            ))}
          </select>
        </label>
        <label className="ml3-decision-wide">
          ملاحظة
          <input name="note" defaultValue={movement.note || ''} placeholder="سبب الحركة أو التصحيح" />
        </label>
        <div className="ml3-decision-actions">
          <button type="submit" className="ml3-mini-action is-confirm">إصلاح واعتماد</button>
          <button type="button" className="ml3-mini-action" onClick={() => onEdit(movement)}>فتح في الإدخال</button>
          <button type="button" className="ml3-mini-action is-muted" onClick={() => onCancel(movement.id)}>إلغاء</button>
        </div>
      </form>
    </article>
  )
}

function AlertBoard({ reviewAccounts, reviewMovements, externalMissing }) {
  const alerts = []
  if (reviewMovements.length) alerts.push({ tone: 'danger', title: 'حركات لا تدخل في الرصيد', detail: `${reviewMovements.length} حركة تحتاج إكمال.` })
  if (reviewAccounts.length) alerts.push({ tone: 'warning', title: 'حسابات تحتاج تصنيف', detail: `${reviewAccounts.length} حساب يحتاج تأكيد قبل الاعتماد.` })
  if (externalMissing.length) alerts.push({ tone: 'info', title: 'أسماء ظهرت خارج الملخص', detail: `${externalMissing.length} اسم يجب إنشاؤه أو تأكيده.` })
  if (!alerts.length) return null

  return (
    <section className="ml3-alert-board">
      <div className="ml3-alert-title">
        <strong>انتباه اليوم</strong>
        <span>{alerts.length}</span>
      </div>
      <div className="ml3-alert-list">
        {alerts.map((alert) => (
          <article className={`ml3-alert ml3-alert--${alert.tone}`} key={alert.title}>
            <strong>{alert.title}</strong>
            <span>{alert.detail}</span>
          </article>
        ))}
      </div>
    </section>
  )
}

export default function MohammadLedgerApp() {
  const [initialState] = useState(loadInitialLedgerState)
  const [accounts, setAccounts] = useState(initialState.accounts)
  const [movements, setMovements] = useState(initialState.movements)
  const [activeSection, setActiveSection] = useState('overview')
  const [activeAccountGroup, setActiveAccountGroup] = useState('people')
  const [movementDraft, setMovementDraft] = useState(() => emptyMovementDraft())
  const [accountDraft, setAccountDraft] = useState(emptyAccountDraft)
  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [feedback, setFeedback] = useState('')

  const activeAccounts = useMemo(() => getActivePostingAccounts(accounts), [accounts])
  const balances = useMemo(() => summarizeBalances(accounts, movements), [accounts, movements])
  const balancesByKind = useMemo(() => {
    const groups = {
      people: [],
      money: [],
      assets: [],
      expenses: [],
      review: [],
    }
    for (const bucket of balances) {
      const kind = bucket.account.valueKind
      if (bucket.account.status === ACCOUNT_STATUSES.NEEDS_REVIEW || kind === VALUE_KINDS.REVIEW) groups.review.push(bucket)
      else if (kind === VALUE_KINDS.RECEIVABLE) groups.people.push(bucket)
      else if (kind === VALUE_KINDS.CASH || kind === VALUE_KINDS.BANK) groups.money.push(bucket)
      else if (kind === VALUE_KINDS.ASSET) groups.assets.push(bucket)
      else if (kind === VALUE_KINDS.EXPENSE) groups.expenses.push(bucket)
    }
    for (const key of Object.keys(groups)) {
      groups[key].sort((a, b) => Number(nonZero(b)) - Number(nonZero(a)) || Math.abs(b.dinar) - Math.abs(a.dinar))
    }
    return groups
  }, [balances])

  const reviewMovements = movements.filter((movement) => movement.status === MOVEMENT_STATUSES.NEEDS_REVIEW)
  const unresolvedExternalAccounts = knownExternalAccounts.filter(
    (externalAccount) =>
      !accounts.some(
        (account) =>
          account.ownerName === externalAccount.ownerName &&
          account.subAccountName === externalAccount.subAccountName &&
          account.status !== ACCOUNT_STATUSES.INACTIVE,
      ),
  )
  const postedUserMovements = movements.filter((movement) => !movement.id?.startsWith('opening-')).slice().reverse()
  const totals = useMemo(() => {
    return balances.reduce(
      (acc, bucket) => {
        const kind = bucket.account.valueKind
        if (kind === VALUE_KINDS.CASH) acc.cash += bucket.dinar
        if (kind === VALUE_KINDS.BANK) acc.bank += bucket.dinar
        if (kind === VALUE_KINDS.RECEIVABLE && bucket.dinar > 0) acc.peopleOweMe += bucket.dinar
        if (kind === VALUE_KINDS.RECEIVABLE && bucket.dinar < 0) acc.iOwePeople += Math.abs(bucket.dinar)
        if (kind === VALUE_KINDS.ASSET) acc.assets += bucket.dinar
        if (kind === VALUE_KINDS.EXPENSE) acc.expenses += bucket.dinar
        acc.usd += bucket.usd
        return acc
      },
      { cash: 0, bank: 0, peopleOweMe: 0, iOwePeople: 0, assets: 0, expenses: 0, usd: 0 },
    )
  }, [balances])

  const normalizedDraft = {
    ...movementDraft,
    amount: Number(movementDraft.amount),
    rate: movementDraft.rate === '' ? undefined : Number(movementDraft.rate),
  }
  const preview = previewMovement(normalizedDraft, accounts, movements)
  const selectedBucket = balances.find((bucket) => bucket.account.id === selectedAccountId) || null
  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ accounts, movements, savedAt: new Date().toISOString() }))
  }, [accounts, movements])

  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    const previousOverflow = document.body.style.overflow
    if (selectedAccountId) document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [selectedAccountId])

  function updateMovementDraft(field, value) {
    setMovementDraft((current) => ({ ...current, [field]: value }))
  }

  function chooseMovementType(type) {
    setMovementDraft((current) => ({
      ...current,
      type,
      currency: type === MOVEMENT_TYPES.USD_SALE || type === MOVEMENT_TYPES.USD_PURCHASE ? CURRENCIES.USD : current.currency,
    }))
  }

  function swapMovementSides() {
    setMovementDraft((current) => ({
      ...current,
      sourceAccountId: current.destinationAccountId || '',
      destinationAccountId: current.sourceAccountId || '',
    }))
  }

  function saveMovement(event) {
    event.preventDefault()
    const movement = postMovement({ ...normalizedDraft, note: movementDraft.note.trim() }, accounts)
    setMovements((current) => [...current, movement])
    setFeedback(movement.status === MOVEMENT_STATUSES.POSTED ? 'تم الحفظ وتحديث الأرصدة.' : 'الحركة ناقصة وتحتاج حل.')
    if (movement.status === MOVEMENT_STATUSES.POSTED) setMovementDraft(emptyMovementDraft(movementDraft.type))
  }

  function cancelMovement(movementId) {
    setMovements((current) =>
      current.map((movement) => {
        if (movement.id !== movementId) return movement
        if (movement.status === MOVEMENT_STATUSES.NEEDS_REVIEW) {
          return {
            ...movement,
            status: MOVEMENT_STATUSES.VOIDED,
            voidReason: 'إلغاء حركة ناقصة',
            voidedAt: new Date().toISOString(),
          }
        }
        const result = voidMovement(movement, 'إلغاء من سجل الحركات')
        return result.ok ? result.movement : movement
      }),
    )
    setFeedback('تم إلغاء الحركة وبقيت في السجل.')
  }

  function addAccount(event) {
    event.preventDefault()
    const account = createAccount(accountDraft)
    const validation = validateAccount(account, accounts)
    if (!validation.ok) {
      setFeedback(validation.errors.map((error) => error.message).join(' '))
      return
    }
    setAccounts((current) => [...current, account])
    setFeedback('تم إنشاء الحساب.')
    setAccountDraft(emptyAccountDraft())
  }

  function confirmAccount(accountId) {
    setAccounts((current) =>
      current.map((account) =>
        account.id === accountId
          ? { ...account, status: ACCOUNT_STATUSES.ACTIVE, type: account.type === ACCOUNT_TYPES.REVIEW ? ACCOUNT_TYPES.PERSON : account.type, valueKind: account.valueKind === VALUE_KINDS.REVIEW ? VALUE_KINDS.RECEIVABLE : account.valueKind }
          : account,
      ),
    )
    setFeedback('تم اعتماد الحساب.')
  }

  function resolveReviewAccount(event, accountId) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const nextAccount = {
      ownerName: String(formData.get('ownerName') || '').trim(),
      subAccountName: String(formData.get('subAccountName') || '').trim(),
      type: String(formData.get('type') || ACCOUNT_TYPES.PERSON),
      valueKind: String(formData.get('valueKind') || VALUE_KINDS.RECEIVABLE),
      notes: String(formData.get('notes') || '').trim(),
    }

    const candidateAccounts = accounts.map((account) =>
      account.id === accountId
        ? {
            ...account,
            ...nextAccount,
            status: ACCOUNT_STATUSES.ACTIVE,
            reviewedAt: new Date().toISOString(),
          }
        : account,
    )
    const candidate = candidateAccounts.find((account) => account.id === accountId)
    const validation = validateAccount(candidate, accounts.filter((account) => account.id !== accountId))
    if (!validation.ok) {
      setFeedback(validation.errors.map((error) => error.message).join(' '))
      return
    }
    setAccounts(candidateAccounts)
    setFeedback('تم حل الحساب واعتماده.')
  }

  function updateAccountClassification(event, accountId) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const nextAccount = {
      ownerName: String(formData.get('ownerName') || '').trim(),
      subAccountName: String(formData.get('subAccountName') || '').trim(),
      type: String(formData.get('type') || ACCOUNT_TYPES.PERSON),
      valueKind: String(formData.get('valueKind') || VALUE_KINDS.RECEIVABLE),
    }
    const candidateAccounts = accounts.map((account) =>
      account.id === accountId
        ? {
            ...account,
            ...nextAccount,
            updatedAt: new Date().toISOString(),
          }
        : account,
    )
    const candidate = candidateAccounts.find((account) => account.id === accountId)
    const validation = validateAccount(candidate, accounts.filter((account) => account.id !== accountId))
    if (!validation.ok) {
      setFeedback(validation.errors.map((error) => error.message).join(' '))
      return
    }
    setAccounts(candidateAccounts)
    setFeedback('تم تعديل الحساب.')
  }

  function disableAccount(accountId) {
    setAccounts((current) =>
      current.map((account) =>
        account.id === accountId ? { ...account, status: ACCOUNT_STATUSES.INACTIVE } : account,
      ),
    )
    setFeedback('تم إخفاء الحساب.')
  }

  function mergeReviewAccount(sourceAccountId, targetAccountId) {
    if (!targetAccountId || sourceAccountId === targetAccountId) return
    setMovements((current) =>
      current.map((movement) => ({
        ...movement,
        sourceAccountId: movement.sourceAccountId === sourceAccountId ? targetAccountId : movement.sourceAccountId,
        destinationAccountId: movement.destinationAccountId === sourceAccountId ? targetAccountId : movement.destinationAccountId,
        mergedFromAccountId: movement.sourceAccountId === sourceAccountId || movement.destinationAccountId === sourceAccountId ? sourceAccountId : movement.mergedFromAccountId,
      })),
    )
    setAccounts((current) =>
      current.map((account) =>
        account.id === sourceAccountId
          ? { ...account, status: ACCOUNT_STATUSES.INACTIVE, mergedIntoAccountId: targetAccountId }
          : account,
      ),
    )
    setFeedback('تم دمج الحساب.')
  }

  function addExternalAccount(event, externalAccount) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const account = createAccount({
      ownerName: externalAccount.ownerName,
      subAccountName: String(formData.get('subAccountName') || externalAccount.subAccountName).trim(),
      type: String(formData.get('type') || ACCOUNT_TYPES.PERSON),
      valueKind: String(formData.get('valueKind') || VALUE_KINDS.RECEIVABLE),
      notes: externalAccount.notes,
    })
    const validation = validateAccount(account, accounts)
    if (!validation.ok) {
      setFeedback(validation.errors.map((error) => error.message).join(' '))
      return
    }
    setAccounts((current) => [...current, account])
    setFeedback(`تم إنشاء حساب ${externalAccount.ownerName}.`)
  }

  function editReviewMovement(movement) {
    setMovementDraft({
      type: movement.type || MOVEMENT_TYPES.TRANSFER,
      amount: movement.amount ? String(movement.amount) : '',
      currency: movement.currency || CURRENCIES.DINAR,
      sourceAccountId: movement.sourceAccountId || '',
      destinationAccountId: movement.destinationAccountId || '',
      rate: movement.rate ? String(movement.rate) : '',
      note: movement.note || '',
    })
    setMovements((current) => current.filter((item) => item.id !== movement.id))
    setFeedback('الحركة جاهزة للتعديل في نموذج الإدخال.')
  }

  function resolveReviewMovement(event, movement) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const candidate = postMovement(
      {
        ...movement,
        type: String(formData.get('type') || movement.type),
        amount: Number(formData.get('amount')),
        currency: String(formData.get('currency') || CURRENCIES.DINAR),
        sourceAccountId: String(formData.get('sourceAccountId') || '') || null,
        destinationAccountId: String(formData.get('destinationAccountId') || '') || null,
        rate: formData.get('rate') === '' ? undefined : Number(formData.get('rate')),
        note: String(formData.get('note') || '').trim(),
      },
      accounts,
    )
    setMovements((current) => current.map((item) => (item.id === movement.id ? candidate : item)))
    setFeedback(candidate.status === MOVEMENT_STATUSES.POSTED ? 'تم إصلاح الحركة.' : 'ما زالت ناقصة.')
  }

  function renderAccountsSection() {
    const activeGroup = accountGroupTabs.find((group) => group.key === activeAccountGroup) || accountGroupTabs[0]
    const rows = balancesByKind[activeGroup.key] || []
    return (
      <section className="ml3-panel">
        <div className="ml3-panel-head">
          <div>
            <h2>الأرصدة</h2>
            <p>اختر نوع الحساب، ثم اضغط على الاسم لفتح تفاصيله وحركاته.</p>
          </div>
          <span>{balances.length}</span>
        </div>
        <div className="ml3-account-switcher" aria-label="أنواع الأرصدة">
          {accountGroupTabs.map((group) => (
            <button
              type="button"
              key={group.key}
              className={activeAccountGroup === group.key ? 'is-active' : ''}
              onClick={() => setActiveAccountGroup(group.key)}
            >
              <strong>{group.label}</strong>
              <span>{balancesByKind[group.key]?.length || 0}</span>
            </button>
          ))}
        </div>
        <AccountList
          title={activeGroup.title}
          subtitle={activeGroup.subtitle}
          rows={rows}
          onOpen={setSelectedAccountId}
          embedded
        />
      </section>
    )
  }

  function renderSection() {
    if (activeSection === 'accounts') return renderAccountsSection()
    if (activeSection === 'review') {
      return (
        <section className="ml3-panel">
          <div className="ml3-panel-head">
            <div>
              <h2>مشاكل تحتاج حل</h2>
              <p>أصلحها قبل اعتمادها.</p>
            </div>
            <span>{balancesByKind.review.length + reviewMovements.length + unresolvedExternalAccounts.length}</span>
          </div>
          <div className="ml3-review-grid">
            <section className="ml3-subpanel">
              <h3>حسابات غير واضحة</h3>
              {balancesByKind.review.length === 0 ? <p className="ml3-empty">لا توجد حسابات معلقة الآن.</p> : null}
              {balancesByKind.review.map((bucket) => (
                <ReviewAccountCard
                  key={bucket.account.id}
                  bucket={bucket}
                  activeAccounts={activeAccounts}
                  onResolve={resolveReviewAccount}
                  onMerge={mergeReviewAccount}
                  onDisable={disableAccount}
                />
              ))}
            </section>
            <section className="ml3-subpanel">
              <h3>أسماء جديدة</h3>
              {unresolvedExternalAccounts.length === 0 ? <p className="ml3-empty">لا توجد أسماء خارج الملخص الآن.</p> : null}
              {unresolvedExternalAccounts.map((account) => (
                <ExternalAccountCard key={account.id} account={account} onCreate={addExternalAccount} />
              ))}
            </section>
            <section className="ml3-subpanel">
              <h3>حركات ناقصة</h3>
              {reviewMovements.length === 0 ? <p className="ml3-empty">لا توجد حركات ناقصة الآن.</p> : null}
              {reviewMovements.map((movement) => (
                <ReviewMovementCard
                  key={movement.id}
                  movement={movement}
                  activeAccounts={activeAccounts}
                  onResolve={resolveReviewMovement}
                  onEdit={editReviewMovement}
                  onCancel={cancelMovement}
                />
              ))}
            </section>
          </div>
        </section>
      )
    }
    if (activeSection === 'history') {
      return (
        <section className="ml3-panel">
          <div className="ml3-panel-head">
            <div>
              <h2>السجل</h2>
              <p>كل حركة محفوظة هنا.</p>
            </div>
            <span>{postedUserMovements.length}</span>
          </div>
          <div className="ml3-history-list">
            {postedUserMovements.length === 0 ? <p className="ml3-empty">لا توجد حركات جديدة بعد.</p> : null}
            {postedUserMovements.map((movement) => (
              <article className="ml3-history-row" key={movement.id}>
                <div>
                  <strong>{movementLabels[movement.type] || movement.type}</strong>
                  <span>{money(movement.amount, movement.currency)} · {movement.status}</span>
                  {movement.note ? <small>{movement.note}</small> : null}
                </div>
                {movement.status === MOVEMENT_STATUSES.POSTED ? (
                  <button type="button" onClick={() => cancelMovement(movement.id)}>
                    إلغاء
                  </button>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      )
    }
    return (
      <section className="ml3-home">
        <div className="ml3-home-focus">
          <div>
            <span>الأهم الآن</span>
            <h2>{reviewMovements.length || balancesByKind.review.length ? 'يوجد شيء يحتاج مراجعة' : 'الدفتر مرتب الآن'}</h2>
            <p>
              {reviewMovements.length || balancesByKind.review.length
                ? 'ابدأ من قسم المراجعة قبل إدخال حركات جديدة كثيرة.'
                : 'استخدم نموذج الإدخال للحركة الجديدة، وافتح الأرصدة عند الحاجة للتفاصيل.'}
            </p>
          </div>
          <button type="button" onClick={() => setActiveSection(reviewMovements.length || balancesByKind.review.length ? 'review' : 'accounts')}>
            {reviewMovements.length || balancesByKind.review.length ? 'فتح المراجعة' : 'فتح الأرصدة'}
          </button>
        </div>

        <div className="ml3-home-grid">
          <button type="button" className="ml3-home-card is-positive" onClick={() => { setActiveSection('accounts'); setActiveAccountGroup('people') }}>
            <span>أقبض من الناس</span>
            <strong>{money(totals.peopleOweMe)}</strong>
          </button>
          <button type="button" className="ml3-home-card is-negative" onClick={() => { setActiveSection('accounts'); setActiveAccountGroup('people') }}>
            <span>أدفع للناس</span>
            <strong>{money(totals.iOwePeople)}</strong>
          </button>
          <button type="button" className="ml3-home-card is-money" onClick={() => { setActiveSection('accounts'); setActiveAccountGroup('money') }}>
            <span>أماكن المال</span>
            <strong>{balancesByKind.money.length} حساب</strong>
          </button>
          <button type="button" className="ml3-home-card is-review" onClick={() => setActiveSection('review')}>
            <span>مراجعة</span>
            <strong>{balancesByKind.review.length + reviewMovements.length + unresolvedExternalAccounts.length}</strong>
          </button>
        </div>

        <section className="ml3-panel">
          <div className="ml3-panel-head">
            <div>
              <h2>أكبر أرصدة الناس</h2>
              <p>للتفاصيل الكاملة افتح قسم الأرصدة.</p>
            </div>
            <span>{balancesByKind.people.filter(nonZero).length}</span>
          </div>
          <div className="ml3-list">
            {balancesByKind.people.filter(nonZero).slice(0, 6).map((bucket) => (
              <AccountRow key={bucket.account.id} bucket={bucket} onOpen={setSelectedAccountId} />
            ))}
          </div>
        </section>
      </section>
    )
  }

  return (
    <main className="ml3-app" dir="rtl">
      <section className="ml3-shell">
        <header className="ml3-topbar">
          <div>
            <span>دفتر محمد</span>
            <h1>الأرصدة الآن</h1>
          </div>
          <div className="ml3-top-actions">
            <b>{activeAccounts.length} حساب</b>
            <b>{reviewMovements.length} مشكلة</b>
          </div>
        </header>

        <section className="ml3-metrics">
          <MetricChip label="كاش" value={totals.cash} tone="cash" />
          <MetricChip label="مصرفي" value={totals.bank} tone="bank" />
          <MetricChip label="أقبض" value={totals.peopleOweMe} tone="positive" />
          <MetricChip label="أدفع" value={totals.iOwePeople} tone="negative" />
          <MetricChip label="أصول" value={totals.assets} tone="asset" />
          <MetricChip label="صرف" value={totals.expenses} tone="expense" />
        </section>

        <AlertBoard
          reviewAccounts={balancesByKind.review}
          reviewMovements={reviewMovements}
          externalMissing={unresolvedExternalAccounts}
        />

        <nav className="ml3-tabs" aria-label="أقسام الدفتر">
          {sectionTabs.map((tab) => (
            <button
              type="button"
              className={activeSection === tab.key ? 'is-active' : ''}
              key={tab.key}
              onClick={() => setActiveSection(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <section className="ml3-layout">
          <aside className="ml3-entry">
            <form className="ml3-entry-card" onSubmit={saveMovement}>
              <div className="ml3-entry-head">
                <div>
                  <span>إضافة حركة</span>
                  <h2>{movementLabels[movementDraft.type]}</h2>
                </div>
                <b>{preview.validation.ok ? 'جاهزة' : 'ناقصة'}</b>
              </div>

              <div className="ml3-quick-actions">
                {[MOVEMENT_TYPES.TRANSFER, MOVEMENT_TYPES.EXPENSE, MOVEMENT_TYPES.USD_SALE, MOVEMENT_TYPES.USD_PURCHASE].map(
                  (type) => (
                    <button
                      type="button"
                      className={movementDraft.type === type ? 'is-active' : ''}
                      key={type}
                      onClick={() => chooseMovementType(type)}
                    >
                      {movementLabels[type]}
                    </button>
                  ),
                )}
              </div>

              <div className="ml3-field-pair">
                <label>
                  المبلغ
                  <input
                    inputMode="decimal"
                    value={movementDraft.amount}
                    onChange={(event) => updateMovementDraft('amount', event.target.value)}
                    placeholder="0"
                  />
                </label>
                <label>
                  العملة
                  <select value={movementDraft.currency} onChange={(event) => updateMovementDraft('currency', event.target.value)}>
                    <option value={CURRENCIES.DINAR}>دينار</option>
                    <option value={CURRENCIES.USD}>دولار</option>
                  </select>
                </label>
              </div>

              {(movementDraft.type === MOVEMENT_TYPES.USD_SALE || movementDraft.type === MOVEMENT_TYPES.USD_PURCHASE) ? (
                <label>
                  سعر الصرف
                  <input
                    inputMode="decimal"
                    value={movementDraft.rate}
                    onChange={(event) => updateMovementDraft('rate', event.target.value)}
                    placeholder="7.5"
                  />
                </label>
              ) : null}

              <div className="ml3-route-picker">
                <AccountSearchSelect
                  label="من"
                  value={movementDraft.sourceAccountId || ''}
                  accounts={activeAccounts}
                  onChange={(value) => updateMovementDraft('sourceAccountId', value)}
                />
                <button type="button" className="ml3-swap" onClick={swapMovementSides}>تبديل</button>
                <AccountSearchSelect
                  label="إلى"
                  value={movementDraft.destinationAccountId || ''}
                  accounts={activeAccounts}
                  onChange={(value) => updateMovementDraft('destinationAccountId', value)}
                />
              </div>
              <label>
                ملاحظة
                <textarea
                  value={movementDraft.note}
                  onChange={(event) => updateMovementDraft('note', event.target.value)}
                  placeholder="اختياري"
                />
              </label>

              <div className={`ml3-preview ${preview.validation.ok ? 'is-ok' : 'is-review'}`}>
                <strong>{preview.validation.ok ? 'تأثير الحركة' : 'لا تعتمد بعد'}</strong>
                {preview.validation.errors.map((error) => (
                  <span key={`${error.field}-${error.message}`}>{error.message}</span>
                ))}
                {preview.effects.map((effect) => (
                  <div className="ml3-effect" key={`${effect.accountId}-${effect.currency}`}>
                    <span>{accountLabel(effect.account)}</span>
                    <b>{money(effect.before, effect.currency)}</b>
                    <i>{signedMoney(effect.delta, effect.currency)}</i>
                    <strong>{money(effect.after, effect.currency)}</strong>
                  </div>
                ))}
              </div>
              <button className="ml3-save" type="submit">
                {preview.validation.ok ? 'تأكيد وحفظ الحركة' : 'حفظ كحركة معلقة'}
              </button>
            </form>

            <form className="ml3-add-account" onSubmit={addAccount}>
              <h3>حساب جديد</h3>
              <input
                value={accountDraft.ownerName}
                onChange={(event) => setAccountDraft((current) => ({ ...current, ownerName: event.target.value }))}
                placeholder="الاسم"
              />
              <input
                value={accountDraft.subAccountName}
                onChange={(event) => setAccountDraft((current) => ({ ...current, subAccountName: event.target.value }))}
                placeholder="مثال: حساب عادي / كاش / مصرفي"
              />
              <div className="ml3-field-pair">
                <select
                  value={accountDraft.type}
                  onChange={(event) => setAccountDraft((current) => ({ ...current, type: event.target.value }))}
                >
                  {Object.entries(accountTypeLabels).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
                <select
                  value={accountDraft.valueKind}
                  onChange={(event) => setAccountDraft((current) => ({ ...current, valueKind: event.target.value }))}
                >
                  {Object.entries(valueKindLabels).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
              <button type="submit">إضافة حساب</button>
            </form>
          </aside>

          <section className="ml3-content">
            {feedback ? <div className="ml3-feedback">{feedback}</div> : null}
            {renderSection()}
          </section>
        </section>
        <AccountProfile
          bucket={selectedBucket}
          movements={movements}
          accounts={accounts}
          onClose={() => setSelectedAccountId('')}
          onEditMovement={editReviewMovement}
          onUpdateAccount={updateAccountClassification}
        />
      </section>
    </main>
  )
}
