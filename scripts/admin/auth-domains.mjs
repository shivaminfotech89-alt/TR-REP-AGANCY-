/**
 * WHICH DOMAINS FIREBASE AUTH WILL ACCEPT A SIGN-IN FROM.
 *
 * READ-ONLY. One GET against the Identity Toolkit admin API.
 *
 *     node scripts/admin/auth-domains.mjs
 *
 * ⚠ THIS IS CONSOLE STATE, AND IT DECIDES A CUSTOMER-FACING DIAGNOSIS. A sign-in that fails
 * on one host and works on another looks identical, from the outside, to a sign-in broken by
 * browser storage policy - and the two have completely different fixes. Taking the domain list
 * on trust in the middle of that is the shape this audit keeps recording, so it is measured.
 *
 * ⚠ IT LIVES IN THE REPO BECAUSE NODE RESOLVES IMPORTS RELATIVE TO THE IMPORTING FILE, NOT THE
 * PROCESS CWD. The first two attempts at this ran from a scratchpad directory and failed with
 * ERR_MODULE_NOT_FOUND for `google-auth-library` - which IS installed, at
 * node_modules/google-auth-library. Re-running with the repo as cwd changed nothing, because
 * cwd was never the question.
 *
 * `google-auth-library` arrives as a transitive dependency of firebase-admin; it is not a
 * direct dependency, so this script is the one place that assumption is written down.
 */
import { readFileSync } from 'node:fs';
import { GoogleAuth } from 'google-auth-library';

const cfg = JSON.parse(readFileSync('firebase-applet-config.json', 'utf8'));

const auth = new GoogleAuth({
  keyFile: '.secrets/serviceAccountKey.json',
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
});

const client = await auth.getClient();
const url = `https://identitytoolkit.googleapis.com/admin/v2/projects/${cfg.projectId}/config`;

console.log(`\nproject                            ${cfg.projectId}`);
console.log(`authDomain in the shipped config   ${cfg.authDomain}`);
console.log('READ-ONLY - nothing in this script writes.\n');

try {
  const res = await client.request({ url });
  const domains = res.data?.authorizedDomains ?? [];

  console.log(`AUTHORIZED DOMAINS (${domains.length}):`);
  for (const d of domains) console.log(`   ${d}`);

  console.log('\nTHE HOSTS THAT MATTER:');
  for (const w of ['transregister.com', 'www.transregister.com', cfg.authDomain]) {
    console.log(`   ${String(w).padEnd(32)} ${domains.includes(w) ? 'PRESENT' : '** ABSENT **'}`);
  }

  // ⚠ A POPUP SIGN-IN RUNS ON authDomain, NOT ON THE APP'S ORIGIN. If authDomain is the
  // firebaseapp.com default, the session is written cross-origin and must survive the hop
  // back - which is exactly what mobile Chrome's storage partitioning interferes with and
  // desktop does not.
  const sameOrigin = /transregister\.com$/i.test(String(cfg.authDomain || ''));
  console.log(`\npopup origin is ${sameOrigin ? 'SAME-ORIGIN with the app' : 'CROSS-ORIGIN to the app'}`);

  const si = res.data?.signIn ?? {};
  const enabled = Object.keys(si).filter((k) => si[k] && si[k].enabled);
  if (enabled.length) console.log(`sign-in methods enabled: ${enabled.join(', ')}`);
} catch (err) {
  const detail = err?.response?.data
    ? JSON.stringify(err.response.data, null, 2)
    : (err?.message || String(err));
  console.error('Could not read the auth config:\n');
  console.error(detail);
  console.error('\nIf this is a permissions error, the service account lacks');
  console.error('firebaseauth.configs.get. The list is then only readable at:');
  console.error('  Firebase console -> Authentication -> Settings -> Authorized domains\n');
  process.exit(1);
}
