import { describe, expect, it } from 'vitest'
import { ACCOUNT_TYPES, mohammadAccountCatalog, mohammadSummaryAccounts } from './accountCatalog'
import {
  CURRENCIES,
  MOVEMENT_STATUSES,
  MOVEMENT_TYPES,
  createAccount,
  createOpeningMovements,
  formatBalanceMeaning,
  getAccountBalance,
  postMovement,
  previewMovement,
  summarizeBalances,
  voidMovement,
  validateAccount,
} from './ledgerCore'

describe('mohammad ledger core', () => {
  it('creates opening balances from the Numbers catalog without losing cash or bank separation', () => {
    const openings = createOpeningMovements(mohammadAccountCatalog)
    const balances = summarizeBalances(mohammadAccountCatalog, openings)

    expect(getAccountBalance('me-cash', mohammadAccountCatalog, openings).dinar).toBe(47164.675)
    expect(getAccountBalance('me-cash', mohammadAccountCatalog, openings).usd).toBe(0.220779)
    expect(getAccountBalance('me-jumhouria', mohammadAccountCatalog, openings).dinar).toBe(-27290)
    expect(balances.find((bucket) => bucket.account.id === 'saeed-cash').dinar).toBe(18260)
    expect(balances.find((bucket) => bucket.account.id === 'saeed-bank').dinar).toBe(13569.99889)
  })

  it('previews transfer effects before posting', () => {
    const openings = createOpeningMovements(mohammadAccountCatalog)
    const preview = previewMovement(
      {
        type: MOVEMENT_TYPES.TRANSFER,
        amount: 500,
        currency: CURRENCIES.DINAR,
        sourceAccountId: 'me-cash',
        destinationAccountId: 'saeed-cash',
      },
      mohammadAccountCatalog,
      openings,
    )

    expect(preview.validation.ok).toBe(true)
    expect(preview.effects).toEqual([
      expect.objectContaining({ accountId: 'me-cash', before: 47164.675, delta: -500, after: 46664.675 }),
      expect.objectContaining({ accountId: 'saeed-cash', before: 18260, delta: 500, after: 18760 }),
    ])
  })

  it('keeps incomplete movements out of posted balances', () => {
    const openings = createOpeningMovements(mohammadAccountCatalog)
    const badMovement = postMovement(
      {
        type: MOVEMENT_TYPES.TRANSFER,
        amount: 250,
        currency: CURRENCIES.DINAR,
        sourceAccountId: null,
        destinationAccountId: 'saeed-cash',
      },
      mohammadAccountCatalog,
    )

    expect(badMovement.status).toBe(MOVEMENT_STATUSES.NEEDS_REVIEW)
    const balance = getAccountBalance('saeed-cash', mohammadAccountCatalog, [...openings, badMovement])
    expect(balance.dinar).toBe(18260)
  })

  it('rejects summary accounts as posting endpoints', () => {
    const movement = postMovement(
      {
        type: MOVEMENT_TYPES.TRANSFER,
        amount: 100,
        currency: CURRENCIES.DINAR,
        sourceAccountId: 'me-cash',
        destinationAccountId: 'trucks-income-summary',
      },
      [...mohammadAccountCatalog, ...mohammadSummaryAccounts],
    )

    expect(movement.status).toBe(MOVEMENT_STATUSES.NEEDS_REVIEW)
    expect(movement.validation.errors.some((error) => error.message.includes('الملخص'))).toBe(true)
  })

  it('supports voiding a posted movement without deleting it', () => {
    const openings = createOpeningMovements(mohammadAccountCatalog)
    const movement = postMovement(
      {
        type: MOVEMENT_TYPES.TRANSFER,
        amount: 1000,
        currency: CURRENCIES.DINAR,
        sourceAccountId: 'me-cash',
        destinationAccountId: 'omar-gold',
      },
      mohammadAccountCatalog,
    )
    const withMovement = getAccountBalance('omar-gold', mohammadAccountCatalog, [...openings, movement])
    expect(withMovement.dinar).toBe(25500)

    const result = voidMovement(movement, 'إدخال بالخطأ')
    expect(result.ok).toBe(true)
    const afterVoid = getAccountBalance('omar-gold', mohammadAccountCatalog, [...openings, result.movement])
    expect(afterVoid.dinar).toBe(24500)
    expect(result.movement.status).toBe(MOVEMENT_STATUSES.VOIDED)
  })

  it('calculates usd sale and purchase as different currency effects', () => {
    const salePreview = previewMovement(
      {
        type: MOVEMENT_TYPES.USD_SALE,
        amount: 100,
        currency: CURRENCIES.USD,
        rate: 7.5,
        sourceAccountId: 'me-cash',
        destinationAccountId: 'me-jumhouria',
      },
      mohammadAccountCatalog,
      createOpeningMovements(mohammadAccountCatalog),
    )

    expect(salePreview.validation.ok).toBe(true)
    expect(salePreview.effects).toEqual([
      expect.objectContaining({ accountId: 'me-cash', currency: CURRENCIES.USD, delta: -100 }),
      expect.objectContaining({ accountId: 'me-jumhouria', currency: CURRENCIES.DINAR, delta: 750 }),
    ])
  })

  it('labels balance direction based on account kind', () => {
    const person = mohammadAccountCatalog.find((account) => account.id === 'rabee-cash')
    const bank = mohammadAccountCatalog.find((account) => account.id === 'me-jumhouria')
    const expense = mohammadAccountCatalog.find((account) => account.id === 'personal-expense')
    const asset = mohammadAccountCatalog.find((account) => account.type === ACCOUNT_TYPES.ASSET)

    expect(formatBalanceMeaning(person, -24942.2)).toBe('عليّ له 24942.2')
    expect(formatBalanceMeaning(bank, -27290)).toBe('ناقص 27290')
    expect(formatBalanceMeaning(expense, 112240)).toBe('تكلفة 112240')
    expect(formatBalanceMeaning(asset, 15550)).toBe('قيمة/رصيد أصل 15550')
  })

  it('creates dynamic accounts with validation before use', () => {
    const account = createAccount({
      ownerName: 'محمد الكيفو',
      subAccountName: 'كاش',
      type: ACCOUNT_TYPES.PERSON,
      valueKind: 'receivable',
    })

    expect(account.id).toContain('محمد-الكيفو-كاش')
    expect(validateAccount(account, mohammadAccountCatalog).ok).toBe(true)
    expect(validateAccount({ ...account, ownerName: '' }, mohammadAccountCatalog).ok).toBe(false)
  })
})
