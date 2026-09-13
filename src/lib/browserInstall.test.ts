// Tests for lib/browserInstall.ts (AUDIT G81). Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guessBrowser, orderSections, INSTALL_SECTIONS } from './browserInstall';

const UA = {
  chromeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  chromeMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36',
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0',
  safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  safariIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  ipadOs: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  firefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0',
  firefoxIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/605.1.15',
  chromeIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/128.0.0.0 Mobile/15E148 Safari/604.1',
};

// ---------------------------------------------------------------- the guess

test('Chrome on Windows, Mac and Android all read as Chrome', () => {
  for (const ua of [UA.chromeWin, UA.chromeMac, UA.chromeAndroid]) {
    assert.equal(guessBrowser({ userAgent: ua }).section, 'chrome', ua.slice(0, 40));
  }
});

test('⚠ Edge is not Chrome, though its user agent says Chrome', () => {
  const g = guessBrowser({ userAgent: UA.edge });
  assert.equal(g.section, 'edge');
  assert.equal(g.canInstall, true);
});

test('⚠ Safari on Mac is not Chrome, though every Chrome UA says Safari', () => {
  const g = guessBrowser({ userAgent: UA.safariMac, maxTouchPoints: 0 });
  assert.equal(g.section, 'safari-macos');
  assert.equal(g.canInstall, true);
});

test('iPhone reads as Safari on iOS', () => {
  assert.equal(guessBrowser({ userAgent: UA.safariIphone }).section, 'safari-ios');
});

test('⚠ an iPad sends a Macintosh user agent - touch points are what tell it from a Mac', () => {
  assert.equal(guessBrowser({ userAgent: UA.ipadOs, maxTouchPoints: 5 }).section, 'safari-ios');
  assert.equal(guessBrowser({ userAgent: UA.ipadOs, maxTouchPoints: 0 }).section, 'safari-macos');
});

test('every browser on iOS installs the same way, whatever it calls itself', () => {
  assert.equal(guessBrowser({ userAgent: UA.chromeIos }).section, 'safari-ios');
  assert.equal(guessBrowser({ userAgent: UA.firefoxIos }).section, 'firefox', 'Firefox names itself, and still cannot install');
});

test('Firefox reads as Firefox and is marked as unable to install', () => {
  const g = guessBrowser({ userAgent: UA.firefox });
  assert.equal(g.section, 'firefox');
  assert.equal(g.canInstall, false);
});

test('an unknown or absent user agent guesses nothing rather than guessing wrongly', () => {
  assert.equal(guessBrowser({}).section, null);
  assert.equal(guessBrowser({ userAgent: '' }).section, null);
  assert.equal(guessBrowser({ userAgent: 'Some Robot/1.0' }).section, null);
});

// ---------------------------------------------------------------- ⚠ ordering never hides a section

test('the guessed section comes first', () => {
  assert.equal(orderSections(guessBrowser({ userAgent: UA.safariIphone }))[0], 'safari-ios');
  assert.equal(orderSections(guessBrowser({ userAgent: UA.edge }))[0], 'edge');
});

test('⚠ EVERY ordering is a permutation of the full list - nothing is ever dropped', () => {
  const cases = [UA.chromeWin, UA.edge, UA.safariMac, UA.safariIphone, UA.firefox, 'Some Robot/1.0', ''];
  for (const ua of cases) {
    const out = orderSections(guessBrowser({ userAgent: ua }));
    assert.equal(out.length, INSTALL_SECTIONS.length, ua.slice(0, 30));
    assert.deepEqual([...out].sort(), [...INSTALL_SECTIONS].sort(), ua.slice(0, 30));
  }
});

test('an unknown browser still shows every section, in the canonical order', () => {
  assert.deepEqual(orderSections(guessBrowser({ userAgent: 'Some Robot/1.0' })), [...INSTALL_SECTIONS]);
});
