import { useState, useEffect, useMemo } from 'react';
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  doc, 
  updateDoc, 
  deleteDoc, 
  setDoc,
  writeBatch,
  runTransaction
} from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { useAgency, highWaterJobNos, atClause, isUnassigned, isIntakeOpen } from '../lib/AgencyContext';
import { issuedMarks } from '../lib/issuedDocuments.js';
import { inspectionsForJob } from '../lib/inspectionLink.js';
import { 
  Loader2, 
  Search, 
  ChevronDown, 
  ChevronRight, 
  Edit, 
  FileSpreadsheet, 
  Building2, 
  Filter, 
  Plus, 
  Trash2, 
  Save, 
  X, 
  CheckCircle2, 
  AlertCircle, 
  Calendar, 
  Hash, 
  Layers, 
  ShieldCheck, 
  Sparkles,
  AlertTriangle,
  RotateCcw,
  BookOpen,
  Ban,
  XCircle,
  Check
} from 'lucide-react';
import { Link } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { formatDDMMYYYY, byDateDesc } from '../lib/utils';

interface Job {
  id: string;
  mrNo: string;
  dateOfIssue: string;
  jobNo: string;
  capacityKva: number;
  make: string;
  serialNo: string;
  coreType?: string;
  status: string;
  repairType: string;
  division: string;
  prevAtNo?: string;
  prevJobNo?: string;
  prevDeliveryDate?: string;
  gpReason?: string;
  createdAt?: any;
  updatedAt?: any;
  isClosed?: boolean;
  isCancelled?: boolean;
  mrStatus?: string;
  cancelledAt?: string | null;
}

interface MrGroup {
  mrNo: string;
  dateOfIssue: string;
  division: string;
  repairType: string;
  isCancelled?: boolean;
  cancelledAt?: string | null;
  jobs: Job[];
}

interface EditableJobEntry {
  id?: string; // empty if new
  jobNo: string;
  capacityKva: string;
  make: string;
  serialNo: string;
  coreType: string;
  status: string;
  /**
   * THE JOB'S OWN DIVISION AND REPAIR TYPE (AUDIT G11).
   *
   * ⚠ CARRIED SO THE SAVE CAN STAMP EACH JOB WITH ITS OWN VALUE. They were absent, so the
   * save had nothing to write but the MR-level field - which is sampled from the FIRST job -
   * and every job on the MR was overwritten with it. `repairType` decides whether work is
   * charged; `division` decides the job-number prefix, the forwarding-letter address and the
   * per-division oil split (F86).
   *
   * Undefined on a NEW row, which is correct: a row the operator just added has no value of
   * its own, so it takes the MR-level one. That is the only case where the MR-level field is
   * the right source.
   */
  division?: string;
  repairType?: string;
  prevAtNo?: string;
  prevJobNo?: string;
  prevDeliveryDate?: string;
  gpReason?: string;
  isNew?: boolean;
  isCancelled?: boolean;
}

interface MrEditState {
  originalMrNo: string;
  mrNo: string;
  dateOfIssue: string;
  division: string;
  repairType: string;
  isCancelled?: boolean;
  jobs: EditableJobEntry[];
  deletedJobIds: string[];
}

const COMMON_KVA_OPTIONS = ['10', '16', '25', '63', '100', '200', '250', '315', '500'];
const JOB_STATUSES = ['Received', 'Internal Inspected', 'Tested / OK', 'Dispatched', 'Scrap / Unrepairable', 'Under Repair', 'Cancelled'];

