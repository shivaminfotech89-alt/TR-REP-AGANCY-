// Tests for lib/deployedVersion.ts - is a newer bundle deployed? (AUDIT G110). Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bundleInHtml, checkDeployedVersion, describeAge, runningBundle } from './deployedVersion';

/** A stand-in for `document`, enough for `runningBundle` - no DOM in this suite. */
const docWith = (srcs: string[]): Document => ({
  querySelectorAll: () => srcs.map(src => ({ getAttribute: () => src })),
} as unknown as Document);

const BUILT = '<script type="module" crossorigin src="/assets/index-Vu5TmkQn.js"></script>';

// ── Reading the running bundle ───────────────────────────────────────────────────────────────────────────────

test('the running bundle is the hashed entry script', () => {
  assert.equal(runningBundle(docWith(['/assets/index-Vu5TmkQn.js'])), 'index-Vu5TmkQn.js');
});

test('⚠ a development page has no hashed bundle, and says so rather than guessing', () => {
  // Vite dev serves /src/main.tsx. Treating that as a version would make every dev reload look like a new deploy.
  assert.equal(runningBundle(docWith(['/src/main.tsx'])), null);
  assert.equal(runningBundle(docWith([])), null);
});

test('the first hashed script wins, and unhashed ones are skipped', () => {
  assert.equal(runningBundle(docWith(['/src/x.tsx', '/assets/index-abc123.js'])), 'index-abc123.js');
});

// ── Reading the deployed bundle out of index.html ────────────────────────────────────────────────────────────

test('the bundle is parsed out of a real built index.html', () => {
  assert.equal(bundleInHtml(BUILT), 'index-Vu5TmkQn.js');
});

test('html naming no bundle yields null, not a false match', () => {
  assert.equal(bundleInHtml('<html><body>login required</body></html>'), null);
  assert.equal(bundleInHtml(''), null);
  assert.equal(bundleInHtml(null as unknown as string), null);
});

test('⚠ the same parse is used on both sides, so a difference can only be content', () => {
  // If the two parses differed, a formatting change in index.html would read as a new version.
  assert.equal(bundleInHtml(BUILT), runningBundle(docWith(['/assets/index-Vu5TmkQn.js'])));
});

// ── The comparison ───────────────────────────────────────────────────────────────────────────────────────────

const fetchReturning = (body: string, ok = true, status = 200) =>
  (async () => ({ ok, status, text: async () => body })) as unknown as typeof fetch;

test('a different deployed bundle is stale, and names both', async () => {
  const r = await checkDeployedVersion({
    doc: docWith(['/assets/index-OLD.js']),
    fetchImpl: fetchReturning('<script type="module" src="/assets/index-NEW.js"></script>'),
  });
  assert.equal(r.state, 'stale');
  assert.deepEqual(r, { state: 'stale', running: 'index-OLD.js', deployed: 'index-NEW.js' });
});

test('the same bundle is current', async () => {
  const r = await checkDeployedVersion({ doc: docWith(['/assets/index-SAME.js']), fetchImpl: fetchReturning(BUILT.replace('Vu5TmkQn', 'SAME')) });
  assert.equal(r.state, 'current');
});

test('⚠ a failed fetch is unknown, NEVER current', async () => {
  // Offline, or a captive portal answering with a login page, is not evidence that this tab is up to date.
  const thrown = await checkDeployedVersion({
    doc: docWith(['/assets/index-OLD.js']),
    fetchImpl: (async () => { throw new Error('network down'); }) as unknown as typeof fetch,
  });
  assert.equal(thrown.state, 'unknown');
  assert.match((thrown as any).reason, /network down/);

  const notOk = await checkDeployedVersion({
    doc: docWith(['/assets/index-OLD.js']), fetchImpl: fetchReturning('', false, 404),
  });
  assert.equal(notOk.state, 'unknown');
  assert.match((notOk as any).reason, /404/);
});

test('⚠ a response that is not index.html is unknown, not stale', async () => {
  // A login page would otherwise read as "a new version is available" forever.
  const r = await checkDeployedVersion({
    doc: docWith(['/assets/index-OLD.js']), fetchImpl: fetchReturning('<html>Sign in</html>'),
  });
  assert.equal(r.state, 'unknown');
});

test('a development page never reports stale, whatever the server says', async () => {
  const r = await checkDeployedVersion({
    doc: docWith(['/src/main.tsx']), fetchImpl: fetchReturning('<script type="module" src="/assets/index-NEW.js"></script>'),
  });
  assert.equal(r.state, 'unknown');
});

test('⚠ the fetch must bypass the cache, or it reads the stale file it is looking for', async () => {
  let seen: any = null;
  await checkDeployedVersion({
    doc: docWith(['/assets/index-OLD.js']),
    fetchImpl: (async (_u: any, init: any) => { seen = init; return { ok: true, status: 200, text: async () => BUILT }; }) as unknown as typeof fetch,
  });
  assert.equal(seen?.cache, 'no-store', 'a cached read of index.html would report current forever');
});

// ── The age line ─────────────────────────────────────────────────────────────────────────────────────────────

test('the age reads coarsely, and "just now" covers the first moments', () => {
  const now = 1_000_000_000_000;
  assert.equal(describeAge(now, now), 'just now');
  assert.equal(describeAge(now - 30_000, now), 'just now');
  assert.equal(describeAge(now - 60_000, now), '1 minute ago');
  assert.equal(describeAge(now - 4 * 60_000, now), '4 minutes ago');
  assert.equal(describeAge(now - 90 * 60_000, now), '2 hours ago');
  assert.equal(describeAge(now - 48 * 3600_000, now), '2 days ago');
});

test('never read means no line at all, rather than "0 minutes ago"', () => {
  const now = 1_000_000_000_000;
  assert.equal(describeAge(null, now), null);
  assert.equal(describeAge(0, now), null);
  assert.equal(describeAge(undefined, now), null);
});

test('a clock that disagrees does not produce a negative age', () => {
  const now = 1_000_000_000_000;
  assert.equal(describeAge(now + 60_000, now), null);
});

// ── Wired as two separate lines, and no header icon ──────────────────────────────────────────────────────────

const bell = readFileSync(new URL('../components/NotificationBell.tsx', import.meta.url), 'utf8');

test('⚠ the two facts are two lines, and the version line is conditional', () => {
  assert.ok(bell.includes('Data read'), 'the staleness line is missing');
  assert.ok(bell.includes('A new version is available'), 'the version line is missing');
  assert.ok(bell.includes("version.state === 'stale'"),
    'the version line must appear only when a newer bundle is genuinely deployed');
});

test('re-reading data and reloading the page are separate actions', () => {
  assert.ok(bell.includes('refreshAgencyData()'), 'the re-read action is missing');
  assert.ok(bell.includes('window.location.reload()'), 'the reload action is missing');
  // ⚠ reload(true) was removed from the spec and is ignored - a plain reload wearing a stronger name.
  assert.ok(!bell.includes('reload(true)'), 'reload(true) does nothing and must not be used');
});

test('⚠ no refresh icon was added to the header cluster', () => {
  const layout = readFileSync(new URL('../components/AppLayout.tsx', import.meta.url), 'utf8');
  const header = layout.slice(layout.indexOf('<header'), layout.indexOf('</header>'));
  assert.ok(!/RefreshCw|refreshAgencyData/.test(header),
    'the header is 134px of controls against a 178px agency name at 380px - the name is what gets squeezed');
});
