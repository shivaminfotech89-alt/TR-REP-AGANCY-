// FIND HOOKS THAT FOLLOW AN EARLY RETURN IN A COMPONENT BODY (AUDIT G47).
//
// React's rules of hooks require the same hooks, in the same order, on every render. An early
// return before a hook breaks that: the render that takes the branch calls fewer hooks than the
// one that does not, and React throws
//
//     Error: Rendered more hooks than during the previous render   (minified: #310)
//
// ⚠ IT CRASHES ONLY WHEN THE BRANCH IS ACTUALLY TAKEN FIRST. A component whose `if (loading)
// return` is false on its first render calls every hook from the start and stays consistent
// forever. The same component mounted while loading is true calls fewer, then more - and dies.
// So this survives in-session navigation and kills a cold load, which is why it can sit in a
// file for weeks.
//
// ⚠ AND A NAIVE GREP CANNOT FIND IT. Returns inside module-level helpers, inside `useMemo`
// callbacks and inside event handlers all look identical to a component-body return when
// matched by indentation - a first attempt at this check reported nine files of which one was
// real. A check that cries wolf gets switched off, which is worse than not having it (G33).
//
// So this tracks brace depth from each component's opening brace and considers only statements
// at depth 1 of that function.
//
//     node scripts/admin/hooks-after-return.js

import { readdirSync, readFileSync } from 'node:fs';

const HOOK = /\buse[A-Z]\w*\s*\(/;
const IS_COMPONENT = /^\s*(?:export\s+default\s+)?function\s+([A-Z]\w*)\s*\(|^\s*export\s+function\s+([A-Z]\w*)\s*\(/;

/** Statements that leave the function before the code below them runs. */
const EARLY_RETURN = /^\s*(?:if\s*\(.*\)\s*)?return\b/;

function analyse(path) {
  const src = readFileSync(path, 'utf8');
  const lines = src.split('\n');
  const findings = [];

  for (let i = 0; i < lines.length; i++) {
    const m = IS_COMPONENT.exec(lines[i]);
    if (!m) continue;
    const name = m[1] || m[2];

    // Walk the function body, tracking depth. Depth 1 is the component body itself.
    let depth = 0, started = false, firstReturn = -1;
    const hooksAfter = [];

    for (let j = i; j < lines.length; j++) {
      const line = lines[j];
      // Strip strings and comments crudely - enough for brace counting on this codebase.
      const code = line.replace(/\/\/.*$/, '').replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""').replace(/`[^`]*`/g, '``');
      const opens = (code.match(/\{/g) || []).length;
      const closes = (code.match(/\}/g) || []).length;

      if (started && depth === 1) {
        if (firstReturn === -1 && EARLY_RETURN.test(code) && !/=>/.test(code)) firstReturn = j + 1;
        else if (firstReturn !== -1 && HOOK.test(code)) hooksAfter.push(j + 1);
      }

      depth += opens;
      if (opens > 0) started = true;
      depth -= closes;
      if (started && depth <= 0) break;
    }

    if (hooksAfter.length) findings.push({ name, firstReturn, hooksAfter });
  }
  return findings;
}

let total = 0;
console.log('\nHOOKS AFTER AN EARLY RETURN — component bodies only\n');
for (const f of readdirSync('src/components').filter(x => x.endsWith('.tsx')).sort()) {
  const found = analyse('src/components/' + f);
  for (const x of found) {
    total++;
    console.log(`  ${f}  ->  ${x.name}()`);
    console.log(`     early return at line ${x.firstReturn}`);
    console.log(`     hook(s) after it:    ${x.hooksAfter.join(', ')}`);
  }
}
console.log(total
  ? `\n  ${total} component(s) will throw React #310 on a render that takes the branch.\n`
  : '\n  None. Every hook runs before any early return.\n');
process.exit(total ? 1 : 0);