export default function MrLedger() {
  const { activeAgency, activeAtMaster, atMasters, getJobNoPrefix, viewingAllTenders } = useAgency();
  const [loading, setLoading] = useState(true);
  /**
   * WORK THAT BELONGS TO NO TENDER (AUDIT F82).
   *
   * Every screen now shows the active AT's work, and a job with no `atId` matches no tender
   * and appears under none. That is correct and it is also how a paid invoice disappears:
   * MSBT-12 is estimated, billed AND paid, and carries no atId.
   *
   * A filter working exactly as written while the thing it is about vanishes is the shape
   * this audit has recorded five times in checks. So unassigned work is not hidden - it is
   * surfaced HERE, as a backlog, reachable and countable, until someone attributes it.
   *
   * ⚠ IT CANNOT BE ATTRIBUTED AUTOMATICALLY. All twelve unassigned jobs sit on MRs where NO
   * job names a tender, so there is nothing to infer from - scripts/admin/assign-at.js
   * refuses all twelve for exactly that reason. Each needs a human with the MR paperwork.
   */
  /**
   * ADDING A UNIT CREATES NEW WORK, so it obeys the same gate as New Job (AUDIT F83).
   * Editing the units already on an MR does not, and is untouched: a transformer received
   * under a tender is finished under it.
   */
  const intakeGate = useMemo(
    () => isIntakeOpen(activeAtMaster, atMasters.filter(t => t.agencyId === activeAgency?.id), viewingAllTenders),
    [activeAtMaster, atMasters, activeAgency?.id],
  );

  const [unassignedJobs, setUnassignedJobs] = useState<any[]>([]);
  const [showUnassigned, setShowUnassigned] = useState(false);

  useEffect(() => {
    if (!auth.currentUser || !activeAgency) { setUnassignedJobs([]); return; }
    let cancelled = false;
    (async () => {
      try {
        // ⚠ AGENCY-WIDE READ, FILTERED IN MEMORY — AND IT CANNOT BE A QUERY (AUDIT F87).
        //
        // This was `where('atId','==','')`, which found 4 of the 12. Firestore equality does
        // not match a document whose field is ABSENT, and 8 of the 12 predate the field
        // entirely - including MSBT-12, the estimated, billed and PAID job this banner exists
        // to keep reachable. It reported a plausible wrong count for a fortnight, which is
        // worse than reporting none: a banner reading "4 jobs belong to no tender" asserts
        // that four is the number, and nobody re-counts an answer that looks like one.
        //
        // There is no query that fixes it. Firestore has no "field is missing" predicate, so
        // "unassigned" cannot be expressed as a filter at all - it can only be recognised
        // after reading, where `isUnassigned` treats absent and empty alike. The cost is one
        // agency-wide read; the alternative is a number that is quietly wrong.
        const snap = await getDocs(query(
          collection(db, 'jobs'),
          where('ownerId', '==', auth.currentUser!.uid),
          where('agencyId', '==', activeAgency.id),
        ));
        const rows = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(isUnassigned);
        if (!cancelled) setUnassignedJobs(rows);
      } catch {
        // A failed read must not be reported as "none" - that is the same lie as hiding them.
        if (!cancelled) setUnassignedJobs([]);
      }
    })();
    return () => { cancelled = true; };
  }, [activeAgency?.id, auth.currentUser?.uid]);

  const [mrGroups, setMrGroups] = useState<MrGroup[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDivision, setSelectedDivision] = useState<string>('All');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'CANCELLED'>('ALL');
  const [expandedMrs, setExpandedMrs] = useState<Set<string>>(new Set());
  
  // Notification Toast
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Full MR Edit Modal State
  const [editingMr, setEditingMr] = useState<MrEditState | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  
  // Cancel MR State
  const [cancelConfirmMr, setCancelConfirmMr] = useState<MrGroup | null>(null);
  const [isCancellingMr, setIsCancellingMr] = useState(false);
  
  // Reactivate MR State
  const [reactivateConfirmMr, setReactivateConfirmMr] = useState<MrGroup | null>(null);
  const [isReactivatingMr, setIsReactivatingMr] = useState(false);

  const fetchJobs = async () => {
    if (!auth.currentUser || !activeAgency) {
      setMrGroups([]);
      setLoading(false);
      return;
    }
    
    try {
      const q = query(
        // ⚠ THE ACTIVE TENDER (AUDIT F82). A new AT starts fresh - no MRs, no jobs, no
        // estimates, bills, challans or testing carry over - so every screen shows the work
        // of the AT selected in the top bar, exactly as it already shows only the active
        // agency's. Unassigned work (no atId) matches no tender and is reached through the
        // unassigned view instead: it is not lost, and it is not pretended to belong here.
        collection(db, 'jobs'),
        where('ownerId', '==', auth.currentUser.uid),
        where('agencyId', '==', activeAgency.id),
        ...atClause(activeAtMaster, viewingAllTenders),
      );
      const snapshot = await getDocs(q);
      const fetchedJobs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Job));
      
      // Group by MR No
      const groups: Record<string, MrGroup> = {};
      fetchedJobs.forEach(job => {
        const mrKey = job.mrNo || 'UNKNOWN-MR';
        if (!groups[mrKey]) {
          groups[mrKey] = {
            mrNo: job.mrNo,
            dateOfIssue: job.dateOfIssue || '',
            division: job.division || 'Unknown',
            repairType: job.repairType || 'OGP',
            isCancelled: false,
            jobs: []
          };
        }
        groups[mrKey].jobs.push(job);
      });

      // Mark MR as cancelled if all its jobs are marked Cancelled
      Object.values(groups).forEach(g => {
        g.isCancelled = g.jobs.length > 0 && g.jobs.every(j => j.status === 'Cancelled' || j.isCancelled === true || j.mrStatus === 'Cancelled');
      });
      
      // Sort MRs by date (newest first)
      const sortedGroups = [...Object.values(groups)].sort(byDateDesc((g: any) => g.dateOfIssue));
      
      setMrGroups(sortedGroups);
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'jobs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
  }, [activeAgency]);

  // Extract unique divisions for filter
  const divisions = useMemo(() => {
    const set = new Set<string>();
    mrGroups.forEach(g => {
      if (g.division && g.division.trim()) set.add(g.division.trim());
    });
    if (activeAgency?.prefixes) {
      Object.keys(activeAgency.prefixes).forEach(div => set.add(div));
    }
    if (activeAtMaster?.prefixes) {
      Object.keys(activeAtMaster.prefixes).forEach(div => set.add(div));
    }
    return Array.from(set).sort();
  }, [mrGroups, activeAgency, activeAtMaster]);

  const activeCount = useMemo(() => mrGroups.filter(g => !g.isCancelled).length, [mrGroups]);
  const cancelledCount = useMemo(() => mrGroups.filter(g => g.isCancelled).length, [mrGroups]);

  const toggleExpand = (mrNo: string) => {
    setExpandedMrs(prev => {
      const newSet = new Set(prev);
      if (newSet.has(mrNo)) {
        newSet.delete(mrNo);
      } else {
        newSet.add(mrNo);
      }
      return newSet;
    });
  };

  // Open Full MR Edit Modal
  const handleOpenFullMrEdit = (group: MrGroup) => {
    setEditingMr({
      originalMrNo: group.mrNo,
      mrNo: group.mrNo,
      dateOfIssue: group.dateOfIssue,
      division: group.division,
      repairType: group.repairType || 'OGP',
      isCancelled: group.isCancelled,
      jobs: group.jobs.map(j => ({
        id: j.id,
        jobNo: j.jobNo,
        capacityKva: String(j.capacityKva || '63'),
        make: j.make || '',
        serialNo: j.serialNo || '',
        coreType: j.coreType || 'CRGO',
        status: j.status || 'Received',
        // Each job's OWN values, so the save has something to write that is not the group's
        // sampled one (AUDIT G11).
        division: j.division,
        repairType: j.repairType,
        prevAtNo: j.prevAtNo || '',
        prevJobNo: j.prevJobNo || '',
        prevDeliveryDate: j.prevDeliveryDate || '',
        gpReason: j.gpReason || '',
        isNew: false,
        isCancelled: j.status === 'Cancelled' || j.isCancelled === true
      })),
      deletedJobIds: []
    });
  };

  /**
   * The AT this MR belongs to, read from its own jobs - never from the session (F66).
   */
  const atForEditingMr = (): { atId: string } | { error: string } => {
    if (!editingMr) return { error: 'No MR is open.' };
    const ids = [...new Set(editingMr.jobs.map(j => String((j as any).atId ?? '').trim()).filter(Boolean))];
    const without = editingMr.jobs.filter(j => !String((j as any).atId ?? '').trim()).length;

    if (ids.length === 1 && without === 0) return { atId: ids[0] };
    if (ids.length === 0) {
      return { error: `MR ${editingMr.mrNo} does not record which AT it was issued under - none of its ${editingMr.jobs.length} transformer(s) carries one.

A transformer added now would have to take its job number and AT percentage from whichever AT is selected today, which may not be the tender this MR belongs to. Set the AT on the existing jobs first.` };
    }
    if (ids.length === 1) {
      return { error: `MR ${editingMr.mrNo} is partly unstamped - ${without} of its ${editingMr.jobs.length} transformer(s) carry no AT.

The AT is known from the others, but adding a transformer while the MR disagrees with itself would spread the inconsistency. Set the AT on those jobs first.` };
    }
    return { error: `MR ${editingMr.mrNo} has transformers under ${ids.length} DIFFERENT ATs.

An MR belongs to one tender. Until that is resolved there is no single sequence to draw a job number from, and no single percentage to price a new transformer at.` };
  };

  // Add new transformer row to editing MR
  const handleAddTransformerToMr = () => {
    if (!editingMr) return;

    /**
     * ⚠ THE GATE IS IN THE HANDLER, NOT ONLY ON THE BUTTON (AUDIT G3).
     *
     * The control at the bottom of this modal is already hidden when the tender is closed to
     * new work - but hiding a control is what the operator SEES, and this is what HAPPENS.
     * The handler checked `atForEditingMr()`, which answers a different question: whether the
     * MR's jobs agree on a tender, not whether that tender still accepts new work.
     *
     * So the F83 rule was enforced by a `{intakeGate.open ? …}` in the JSX and by nothing
     * else - the exact arrangement OilInward rejects three files away, with a comment saying
     * so. Adding a unit to an old MR while its tender is closed is intake, and intake is what
     * that rule refuses.
     */
    if (!intakeGate.open) {
      setNotification({
        type: 'error',
        message: `No new units can be added: ${intakeGate.reason} The units already on this MR can still be edited.`,
      });
      return;
    }

    const lastJob = editingMr.jobs[editingMr.jobs.length - 1];
    const coreType = lastJob?.coreType || 'CRGO';
    const capacityKva = lastJob?.capacityKva || '63';

    // CONTINUE FROM THE HIGHEST ACTIVE NUMBER SAVED ON THIS MR (AUDIT F70).
    // Cancelled jobs are excluded so their numbers are reused.
    let nextJobNo = '';
    if (activeAgency && editingMr.repairType !== 'GP') {
      const at = atForEditingMr();
      if ('error' in at) {
        setNotification({ type: 'error', message: at.error });
        return;
      }
      const { prefix } = getJobNoPrefix(editingMr.division, coreType, at.atId);
      if (prefix) {
        const head = `${prefix.toUpperCase()}-`;
        const tailOf = (v: unknown): number => {
          const raw = String(v ?? '').trim().toUpperCase();
          if (!raw.startsWith(head)) return 0;
          const n = Number(raw.slice(head.length));
          return Number.isFinite(n) && n > 0 ? n : 0;
        };

        const onThisMr = editingMr.jobs
          .filter(j => j.status !== 'Cancelled' && !j.isCancelled && (editingMr.repairType || '').toUpperCase() !== 'GP')
          .reduce((m, j) => Math.max(m, tailOf(j.jobNo)), 0);

        const inAgency = mrGroups
          .filter(g => !g.isCancelled && (g.repairType || '').toUpperCase() !== 'GP')
          .reduce(
            (m, g) => g.jobs
              .filter(j => j.status !== 'Cancelled' && !j.isCancelled && (j.repairType || '').toUpperCase() !== 'GP' && !(j as any).isGp)
              .reduce((n, j) => Math.max(n, tailOf((j as any).jobNo)), m), 0);

        const base = onThisMr > 0 ? onThisMr : inAgency;
        nextJobNo = `${prefix}-${base + 1}`;
      }
    }

    setEditingMr(prev => {
      if (!prev) return null;
      return {
        ...prev,
        jobs: [
          ...prev.jobs,
          {
            jobNo: nextJobNo,
            capacityKva: capacityKva,
            make: lastJob?.make || '',
            serialNo: '',
            coreType: coreType,
            status: 'Received',
            prevAtNo: lastJob?.prevAtNo || '',
            prevJobNo: '',
            prevDeliveryDate: lastJob?.prevDeliveryDate || '',
            gpReason: lastJob?.gpReason || '',
            isNew: true,
            isCancelled: false
          }
        ]
      };
    });
  };

  // Remove transformer from editing MR
  const handleRemoveTransformerFromMr = (index: number) => {
    if (!editingMr) return;
    const targetJob = editingMr.jobs[index];
    
    setEditingMr(prev => {
      if (!prev) return null;
      const updatedJobs = prev.jobs.filter((_, i) => i !== index);
      const updatedDeletedIds = targetJob.id && !targetJob.isNew 
        ? [...prev.deletedJobIds, targetJob.id] 
        : prev.deletedJobIds;

      return {
        ...prev,
        jobs: updatedJobs,
        deletedJobIds: updatedDeletedIds
      };
    });
  };

  // Handle changes to individual job row in MR Edit Modal
  const handleJobFieldChange = (index: number, field: keyof EditableJobEntry, value: string) => {
    if (!editingMr) return;
    setEditingMr(prev => {
      if (!prev) return null;
      const newJobs = [...prev.jobs];
      newJobs[index] = { ...newJobs[index], [field]: value };
      return { ...prev, jobs: newJobs };
    });
  };

  // Save Full MR Updates to Firestore
  const handleSaveFullMr = async () => {
    if (!editingMr || !auth.currentUser || !activeAgency) return;

    /**
     * ⚠ THE SAME GUARD THE ADD-UNIT BUTTON USES, ON THE PATH THAT ACTUALLY WRITES (AUDIT G2).
     *
     * `handleAddTransformerToMr` calls `atForEditingMr()` and refuses when the MR's own jobs
     * do not agree on a tender. This function - which creates jobs in a batch a few lines
     * below - did not, and fell back to `activeAtMaster ? activeAtMaster.id : ''`.
     *
     * ⚠ THE WRONG-TENDER CASE IS WORSE THAN THE EMPTY ONE. An empty `atId` is findable: it
     * shows in the unassigned backlog and every census counts it. A job stamped with TODAY'S
     * tender on another tender's MR looks correct everywhere and prices from the wrong rate
     * schedule and the wrong AT percentage - the exact failure F72 exists to prevent.
     *
     * The MR's own jobs are the authority, never the session (F66). If they cannot say which
     * tender this MR belongs to, that is a question for a person with the paperwork, not a
     * default for the app to pick.
     */
    const mrAt = atForEditingMr();
    if ('error' in mrAt) {
      alert(mrAt.error);
      return;
    }

    if (!editingMr.mrNo.trim()) {
      alert('MR Number cannot be empty.');
      return;
    }

    if (editingMr.jobs.length === 0) {
      alert('MR must contain at least one transformer.');
      return;
    }

    // Check for empty required fields
    for (let i = 0; i < editingMr.jobs.length; i++) {
      const j = editingMr.jobs[i];
      if (!j.jobNo.trim()) {
        alert(`Transformer #${i + 1} has an empty Job Number.`);
        return;
      }
      if (!j.capacityKva || isNaN(Number(j.capacityKva))) {
        alert(`Transformer #${i + 1} has an invalid KVA capacity.`);
        return;
      }
    }

    /**
     * ⚠ A REMOVED ROW CANNOT TAKE AN ISSUED DOCUMENT WITH IT (AUDIT G3).
     *
     * This loop deletes every job the operator removed from the edit modal, and it checked
     * NOTHING. A job carrying a bill, an estimate, a payment or a challan was destroyed by
     * taking its row out of a form - and `issuedByAgencyId` lives on that document (O14), so
     * the delete removes the only record of WHAT was billed, TO whom, and BY which agency.
     *
     * O33 recorded this gap against `handleDeleteEntireMr` and named only that function. The
     * gap had TWO sites; this is the one the entry did not name, which is how it survived a
     * fix aimed at the other. `scripts/admin/delete-unassigned.js` has refused exactly this
     * since it was written - a script guarding what the UI did freely.
     *
     * ⚠ SAME TEST AS THE SCRIPT, NOT A SECOND ONE - src/lib/issuedDocuments.js is imported by
     * both. A guard that agrees with its script only by coincidence is the F87 shape.
     *
     * It REFUSES rather than warns. Deletion has no undo, and the operator can clear those
     * fields first if the document really was never issued.
     */
    const blockedDeletes = editingMr.deletedJobIds
      .map(id => {
        const job = (editingMr.jobs as any[]).find((j: any) => j.id === id);
        return job ? { job, marks: issuedMarks(job) } : null;
      })
      .filter((x: any) => x && x.marks.length > 0) as { job: any; marks: string[] }[];

    if (blockedDeletes.length > 0) {
      const lines = blockedDeletes.map(
        b => `${b.job.jobNo || '(no job number)'} — ${b.marks.join(', ')}`,
      );
      alert([
        `Cannot remove ${blockedDeletes.length} transformer(s) from MR ${editingMr.mrNo}: they carry documents that have left the agency.`,
        '',
        ...lines,
        '',
        'Deleting these would remove the only record of what was billed, to whom, and by which agency. Put the row(s) back, or clear those fields first if nothing was issued.',
      ].join('\n'));
      return;
    }

    /**
     * ⚠ A DELETED JOB TAKES ITS INSPECTIONS WITH IT, AND SAYS HOW MANY (AUDIT G4).
     *
     * `inspections` is the only collection holding a `jobId`, and nothing deleted them - O33's
     * second gap. The orphan is not merely untidy: `jobId` is the ONLY link, so an inspection
     * whose job is gone is unreachable by any screen, script or census. Dead weight that every
     * later reader has to recognise and explain away.
     *
     * ⚠ THE REASON FOR CASCADING IS SPECIFIC, NOT GENERAL, AND THE COUNTERFACTUAL MATTERS.
     * Cascade is right HERE BECAUSE the orphan cannot be reached. Had inspections carried
     * `mrNo` - as the matcher wrongly assumed for months - the opposite would follow: the
     * orphan would still be findable by MR, deleting it would destroy measured facts about a
     * physical transformer (oil capacity, less oil, winding damage) recorded nowhere else, and
     * re-creating a job with the same number would re-link it, which is right for a typo
     * correction and wrong for a different transformer. Do not read "delete the children" as
     * the rule; read "an unreachable record is not evidence".
     *
     * THE COUNT IS NAMED BEFORE IT HAPPENS. O33's complaint about the other delete path was a
     * dialog "that names the jobs and not the inspections, and gives no count of what it
     * leaves" - so this one gives the count of what it takes.
     */
    let inspectionsToDelete: string[] = [];
    if (editingMr.deletedJobIds.length > 0) {
      try {
        const inspSnap = await getDocs(query(
          collection(db, 'inspections'),
          where('ownerId', '==', auth.currentUser.uid),
        ));
        const allInsp = inspSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
        const removedJobs = (editingMr.jobs as any[]).filter(j => editingMr.deletedJobIds.includes(j.id));
        inspectionsToDelete = [...new Set(
          removedJobs.flatMap(j => inspectionsForJob(j, allInsp).map((i: any) => i.id)),
        )];
      } catch {
        // ⚠ A FAILED READ ABORTS THE SAVE. Committing the job deletions without knowing what
        // they strand is the exact outcome this guard exists to prevent.
        alert('Could not check which inspections belong to the removed transformer(s). Nothing was saved — try again.');
        return;
      }

      if (inspectionsToDelete.length > 0) {
        const ok = window.confirm([
          `Removing ${editingMr.deletedJobIds.length} transformer(s) will also delete ${inspectionsToDelete.length} inspection record(s) attached to them.`,
          '',
          'An inspection is reached only through its job, so leaving them behind would make them unreachable rather than preserving them.',
          '',
          'This cannot be undone. Continue?',
        ].join('\n'));
        if (!ok) return;
      }
    }

    setIsSavingEdit(true);
    try {
      const batch = writeBatch(db);
      const now = Date.now();

      // 1. Delete removed jobs — every one already cleared the issued-document guard above.
      for (const delId of editingMr.deletedJobIds) {
        const docRef = doc(db, 'jobs', delId);
        batch.delete(docRef);
      }

      // 1b. …and their inspections, in the SAME batch. A separate write could leave a job
      //     deleted with its inspections intact, which is the orphan state by another route.
      for (const inspId of inspectionsToDelete) {
        batch.delete(doc(db, 'inspections', inspId));
      }

      // 2. Update existing or insert new jobs
      for (const j of editingMr.jobs) {
        const isJobCancelled = j.status === 'Cancelled' || j.isCancelled === true;
        if (j.id && !j.isNew) {
          // Existing Job update
          const docRef = doc(db, 'jobs', j.id);
          batch.update(docRef, {
            mrNo: editingMr.mrNo.trim(),
            dateOfIssue: editingMr.dateOfIssue,
            // ⚠ THE JOB'S OWN VALUES, NEVER THE MR HEADER'S (AUDIT G11). This read
            // `editingMr.division` / `editingMr.repairType`, which are sampled from the FIRST
            // job of the group and never revisited - so opening an MR in Full Edit and pressing
            // Save stamped every job with the first job's values and set `isGp` to match.
            //
            // On a mixed MR that is not a wrong label, it is a SILENT REWRITE: a GP job among
            // OGP ones became OGP, losing the record that it was repaired under guarantee at no
            // cost, for an operator who opened the modal to fix a serial number.
            //
            // The fallback is for a row with no value of its own - i.e. one just added - and
            // that is the only case where the MR-level control is the right source.
            division: j.division ?? editingMr.division,
            repairType: j.repairType ?? editingMr.repairType,
            isGp: (j.repairType ?? editingMr.repairType) === 'GP',
            jobNo: j.jobNo.trim(),
            capacityKva: Number(j.capacityKva),
            make: j.make.trim().toUpperCase(),
            serialNo: j.serialNo.trim().toUpperCase(),
            coreType: j.coreType,
            status: j.status,
            isCancelled: isJobCancelled,
            mrStatus: isJobCancelled ? 'Cancelled' : 'Active',
            prevAtNo: j.prevAtNo || '',
            prevJobNo: j.prevJobNo || '',
            prevDeliveryDate: j.prevDeliveryDate || '',
            gpReason: j.gpReason || '',
            updatedAt: now
          });
        } else {
          // New Job creation
          const newDocRef = doc(collection(db, 'jobs'));
          batch.set(newDocRef, {
            mrNo: editingMr.mrNo.trim(),
            dateOfIssue: editingMr.dateOfIssue,
            // Same rule as the update branch above (AUDIT G11). A new row genuinely has no
            // values of its own, so here the MR-level control is the correct source - but it
            // is written through the same expression so the two branches cannot drift.
            division: j.division ?? editingMr.division,
            repairType: j.repairType ?? editingMr.repairType,
            isGp: (j.repairType ?? editingMr.repairType) === 'GP',
            type: 'Distribution',
            jobNo: j.jobNo.trim(),
            capacityKva: Number(j.capacityKva),
            make: j.make.trim().toUpperCase(),
            serialNo: j.serialNo.trim().toUpperCase(),
            coreType: j.coreType || 'CRGO',
            status: j.status || 'Received',
            isCancelled: isJobCancelled,
            mrStatus: isJobCancelled ? 'Cancelled' : 'Active',
            isClosed: false,
            // ⚠ `activeAtMaster` DOES NOT APPEAR HERE (AUDIT G2). `mrAt` is resolved from the
            // MR's own jobs at the top of this function, and the save refuses if they cannot
            // agree - so there is no case left in which a fallback would be consulted, and no
            // expression for a later edit to widen back into one.
            atId: mrAt.atId,
            prevAtNo: j.prevAtNo || '',
            prevJobNo: j.prevJobNo || '',
            prevDeliveryDate: j.prevDeliveryDate || '',
            gpReason: j.gpReason || '',
            createdAt: now,
            updatedAt: now,
            ownerId: auth.currentUser.uid,
            agencyId: activeAgency.id
          });
        }
      }

      await batch.commit();

      // ADVANCE THE COUNTER TO WHAT WAS ACTUALLY SAVED (ACTIVE JOBS ONLY)
      if (editingMr.repairType !== 'GP') {
        // Resolved once at the top of this function - the save cannot have reached here with
        // an unresolved AT, so this no longer re-derives it (AUDIT G2).
        const at = mrAt;
        if (!('error' in at)) {
          const activeJobs = editingMr.jobs.filter(j => j.status !== 'Cancelled' && !j.isCancelled);
          const highWater = highWaterJobNos(activeJobs, editingMr.division);
          if (Object.keys(highWater).length > 0) {
            try {
              const atRef = doc(db, 'atMasters', at.atId);
              await runTransaction(db, async (tx) => {
                const snap = await tx.get(atRef);
                if (!snap.exists()) return;
                const counters: Record<string, number> = { ...((snap.data() as any)?.lastJobNumbers || {}) };
                let changed = false;
                for (const [key, num] of Object.entries(highWater)) {
                  if (num > (Number(counters[key]) || 0)) { counters[key] = num; changed = true; }
                  if (key.endsWith('_CRGO') && num > (Number(counters[editingMr.division]) || 0)) {
                    counters[editingMr.division] = num; changed = true;
                  }
                }
                if (changed) tx.update(atRef, { lastJobNumbers: counters });
              });
            } catch (counterErr) {
              console.error('MR saved, but the job-number counter could not be advanced:', counterErr);
            }
          }
        }
      }

      setNotification({
        type: 'success',
        message: `✓ MR #${editingMr.mrNo} and all ${editingMr.jobs.length} transformer records updated successfully!`
      });
      setTimeout(() => setNotification(null), 5000);

      setEditingMr(null);
      await fetchJobs();
    } catch (err) {
      console.error('Error saving full MR edit:', err);
      handleFirestoreError(err, OperationType.UPDATE, 'jobs');
      setNotification({
        type: 'error',
        message: 'Failed to update MR: ' + (err instanceof Error ? err.message : String(err))
      });
    } finally {
      setIsSavingEdit(false);
    }
  };

  // Cancel entire MR (releases job numbers for reuse and blocks downstream processing)
  const handleCancelEntireMr = async () => {
    if (!cancelConfirmMr || !auth.currentUser || !activeAgency) return;
    
    setIsCancellingMr(true);
    try {
      const batch = writeBatch(db);
      const nowIso = new Date().toISOString();
      const nowTime = Date.now();
      for (const j of cancelConfirmMr.jobs) {
        const docRef = doc(db, 'jobs', j.id);
        batch.update(docRef, {
          status: 'Cancelled',
          isCancelled: true,
          mrStatus: 'Cancelled',
          cancelledAt: nowIso,
          updatedAt: nowTime
        });
      }
      await batch.commit();

      setNotification({
        type: 'success',
        message: `✓ MR #${cancelConfirmMr.mrNo} cancelled. All ${cancelConfirmMr.jobs.length} transformer job numbers released for reuse.`
      });
      setTimeout(() => setNotification(null), 6000);

      setCancelConfirmMr(null);
      if (editingMr?.originalMrNo === cancelConfirmMr.mrNo) {
        setEditingMr(null);
      }
      await fetchJobs();
    } catch (err) {
      console.error('Error cancelling MR:', err);
      handleFirestoreError(err, OperationType.UPDATE, 'jobs');
    } finally {
      setIsCancellingMr(false);
    }
  };

  // Reactivate a Cancelled MR
  const handleReactivateMr = async (group: MrGroup) => {
    if (!auth.currentUser || !activeAgency) return;
    setIsReactivatingMr(true);
    try {
      // Check if any job number is currently used by another active job in the agency
      const q = query(
        collection(db, 'jobs'),
        where('ownerId', '==', auth.currentUser.uid),
        where('agencyId', '==', activeAgency.id)
      );
      const snap = await getDocs(q);
      const otherActiveJobs = snap.docs
        .map(d => ({ id: d.id, ...d.data() } as any))
        .filter(j => !group.jobs.some(gj => gj.id === j.id) && j.status !== 'Cancelled' && !j.isCancelled && j.mrStatus !== 'Cancelled');

      const activeJobNos = new Set(otherActiveJobs.map(j => (j.jobNo || '').trim().toUpperCase()));
      const clashingJob = group.jobs.find(j => activeJobNos.has((j.jobNo || '').trim().toUpperCase()));

      if (clashingJob) {
        alert(`Cannot reactivate MR #${group.mrNo} because Job No "${clashingJob.jobNo}" has already been assigned to another active transformer in the agency. Please edit its Job Number first before reactivating.`);
        setIsReactivatingMr(false);
        return;
      }

      const batch = writeBatch(db);
      const nowTime = Date.now();
      for (const j of group.jobs) {
        const docRef = doc(db, 'jobs', j.id);
        batch.update(docRef, {
          status: 'Received',
          isCancelled: false,
          mrStatus: 'Active',
          cancelledAt: null,
          updatedAt: nowTime
        });
      }
      await batch.commit();

      setNotification({
        type: 'success',
        message: `✓ MR #${group.mrNo} reactivated successfully.`
      });
      setTimeout(() => setNotification(null), 5000);
      setReactivateConfirmMr(null);
      await fetchJobs();
    } catch (err) {
      console.error('Error reactivating MR:', err);
      handleFirestoreError(err, OperationType.UPDATE, 'jobs');
    } finally {
      setIsReactivatingMr(false);
    }
  };

  const exportToExcel = () => {
    const wsData: any[][] = [];
    wsData.push(['MR No', 'MR Receive Date', 'Division', 'Job No', 'KVA', 'Make', 'Serial No', 'Core Type', 'Status', 'Repair Type', 'Prev AT / Ref', 'Last Repaired Date']);
    
    filteredGroups.forEach(group => {
      group.jobs.forEach(job => {
        wsData.push([
          group.mrNo,
          formatDDMMYYYY(group.dateOfIssue),
          group.division,
          job.jobNo,
          job.capacityKva,
          job.make,
          job.serialNo,
          job.coreType || 'CRGO',
          job.status,
          job.repairType,
          job.prevAtNo || job.prevJobNo || '-',
          job.prevDeliveryDate ? formatDDMMYYYY(job.prevDeliveryDate) : '-'
        ]);
      });
    });

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "MR Register");
    XLSX.writeFile(wb, `MR_Register_${selectedDivision}_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const filteredGroups = mrGroups.filter(group => {
    const matchesSearch = group.mrNo.toLowerCase().includes(searchTerm.toLowerCase()) ||
      group.jobs.some(j => (j.jobNo || '').toLowerCase().includes(searchTerm.toLowerCase()) || (j.serialNo || '').toLowerCase().includes(searchTerm.toLowerCase()) || (j.make || '').toLowerCase().includes(searchTerm.toLowerCase()));
    
    const matchesDivision = selectedDivision === 'All' || group.division.toLowerCase() === selectedDivision.toLowerCase();
    
    const matchesStatus = 
      statusFilter === 'ALL' ? true :
      statusFilter === 'ACTIVE' ? !group.isCancelled :
      group.isCancelled;

    return matchesSearch && matchesDivision && matchesStatus;
  });

  return (
    <div className="max-w-6xl mx-auto space-y-4 sm:space-y-6 pb-20">
      
      {/* TOAST NOTIFICATION */}
      {notification && (
        <div className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 shadow-md animate-in fade-in ${
          notification.type === 'success' 
            ? 'bg-emerald-50 border-emerald-300 text-emerald-900' 
            : 'bg-rose-50 border-rose-300 text-rose-900'
        }`}>
          <div className="flex items-center gap-2.5 text-xs font-bold">
            {notification.type === 'success' ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> : <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />}
            <span>{notification.message}</span>
          </div>
          <button 
            type="button" 
            onClick={() => setNotification(null)}
            className="p-1 hover:bg-black/5 rounded-lg text-slate-500 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-white p-4 rounded-xl shadow-xs border border-slate-200">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-blue-50 text-blue-600 rounded-xl">
            <BookOpen className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base sm:text-lg font-bold text-slate-900">MR Register (Material Receipts)</h1>
            <p className="text-xs text-slate-500">Inward transformer intake records, full MR editing, and MR cancellation</p>
          </div>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Link
            to="/new-job"
            className="w-full sm:w-auto flex items-center justify-center space-x-1.5 bg-blue-600 hover:bg-blue-700 text-white px-3.5 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors shadow-xs"
          >
            <Plus className="w-4 h-4" />
            <span>New MR Inward</span>
          </Link>

          <button 
            onClick={exportToExcel}
            className="w-full sm:w-auto flex items-center justify-center space-x-1.5 bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors shadow-xs cursor-pointer"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>Excel</span>
          </button>
        </div>
      </div>

      {/* UNASSIGNED WORK — a backlog, not a disappearance (AUDIT F82).
          Shown only when there is any, so a clean agency never sees it, and it empties as
          each job is attributed. There is no bulk fix: all twelve in live data sit on MRs
          where NO job names a tender, so nothing can be inferred from siblings and
          scripts/admin/assign-at.js refuses every one. Each needs the MR paperwork. */}
      {/* HIDDEN IN "ALL TENDERS" MODE, because there the tender clause is dropped and these
          jobs are already IN the list below - the banner would be counting them twice and
          calling one of the copies missing (AUDIT F87). */}
      {!viewingAllTenders && unassignedJobs.length > 0 && (
        <div className="bg-amber-50 border-2 border-amber-300 rounded-xl overflow-hidden">
          <button
            type="button"
            onClick={() => setShowUnassigned(o => !o)}
            className="w-full text-left p-3.5 flex items-start gap-2.5 hover:bg-amber-100/60"
          >
            <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-amber-900">
                {unassignedJobs.length} job{unassignedJobs.length === 1 ? '' : 's'} belong to no tender
              </p>
              <p className="text-xs text-amber-800 mt-0.5">
                They carry no AT, so they appear under no tender &mdash; including any that are
                estimated, billed or paid. They are not lost; they are listed here until each is
                attributed to the tender its MR belongs to.
              </p>
            </div>
            <span className="shrink-0 text-xs font-bold px-3 py-1.5 rounded-lg bg-amber-600 text-white">
              {showUnassigned ? 'Hide' : 'Show'}
            </span>
          </button>

          {showUnassigned && (
            <div className="border-t-2 border-amber-300 bg-white divide-y divide-slate-100 max-h-80 overflow-y-auto">
              {unassignedJobs.map((j: any) => {
                const issued = [
                  j.estimateSentDate && 'estimate sent',
                  j.billNo && 'billed',
                  j.paymentStatus === 'Paid' && 'PAID',
                  j.challanNo && 'challan',
                ].filter(Boolean);
                return (
                  <div key={j.id} className="p-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs">
                    <span className="font-mono font-bold text-slate-900">{j.jobNo || '(no job number)'}</span>
                    <span className="text-slate-500">MR {j.mrNo || '-'}</span>
                    <span className="text-slate-500">{j.division || '-'}</span>
                    <span className="text-slate-500">{j.make || '-'} &middot; {j.serialNo || '-'}</span>
                    {/* AN ISSUED DOCUMENT IS WHY THIS LIST EXISTS. Named loudly: these are the
                        ones whose disappearance would have mattered. */}
                    {issued.length > 0 && (
                      <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-800 font-bold border border-rose-300">
                        {issued.join(', ')}
                      </span>
                    )}
                  </div>
                );
              })}
              <div className="p-3 text-[11px] text-slate-600 bg-slate-50">
                Attributing these needs the MR paperwork &mdash; nothing can infer them, because no
                job on any of these MRs names a tender. Once a job on an MR carries an AT,
                <code className="mx-1">scripts/admin/assign-at.js</code> can fill in its siblings.
              </div>
            </div>
          )}
        </div>
      )}

      {/* Filter & Search Toolbar */}
      <div className="bg-white rounded-xl shadow-xs border border-slate-200 overflow-hidden">
        <div className="p-3 sm:p-4 border-b border-slate-200 bg-slate-50 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 flex-1">
            {/* Search Input */}
            <div className="relative flex-1 min-w-0 sm:max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input 
                type="text" 
                placeholder="Search MR No, Job No, S/N, Make..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-xs sm:text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
              />
            </div>

            {/* Division Filter Dropdown */}
            <div className="flex items-center gap-1.5 min-w-0 sm:w-56">
              <div className="relative w-full">
                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                <select
                  value={selectedDivision}
                  onChange={(e) => setSelectedDivision(e.target.value)}
                  className="w-full pl-9 pr-8 py-2 text-xs sm:text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white font-medium text-slate-700 appearance-none cursor-pointer"
                >
                  <option value="All">All Divisions ({mrGroups.length} MRs)</option>
                  {divisions.map(div => {
                    const count = mrGroups.filter(g => g.division.toLowerCase() === div.toLowerCase()).length;
                    return (
                      <option key={div} value={div}>
                        {div} Division ({count} MRs)
                      </option>
                    );
                  })}
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              </div>
            </div>

            {/* Status Filter Toggle */}
            <div className="flex items-center bg-slate-200/80 p-1 rounded-lg text-xs font-bold shrink-0">
              <button
                type="button"
                onClick={() => setStatusFilter('ALL')}
                className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                  statusFilter === 'ALL' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                All ({mrGroups.length})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('ACTIVE')}
                className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                  statusFilter === 'ACTIVE' ? 'bg-white text-blue-700 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Active ({activeCount})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('CANCELLED')}
                className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                  statusFilter === 'CANCELLED' ? 'bg-white text-rose-700 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Cancelled ({cancelledCount})
              </button>
            </div>

          </div>

          {/* Counts badge */}
          <div className="flex items-center justify-between sm:justify-end text-xs font-semibold text-slate-600">
            <span className="bg-slate-200/80 px-2.5 py-1 rounded-md">
              Showing <span className="font-bold text-slate-900">{filteredGroups.length}</span> of {mrGroups.length} MRs
            </span>
          </div>
        </div>

        {/* MR Listing */}
        <div className="divide-y divide-slate-200">
          {loading ? (
            <div className="p-12 text-center">
              <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto" />
              <p className="text-sm text-slate-500 mt-4">Loading register...</p>
            </div>
          ) : filteredGroups.length === 0 ? (
            <div className="p-12 text-center text-slate-500">
              <Filter className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <p className="font-medium text-slate-700">No MR records found matching your filters.</p>
              <p className="text-xs text-slate-400 mt-1">Try selecting "All Divisions" or clear your search term.</p>
            </div>
          ) : (
            filteredGroups.map(group => (
              <div 
                key={group.mrNo} 
                className={`transition-colors ${
                  group.isCancelled ? 'bg-rose-50/20 hover:bg-rose-50/40 opacity-90' : 'bg-white hover:bg-slate-50/50'
                }`}
              >
                
                {/* MR HEADER ROW */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 sm:p-4 gap-3">
                  
                  {/* LEFT: Clickable expander with MR info */}
                  <div 
                    onClick={() => toggleExpand(group.mrNo)}
                    className="flex items-start sm:items-center space-x-3 min-w-0 cursor-pointer flex-1"
                  >
                    <div className="text-slate-400 hover:text-blue-600 transition-colors mt-0.5 sm:mt-0 shrink-0">
                      {expandedMrs.has(group.mrNo) ? <ChevronDown className="w-5 h-5 text-blue-600" /> : <ChevronRight className="w-5 h-5" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className={`font-bold text-sm ${group.isCancelled ? 'text-slate-600 line-through' : 'text-slate-900'}`}>
                          MR No: <span className={`font-mono font-black ${group.isCancelled ? 'text-rose-700 no-underline' : 'text-blue-600'}`}>{group.mrNo}</span>
                        </h3>

                        {group.isCancelled ? (
                          <span className="text-[10px] font-black uppercase text-rose-800 bg-rose-100 border border-rose-300 px-2 py-0.5 rounded flex items-center gap-1 shadow-2xs">
                            <Ban className="w-3 h-3 text-rose-600" /> CANCELLED
                          </span>
                        ) : null}

                        <span className="text-[10px] font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                          {group.division}
                        </span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                          group.repairType === 'GP'
                            ? 'bg-amber-100 text-amber-800 border-amber-300'
                            : 'bg-blue-100 text-blue-800 border-blue-200'
                        }`}>
                          {group.repairType || 'OGP'}
                        </span>
                        <span className="text-[10px] font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                          Received: <span className="font-mono font-bold text-slate-800">{formatDDMMYYYY(group.dateOfIssue)}</span>
                        </span>
                        <span className="text-xs font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                          {group.jobs.length} Unit{group.jobs.length !== 1 ? 's' : ''}
                        </span>
                      </div>
                    </div>
                  </div>
                  
                  {/* RIGHT: ACTION BUTTONS */}
                  <div className="flex items-center space-x-2 pl-8 sm:pl-0 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleOpenFullMrEdit(group)}
                      className="inline-flex items-center space-x-1.5 text-xs font-bold text-blue-700 hover:text-white bg-blue-50 hover:bg-blue-600 border border-blue-200 hover:border-blue-600 px-3 py-1.5 rounded-lg transition-all shadow-2xs cursor-pointer"
                      title="Open Full MR Edit mode to edit all jobs, dates, divisions and numbers"
                    >
                      <Edit className="w-3.5 h-3.5" />
                      <span>Full Edit MR</span>
                    </button>

                    {group.isCancelled ? (
                      <button
                        type="button"
                        onClick={() => handleReactivateMr(group)}
                        disabled={isReactivatingMr}
                        className="inline-flex items-center space-x-1 text-xs font-bold text-emerald-700 hover:text-white bg-emerald-50 hover:bg-emerald-600 border border-emerald-300 hover:border-emerald-600 px-2.5 py-1.5 rounded-lg transition-all shadow-2xs cursor-pointer"
                        title="Reactivate this cancelled MR"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Reactivate MR</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setCancelConfirmMr(group)}
                        className="inline-flex items-center space-x-1 text-xs font-bold text-rose-700 hover:text-white bg-rose-50 hover:bg-rose-600 border border-rose-300 hover:border-rose-600 px-2.5 py-1.5 rounded-lg transition-all shadow-2xs cursor-pointer"
                        title="Cancel this MR (release job numbers for reuse and stop downstream processing)"
                      >
                        <Ban className="w-3.5 h-3.5" />
                        <span>Cancel MR</span>
                      </button>
                    )}
                  </div>

                </div>
                
                {/* Collapsible Transformer Details Table */}
                {expandedMrs.has(group.mrNo) && (
                  <div className="bg-slate-50/90 p-3 sm:p-4 border-t border-slate-200 overflow-x-auto">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-bold text-slate-700 flex items-center gap-2">
                        <span>Transformers in MR #{group.mrNo} ({group.jobs.length})</span>
                        {group.isCancelled && (
                          <span className="text-[10px] text-rose-700 font-bold bg-rose-100 border border-rose-200 px-2 py-0.5 rounded">
                            Job numbers released for reuse
                          </span>
                        )}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleOpenFullMrEdit(group)}
                        className="text-[11px] text-blue-600 hover:underline font-bold flex items-center gap-1 cursor-pointer"
                      >
                        <Edit className="w-3 h-3" /> Edit Batch / Add Transformers
                      </button>
                    </div>

                    <table className="w-full text-xs text-left min-w-[620px]">
                      <thead className="text-slate-500 uppercase tracking-wider font-bold border-b border-slate-200 bg-white/60">
                        <tr>
                          <th className="py-2 px-2.5">#</th>
                          <th className="py-2 px-2.5">Job No</th>
                          <th className="py-2 px-2.5">Make</th>
                          <th className="py-2 px-2.5">KVA</th>
                          <th className="py-2 px-2.5">Serial No</th>
                          <th className="py-2 px-2.5">Core Type</th>
                          <th className="py-2 px-2.5">Status</th>
                          {group.repairType === 'GP' && <th className="py-2 px-2.5">Prev AT / Ref</th>}
                          <th className="py-2 px-2.5 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200/70">
                        {group.jobs.map((job, idx) => (
                          <tr key={job.id} className={group.isCancelled ? 'opacity-70 hover:bg-rose-50/20' : 'hover:bg-white'}>
                            <td className="py-2 px-2.5 text-slate-400 font-mono">{idx + 1}</td>
                            <td className="py-2 px-2.5 font-mono font-bold text-slate-900">{job.jobNo}</td>
                            <td className="py-2 px-2.5 text-slate-700 uppercase">{job.make}</td>
                            <td className="py-2 px-2.5 font-semibold text-slate-800">{job.capacityKva} KVA</td>
                            <td className="py-2 px-2.5 font-mono text-slate-600">{job.serialNo}</td>
                            <td className="py-2 px-2.5 font-medium text-slate-700">{job.coreType || 'CRGO'}</td>
                            <td className="py-2 px-2.5">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                                job.status === 'Cancelled' || job.isCancelled
                                  ? 'bg-rose-100 text-rose-800 border border-rose-300 font-bold'
                                  : job.status === 'Dispatched' 
                                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' 
                                  : job.status?.includes('Tested')
                                  ? 'bg-blue-100 text-blue-800 border border-blue-300'
                                  : job.status?.includes('Scrap')
                                  ? 'bg-rose-100 text-rose-800 border border-rose-300'
                                  : 'bg-amber-100 text-amber-800 border border-amber-300'
                              }`}>
                                {job.status}
                              </span>
                            </td>
                            {group.repairType === 'GP' && (
                              <td className="py-2 px-2.5 text-[11px] text-amber-800 font-mono">
                                {job.prevAtNo || job.prevJobNo || 'GP Warranty'}
                              </td>
                            )}
                            <td className="py-2 px-2.5 text-right">
                              <Link 
                                to={`/edit-job/${job.id}`} 
                                className="inline-flex items-center space-x-1 text-[10px] font-bold uppercase tracking-wider text-blue-600 hover:text-blue-800 bg-white hover:bg-blue-50 border border-slate-200 hover:border-blue-200 px-2 py-0.5 rounded transition-colors shadow-2xs"
                              >
                                <Edit className="w-3 h-3" />
                                <span>Quick Edit</span>
                              </Link>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

              </div>
            ))
          )}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* FULL MR EDIT MODAL */}
      {/* ========================================================================= */}
      {editingMr && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-2 sm:p-4 overflow-y-auto animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-2xl max-w-5xl w-full border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]">
            
            {/* MODAL HEADER */}
            <div className="p-4 bg-slate-900 text-white flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-600 text-white rounded-xl">
                  <Edit className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-sm sm:text-base">
                      Full MR Edit: <span className="font-mono text-blue-300">MR #{editingMr.originalMrNo}</span>
                    </h3>
                    {editingMr.isCancelled && (
                      <span className="text-[10px] font-black uppercase text-rose-300 bg-rose-900/60 border border-rose-400 px-2 py-0.5 rounded">
                        CANCELLED
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-300">
                    Edit MR Header information, change category, and modify all {editingMr.jobs.length} transformer unit(s)
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditingMr(null)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* CANCELLED WARNING BANNER */}
            {editingMr.isCancelled && (
              <div className="p-3 bg-rose-50 border-b border-rose-200 text-xs text-rose-900 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Ban className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>
                    <strong>This MR is currently Cancelled.</strong> Its job numbers have been released for reuse, and downstream workflow (inspections, testing, dispatch) is disabled.
                  </span>
                </div>
              </div>
            )}

            {/* MODAL BODY (SCROLLABLE) */}
            <div className="overflow-y-auto p-4 sm:p-6 space-y-5 flex-1 bg-slate-50/50">
              
              {/* SECTION 1: MR HEADER DETAILS */}
              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-3">
                {/* ⚠ THESE ARE READ, NOT WRITTEN ONTO EXISTING JOBS (AUDIT G11).
                    `division` and `repairType` below are still needed: the job-number prefix
                    comes from `getJobNoPrefix(editingMr.division, …)`, the counter advance is
                    keyed on it, and GP excludes a job from number continuation. So they cannot
                    be removed without breaking number allocation.
                    What they no longer do is overwrite every job on save - each job keeps its
                    own values, and these apply only to a row that has none, i.e. a new one. */}
                <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
                  <FileSpreadsheet className="w-4 h-4 text-blue-600" />
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                    MR Header & Administrative Details
                  </h4>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                  
                  {/* MR NUMBER */}
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-600 mb-1">
                      MR / Challan No. <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={editingMr.mrNo}
                      onChange={(e) => setEditingMr(prev => prev ? ({ ...prev, mrNo: e.target.value }) : null)}
                      className="w-full px-3 py-2 text-xs font-mono font-bold border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white"
                      placeholder="MR Number"
                    />
                    {editingMr.mrNo !== editingMr.originalMrNo && (
                      <span className="text-[10px] text-amber-600 font-medium block mt-0.5">
                        Will rename MR for all units
                      </span>
                    )}
                  </div>

                  {/* RECEIVE DATE */}
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-600 mb-1">
                      MR Receive Date <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="date"
                      value={editingMr.dateOfIssue}
                      onChange={(e) => setEditingMr(prev => prev ? ({ ...prev, dateOfIssue: e.target.value }) : null)}
                      className="w-full px-3 py-2 text-xs font-mono font-bold border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white"
                    />
                  </div>

                  {/* DIVISION */}
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-600 mb-1">
                      Division Office <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={editingMr.division}
                      onChange={(e) => setEditingMr(prev => prev ? ({ ...prev, division: e.target.value }) : null)}
                      className="w-full px-3 py-2 text-xs font-bold border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white cursor-pointer"
                    >
                      {divisions.map(div => (
                        <option key={div} value={div}>{div}</option>
                      ))}
                    </select>
                  </div>

                  {/* REPAIR TYPE */}
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-600 mb-1">
                      Repair Category <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={editingMr.repairType}
                      onChange={(e) => setEditingMr(prev => prev ? ({ ...prev, repairType: e.target.value }) : null)}
                      className="w-full px-3 py-2 text-xs font-bold border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white cursor-pointer"
                    >
                      <option value="OGP">OGP (Out of Guarantee)</option>
                      <option value="GP">GP (Guarantee Period Warranty)</option>
                    </select>
                  </div>

                </div>
              </div>

              {/* SECTION 2: TRANSFORMER UNITS IN THIS MR */}
              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-3">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-blue-600" />
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                      Transformer Units ({editingMr.jobs.length})
                    </h4>
                  </div>
                  
                  {/* ⚠ AN ADDED UNIT JOINS THE MR'S TENDER, NOT THE ONE ON SCREEN (AUDIT F82).
                      A unit added to MR 1563 belongs to the tender 1563 was issued under -
                      that is F66 and it is correct. But now that every screen shows only the
                      active tender's work, a unit added to an OLD MR while working under a
                      NEW tender is stamped with the old one and disappears from view the
                      moment it saves. Consistent behaviour that looks exactly like a bug, so
                      the fix is saying it rather than changing it. */}
                  {(() => {
                    const mrAt = atForEditingMr();
                    if ('error' in mrAt) return null;
                    if (!activeAtMaster || mrAt.atId === activeAtMaster.id) return null;
                    const mrAtDoc = atMasters.find(x => x.id === mrAt.atId);
                    return (
                      <div className="w-full basis-full p-2.5 rounded-lg bg-indigo-50 border border-indigo-300 text-[11px] text-indigo-900">
                        <strong className="font-bold">
                          This unit joins MR {editingMr.mrNo}, which belongs to AT{' '}
                          {mrAtDoc?.atNumber || mrAtDoc?.name || '(unknown)'}.
                        </strong>{' '}
                        It will not appear under AT {activeAtMaster.atNumber || activeAtMaster.name},
                        the tender you are working in &mdash; a unit added to an MR belongs to the
                        tender that MR was issued under, and is priced and counted against it.
                      </div>
                    );
                  })()}

                  {/* THE REASON IN ITS PLACE, not a disabled control. A greyed button still
                      says "this is a thing you might do to this MR", and under a closed
                      tender it is not (AUDIT F83). Editing the units already here is
                      unaffected - only adding a NEW one is refused. */}
                  {intakeGate.open ? (
                    <button
                      type="button"
                      onClick={handleAddTransformerToMr}
                      className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-lg text-xs font-bold flex items-center gap-1 transition-colors cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add Unit to this MR</span>
                    </button>
                  ) : (
                    <span className="px-3 py-1.5 bg-amber-50 text-amber-900 border border-amber-300 rounded-lg text-[11px] font-semibold max-w-xs">
                      No new units: {intakeGate.reason} The units already on this MR can still be
                      edited, inspected, tested and dispatched.
                    </span>
                  )}
                </div>

                <div className="space-y-3">
                  {editingMr.jobs.map((job, idx) => (
                    <div 
                      key={job.id || `new-${idx}`}
                      className={`p-3 rounded-xl border transition-all ${
                        job.isNew ? 'border-emerald-300 bg-emerald-50/30' : 'border-slate-200 bg-white'
                      }`}
                    >
                      {/* UNIT HEADER */}
                      <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-slate-100">
                        <div className="flex items-center gap-2">
                          <span className="w-5 h-5 rounded-full bg-slate-800 text-white font-mono text-[10px] font-bold flex items-center justify-center">
                            {idx + 1}
                          </span>
                          <span className="text-xs font-bold text-slate-800">
                            Unit #{idx + 1}
                          </span>
                          {job.isNew && (
                            <span className="text-[9px] bg-emerald-100 text-emerald-800 font-extrabold px-1.5 py-0.5 rounded">
                              NEW
                            </span>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => handleRemoveTransformerFromMr(idx)}
                          className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                          title="Remove unit from MR"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {/* UNIT FIELDS */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-6 gap-2.5">
                        
                        {/* JOB NO */}
                        <div>
                          <label className="block text-[9px] font-bold uppercase text-slate-500 mb-0.5">
                            Job No. *
                          </label>
                          <input
                            type="text"
                            value={job.jobNo}
                            onChange={(e) => handleJobFieldChange(idx, 'jobNo', e.target.value)}
                            className="w-full px-2.5 py-1.5 text-xs font-mono font-bold border border-slate-300 rounded-lg focus:ring-1 focus:ring-blue-500 bg-white"
                          />
                        </div>

                        {/* CAPACITY KVA */}
                        <div>
                          <label className="block text-[9px] font-bold uppercase text-slate-500 mb-0.5">
                            Capacity (KVA) *
                          </label>
                          <div className="space-y-1">
                            <input
                              type="number"
                              value={job.capacityKva}
                              onChange={(e) => handleJobFieldChange(idx, 'capacityKva', e.target.value)}
                              className="w-full px-2.5 py-1.5 text-xs font-mono font-bold border border-slate-300 rounded-lg focus:ring-1 focus:ring-blue-500 bg-white"
                            />
                            <div className="flex items-center gap-1 overflow-x-auto py-0.5 scrollbar-none no-scrollbar">
                              {COMMON_KVA_OPTIONS.map(kva => (
                                <button
                                  key={kva}
                                  type="button"
                                  onClick={() => handleJobFieldChange(idx, 'capacityKva', kva)}
                                  className={`px-1 py-0.2 rounded text-[8px] font-mono font-bold shrink-0 transition-colors cursor-pointer ${
                                    String(job.capacityKva) === kva 
                                      ? 'bg-blue-600 text-white' 
                                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                  }`}
                                >
                                  {kva}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>

                        {/* MAKE */}
                        <div>
                          <label className="block text-[9px] font-bold uppercase text-slate-500 mb-0.5">
                            Make / Brand *
                          </label>
                          <input
                            type="text"
                            value={job.make}
                            onChange={(e) => handleJobFieldChange(idx, 'make', e.target.value.toUpperCase())}
                            className="w-full px-2.5 py-1.5 text-xs font-bold uppercase border border-slate-300 rounded-lg focus:ring-1 focus:ring-blue-500 bg-white"
                          />
                        </div>

                        {/* SERIAL NO */}
                        <div>
                          <label className="block text-[9px] font-bold uppercase text-slate-500 mb-0.5">
                            Serial No. *
                          </label>
                          <input
                            type="text"
                            value={job.serialNo}
                            onChange={(e) => handleJobFieldChange(idx, 'serialNo', e.target.value.toUpperCase())}
                            className="w-full px-2.5 py-1.5 text-xs font-mono font-bold border border-slate-300 rounded-lg focus:ring-1 focus:ring-blue-500 bg-white"
                          />
                        </div>

                        {/* CORE TYPE */}
                        <div>
                          <label className="block text-[9px] font-bold uppercase text-slate-500 mb-0.5">
                            Core Type *
                          </label>
                          <select
                            value={job.coreType}
                            onChange={(e) => handleJobFieldChange(idx, 'coreType', e.target.value)}
                            className="w-full px-2.5 py-1.5 text-xs font-bold border border-slate-300 rounded-lg focus:ring-1 focus:ring-blue-500 bg-white cursor-pointer"
                          >
                            <option value="CRGO">CRGO</option>
                            <option value="Amorphous">Amorphous</option>
                            <option value="Wound Core">Wound Core</option>
                            <option value="LSTC">LSTC</option>
                            <option value="OH">OH</option>
                          </select>
                        </div>

                        {/* STATUS */}
                        <div>
                          <label className="block text-[9px] font-bold uppercase text-slate-500 mb-0.5">
                            Current Status
                          </label>
                          <select
                            value={job.status}
                            onChange={(e) => handleJobFieldChange(idx, 'status', e.target.value)}
                            className="w-full px-2.5 py-1.5 text-xs font-semibold border border-slate-300 rounded-lg focus:ring-1 focus:ring-blue-500 bg-white cursor-pointer"
                          >
                            {JOB_STATUSES.map(st => (
                              <option key={st} value={st}>{st}</option>
                            ))}
                          </select>
                        </div>

                      </div>

                      {/* GP EXTRA ROW DETAILS IF GP */}
                      {editingMr.repairType === 'GP' && (
                        <div className="mt-2.5 pt-2 border-t border-amber-200/60 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                          <div>
                            <label className="block text-[9px] font-bold uppercase text-amber-900 mb-0.5">
                              Prev AT / Tender Ref:
                            </label>
                            <input
                              type="text"
                              value={job.prevAtNo || ''}
                              onChange={(e) => handleJobFieldChange(idx, 'prevAtNo', e.target.value)}
                              placeholder="e.g. AT-2023-24"
                              className="w-full px-2.5 py-1 border border-amber-300 rounded-lg text-xs bg-white"
                            />
                          </div>

                          <div>
                            <label className="block text-[9px] font-bold uppercase text-amber-900 mb-0.5">
                              Last Repaired Date:
                            </label>
                            <input
                              type="date"
                              value={job.prevDeliveryDate || ''}
                              onChange={(e) => handleJobFieldChange(idx, 'prevDeliveryDate', e.target.value)}
                              className="w-full px-2.5 py-1 border border-amber-300 rounded-lg text-xs font-mono bg-white"
                            />
                          </div>

                          <div>
                            <label className="block text-[9px] font-bold uppercase text-amber-900 mb-0.5">
                              GP Reason:
                            </label>
                            <input
                              type="text"
                              value={job.gpReason || ''}
                              onChange={(e) => handleJobFieldChange(idx, 'gpReason', e.target.value)}
                              placeholder="e.g. HT Coil Burn"
                              className="w-full px-2.5 py-1 border border-amber-300 rounded-lg text-xs bg-white"
                            />
                          </div>
                        </div>
                      )}

                    </div>
                  ))}
                </div>
              </div>

            </div>

            {/* MODAL FOOTER */}
            <div className="p-4 bg-slate-100 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
              
              <div>
                {!editingMr.isCancelled ? (
                  <button
                    type="button"
                    onClick={() => {
                      setCancelConfirmMr({ mrNo: editingMr.originalMrNo, dateOfIssue: editingMr.dateOfIssue, division: editingMr.division, repairType: editingMr.repairType, jobs: editingMr.jobs as any });
                    }}
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-rose-600 hover:text-rose-800 hover:bg-rose-50 px-3 py-2 rounded-xl transition-colors cursor-pointer border border-rose-200"
                  >
                    <Ban className="w-4 h-4 text-rose-600" />
                    <span>Cancel Entire MR</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      handleReactivateMr({ mrNo: editingMr.originalMrNo, dateOfIssue: editingMr.dateOfIssue, division: editingMr.division, repairType: editingMr.repairType, jobs: editingMr.jobs as any });
                    }}
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 hover:text-emerald-900 hover:bg-emerald-50 px-3 py-2 rounded-xl transition-colors cursor-pointer border border-emerald-300"
                  >
                    <RotateCcw className="w-4 h-4 text-emerald-600" />
                    <span>Reactivate Entire MR</span>
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                <button
                  type="button"
                  onClick={() => setEditingMr(null)}
                  className="px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
                >
                  Close
                </button>

                <button
                  type="button"
                  disabled={isSavingEdit}
                  onClick={handleSaveFullMr}
                  className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs sm:text-sm rounded-xl shadow-md transition-all flex items-center justify-center gap-2 disabled:opacity-50 min-h-[40px] cursor-pointer"
                >
                  {isSavingEdit ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Saving MR Updates...</span>
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4" />
                      <span>Save All MR Changes</span>
                    </>
                  )}
                </button>
              </div>

            </div>

          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* CANCEL MR CONFIRMATION MODAL */}
      {/* ========================================================================= */}
      {cancelConfirmMr && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-2xl p-5 sm:p-6 max-w-md w-full border border-rose-200">
            <div className="flex items-center gap-3 mb-3 text-rose-600">
              <div className="bg-rose-100 p-2.5 rounded-xl shrink-0">
                <Ban className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Cancel MR #{cancelConfirmMr.mrNo}?</h3>
                <p className="text-xs text-rose-600 font-medium">Releases job numbers for reuse</p>
              </div>
            </div>

            <div className="text-slate-700 text-xs sm:text-sm mb-5 leading-relaxed bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-2">
              <p>
                Are you sure you want to cancel <strong>MR #{cancelConfirmMr.mrNo}</strong> ({cancelConfirmMr.division} Division)?
              </p>
              <ul className="list-disc pl-4 text-slate-600 text-xs space-y-1">
                <li>Marks all <strong>{cancelConfirmMr.jobs.length} transformer unit(s)</strong> as <strong>Cancelled</strong>.</li>
                <li><strong>Releases all Job Numbers</strong> assigned to this MR so they can be immediately reused for new intakes.</li>
                <li>Blocks further work (inspections, testing, dispatch, billing) for this MR.</li>
                <li>Preserves historical audit trail in the MR register.</li>
              </ul>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={isCancellingMr}
                onClick={() => setCancelConfirmMr(null)}
                className="px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
              >
                No, Keep Active
              </button>

              <button
                type="button"
                disabled={isCancellingMr}
                onClick={handleCancelEntireMr}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {isCancellingMr ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Cancelling MR...</span>
                  </>
                ) : (
                  <>
                    <Ban className="w-4 h-4" />
                    <span>Yes, Cancel MR</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
