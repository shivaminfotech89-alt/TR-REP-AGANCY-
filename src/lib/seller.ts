/**
 * WHO IS SELLING THIS (AUDIT G41).
 *
 * ⚠ THE LEGAL ENTITY IS THE PROPRIETOR, NOT THE TRADE NAME, and on these pages that distinction
 * is not pedantry. The GSTIN's fifth character is `P`, which marks a proprietorship: there is no
 * company, and "MSD CORPORATION" is a name the proprietor trades under. A contract is therefore
 * with MEGHA HASMUKHBHAI PANCHAL; MSD CORPORATION cannot be a party to anything because it is
 * not a person or a body corporate.
 *
 * Getting this backwards on a payment-processor review is itself a rejection cause, because the
 * entity on the site then does not match the entity on the GST registration and the bank
 * account.
 *
 * ⚠ THE PLACEHOLDERS ARE DELIBERATE AND MUST BE FILLED BEFORE THESE PAGES GO LIVE. An address
 * and a phone number cannot be inferred, guessed, or borrowed from a sample - they are checked
 * against the registration. `MISSING` renders visibly on the page rather than as a blank, so a
 * page that ships incomplete says so instead of looking finished.
 */

export const SELLER = {
  /** The legal person. What a contract is with. */
  legalName: 'MEGHA HASMUKHBHAI PANCHAL',
  /** The name the business trades under. Not a legal entity. */
  tradeName: 'MSD CORPORATION',
  /** Sole proprietorship - stated on the page, because it determines who the contract binds. */
  constitution: 'Sole proprietorship',
  gstin: '24DHHPP9291K1ZM',
  /** Derived from the GSTIN's first two digits, so it cannot disagree with it. */
  stateCode: '24',
  state: 'Gujarat',
  country: 'India',

  /** ⚠ TO BE SUPPLIED. Must match the GST registration. */
  address: '[registered address]',
  /** ⚠ TO BE SUPPLIED. A number a reviewer can call. */
  phone: '[phone]',

  email: 'shivaminfotech89@gmail.com',
  product: 'TransRegister',
  site: 'transregister.com',
} as const;

/** True when a value is still a placeholder, so a page can show that rather than hide it. */
export function isPlaceholder(v: string): boolean {
  return /^\[.*\]$/.test(String(v || '').trim());
}
