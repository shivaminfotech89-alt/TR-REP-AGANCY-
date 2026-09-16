// Tests for lib/allotmentInheritance.ts (AUDIT G94). Run with `npm test`.
//
// ⚠ THESE EXIST TO MAKE THE LIST SHRINK-ONLY. The whole argument for an enumerated list over a
// flag or a dated cutoff is that it CANNOT quietly become permanent - adding a tender to it
// fails here, and removing one is the intended direction of travel. Without this file the list
// is just a second code path with a comment asking people to be careful.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LEGACY_QUOTA_ATS,
  LEGACY_QUOTA_ATS_AT_CUTOFF,
  inheritsAgencyQuota,
} from './allotmentInheritance';

test('⚠⚠ THE LIST MAY ONLY SHRINK - no id may be added after the cutoff', () => {
  const frozen = new Set(LEGACY_QUOTA_ATS_AT_CUTOFF);
  for (const id of LEGACY_QUOTA_ATS) {
    assert.ok(
      frozen.has(id),
      `${id} is in LEGACY_QUOTA_ATS but not in the frozen cutoff list. A tender created AFTER `
      + `the rule changed cannot inherit an agency quota - it starts at {} and only letters add. `
      + `If this is a genuine pre-cutoff tender that was missed, that is a data question, not a `
      + `reason to edit the frozen list.`,
    );
  }
});

test('⚠ the list never gets longer than it was at the cutoff', () => {
  assert.ok(
    LEGACY_QUOTA_ATS.length <= LEGACY_QUOTA_ATS_AT_CUTOFF.length,
    `LEGACY_QUOTA_ATS has ${LEGACY_QUOTA_ATS.length} entries, more than the ${LEGACY_QUOTA_ATS_AT_CUTOFF.length} `
    + 'it was allowed to contain. It is a closing list, not a register.',
  );
});

test('no id appears twice - a duplicate hides a removal', () => {
  // Deleting one of two identical entries looks like progress and changes nothing.
  assert.equal(new Set(LEGACY_QUOTA_ATS).size, LEGACY_QUOTA_ATS.length);
  assert.equal(new Set(LEGACY_QUOTA_ATS_AT_CUTOFF).size, LEGACY_QUOTA_ATS_AT_CUTOFF.length);
});

test('a listed tender inherits; anything else does not', () => {
  assert.equal(inheritsAgencyQuota('Unu1F8JR9koc9gamfgfL'), true);
  assert.equal(inheritsAgencyQuota('a-tender-created-tomorrow'), false);
});

test('⚠ a missing id is NOT legacy - "no tender selected" must not inherit a quota', () => {
  // activeAtMaster is null on several screens and an unsaved AT has no id. Both take the new
  // rule: returning true here would let the absence of a tender inherit the agency's map.
  assert.equal(inheritsAgencyQuota(null), false);
  assert.equal(inheritsAgencyQuota(undefined), false);
  assert.equal(inheritsAgencyQuota(''), false);
  assert.equal(inheritsAgencyQuota('   '), false);
});

test('⚠ the finish line is reachable - an empty list means nothing inherits', () => {
  // Stated as a test so the intended end state is written down: when the last tender's letters
  // are entered, this module and its call sites delete.
  const emptyBehaviour = (ids: readonly string[], id: string) => ids.includes(id);
  assert.equal(emptyBehaviour([], 'Unu1F8JR9koc9gamfgfL'), false);
});
