/**
 * IS A NEWER BUNDLE DEPLOYED THAN THE ONE THIS TAB IS RUNNING? (AUDIT G110)
 *
 * ⚠ THE BUTTON THIS EXISTS FOR WOULD OTHERWISE BE PRESSED HOPEFULLY. "Reload" with nothing behind it is a control an
 * operator tries when something looks wrong; "a new version is available" is a fact. Only the second is worth a line
 * on screen, and only this answers it.
 *
 * ⚠⚠ AND IT IS NOT THE FIX FOR A STALE BUNDLE - THE CACHE HEADER ON `index.html` IS. Vite content-hashes every
 * asset, so a deploy produces `index-NEWHASH.js` and the old file keeps being served quite correctly. The only file
 * that can go stale is `index.html`, which has a stable name and is what points at the hashed assets. A cached
 * index.html therefore pins a tab to an old bundle indefinitely. That is a response-header matter, not a UI one, and
 * this check is the operator-facing half of a fix whose other half is in `vercel.json`.
 *
 * ⚠ `window.location.reload(true)` DOES NOT HELP, AND DOES NOT DO WHAT ITS NAME SUGGESTS. The `forceReload`
 * argument was removed from the specification and is ignored by current browsers; there is no hard refresh available
 * to script. `reload()` re-requests the document and obeys whatever cache directives came with it - which is exactly
 * why the header is the fix and this is only the notice.
 *
 * ⚠ NO SERVICE WORKER IS INVOLVED. The app ships a manifest and icons but registers no service worker, so there is
 * no worker cache to blame and no `updatefound` event to listen for. If one is ever added, its update lifecycle is
 * the better signal and this module should give way to it rather than run alongside.
 */

/** The marker a built page carries: its own hashed entry script. Dev serves `/src/main.tsx`, which this ignores. */
const BUNDLE_PATTERN = /\/assets\/([A-Za-z0-9._-]+\.js)/;

/**
 * The hashed entry bundle this tab is running, or null when there is not one to read - which is the case in dev,
 * where the entry is `/src/main.tsx` and no comparison is meaningful.
 */
export function runningBundle(doc: Document = document): string | null {
  const scripts = Array.from(doc.querySelectorAll('script[type="module"][src]')) as HTMLScriptElement[];
  for (const script of scripts) {
    const match = BUNDLE_PATTERN.exec(script.getAttribute('src') || '');
    if (match) return match[1];
  }
  return null;
}

/** The hashed entry bundle named by a copy of index.html. Same parse, so the two can only differ by content. */
export function bundleInHtml(html: string): string | null {
  const match = BUNDLE_PATTERN.exec(String(html ?? ''));
  return match ? match[1] : null;
}

export type VersionCheck =
  /** The deployed bundle differs from the running one - a reload will pick it up. */
  | { state: 'stale'; running: string; deployed: string }
  /** Checked, and this tab is running what is deployed. */
  | { state: 'current'; running: string }
  /** No comparison was possible: dev, an unreadable response, or a network failure. Say nothing on screen. */
  | { state: 'unknown'; reason: string };

/**
 * Fetches `index.html` past the cache and compares the bundle it names with the running one.
 *
 * ⚠ `cache: 'no-store'`, OR THIS CHECK READS THE SAME STALE FILE IT IS TRYING TO DETECT. The whole failure being
 * looked for is a cached index.html; a cached fetch of it would report "current" with perfect confidence, forever.
 *
 * ⚠ A FAILURE IS 'unknown', NEVER 'current'. Offline, a 404, a captive portal returning a login page - none of those
 * is evidence that the tab is up to date, and reporting them as such is how a check comes to reassure rather than
 * inform. The caller shows a line only for 'stale'.
 */
export async function checkDeployedVersion(
  opts: { doc?: Document; fetchImpl?: typeof fetch; url?: string } = {},
): Promise<VersionCheck> {
  const doc = opts.doc ?? document;
  const fetchImpl = opts.fetchImpl ?? (typeof fetch === 'function' ? fetch : null);
  const running = runningBundle(doc);
  if (!running) return { state: 'unknown', reason: 'this page has no hashed bundle to compare - a development build' };
  if (!fetchImpl) return { state: 'unknown', reason: 'no fetch available' };

  let html: string;
  try {
    const res = await fetchImpl(opts.url ?? '/index.html', { cache: 'no-store' });
    if (!res.ok) return { state: 'unknown', reason: `index.html returned ${res.status}` };
    html = await res.text();
  } catch (err: any) {
    return { state: 'unknown', reason: String(err?.message || err) };
  }

  const deployed = bundleInHtml(html);
  if (!deployed) return { state: 'unknown', reason: 'the response named no bundle - it may not be index.html' };
  return deployed === running ? { state: 'current', running } : { state: 'stale', running, deployed };
}

/**
 * "2 minutes ago". Deliberately coarse: the figure answers "is it worth re-reading", and a seconds-accurate age
 * invites reading it as a staleness guarantee, which it is not - see `loadedAt` in lib/loadFailure.
 */
export function describeAge(loadedAt: number | null | undefined, now: number): string | null {
  const at = Number(loadedAt || 0);
  if (!at || !Number.isFinite(at) || at > now) return null;
  const seconds = Math.floor((now - at) / 1000);
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
