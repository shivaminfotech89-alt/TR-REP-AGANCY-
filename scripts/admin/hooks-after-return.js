// FIND HOOKS THAT FOLLOW AN EARLY RETURN IN A COMPONENT BODY (AUDIT G47, rebuilt in G59).
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
// ⚠ THE BRACE-COUNTING VERSION WAS BLIND TO ITS OWN SUBJECT (G59). It reported "None" while
// EstimateMaster carried three hooks below `if (!activeAgency) { return (...) }` - the exact
// crash shape above, in a file this exists to protect. Two blind spots:
//   - it saw an early return only on the same line as its `if`, never a braced block;
//   - its hook pattern `use[A-Z]\w*\s*\(` did not match a hook with type arguments,
//     `useState<Record<string, boolean>>(`.
// A guard in that state is worse than no guard: it does not stay silent, it reports clean.
//
// So this reads the code with the TypeScript parser that `tsc` uses, rather than counting braces:
//   - a component is a capitalised function (declared, or assigned to a capitalised const,
//     including through memo/forwardRef);
//   - an EARLY RETURN is any top-level statement of its body that contains a `return` outside a
//     nested function - wherever the `if` and the `return` sit on the page;
//   - a HOOK is a call to `useX` or `React.useX`, type arguments or not.
//
// ⚠ AND IT PROVES IT CAN SEE BEFORE IT SAYS "None". Every run starts with a self-test: synthetic
// components for each shape, including one that must NOT be flagged, then a probe inserted below
// the early return of every real component that has one. If the guard misses any of them it
// exits 1 without scanning - a guard that cannot find a planted fault has nothing to report.
//
//     node scripts/admin/hooks-after-return.js              every .tsx under src/
//     node scripts/admin/hooks-after-return.js <file>...    just those files

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

const HOOK_NAME = /^use[A-Z0-9]/;

/** A function or class boundary: a `return` or hook call inside one is not the component's. */
const isBoundary = node => ts.isFunctionLike(node) || ts.isClassLike(node);

function firstReturnIn(node) {
  if (ts.isReturnStatement(node)) return node;
  let found = null;
  ts.forEachChild(node, child => {
    if (found || isBoundary(child)) return;
    found = firstReturnIn(child);
  });
  return found;
}

function hookCallsIn(node, out = []) {
  if (ts.isCallExpression(node)) {
    const callee = node.expression;
    const name = ts.isIdentifier(callee) ? callee.text
      : ts.isPropertyAccessExpression(callee) ? callee.name.text : '';
    if (HOOK_NAME.test(name)) out.push(node);
  }
  ts.forEachChild(node, child => { if (!isBoundary(child)) hookCallsIn(child, out); });
  return out;
}

/** Capitalised components declared at the top level of a file, with their bodies. */
function componentsIn(sf) {
  const out = [];
  const fnBody = fn => (fn && (ts.isFunctionExpression(fn) || ts.isArrowFunction(fn) || ts.isFunctionDeclaration(fn))
    && fn.body && ts.isBlock(fn.body)) ? fn.body : null;
  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.body) {
      const name = stmt.name?.text ?? 'default';
      if (/^[A-Z]/.test(name) || name === 'default') out.push({ name, body: stmt.body });
    }
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !/^[A-Z]/.test(decl.name.text)) continue;
        let init = decl.initializer;
        // memo(function X() {...}) / forwardRef((props, ref) => {...})
        if (init && ts.isCallExpression(init)) init = init.arguments.find(a => fnBody(a));
        const body = fnBody(init);
        if (body) out.push({ name: decl.name.text, body });
      }
    }
  }
  return out;
}

