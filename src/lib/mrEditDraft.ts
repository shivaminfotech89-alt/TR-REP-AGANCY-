/**
 * THE EDIT DIALOG'S COPY OF A STORED JOB - AND THE CONTRACT IT HAS TO KEEP (AUDIT G111).
 *
 * `MrLedger` opens Full Edit by mapping each stored job into a smaller draft object. That mapping is a hand-written
 * field list, and **a field left out of it does not read as missing - it reads as absent from the data.**
 *
 * ⚠⚠ THAT IS EXACTLY WHAT HAPPENED. `atId` was not in the list, so every job the gate saw had no tender, so
 * `atForEditingMr` answered "none of its N transformer(s) carries one" for **every MR in the app** - including MRs
 * whose jobs all carry a valid, Active, same-agency AT. ADMIN's MR 45645 was reported on exactly that basis, and
 * its one job holds `atId` pointing at an Active ADMIN tender.
 *
 * ⚠ AND THE CAST IS WHAT HID IT. The gate read `(j as any).atId`. That compiled, returned `undefined` every time,
 * and **without the cast TypeScript would have refused it** - the draft type has no `atId`. So the cast was not
 * working around a type error; it was manufacturing one that could not be seen. See the note in AUDIT.
 *
 * So the field list is declared here, once, as a checked contract rather than a literal in a JSX callback:
 * `DRAFT_JOB_FIELDS` is what a draft must carry, the type says so, and a test asserts that every field the gate and
 * the save read off a draft is in it. A field added to either consumer without being added here now fails a test
 * instead of silently reading `undefined`.
 */

/**
 * Every field the edit dialog must carry from the stored job, because something downstream reads it.
 *
 * ⚠ ADDING A READ IN `MrLedger` MEANS ADDING THE NAME HERE. The test derives the consumers' reads from source and
 * requires them to be a subset of this list; that is the general form of the defect this file exists for, not just
 * the `atId` instance of it.
 */
export const DRAFT_JOB_FIELDS = [
  'id', 'jobNo', 'capacityKva', 'make', 'serialNo', 'coreType', 'status',
  'division', 'repairType', 'prevAtNo', 'prevJobNo', 'prevDeliveryDate', 'gpReason',
  'isNew', 'isCancelled',
  /** ⚠ READ ONLY BY THE GATE, WHICH IS WHY IT WAS THE ONE TO GO MISSING - nothing else in the save touches it. */
  'atId',
] as const;

export type DraftJobField = typeof DRAFT_JOB_FIELDS[number];

/** The draft the dialog edits. `atId` is a real field here, so reading it needs no cast. */
export interface MrEditJob {
  id?: string;
  jobNo: string;
  capacityKva: string;
  make: string;
  serialNo: string;
  coreType: string;
  status: string;
  division: string;
  repairType: string;
  prevAtNo: string;
  prevJobNo: string;
  prevDeliveryDate: string;
  gpReason: string;
  isNew: boolean;
  isCancelled: boolean;
  /** The tender this job was booked under, carried through so the gate can resolve the MR's AT from its own jobs. */
  atId: string;
}

/**
 * One stored job as the dialog edits it.
 *
 * `isCancelled` is derived rather than copied - a job is cancelled by either field, and the dialog needs one answer.
 * `isNew` is false by construction: a draft built from a stored job is not a new row.
 */
export function mrEditJob(job: any): MrEditJob {
  return {
    id: job?.id,
    jobNo: job?.jobNo ?? '',
    capacityKva: String(job?.capacityKva || '63'),
    make: job?.make || '',
    serialNo: job?.serialNo || '',
    coreType: job?.coreType || 'CRGO',
    status: job?.status || 'Received',
    // Each job's OWN values, so the save has something to write that is not the group's sampled one (AUDIT G11).
    division: job?.division ?? '',
    repairType: job?.repairType ?? '',
    prevAtNo: job?.prevAtNo || '',
    prevJobNo: job?.prevJobNo || '',
    prevDeliveryDate: job?.prevDeliveryDate || '',
    gpReason: job?.gpReason || '',
    isNew: false,
    isCancelled: job?.status === 'Cancelled' || job?.isCancelled === true,
    // ⚠ '' WHEN ABSENT, NOT undefined. The gate distinguishes "no AT on any job" from "one AT and some blanks", and
    // both arms test a trimmed string - an undefined here would work by luck rather than by contract.
    atId: String(job?.atId ?? '').trim(),
  };
}
