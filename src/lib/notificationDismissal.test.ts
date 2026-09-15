// Tests for lib/notificationDismissal.ts (AUDIT G93). Run with `npm test`.
//
// The load-bearing behaviours are: a dismissal lasts only while the FACT is unchanged, and a
// storage failure shows the notification rather than hiding it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signatureOf, isDismissed, dismiss, undismiss, readDismissed } from './notificationDismissal';

/** A minimal localStorage. `mode` lets a test make the browser hostile. */
function useStorage(mode: 'ok' | 'throws-on-read' | 'throws-on-write' | 'absent' = 'ok') {
  const map = new Map<string, string>();
  if (mode === 'absent') {
    delete (globalThis as any).localStorage;
    return map;
  }
  (globalThis as any).localStorage = {
    getItem: (k: string) => {
      if (mode === 'throws-on-read') throw new Error('blocked');
      return map.has(k) ? map.get(k) : null;
    },
    setItem: (k: string, v: string) => {
      if (mode === 'throws-on-write') throw new Error('quota');
      map.set(k, v);
    },
    removeItem: (k: string) => { map.delete(k); },
  };
  return map;
}

// ---------------------------------------------------------------- the signature

test('the same facts in a different order are the same signature', () => {
  assert.equal(signatureOf(['b', 'a', 'c']), signatureOf(['c', 'b', 'a']));
});

test('a different set of facts is a different signature', () => {
  assert.notEqual(signatureOf(['a', 'b']), signatureOf(['a', 'b', 'c']));
  assert.notEqual(signatureOf(['a', 'b']), signatureOf(['a']));
});

test('blanks and duplicates do not change the fact', () => {
  assert.equal(signatureOf(['a', '', '  ', 'a', null, undefined]), signatureOf(['a']));
});

test('no facts is an empty signature', () => {
  assert.equal(signatureOf([]), '');
  assert.equal(signatureOf([null, '  ']), '');
});

// ---------------------------------------------------------------- dismiss until the fact changes

test('⚠ DISMISSED STAYS DISMISSED WHILE THE FACT IS UNCHANGED', () => {
  useStorage();
  const sig = signatureOf(['receipt-1', 'receipt-2']);
  assert.equal(isDismissed('oil', sig), false, 'not dismissed before anyone dismisses it');
  dismiss('oil', sig);
  assert.equal(isDismissed('oil', sig), true);
  // The same facts, recomputed in another order on a later render.
  assert.equal(isDismissed('oil', signatureOf(['receipt-2', 'receipt-1'])), true);
});

test('⚠ A NEW UNMATCHED RECEIPT BRINGS IT BACK', () => {
  useStorage();
  dismiss('oil', signatureOf(['receipt-1']));
  assert.equal(isDismissed('oil', signatureOf(['receipt-1', 'receipt-2'])), false);
});

test('⚠ SO DOES ONE BEING RESOLVED - any change to the fact is a change', () => {
  useStorage();
  dismiss('oil', signatureOf(['receipt-1', 'receipt-2']));
  assert.equal(isDismissed('oil', signatureOf(['receipt-2'])), false);
});

test('a dismissal is per notification, not global', () => {
  useStorage();
  dismiss('oil', signatureOf(['x']));
  assert.equal(isDismissed('jobs', signatureOf(['x'])), false);
});

test('an empty signature is never dismissed - there is no fact to dismiss', () => {
  useStorage();
  dismiss('oil', '');
  assert.equal(isDismissed('oil', ''), false);
  assert.equal(readDismissed('oil'), '', 'nothing was written');
});

test('undismiss returns the notice with the facts unchanged', () => {
  useStorage();
  const sig = signatureOf(['x']);
  dismiss('oil', sig);
  undismiss('oil');
  assert.equal(isDismissed('oil', sig), false);
});

// ---------------------------------------------------------------- hostile browsers

test('⚠ STORAGE THAT THROWS ON READ SHOWS THE NOTIFICATION', () => {
  useStorage('throws-on-read');
  assert.equal(isDismissed('oil', signatureOf(['x'])), false);
});

test('⚠ STORAGE THAT THROWS ON WRITE SHOWS THE NOTIFICATION', () => {
  useStorage('throws-on-write');
  const sig = signatureOf(['x']);
  dismiss('oil', sig);
  assert.equal(isDismissed('oil', sig), false, 'a failed write must not read back as dismissed');
});

test('⚠ NO localStorage AT ALL IS NOT A CRASH, AND NOT A HIDDEN NOTICE', () => {
  useStorage('absent');
  const sig = signatureOf(['x']);
  assert.doesNotThrow(() => dismiss('oil', sig));
  assert.doesNotThrow(() => undismiss('oil'));
  assert.equal(isDismissed('oil', sig), false);
});