/** Findings for one source text: each component with hooks below its first early return. */
function analyseSource(src, fileName) {
  const sf = ts.createSourceFile(fileName, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const line = node => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const findings = [];
  for (const { name, body } of componentsIn(sf)) {
    let early = null;
    const hooksAfter = [];
    for (const stmt of body.statements) {
      if (early) hookCallsIn(stmt).forEach(h => hooksAfter.push(line(h)));
      else {
        const r = firstReturnIn(stmt);
        if (r) early = { stmt, returnLine: line(r), endLine: sf.getLineAndCharacterOfPosition(stmt.getEnd()).line + 1 };
      }
    }
    findings.push({ name, early, hooksAfter, isLast: early ? body.statements.at(-1) === early.stmt : true });
  }
  return findings;
}

// ------------------------------------------------------------------------------ self-test
const failures = [];

const SYNTHETIC = [
  ['braced early return, then a typed hook',
   'export function Probe() {\n  const [a] = useState(0);\n  if (!a) {\n    return null;\n  }\n  const b = useState<number>(1);\n  return <div />;\n}\n', [6]],
  ['early return on the same line as its if, then a hook',
   'export default function Probe() {\n  if (loading) return null;\n  useEffect(() => {}, []);\n  return null;\n}\n', [3]],
  ['return on the line after an unbraced if',
   'function Probe() {\n  if (loading)\n    return null;\n  const x = useMemo(() => 1, []);\n  return null;\n}\n', [4]],
  ['arrow component through memo, then React.useRef<T>',
   'export const Probe = memo(() => {\n  if (x) { return null; }\n  const r = React.useRef<HTMLDivElement | null>(null);\n  return null;\n});\n', [3]],
  ['CLEAN - returns only inside callbacks must not count',
   'export function Probe() {\n  const cb = useCallback(() => { if (a) return 1; return 2; }, []);\n  useEffect(() => { return () => {}; }, []);\n  const v = useMemo<number>(() => { return 3; }, []);\n  return null;\n}\n', []],
];
for (const [label, src, expected] of SYNTHETIC) {
  const got = analyseSource(src, 'probe.tsx').flatMap(f => f.hooksAfter);
  if (JSON.stringify(got) !== JSON.stringify(expected)) failures.push(`synthetic "${label}": expected hooks at [${expected}], saw [${got}]`);
}

const argFiles = process.argv.slice(2);
const walk = dir => readdirSync(dir).flatMap(f => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : p.endsWith('.tsx') ? [p] : [];
});
const files = (argFiles.length ? argFiles : walk('src')).sort();

// A real probe in every real component that has an early return with code after it: insert a
// typed hook on the line below the returning statement, prove the line is there, prove it is seen.
const PROBE = '  const __hooksGuardProbe = useState<number>(0);';
let probes = 0;
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  for (const f of analyseSource(src, file)) {
    if (!f.early || f.isLast) continue;
    const lines = src.split('\n');
    const at = f.early.endLine;                       // 0-based index of the line after the statement
    const mutated = [...lines.slice(0, at), PROBE, ...lines.slice(at)].join('\n');
    if (mutated.split('\n')[at] !== PROBE) { failures.push(`${file} ${f.name}(): probe line not where it was inserted`); continue; }
    probes++;
    const seen = analyseSource(mutated, file).find(x => x.name === f.name)?.hooksAfter ?? [];
    if (!seen.includes(at + 1)) failures.push(`${file} ${f.name}(): probe below the return at line ${f.early.returnLine} was NOT caught`);
  }
}

console.log('\nHOOKS AFTER AN EARLY RETURN — component bodies only\n');
if (failures.length) {
  console.log('  SELF-TEST FAILED - the guard cannot see what it checks, so a clean result would mean nothing:\n');
  failures.forEach(f => console.log(`    ${f}`));
  console.log('');
  process.exit(1);
}
console.log(`  self-test: ${SYNTHETIC.length} synthetic cases and ${probes} probe(s) in real components, all caught\n`);

// ------------------------------------------------------------------------------ the scan
let total = 0;
for (const file of files) {
  for (const f of analyseSource(readFileSync(file, 'utf8'), file)) {
    if (!f.hooksAfter.length) continue;
    total++;
    console.log(`  ${file}  ->  ${f.name}()`);
    console.log(`     early return at line ${f.early.returnLine}`);
    console.log(`     hook(s) after it:    ${f.hooksAfter.join(', ')}`);
  }
}
console.log(total
  ? `\n  ${total} component(s) will throw React #310 on a render that takes the branch.\n`
  : `\n  None in ${files.length} file(s). Every hook runs before any early return.\n`);
process.exit(total ? 1 : 0);
