import type { Account } from './types';

/**
 * How to ask a bank for the balance (U-11): an SMS keyword and number, and a missed-call number.
 * From the banks' published lists (compiled by BankBazaar/Groww, checked 2026-10-06). Banks change
 * these and some need SMS banking registered first, so every account can override them.
 * `{last4}` in the text is filled with the account's last digits.
 */
export interface BalanceCheck {
  sms?: string;
  text?: string;
  call?: string;
}

const BANKS: [RegExp, BalanceCheck][] = [
  [/hdfc/i, { sms: '5676712', text: 'BAL', call: '18002703333' }],
  [/state bank|\bsbi\b/i, { sms: '9223766666', text: 'BAL', call: '9223766666' }],
  [/icici/i, { sms: '9215676766', text: 'IBAL', call: '9594612612' }],
  [/axis/i, { sms: '56161600', text: 'BAL', call: '18004195959' }],
  [/kotak/i, { sms: '9971056767', text: 'BAL', call: '18002740110' }],
  [/idfc/i, { sms: '5676732', text: 'BAL', call: '18002700720' }],
  [/yes bank/i, { sms: '9840909000', text: 'YESBAL', call: '09223920000' }],
  [/indusind/i, { sms: '9212299955', text: 'BAL', call: '18002741000' }],
  [/baroda/i, { sms: '8422009988', text: 'BAL {last4}', call: '8468001111' }],
  [/union bank/i, { sms: '09223008486', text: 'UBAL', call: '09223008586' }],
  [/punjab national|\bpnb\b/i, { call: '18001802223' }],
  [/canara/i, { call: '09015483483' }],
  [/federal/i, { call: '8431900900' }],
  [/\bau\b/i, { call: '18001202586' }],
];

/** The way to check this account's balance: your own numbers first, else the bank's. */
export function balanceCheckFor(
  a: Pick<Account, 'institution' | 'name' | 'last4' | 'balanceCheck'>,
) {
  const known = BANKS.find(([re]) => re.test(`${a.institution ?? ''} ${a.name}`))?.[1] ?? {};
  const merged: BalanceCheck = { ...known, ...a.balanceCheck };
  const text = merged.text?.replace('{last4}', a.last4 ?? '').trim();
  return { ...merged, text, known: !!(merged.sms || merged.call) };
}

/** `sms:` link that opens Messages with the text filled in (Android and iOS both read `body`). */
export const smsLink = (number: string, text?: string) =>
  `sms:${number}${text ? `?body=${encodeURIComponent(text)}` : ''}`;
