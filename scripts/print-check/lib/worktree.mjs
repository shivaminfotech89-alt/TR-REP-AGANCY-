// THE "BEFORE" SIDE OF A COMPARISON: a detached git worktree of the ref, borrowing the repository's node_modules.
//
// ⚠ THE CLEANUP ORDER IS A PROPERTY OF THIS FILE, NOT OF WHOEVER RUNS IT.
//
// The worktree's node_modules is a LINK to the repository's real node_modules - a junction on Windows, a directory
// symlink elsewhere. Removing the worktree while that link exists hands the removal a path into the repository's
// real packages, and a removal that follows it deletes them. By hand this was done in the right order every time:
// remove the link, confirm the repository's packages are intact, then remove the worktree. Here that order is the
// only one the code has, the link is removed non-recursively and only after proving it IS a link, and before any
// of it is trusted with the repository the same removal is proved on a throwaway link every run.
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO, Refusal } from './env.mjs';

const git = (...args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const REPO_PACKAGE = join(REPO, 'node_modules', 'react', 'package.json');

/** A link, never a copy. A junction needs no elevation on Windows. */
function makeLink(target, path) {
  symlinkSync(target, path, process.platform === 'win32' ? 'junction' : 'dir');
}

/** Removes the link at `path` and nothing it points to. Refuses anything that is not a link. */
function removeLinkOnly(path) {
  if (!lstatSync(path).isSymbolicLink()) {
    throw new Refusal(`${path} is not a link, so it is not removed - removing it could mean removing real files. Nothing was deleted. Remove the worktree by hand, checking it first.`);
  }
  // Non-recursive on purpose: rmdir of a junction removes the junction; it cannot empty the directory it points to.
  if (process.platform === 'win32') rmdirSync(path); else unlinkSync(path);
  if (existsSync(path)) throw new Refusal(`the link at ${path} is still present after removing it. The worktree is left in place.`);
}

/**
 * THE REMOVAL, PROVED ON A THROWAWAY PAIR BEFORE IT IS USED ON THE REPOSITORY'S node_modules.
 * If removing a link ever took its target with it, this fails here, on a sentinel file, and nothing else runs.
 */
export function proveLinkRemoval(scratch) {
  const target = join(scratch, 'link-proof-target');
  const path = join(scratch, 'link-proof-link');
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, 'sentinel'), 'must survive the removal of the link');
  makeLink(target, path);
  if (!existsSync(join(path, 'sentinel'))) throw new Refusal('link proof: the link does not reach its target, so the removal below would be proved on nothing.');
  removeLinkOnly(path);
  if (!existsSync(join(target, 'sentinel'))) throw new Refusal('link proof: REMOVING THE LINK DELETED ITS TARGET. Nothing will be linked to the repository\'s node_modules.');
}

export function createTree(ref, scratch) {
  if (!existsSync(REPO_PACKAGE)) throw new Refusal(`the repository's node_modules is not installed (${REPO_PACKAGE} missing). Run npm install first.`);
  let sha;
  try { sha = git('rev-parse', '--verify', `${ref}^{commit}`); } catch { throw new Refusal(`"${ref}" is not a commit in this repository.`); }
  const path = join(scratch, `tree-${sha.slice(0, 10)}`);
  git('worktree', 'add', '--detach', path, sha);
  const link = join(path, 'node_modules');
  if (existsSync(link)) throw new Refusal(`the worktree at ${path} already has a node_modules - not linking over it.`);
  makeLink(join(REPO, 'node_modules'), link);
  return { ref, sha, path, link };
}

/** 1 the link, 2 the repository's packages checked, 3 the worktree, 4 prune, 5 the packages checked again. */
export function removeTree(tree) {
  if (existsSync(tree.link) || isDanglingLink(tree.link)) removeLinkOnly(tree.link);
  if (!existsSync(REPO_PACKAGE)) throw new Refusal(`THE REPOSITORY'S node_modules IS DAMAGED - ${REPO_PACKAGE} is missing. The worktree at ${tree.path} was NOT removed.`);
  git('worktree', 'remove', '--force', tree.path);
  git('worktree', 'prune');
  if (!existsSync(REPO_PACKAGE)) throw new Refusal(`THE REPOSITORY'S node_modules IS DAMAGED after removing the worktree - ${REPO_PACKAGE} is missing.`);
}

function isDanglingLink(path) {
  try { return lstatSync(path).isSymbolicLink(); } catch { return false; }
}
