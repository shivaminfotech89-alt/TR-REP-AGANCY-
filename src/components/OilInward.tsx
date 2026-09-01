import React, { useState, useEffect, useMemo } from "react";
import { inspectionFor } from '../lib/inspectionLink.js';
import { useAgency, isUnassigned, isIntakeOpen } from "../lib/AgencyContext";
import { db, auth, handleFirestoreError, OperationType } from "../lib/firebase";
import * as XLSX from "xlsx";
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  updateDoc,
  doc,
  serverTimestamp,
} from "firebase/firestore";
import { formatDDMMYYYY, getMrDateIso } from '../lib/utils';
import { describeOil } from '../lib/oilBalance';
import { CARD, CARD_PAD, NUM, NUM_INLINE, TONE, chip, TABLE_WRAP, TABLE, TH, TD } from '../lib/ui';
import {
  Droplet,
  Plus,
  Calendar,
  Building,
  X,
  Save,
  FileText,
  BarChart2,
  List,
  Edit2,
  Download,
} from "lucide-react";

export interface OilTransaction {
  id?: string;
  agencyId: string;
  mrNo: string;
  mrDate?: string;
  date: number;
  division: string;
  oilType: "Fresh" | "Used";
  barrels: number;
  /**
   * WHICH TENDER THIS OIL BELONGS TO (AUDIT F82). Optional because every transaction written
   * before oil was recorded per AT has none - those are unassigned, not wrong, and are not
   * guessed at: three of the four in live data name an MR with no jobs to read a tender from.
   */
  atId?: string;
  grossLiters: number;
  /**
   * THE OPERATOR TYPED THIS GROSS RATHER THAN ACCEPTING `barrels x 210` (AUDIT F97).
   *
   * ⚠ FRESH ONLY, AND DELIBERATELY. Fresh oil arrives in sealed barrels, so 210 per barrel is
   * the default and a deviation is a fact about the delivery - a division sent one short.
   * USED oil has no such default: its gross is measured every time, so a flag on it would
   * mark every row and mean nothing.
   *
   * ⚠ IT IS WHAT STOPS A CORRECT FIGURE LOOKING LIKE A TYPO. Every other Fresh row is a
   * multiple of 210, so "1 barrel / 195.00" reads as a slip - and the person most likely to
   * 'fix' it is someone reconciling months later who cannot know it was deliberate. The
   * register and the Excel export mark the row.
   */
  grossLitersManual?: boolean;
  filtrationLossPercent: number;
  netLiters: number;
  createdAt?: any;
  ownerId?: string;
}

/**
 * FRESH OIL'S DEFAULT GROSS — a DEFAULT, not a rule (AUDIT F97).
 *
 * A sealed barrel holds 210 L, so that is what the form fills in. It is not a constraint: a
 * division can send a barrel short, and the operator types the real figure over it. The field
 * used to be `readOnly` for Fresh with a tooltip saying the quantity was fixed, which stated
 * as policy something that was only ever a convenience.
 *
 * Module scope, so the form's initial state can use it - and so the number appears once
 * rather than in four places that could drift.
 */
const FRESH_LITRES_PER_BARREL = 210;
const defaultGrossFor = (barrels: number) => barrels * FRESH_LITRES_PER_BARREL;

export default function OilInward() {
  const { activeAgency, activeAtMaster, atMasters, viewingAllTenders } = useAgency();

  /**
   * NEW OIL ENTRIES OBEY THE TENDER GATE (AUDIT F83). Oil already recorded under this
   * tender stays visible and stays in its balance; only NEW entries are refused.
   */
  const intakeGate = isIntakeOpen(activeAtMaster, atMasters.filter(t => t.agencyId === activeAgency?.id), viewingAllTenders);

  const [transactions, setTransactions] = useState<OilTransaction[]>([]);
  /**
   * OIL BELONGING TO NO TENDER — held separately, shown separately, counted in NEITHER
   * balance (AUDIT F87). Folding it into the tender's figures would attribute litres to a
   * tender nobody said they belong to; dropping it is what the broken query already did.
   */
  const [unassignedTx, setUnassignedTx] = useState<OilTransaction[]>([]);
  const [unassignedJobCount, setUnassignedJobCount] = useState(0);
  const [showUnassignedOil, setShowUnassignedOil] = useState(false);
  const [jobs, setJobs] = useState<any[]>([]);
  const [inspections, setInspections] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"transactions" | "summary">(
    "transactions",
  );
  const [filterDivision, setFilterDivision] = useState<string>("All");
  const [filterDateMode, setFilterDateMode] = useState<"all" | "upto" | "exact">("all");
  const [filterUptoDate, setFilterUptoDate] = useState<string>("");
  const [filterExactDate, setFilterExactDate] = useState<string>("");

  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    mrNo: "",
    mrDate: new Date().toISOString().split("T")[0],
    date: new Date().toISOString().split("T")[0],
    division: "",
    oilType: "Fresh" as "Fresh" | "Used",
    barrels: 1,
    grossLiters: FRESH_LITRES_PER_BARREL,
    grossLitersManual: false,
  });

  const parseDateToTimestamp = (dateVal: any): number => {
    if (!dateVal) return 0;
    if (typeof dateVal === "number") return dateVal;
    if (dateVal instanceof Date) return dateVal.getTime();
    if (dateVal.seconds || dateVal._seconds) return (dateVal.seconds || dateVal._seconds) * 1000;
    if (typeof dateVal === "string") {
      const s = dateVal.trim();
      if (!s || s === "-") return 0;
      // Format: YYYY-MM-DD or YYYY/MM/DD or YYYY.MM.DD
      if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/.test(s)) {
        const parts = s.split("T")[0].split(/[-/.]/);
        const y = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10) - 1;
        const d = parseInt(parts[2], 10);
        return new Date(y, m, d, 23, 59, 59, 999).getTime();
      }
      // Format: DD-MM-YYYY or DD/MM/YYYY or DD.MM.YYYY
      if (/^\d{1,2}[-/.]\d{1,2}[-/.]\d{4}/.test(s)) {
        const parts = s.split(/[-/.]/);
        const d = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10) - 1;
        const y = parseInt(parts[2], 10);
        return new Date(y, m, d, 23, 59, 59, 999).getTime();
      }
      const parsed = new Date(s).getTime();
      return isNaN(parsed) ? 0 : parsed;
    }
    return 0;
  };

  const formatDateStr = (dateVal: any): string => {
    if (!dateVal) return "";
    if (typeof dateVal === "string") return dateVal;
    if (typeof dateVal === "number") {
      const d = new Date(dateVal);
      if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
    }
    if (dateVal?.seconds) {
      const d = new Date(dateVal.seconds * 1000);
      if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
    }
    return "";
  };

  /** Raw ISO (or '-'), shared with BillingSystem - see lib/utils getMrDateIso.
   *  Format at the render site, never here: this also feeds formData. */
  const getMrDate = (mrNo: string) => getMrDateIso(mrNo, jobs, transactions);

  const handleMrNoChange = (newMrNo: string) => {
    const derivedDate = getMrDate(newMrNo);
    setFormData((prev) => ({
      ...prev,
      mrNo: newMrNo,
      mrDate: derivedDate !== "-" ? derivedDate : prev.mrDate,
    }));
  };

  const divisions = activeAgency ? Object.keys((activeAtMaster && activeAtMaster.prefixes && Object.keys(activeAtMaster.prefixes).length > 0) ? activeAtMaster.prefixes : (activeAgency.prefixes || {})) : [];

  useEffect(() => {
    if (activeAgency && !formData.division && divisions.length > 0) {
      setFormData((prev) => ({ ...prev, division: divisions[0] }));
    }
  }, [activeAgency, divisions]);

  useEffect(() => {
    if (activeAgency && auth.currentUser) {
      fetchData();
    } else {
      setTransactions([]);
      setJobs([]);
      setInspections([]);
      setLoading(false);
    }
    // ⚠ THE TENDER IS A DEPENDENCY (AUDIT F89). The read is agency-wide but the SPLIT is
    // per tender, so changing tender - or switching to "all tenders" - changes what the
    // register must show. This listed only `activeAgency`, which was survivable while the
    // query itself was tender-scoped only because switching tender also happened to
    // remount; it is not survivable now that the split is done here.
  }, [activeAgency, activeAtMaster?.id, viewingAllTenders]);

  const fetchData = async () => {
    setLoading(true);
    try {
      if (!auth.currentUser || !activeAgency) return;

      // ⚠ ONE AGENCY-WIDE READ, SPLIT IN MEMORY (AUDIT F87). This used to be two
      // tender-scoped queries, and both were `where("atId","==", <id>)` - which matched NONE
      // of the four transactions in live data, because every one of them has the field
      // ABSENT rather than empty and Firestore equality does not match a missing field. The
      // register rendered empty against oil the DISCOM is owed.
      //
      // No query can fix that: "unassigned" is not expressible as a Firestore filter. Reading
      // the agency's oil and splitting it here is the only way to show BOTH the tender's
      // transactions and the ones belonging to no tender, and it removes the way two queries
      // over the same data can disagree.
      //
      // OIL IS STILL PER TENDER (AUDIT F82), with one exception: the net balance at the close
      // of a tender is what the agency owes or is owed, so it carries forward as the next
      // tender's OPENING balance. Everything else starts empty.
      const [txSnap, jobsSnap, inspSnap] = await Promise.all([
        getDocs(
          query(
            collection(db, "oilTransactions"),
            where("ownerId", "==", auth.currentUser.uid),
            where("agencyId", "==", activeAgency.id),
          ),
        ),
        getDocs(
          query(
            collection(db, "jobs"),
            where("ownerId", "==", auth.currentUser.uid),
            where("agencyId", "==", activeAgency.id),
          ),
        ),
        getDocs(
          query(
            collection(db, "inspections"),
            where("ownerId", "==", auth.currentUser.uid),
          ),
        ),
      ]);

      const allTx = txSnap.docs.map(
        (d) => ({ id: d.id, ...d.data() }) as OilTransaction,
      );
      allTx.sort((a, b) => b.date - a.date);
      const allJobs = jobsSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as any);

      /**
       * ⚠ "ALL TENDERS" TAKES EVERYTHING, INCLUDING UNASSIGNED (AUDIT F89).
       *
       * The agency-wide net is every litre the agency was short and every litre it was
       * issued, across its whole recorded history. Work belonging to no tender is still work
       * the agency did, so excluding it here would reproduce the defect the unassigned
       * section exists to fix - and the section is hidden in this mode precisely because the
       * rows are already counted in the figures below.
       *
       * A single tender still takes only its own, and unassigned is surfaced separately.
       * Two questions, two answers - see `openingForFilter` for the other half of it.
       */
      if (viewingAllTenders) {
        setTransactions(allTx);
        setJobs(allJobs);
      } else {
        // Unassigned is recognised, never queried for - `isUnassigned` treats an absent atId
        // and an empty one alike, which is exactly what the query could not do.
        setTransactions(allTx.filter(t => !isUnassigned(t) && String((t as any).atId) === activeAtMaster?.id));
        setJobs(allJobs.filter(j => !isUnassigned(j) && String(j.atId) === activeAtMaster?.id));
      }
      setUnassignedTx(allTx.filter(isUnassigned));
      setUnassignedJobCount(allJobs.filter(isUnassigned).length);

      const inspDocs = inspSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setInspections(inspDocs.filter((i: any) => i.type === "External"));
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, "jobs");
    } finally {
      setLoading(false);
    }
  };

  const handleBarrelsChange = (barrelsStr: string) => {
    const barrels = parseFloat(barrelsStr) || 0;
    // ⚠ A TYPED GROSS SURVIVES A BARRELS CHANGE (AUDIT F97), the same rule the job-number
    // field follows: once the operator has stated a figure, an unrelated edit must not
    // silently overwrite it. The hint under the field names the default and offers the way
    // back, so gross refusing to move is explained rather than looking broken.
    if (formData.oilType === "Fresh" && !formData.grossLitersManual) {
      setFormData((prev) => ({ ...prev, barrels, grossLiters: defaultGrossFor(barrels) }));
    } else {
      setFormData((prev) => ({ ...prev, barrels }));
    }
  };

  const handleOilTypeChange = (type: "Fresh" | "Used") => {
    if (type === "Fresh") {
      // Switching TO Fresh restores the default unless a figure was typed. Switching to Used
      // clears the flag: Used has no default to have overridden (AUDIT F97).
      setFormData((prev) => prev.grossLitersManual
        ? { ...prev, oilType: type }
        : { ...prev, oilType: type, grossLiters: defaultGrossFor(prev.barrels) });
    } else {
      setFormData((prev) => ({ ...prev, oilType: type, grossLitersManual: false }));
    }
  };

  const calculateNetLiters = (gross: number, type: "Fresh" | "Used") => {
    if (type === "Fresh") return gross;
    return gross - gross * 0.05;
  };

  const handleSave = async (e: React.FormEvent) => {
    // ⚠ THE GATE IS IN THE HANDLER, not only on the button. Hiding a control is what the
    // operator sees; this is what happens. An edit is always allowed - correcting oil
    // already recorded under this tender is work on an existing record (AUDIT F83).
    if (!editingId && !intakeGate.open) {
      e.preventDefault();
      alert(`No new oil entries can be recorded against this tender.

${intakeGate.reason}`);
      return;
    }
    e.preventDefault();
    if (!activeAgency || !auth.currentUser) return;

    try {
      const netLiters = calculateNetLiters(
        formData.grossLiters,
        formData.oilType,
      );

      // ⚠ ONE DEFINITION, USED BY BOTH WRITES (AUDIT F97). A flag set on create and forgotten
      // on update is how a corrected row loses its marker and starts reading as a typo again.
      // A value that MATCHES the default is not manual, whatever was typed to reach it - there
      // is nothing for a reader to be warned about.
      const isManualGross =
        formData.oilType === "Fresh" &&
        Number(formData.grossLiters) !== defaultGrossFor(Number(formData.barrels));

      if (editingId) {
        const txRef = doc(db, "oilTransactions", editingId);
        await updateDoc(txRef, {
          mrNo: formData.mrNo,
          mrDate: formData.mrDate,
          date: new Date(formData.date).getTime(),
          division: formData.division,
          oilType: formData.oilType,
          barrels: formData.barrels,
          grossLiters: formData.grossLiters,
          grossLitersManual: isManualGross,
          filtrationLossPercent: formData.oilType === "Fresh" ? 0 : 5,
          netLiters,
        });
      } else {
        const newTx: OilTransaction = {
          agencyId: activeAgency.id,
          ownerId: auth.currentUser.uid,
          mrNo: formData.mrNo,
          mrDate: formData.mrDate,
          date: new Date(formData.date).getTime(),
          division: formData.division,
          oilType: formData.oilType,
          barrels: formData.barrels,
          grossLiters: formData.grossLiters,
          grossLitersManual: isManualGross,
          filtrationLossPercent: formData.oilType === "Fresh" ? 0 : 5,
          netLiters,
          // WHICH TENDER THIS OIL BELONGS TO. Stamped at entry from the active AT, the same
          // way a job is - a transaction cannot be attributed later, because the MR it names
          // may have no jobs to read a tender from (AUDIT F82).
          // ⚠ NO FALLBACK (AUDIT G2). `?? ''` here was unreachable - the handler returns at
          // the intake gate above when no tender is active, and `isIntakeOpen(null, …)` is
          // closed, which covers "all tenders" too. Removed rather than kept, for the same
          // reason as NewJob's: it is the pattern that produced the unassigned rows.
          atId: activeAtMaster!.id,
          createdAt: serverTimestamp(),
        };
        await addDoc(collection(db, "oilTransactions"), newTx);
      }

      handleCancelForm();
      fetchData();
    } catch (error) {
      handleFirestoreError(error, editingId ? OperationType.UPDATE : OperationType.CREATE, "jobs");
    }
  };

  const handleEdit = (tx: OilTransaction) => {
    setFormData({
      mrNo: tx.mrNo,
      mrDate: tx.mrDate || getMrDate(tx.mrNo),
      date: new Date(tx.date).toISOString().split("T")[0],
      division: tx.division,
      oilType: tx.oilType,
      barrels: tx.barrels,
      // ⚠ THE STORED VALUE, NEVER RECOMPUTED (AUDIT F97). Deriving it here would silently
      // restore 210 on any row where a division sent a barrel short - the edit would undo the
      // correction just by being opened.
      grossLiters: tx.grossLiters,
      grossLitersManual: Boolean(tx.grossLitersManual),
    });
    setEditingId(tx.id!);
    setShowAddForm(true);
    setViewMode("transactions");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleCancelForm = () => {
    setShowAddForm(false);
    setEditingId(null);
    setFormData({
      mrNo: "",
      mrDate: new Date().toISOString().split("T")[0],
      date: new Date().toISOString().split("T")[0],
      division: divisions[0] || "",
      oilType: "Fresh",
      barrels: 1,
      grossLiters: FRESH_LITRES_PER_BARREL,
      grossLitersManual: false,
    });
  };

  const mrSummary = useMemo(() => {
    const summary: Record<
      string,
      {
        mrNo: string;
        mrDate: string;
        division: string;
        totalShortage: number;
        totalReceived: number;
      }
    > = {};

    // Group shortage from external inspections via jobs
    jobs.forEach((job) => {
      const mrNo = job.mrNo;
      if (!mrNo) return;
      const mrDate = job.dateOfIssue || job.mrDate || (job.createdAt ? formatDateStr(job.createdAt) : "-");
      if (!summary[mrNo]) {
        summary[mrNo] = {
          mrNo,
          mrDate,
          division: job.division || "",
          totalShortage: 0,
          totalReceived: 0,
        };
      } else if (summary[mrNo].mrDate === "-" && mrDate !== "-") {
        summary[mrNo].mrDate = mrDate;
      }

      const insp = inspectionFor(job, inspections);

      const rawOilCap = insp?.data?.oilCapLtrs ?? insp?.oilCapLtrs ?? job.externalDetails?.oilCapLtrs ?? job.oilCapLtrs ?? job.oilCapacity;
      const rawLessOil = insp?.data?.lessOilLtrs ?? insp?.lessOilLtrs ?? job.externalDetails?.lessOilLtrs ?? job.lessOilLtrs;
      const rawNetShortage = insp?.data?.netShortage ?? insp?.netShortage ?? job.externalDetails?.netShortage;

      const kva = Number(job.capacityKva) || 25;
      const defaultCap = kva <= 16 ? 140 : kva <= 25 ? 184 : kva <= 63 ? 240 : 323;

      const oilCap = (rawOilCap !== undefined && rawOilCap !== null && String(rawOilCap).trim() !== '')
        ? Number(rawOilCap)
        : defaultCap;

      const lessOil = (rawLessOil !== undefined && rawLessOil !== null && String(rawLessOil).trim() !== '')
        ? Number(rawLessOil)
        : 0;

      const oilRecd = Math.max(0, oilCap - lessOil);
      const baseShortage = lessOil;
      const filterLoss = oilRecd * 0.05;
      const netShortage = (typeof rawNetShortage === "number")
        ? rawNetShortage
        : (baseShortage + filterLoss);

      summary[mrNo].totalShortage += netShortage;
    });

    // Group received oil from transactions
    transactions.forEach((tx) => {
      const mrNo = tx.mrNo;
      if (!mrNo) return;
      const txMrDate = tx.mrDate || getMrDate(tx.mrNo);
      if (!summary[mrNo]) {
        summary[mrNo] = {
          mrNo,
          mrDate: txMrDate,
          division: tx.division || "",
          totalShortage: 0,
          totalReceived: 0,
        };
      } else if (summary[mrNo].mrDate === "-" && txMrDate !== "-") {
        summary[mrNo].mrDate = txMrDate;
      }
      summary[mrNo].totalReceived += tx.netLiters;
    });

    return Object.values(summary).sort(
      (a, b) => b.totalShortage - a.totalShortage,
    );
  }, [jobs, inspections, transactions]);

  const availableMrDates = useMemo(() => {
    const dates = new Set<string>();
    mrSummary.forEach((s) => {
      if (s.mrDate && s.mrDate !== "-") dates.add(s.mrDate);
    });
    return Array.from(dates).sort((a, b) => b.localeCompare(a));
  }, [mrSummary]);

  const filteredSummary = useMemo(() => {
    return mrSummary.filter((s) => {
      if (filterDivision !== "All" && s.division !== filterDivision) return false;
      
      if (filterDateMode === "upto" && filterUptoDate.trim() !== "") {
        const uptoTimestamp = parseDateToTimestamp(filterUptoDate);
        const itemTimestamp = parseDateToTimestamp(s.mrDate);
        if (itemTimestamp && uptoTimestamp && itemTimestamp > uptoTimestamp) return false;
      } else if (filterDateMode === "exact" && filterExactDate.trim() !== "") {
        const target = filterExactDate.trim();
        if (!s.mrDate || s.mrDate === "-") return false;
        if (s.mrDate !== target && !s.mrDate.includes(target)) return false;
      }
      return true;
    });
  }, [mrSummary, filterDivision, filterDateMode, filterUptoDate, filterExactDate]);

  const filteredTransactions = useMemo(() => {
    return transactions.filter((t) => {
      if (filterDivision !== "All" && t.division !== filterDivision) return false;
      
      const txMrDate = t.mrDate || getMrDate(t.mrNo) || formatDateStr(t.date);
      if (filterDateMode === "upto" && filterUptoDate.trim() !== "") {
        const uptoTimestamp = parseDateToTimestamp(filterUptoDate);
        const txTimestamp = parseDateToTimestamp(txMrDate);
        if (txTimestamp && uptoTimestamp && txTimestamp > uptoTimestamp) return false;
      } else if (filterDateMode === "exact" && filterExactDate.trim() !== "") {
        const target = filterExactDate.trim();
        if (!txMrDate || txMrDate === "-") return false;
        if (txMrDate !== target && !txMrDate.includes(target)) return false;
      }
      return true;
    });
  }, [transactions, filterDivision, filterDateMode, filterUptoDate, filterExactDate, jobs]);

  // Aggregate stats for filtered criteria
  const subTotalShortage = useMemo(() => {
    return filteredSummary.reduce((sum, item) => sum + item.totalShortage, 0);
  }, [filteredSummary]);

  const subTotalReceived = useMemo(() => {
    return filteredSummary.reduce((sum, item) => sum + item.totalReceived, 0);
  }, [filteredSummary]);

  /**
   * THE BALANCE THIS TENDER OPENED WITH — a recorded figure, not a computed one.
   *
   * Absent is NOT zero and is not shown as zero: an AT with no carried balance has had none
   * confirmed, which is a different statement from "the previous tender closed level"
   * (AUDIT F82).
   */
  const openingBalance = Number((activeAtMaster as any)?.openingOilBalance);
  const hasOpeningBalance = Number.isFinite(openingBalance);

  /**
   * PER DIVISION (AUDIT F86). Oil is settled with a division, so an opening position of
   * "+40 SABARMATI, -30 KALOL" is two facts, not one net of +10 - and the DISCOM is owed
   * 40 in one place while the agency holds 30 in another.
   */
  const openingByDivision = ((activeAtMaster as any)?.openingOilBalanceByDivision || {}) as Record<string, number>;

  /** The tender the opening balance was carried FROM, named rather than implied (AUDIT F88). */
  const openingSourceAt = useMemo(
    () => atMasters.find(t => t.id === (activeAtMaster as any)?.openingOilBalanceFromAtId) || null,
    [atMasters, activeAtMaster],
  );
  const openingSourceLabel = openingSourceAt
    ? `AT ${openingSourceAt.atNumber || openingSourceAt.name}`
    : 'the previous tender';

  /**
   * THE OPENING BALANCE THAT APPLIES TO WHAT IS ON SCREEN (AUDIT F88).
   *
   * ⚠ IT MUST FOLLOW THE DIVISION FILTER, and it did not. `subTotalNetBalance` added the
   * AGENCY-WIDE opening figure to a division-filtered movement, so filtering the register to
   * KALOL showed KALOL's shortage plus every division's carried balance and called the result
   * KALOL's net. The per-division map recorded in F86 is exactly what makes the right answer
   * available; nothing was reading it here.
   *
   * A division with no entry in the map opens at zero, which is correct: the map holds every
   * division that had any movement in the source tender, so absence means no position.
   */
  const openingForFilter = useMemo(() => {
    // ⚠ ZERO IN "ALL TENDERS" MODE, AND NOT BECAUSE THERE IS NO OPENING (AUDIT F89).
    //
    // An opening balance is not oil. It is a bookkeeping figure carried between tenders, and
    // every litre behind it is ALREADY in the transaction and inspection history that the
    // agency-wide view sums. Adding it would count those litres twice.
    //
    // The agency-wide question is a different question, with its own correct answer:
    //   per tender  -> opening balance + that tender's movement
    //   all tenders -> movement alone, across the agency's whole recorded history
    // Both are right. Neither is the other with a filter relaxed.
    if (viewingAllTenders) return 0;
    if (!hasOpeningBalance) return 0;
    if (filterDivision === 'All') return openingBalance;
    return Number(openingByDivision[filterDivision] || 0);
  }, [viewingAllTenders, hasOpeningBalance, openingBalance, openingByDivision, filterDivision]);

  /** The F88 opening lines are per tender, so they do not exist in the agency-wide view. */
  const showOpeningLines = hasOpeningBalance && !viewingAllTenders;

  /**
   * THE CARRIED FIGURE IS KNOWN TO BE SHORT (AUDIT F96). Set at rollover when the source
   * tender held work belonging to no tender, which no per-tender balance can include. Carried
   * anyway - blocking a rollover over old unstamped rows is worse than an approximate figure -
   * so the register is where it must stop looking exact.
   */
  const openingIncomplete = (activeAtMaster as any)?.openingOilBalanceIncomplete as
    { jobs: number; txns: number } | undefined;

  /**
   * THE OPENING POSITION AS LINES — one per division, plus the agency total (AUDIT F88).
   *
   * ONE SOURCE FOR EVERY PLACE IT IS SHOWN: the summary table's opening rows, the panel above
   * the transactions table, and the Excel export. Three renderings of one computation, not
   * three computations - the shape F82 and F87 were both about.
   */
  const openingLines = useMemo(() => {
    if (!hasOpeningBalance) return [];
    const divs = Object.entries(openingByDivision)
      .filter(([div]) => filterDivision === 'All' || div === filterDivision)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([division, v]) => ({ division, litres: Number(v) || 0 }));
    return divs;
  }, [hasOpeningBalance, openingByDivision, filterDivision]);

  /** This tender's own movement, before anything carried in. */
  const tenderNetMovement = useMemo(() => {
    return subTotalShortage - subTotalReceived;
  }, [subTotalShortage, subTotalReceived]);

  /**
   * WHAT IS ACTUALLY OWED: what carried in, plus what this tender moved. A tender that
   * opened at +210 litres and recorded no movement still stands at +210, and a register showing 0
   * would be reporting the paperwork rather than the oil.
   */
  const subTotalNetBalance = useMemo(() => {
    return openingForFilter + tenderNetMovement;
  }, [openingForFilter, tenderNetMovement]);

  /**
   * THE FIGURE THAT WOULD CARRY FORWARD from this tender - offered for confirmation, never
   * written on its own. The carry happens automatically on tender creation (AUDIT F96).
   */
  const closingBalanceForCarry = subTotalNetBalance;

  const exportToExcel = () => {
    const wsData: any[][] = [];

    const filterInfo = `Tender: ${viewingAllTenders ? "ALL TENDERS" : (activeAtMaster ? `AT ${activeAtMaster.atNumber || activeAtMaster.name}` : "none")} | Division: ${filterDivision} | Mode: ${filterDateMode === "upto" ? `Up to ${formatDDMMYYYY(filterUptoDate)}` : filterDateMode === "exact" ? `Date: ${formatDDMMYYYY(filterExactDate)}` : "All Dates"}`;

    /**
     * THE OPENING POSITION IN THE EXPORT TOO (AUDIT F88).
     *
     * ⚠ THE SUB TOTAL ALREADY INCLUDED IT AND NOTHING SAID SO. `subTotalNetBalance` has
     * carried the opening balance since F82, so the exported total was right while the rows
     * above it did not add up to it - a spreadsheet that fails its own arithmetic check with
     * no line to explain the difference. Whoever reconciled it would conclude the total was
     * wrong, which is the opposite of what is true.
     *
     * The direction is written out per line, because a bare "-2120" in a cell someone opens
     * six months from now says nothing about who owes whom.
     */
    /**
     * THE AGENCY-WIDE CAVEATS TRAVEL WITH THE FILE (AUDIT F89). A spreadsheet outlives the
     * screen it was exported from, and this one carries a figure someone may reconcile
     * against the DISCOM's own account months later. Both limits are stated in the sheet.
     */
    const pushScopeNote = (width: number) => {
      const pad = (cells: any[]) => [...cells, ...Array(Math.max(0, width - cells.length)).fill("")];
      if (!viewingAllTenders) return;
      wsData.push(pad(["SCOPE: ALL TENDERS — net from movement alone"]));
      wsData.push(pad(["Opening balances are EXCLUDED: every litre behind them is already in the rows below, and including them would count those litres twice."]));
      wsData.push(pad(["This is the app's recorded history. It matches the DISCOM's oil account only if the agency stood at zero with the division when these records began — any earlier position is not represented here."]));
      wsData.push([]);
    };

    const pushOpeningRows = (width: number) => {
      if (!showOpeningLines) return;
      const pad = (cells: any[]) => [...cells, ...Array(Math.max(0, width - cells.length)).fill("")];
      wsData.push(pad([`PREVIOUS AT NET PENDING — carried forward from ${openingSourceLabel}`]));
      wsData.push(pad(["Division", "Net pending (LTR)", "Direction"]));
      openingLines.forEach(({ division, litres }) => {
        const d = describeOil(litres);
        wsData.push(pad([division, Number(litres.toFixed(2)), d.direction]));
      });
      if (filterDivision === 'All') {
        const d = describeOil(openingBalance);
        wsData.push(pad(["All divisions", Number(openingBalance.toFixed(2)), d.direction]));
      }
      wsData.push([]);
    };

    if (viewMode === "transactions") {
      wsData.push(["OIL INWARD TRANSACTIONS LEDGER"]);
      wsData.push([`Agency: ${activeAgency?.name || ""}`, filterInfo]);
      wsData.push([]);
      pushScopeNote(10);
      pushOpeningRows(10);
      // "Gross source" rather than a symbol beside the number: a spreadsheet is sorted,
      // filtered and re-read by people who never saw this screen (AUDIT F97).
      wsData.push(["Receive Date", "MR No.", "MR Date", "Division", "Oil Type", "Barrels", "Gross (LTR)", "Gross source", "Loss %", "Net (LTR)"]);
      filteredTransactions.forEach((tx) => {
        const date = formatDDMMYYYY(tx.date);
        const mrDate = tx.mrDate || getMrDate(tx.mrNo);
        wsData.push([
          date,
          tx.mrNo,
          mrDate,
          tx.division,
          tx.oilType,
          tx.barrels,
          Number(tx.grossLiters.toFixed(2)),
          tx.grossLitersManual ? `manual (default ${tx.barrels * FRESH_LITRES_PER_BARREL})` : "default",
          tx.filtrationLossPercent,
          Number(tx.netLiters.toFixed(2))
        ]);
      });
      const totalGross = filteredTransactions.reduce((sum, item) => sum + item.grossLiters, 0);
      const totalNet = filteredTransactions.reduce((sum, item) => sum + item.netLiters, 0);
      wsData.push([]);
      wsData.push(["Sub Total", "", "", "", "", "", Number(totalGross.toFixed(2)), "", "", Number(totalNet.toFixed(2))]);
    } else {
      wsData.push(["OIL MR-WISE SHORTAGE & INWARD SUMMARY"]);
      wsData.push([`Agency: ${activeAgency?.name || ""}`, filterInfo]);
      wsData.push([]);
      pushScopeNote(6);
      pushOpeningRows(6);
      wsData.push(["MR No.", "MR Date", "Division", "Total Shortage (LTR)", "Oil Received (LTR)", "Net Pending / Shortage (LTR)"]);
      filteredSummary.forEach((summary) => {
        const pending = summary.totalShortage - summary.totalReceived;
        wsData.push([
          summary.mrNo,
          summary.mrDate,
          summary.division,
          Number(summary.totalShortage.toFixed(2)),
          Number(summary.totalReceived.toFixed(2)),
          Number(pending.toFixed(2))
        ]);
      });
      wsData.push([]);
      wsData.push([
        `SUB TOTAL (${filterDivision !== 'All' ? filterDivision : 'All Divisions'}${filterDateMode === 'upto' ? ` - Up to ${formatDDMMYYYY(filterUptoDate)}` : ''})`,
        "",
        "",
        Number(subTotalShortage.toFixed(2)),
        Number(subTotalReceived.toFixed(2)),
        Number(subTotalNetBalance.toFixed(2))
      ]);
      wsData.push(["", "", "", "", "Direction", describeOil(subTotalNetBalance).direction]);
    }

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, viewMode === "transactions" ? "Transactions" : "MR_Summary");
    const filename = `Oil_Ledger_${filterDivision}_${filterDateMode === "upto" ? `Upto_${filterUptoDate}` : "Report"}.xlsx`;
    XLSX.writeFile(wb, filename);
  };

  if (!activeAgency) {
    return (
      <div className="p-8 text-center text-slate-500">
        Please select or create an agency first.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* THE AGENCY-WIDE VIEW SAYS WHAT IT IS AND WHAT IT IS NOT (AUDIT F89).
          Both caveats are on the screen rather than in a tooltip, because this figure is the
          one an operator would quote to a division. */}
      {viewingAllTenders && (
        <div className="bg-indigo-50 border-2 border-indigo-300 rounded-xl p-3.5 space-y-2">
          {/* RESTYLED, NOT REWORDED (AUDIT G12). Both caveats below keep every word - they
              bound what this figure can be used for. The dot is ADDED: the indigo panel alone
              did not survive a photocopy. */}
          <p className="text-sm font-bold text-indigo-900 flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${TONE.info.dot} shrink-0`} />
            Every tender &mdash; net from movement alone
          </p>
          <p className="text-xs text-indigo-900">
            <strong>Opening balances are excluded.</strong> An opening balance is not oil; it is a
            bookkeeping figure carried from one tender to the next, and every litre behind it is
            already counted in the shortage and inward records below. Including it would count
            those litres twice. This net is
            {' '}<strong>total shortage &minus; total oil received</strong>, across every tender,
            which is the same subtraction the DISCOM&rsquo;s oil account performs without its
            opening column.
          </p>
          {/* ⚠ A CAVEAT WITH NO REMEDY IN THE APP, AND IT STILL HAS TO BE SAID (AUDIT F94).
              It used to end with a link to a manual "record your day-one position" form. That
              form is gone: where a previous tender exists the figure is DERIVED from its jobs
              and transactions and the carry-forward records it, so asking someone to type a
              number the app can compute was the wrong shape.

              What the link offered a remedy for is unchanged and still true - a position that
              predates the app's first record cannot be seen from inside the app. So the caveat
              stays and simply stops pretending there is a button for it. A limit stated without
              a fix is honest; a limit dropped because nothing can be done about it is not. */}
          <p className="text-xs text-amber-900 bg-amber-50 border border-amber-300 rounded-lg p-2.5">
            <strong>This is the app&rsquo;s recorded history, not the division&rsquo;s.</strong> It matches
            the DISCOM&rsquo;s oil account only if the agency stood at zero with the division when
            these records began. Any position that predates them is not represented here, and the
            two figures will differ by exactly that amount for as long as the account runs.
            Reconcile against the division&rsquo;s own oil account before quoting this figure.
          </p>
        </div>
      )}
      {/* OIL BELONGING TO NO TENDER — reachable, countable, and NOT in the balance above
          (AUDIT F87). The same treatment the unassigned jobs backlog gets in MrLedger, and
          for the same reason: a filter working exactly as written while litres the DISCOM is
          owed vanish from the screen is the shape this audit keeps recording. These are shown
          whichever tender is selected, because they belong to none of them. */}
      {/* HIDDEN IN "ALL TENDERS" MODE: there these rows are INCLUDED in the figures
          below, so listing them separately would present counted work as missing
          (AUDIT F89). Same reasoning as the MR Ledger banner. */}
      {!viewingAllTenders && (unassignedTx.length > 0 || unassignedJobCount > 0) && (() => {
        const litres = unassignedTx.reduce((s, t) => s + (Number((t as any).netLiters) || 0), 0);
        return (
          <div className="bg-amber-50 border-2 border-amber-300 rounded-xl overflow-hidden">
            <button
              type="button"
              onClick={() => setShowUnassignedOil(o => !o)}
              className="w-full text-left p-3.5 flex items-start gap-2.5 hover:bg-amber-100/60"
            >
              <Droplet className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-amber-900 flex flex-wrap items-center gap-x-1 gap-y-0.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${TONE.warn.dot} shrink-0`} />
                  {unassignedTx.length > 0 && (
                    <>{unassignedTx.length} oil transaction{unassignedTx.length === 1 ? '' : 's'}
                    {' '}({litres.toFixed(2)} LTR){unassignedJobCount > 0 ? ' and ' : ' '}</>
                  )}
                  {unassignedJobCount > 0 && (
                    <>{unassignedJobCount} job{unassignedJobCount === 1 ? '' : 's'} </>
                  )}
                  belong to no tender
                </p>
                <p className="text-xs text-amber-800 mt-0.5">
                  They carry no AT, so they are in no tender&rsquo;s balance &mdash; not this
                  one&rsquo;s and not any other&rsquo;s. Until each is attributed to the tender its
                  MR belongs to, the balance below is the selected tender&rsquo;s alone and does
                  not account for {unassignedTx.length > 0 ? `these ${litres.toFixed(2)} litres` : 'these jobs'}.
                </p>
              </div>
              <span className="shrink-0 text-xs font-bold px-3 py-1.5 rounded-lg bg-amber-600 text-white">
                {showUnassignedOil ? 'Hide' : 'Show'}
              </span>
            </button>

            {showUnassignedOil && unassignedTx.length > 0 && (
              <div className="border-t-2 border-amber-300 bg-white divide-y divide-slate-100 max-h-72 overflow-y-auto">
                {unassignedTx.map(t => (
                  <div key={t.id} className="p-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs">
                    <span className="font-mono tabular-nums font-bold text-slate-900">MR {t.mrNo || '(no MR)'}</span>
                    <span className="text-slate-600">{t.division || '(no division)'}</span>
                    <span className="text-slate-600">{t.oilType}</span>
                    <span className="font-mono tabular-nums font-bold text-slate-900">
                      {(Number((t as any).netLiters) || 0).toFixed(2)} LTR
                    </span>
                    <span className="text-slate-500">
                      {(() => {
                        const ms = parseDateToTimestamp(t.date);
                        return ms ? formatDDMMYYYY(new Date(ms).toISOString().slice(0, 10)) : '(no date)';
                      })()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {/* Top Header & Stat Cards */}
      <div className={`${CARD} ${CARD_PAD} space-y-3`}>
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900 flex items-center">
              <Droplet className="w-6 h-6 mr-3 text-blue-600" />
              Oil Ledger & Shortage Account - {activeAgency.name}
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              Manage inward oil, filter by concern division and up to MR date to cross-check billing shortage subtotals.
            </p>
          </div>

          {/* Quick Stat Cards */}
          <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
            <div className="bg-amber-50 border border-amber-200 rounded px-3 py-2 text-right">
              <div className="text-[10px] uppercase font-bold text-amber-700">
                Sub Total Shortage
              </div>
              <div className="text-base font-mono tabular-nums font-bold text-amber-900">
                {subTotalShortage.toFixed(2)} LTR
              </div>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded px-3 py-2 text-right">
              <div className="text-[10px] uppercase font-bold text-blue-700">
                Inward Received
              </div>
              <div className="text-base font-mono tabular-nums font-bold text-blue-900">
                {subTotalReceived.toFixed(2)} LTR
              </div>
            </div>

            {/* WHAT CARRIED IN FROM THE PREVIOUS TENDER, shown beside what this one moved.
                Absent is not zero: an AT with no carried balance has had none CONFIRMED, and
                saying "0.00" would assert that the previous tender closed level (AUDIT F82). */}
            <div className={`border rounded px-3 py-2 text-right ${
              !activeAtMaster ? 'bg-slate-50 border-slate-200 text-slate-500'
                : hasOpeningBalance ? 'bg-indigo-50 border-indigo-200 text-indigo-900'
                : 'bg-amber-50 border-amber-300 text-amber-900'}`}>
              <div className="text-[10px] uppercase font-bold opacity-80">Opening balance</div>
              <div className="font-mono tabular-nums font-black text-sm">
                {viewingAllTenders ? 'excluded'
                  : hasOpeningBalance ? describeOil(openingBalance).signed : 'not carried forward'}
              </div>
              <div className="text-[9px] opacity-70">
                {/* THE SOURCE TENDER BY NAME, and the direction in words (AUDIT F88). It said
                    "the previous tender" while the record names exactly which one, and showed
                    a sign with nothing saying which way it ran. */}
                {viewingAllTenders
                  ? 'not applicable across tenders — the movement below already contains it'
                  : hasOpeningBalance
                  ? `${describeOil(openingBalance).direction} · from ${openingSourceLabel}`
                  : 'no balance has been confirmed for this tender'}
              </div>
              {/* THE DIVISIONS BEHIND THE TOTAL. A single figure hides that one division is
                  owed oil while another holds it, and that is what gets settled. */}
              {hasOpeningBalance && Object.keys(openingByDivision).length > 0 && (
                <div className="mt-1 pt-1 border-t border-indigo-200 space-y-0.5">
                  {Object.entries(openingByDivision).sort(([a], [b]) => a.localeCompare(b)).map(([div, v]) => (
                    <div key={div} className="flex items-baseline justify-between gap-2 text-[10px]">
                      <span className="font-semibold opacity-80">{div}</span>
                      <span className="font-mono tabular-nums font-bold">
                        {Number(v) >= 0 ? '+' : ''}{Number(v).toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className={`border rounded px-3 py-2 text-right ${subTotalNetBalance > 0 ? 'bg-rose-50 border-rose-200 text-rose-900' : subTotalNetBalance < 0 ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-slate-50 border-slate-200 text-slate-900'}`}>
              <div className="text-[10px] uppercase font-bold opacity-80">
                Net Balance
              </div>
              <div className="text-base font-mono tabular-nums font-black">
                {describeOil(subTotalNetBalance).signed}
              </div>
              <div className="text-[9px] font-bold uppercase tracking-wide opacity-80">
                {describeOil(subTotalNetBalance).direction}
              </div>
            </div>
          </div>
        </div>

        {/* Filter Controls Bar */}
        <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-slate-100">
          {/* Division Filter */}
          <div className="flex items-center space-x-2 bg-slate-50 border border-slate-200 rounded px-3 py-1.5">
            <span className="text-[10px] uppercase font-bold text-slate-500">
              Concern Division:
            </span>
            <select
              value={filterDivision}
              onChange={(e) => setFilterDivision(e.target.value)}
              className="text-sm border-none bg-transparent font-bold text-slate-700 focus:ring-0 cursor-pointer outline-none"
            >
              <option value="All">All Divisions</option>
              {divisions.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>

          {/* Date Filter Mode */}
          <div className="flex items-center space-x-1 bg-slate-100 p-1 rounded border border-slate-200 text-xs">
            <button
              type="button"
              onClick={() => {
                setFilterDateMode("all");
                setFilterUptoDate("");
                setFilterExactDate("");
              }}
              className={`px-2.5 py-1 rounded font-bold transition-all ${filterDateMode === "all" ? "bg-white text-blue-700 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
            >
              All Dates
            </button>
            <button
              type="button"
              onClick={() => {
                setFilterDateMode("upto");
                if (!filterUptoDate && availableMrDates.length > 0) {
                  setFilterUptoDate(availableMrDates[0]);
                }
              }}
              className={`px-2.5 py-1 rounded font-bold transition-all flex items-center ${filterDateMode === "upto" ? "bg-blue-600 text-white shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
            >
              <Calendar className="w-3.5 h-3.5 mr-1" />
              Up to MR Date (Cumulative)
            </button>
            <button
              type="button"
              onClick={() => {
                setFilterDateMode("exact");
                if (!filterExactDate && availableMrDates.length > 0) {
                  setFilterExactDate(availableMrDates[0]);
                }
              }}
              className={`px-2.5 py-1 rounded font-bold transition-all ${filterDateMode === "exact" ? "bg-white text-blue-700 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
            >
              Exact MR Date
            </button>
          </div>

          {/* Date Selector for Upto Mode */}
          {filterDateMode === "upto" && (
            <div className="flex items-center space-x-2 bg-blue-50 border border-blue-200 rounded px-3 py-1.5 animate-fadeIn">
              <span className="text-[10px] uppercase font-bold text-blue-700">
                Up to Date:
              </span>
              <input
                type="date"
                value={filterUptoDate}
                onChange={(e) => setFilterUptoDate(e.target.value)}
                className="text-xs font-mono tabular-nums font-bold bg-white border border-blue-300 rounded px-2 py-1 text-slate-800 focus:outline-none"
              />
              {availableMrDates.length > 0 && (
                <select
                  value={filterUptoDate}
                  onChange={(e) => setFilterUptoDate(e.target.value)}
                  className="text-xs font-mono tabular-nums font-semibold bg-white border border-blue-300 rounded px-2 py-1 text-slate-700 focus:outline-none max-w-[140px]"
                >
                  <option value="">-- Pick MR Date --</option>
                  {availableMrDates.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* Date Selector for Exact Mode */}
          {filterDateMode === "exact" && (
            <div className="flex items-center space-x-2 bg-slate-50 border border-slate-200 rounded px-3 py-1.5 animate-fadeIn">
              <span className="text-[10px] uppercase font-bold text-slate-600">
                Exact Date:
              </span>
              <input
                type="date"
                value={filterExactDate}
                onChange={(e) => setFilterExactDate(e.target.value)}
                className="text-xs font-mono tabular-nums font-bold bg-white border border-slate-300 rounded px-2 py-1 text-slate-800 focus:outline-none"
              />
              {availableMrDates.length > 0 && (
                <select
                  value={filterExactDate}
                  onChange={(e) => setFilterExactDate(e.target.value)}
                  className="text-xs font-mono tabular-nums font-semibold bg-white border border-slate-300 rounded px-2 py-1 text-slate-700 focus:outline-none max-w-[140px]"
                >
                  <option value="">-- Pick MR Date --</option>
                  {availableMrDates.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* Clear Filters */}
          {(filterDivision !== "All" || filterDateMode !== "all") && (
            <button
              type="button"
              onClick={() => {
                setFilterDivision("All");
                setFilterDateMode("all");
                setFilterUptoDate("");
                setFilterExactDate("");
              }}
              className="flex items-center px-2.5 py-1.5 text-xs text-rose-600 hover:bg-rose-50 border border-rose-200 rounded font-semibold transition-colors"
            >
              <X className="w-3.5 h-3.5 mr-1" />
              Reset Filters
            </button>
          )}
        </div>

        {/* Cross-check Banner */}
        {filterDivision !== "All" && filterDateMode === "upto" && filterUptoDate && (
          <div className="bg-blue-50 border border-blue-200 text-blue-900 rounded p-3 text-xs flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <span className="font-bold uppercase tracking-wider text-[10px] bg-blue-600 text-white px-2 py-0.5 rounded">
                Billing Reconciliation
              </span>
              <span>
                Cumulative oil account for <strong>{filterDivision}</strong> up to <strong>{formatDDMMYYYY(filterUptoDate)}</strong>.
                Sub Total Shortage: <strong className="font-mono tabular-nums">{subTotalShortage.toFixed(2)} LTR</strong> |
                Total Inward: <strong className="font-mono tabular-nums">{subTotalReceived.toFixed(2)} LTR</strong> |
                Net Due: <strong className="font-mono tabular-nums">{subTotalNetBalance >= 0 ? '+' : ''}{subTotalNetBalance.toFixed(2)} LTR</strong>.
              </span>
            </div>
          </div>
        )}
      </div>

      <div className={CARD}>
        <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
          <div className="flex space-x-2">
            <button
              onClick={() => {
                setViewMode("transactions");
                setShowAddForm(false);
                setEditingId(null);
              }}
              className={`px-4 py-2 text-sm font-bold rounded transition-colors flex items-center ${
                viewMode === "transactions"
                  ? "bg-white text-blue-700 shadow-sm border border-slate-200"
                  : "text-slate-500 hover:bg-slate-200 border border-transparent"
              }`}
            >
              <List className="w-4 h-4 mr-2" />
              Inward Transactions
            </button>
            <button
              onClick={() => {
                setViewMode("summary");
                setShowAddForm(false);
                setEditingId(null);
              }}
              className={`px-4 py-2 text-sm font-bold rounded transition-colors flex items-center ${
                viewMode === "summary"
                  ? "bg-white text-blue-700 shadow-sm border border-slate-200"
                  : "text-slate-500 hover:bg-slate-200 border border-transparent"
              }`}
            >
              <BarChart2 className="w-4 h-4 mr-2" />
              MR Wise Shortage Summary
            </button>
          </div>

          <div className="flex space-x-2">
            <button
              onClick={exportToExcel}
              className="flex items-center px-3 py-1.5 text-xs font-bold uppercase tracking-wider bg-slate-100 text-slate-700 border border-slate-300 rounded hover:bg-slate-200 transition-colors"
            >
              <Download className="w-4 h-4 mr-1" />
              Export Excel
            </button>
            {viewMode === "transactions" && (
              <button
                onClick={() =>
                  showAddForm ? handleCancelForm() : setShowAddForm(true)
                }
                className="flex items-center px-3 py-1.5 text-xs font-bold uppercase tracking-wider bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
              >
                {showAddForm ? (
                  <X className="w-4 h-4 mr-1" />
                ) : (
                  <Plus className="w-4 h-4 mr-1" />
                )}
                {showAddForm ? "Cancel" : "Receive Oil"}
              </button>
            )}
          </div>
        </div>

        {viewMode === "transactions" && showAddForm && (
          <div className="p-4 border-b border-slate-200 bg-blue-50/30">
            <form
              onSubmit={handleSave}
              className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4"
            >
              <div>
                <label className="block text-xs font-bold uppercase text-slate-500 mb-1">
                  MR No.
                </label>
                <div className="relative">
                  <FileText className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                  <input
                    required
                    type="text"
                    value={formData.mrNo}
                    onChange={(e) => handleMrNoChange(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-sm border rounded focus:ring-1 focus:ring-blue-500"
                    placeholder="e.g. MR-1234"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-slate-500 mb-1">
                  MR Date
                </label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                  <input
                    type="date"
                    value={formData.mrDate}
                    onChange={(e) =>
                      setFormData({ ...formData, mrDate: e.target.value })
                    }
                    className="w-full pl-9 pr-3 py-2 text-sm border rounded focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-slate-500 mb-1">
                  Date of Receive
                </label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                  <input
                    required
                    type="date"
                    value={formData.date}
                    onChange={(e) =>
                      setFormData({ ...formData, date: e.target.value })
                    }
                    className="w-full pl-9 pr-3 py-2 text-sm border rounded focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-slate-500 mb-1">
                  Division
                </label>
                <div className="relative">
                  <Building className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                  <select
                    required
                    value={formData.division}
                    onChange={(e) =>
                      setFormData({ ...formData, division: e.target.value })
                    }
                    className="w-full pl-9 pr-3 py-2 text-sm border rounded focus:ring-1 focus:ring-blue-500"
                  >
                    {divisions.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-slate-500 mb-1">
                  Oil Type
                </label>
                <select
                  required
                  value={formData.oilType}
                  onChange={(e) =>
                    handleOilTypeChange(e.target.value as "Fresh" | "Used")
                  }
                  className="w-full px-3 py-2 text-sm border rounded focus:ring-1 focus:ring-blue-500"
                >
                  <option value="Fresh">Fresh Oil</option>
                  <option value="Used">Used Oil (5% Loss)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase text-slate-500 mb-1">
                  No. of Barrels
                </label>
                <input
                  required
                  type="number"
                  step="0.01"
                  value={formData.barrels}
                  onChange={(e) => handleBarrelsChange(e.target.value)}
                  className="w-full px-3 py-2 text-sm border rounded focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase text-slate-500 mb-1">
                  Gross Liters
                </label>
                {/* ⚠ NO LONGER readOnly FOR FRESH, AND THE TOOLTIP NO LONGER SAYS IT IS
                    (AUDIT F97). It read "Fresh oil is fixed at 210L per barrel", which was a
                    policy statement the field enforced and which is not true: a division can
                    send a barrel short. A tooltip left contradicting the control it labels is
                    worse than no tooltip. */}
                <input
                  required
                  type="number"
                  step="0.01"
                  value={formData.grossLiters}
                  onChange={(e) => {
                    const typed = parseFloat(e.target.value) || 0;
                    setFormData((prev) => ({
                      ...prev,
                      grossLiters: typed,
                      // Typing the default back is not "manual" - it is agreeing with it, and
                      // it restores the recompute-on-barrels-change behaviour.
                      grossLitersManual:
                        prev.oilType === "Fresh" && typed !== defaultGrossFor(prev.barrels),
                    }));
                  }}
                  className={`w-full px-3 py-2 text-sm border rounded focus:ring-1 focus:ring-blue-500 bg-white ${
                    formData.grossLitersManual ? 'border-amber-400 ring-1 ring-amber-200' : ''
                  }`}
                  title={
                    formData.oilType === "Fresh"
                      ? `Defaults to ${FRESH_LITRES_PER_BARREL} L per barrel. Type over it if the division sent a barrel short.`
                      : "Enter actual received quantity for used oil"
                  }
                />
                {/* THE HINT: why gross did not move, and the way back (AUDIT F97). Without it,
                    typing barrels and seeing gross stay put reads as a broken field. */}
                {formData.grossLitersManual && (
                  <p className="mt-1 text-[11px] text-amber-800">
                    <strong>Manual figure.</strong> The default for {formData.barrels}{' '}
                    barrel{formData.barrels === 1 ? '' : 's'} would be{' '}
                    {defaultGrossFor(formData.barrels)} L, and changing barrels will not
                    overwrite what you typed.{' '}
                    <button
                      type="button"
                      onClick={() => setFormData((prev) => ({
                        ...prev,
                        grossLiters: defaultGrossFor(prev.barrels),
                        grossLitersManual: false,
                      }))}
                      className="font-bold underline hover:text-amber-900"
                    >
                      Use the default
                    </button>
                  </p>
                )}
              </div>

              <div className="col-span-1 md:col-span-2 lg:col-span-1 flex items-end">
                <div className="bg-slate-100 p-3 rounded border border-slate-200 w-full flex justify-between items-center">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-500 block">
                      Calculation Preview
                    </span>
                    <span className="text-sm text-slate-700">
                      {formData.grossLiters} LTR -{" "}
                      {formData.oilType === "Fresh" ? "0%" : "5%"} Loss
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-lg font-mono tabular-nums font-bold text-green-700">
                      ={" "}
                      {calculateNetLiters(
                        formData.grossLiters,
                        formData.oilType,
                      ).toFixed(2)}{" "}
                      Net LTR
                    </span>
                  </div>
                </div>
              </div>

              <div className="col-span-1 md:col-span-2 lg:col-span-4 flex justify-end mt-2 space-x-2">
                {editingId && (
                  <button
                    type="button"
                    onClick={handleCancelForm}
                    className="px-6 py-2 text-sm font-bold uppercase tracking-wider text-slate-500 border border-transparent hover:bg-slate-100 rounded transition-colors"
                  >
                    Cancel Edit
                  </button>
                )}
                {/* A NEW ENTRY OBEYS THE TENDER GATE; AN EDIT DOES NOT (AUDIT F83).
                    `editingId` is the distinction: correcting oil already recorded under
                    this tender is work on an existing record, which an old tender stays
                    open for. Only a NEW entry creates work. */}
                {(editingId || intakeGate.open) ? (
                  <button
                    type="submit"
                    className="flex items-center px-6 py-2 text-sm font-bold uppercase tracking-wider bg-green-600 text-white rounded hover:bg-green-700 transition-colors"
                  >
                    <Save className="w-4 h-4 mr-2" />
                    {editingId ? "Update Entry" : "Save Inward Entry"}
                  </button>
                ) : (
                  <span className="inline-flex items-start gap-1.5 px-2.5 py-1.5 text-xs font-semibold bg-amber-50 text-amber-900 border border-l-2 border-l-amber-500 border-amber-300 rounded max-w-md">
                    {/* Dot added; the reason itself is untouched (AUDIT G12). */}
                    <span className={`w-1.5 h-1.5 rounded-full ${TONE.warn.dot} shrink-0 mt-1`} />
                    No new oil entries: {intakeGate.reason} Oil already recorded under this
                    tender stays in its balance and can still be corrected.
                  </span>
                )}
              </div>
            </form>
          </div>
        )}

        {/* THE OPENING POSITION ABOVE THE TRANSACTIONS LEDGER (AUDIT F88).
            The same lines the summary register carries as rows, from the same computation -
            rendered as a panel here only because this table's columns (barrels, gross, loss %)
            have no meaning for a carried balance. The numbers are `openingLines`, never a
            second derivation of them. */}
        {!loading && showOpeningLines && viewMode === "transactions" && (
          <div className="mx-4 mb-3 rounded-lg border border-indigo-200 bg-indigo-50 overflow-hidden">
            <div className="px-3 py-2 border-b border-indigo-200 bg-indigo-100/70">
              <span className="text-[10px] uppercase font-black tracking-widest text-indigo-900">
                Previous AT net pending
              </span>
              <span className="ml-2 text-[11px] font-bold text-indigo-800">
                carried forward from {openingSourceLabel}
              </span>
              {/* NEVER PRESENTED AS EXACT WHEN IT IS NOT (AUDIT F96). The rollover carried the
                  figure rather than refusing over old unstamped rows; this is where that
                  trade-off is disclosed. */}
              {openingIncomplete && (
                <div className="mt-1 text-[11px] text-amber-900 bg-amber-50 border border-amber-300 rounded px-2 py-1">
                  <strong>Approximate.</strong> When this tender opened,{' '}
                  {[openingIncomplete.txns > 0 && `${openingIncomplete.txns} oil transaction${openingIncomplete.txns === 1 ? '' : 's'}`,
                    openingIncomplete.jobs > 0 && `${openingIncomplete.jobs} job${openingIncomplete.jobs === 1 ? '' : 's'}`]
                    .filter(Boolean).join(' and ')}{' '}
                  belonged to no tender, so no tender&rsquo;s closing balance accounted for them.
                  This figure is short by whatever they hold.
                </div>
              )}
            </div>
            <div className="divide-y divide-indigo-200/70">
              {openingLines.map(({ division, litres }) => {
                const d = describeOil(litres);
                return (
                  <div key={`opening-panel-${division}`} className="px-3 py-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                    <span className="text-xs font-bold text-indigo-900">{division}</span>
                    <span className="flex items-baseline gap-2">
                      <span className={`font-mono tabular-nums font-black text-sm ${d.agencyIsOwed ? 'text-red-700' : d.sign ? 'text-emerald-700' : 'text-slate-700'}`}>
                        {d.signed}
                      </span>
                      <span className="text-[10px] font-bold uppercase tracking-wide text-indigo-800">
                        {d.direction}
                      </span>
                    </span>
                  </div>
                );
              })}
              {filterDivision === 'All' && (() => {
                const d = describeOil(openingBalance);
                return (
                  <div className="px-3 py-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 bg-indigo-100">
                    <span className="text-xs font-black uppercase tracking-wider text-indigo-900">
                      All divisions
                    </span>
                    <span className="flex items-baseline gap-2">
                      <span className={`font-mono tabular-nums font-black text-sm ${d.agencyIsOwed ? 'text-red-700' : d.sign ? 'text-emerald-700' : 'text-slate-700'}`}>
                        {d.signed}
                      </span>
                      <span className="text-[10px] font-bold uppercase tracking-wide text-indigo-800">
                        {d.direction}
                      </span>
                    </span>
                  </div>
                );
              })()}
              {openingLines.length === 0 && (
                <div className="px-3 py-2 text-[11px] text-indigo-800">
                  The carried balance has no per-division breakdown recorded
                  {filterDivision !== 'All' ? ` for ${filterDivision}` : ''}.
                </div>
              )}
            </div>
          </div>
        )}

        {/* ⚠ SCROLLS SIDEWAYS, HIDES NOTHING (AUDIT G12). The transactions table has ten
            columns and the summary six; an operator reconciling oil against a division needs
            every one of them. A register missing its middle columns on a narrow screen is a
            different and wrong register. */}
        <div className={TABLE_WRAP}>
          {viewMode === "transactions" ? (
            <table className={TABLE}>
              <thead className="bg-slate-50 text-xs uppercase text-slate-500 font-bold border-b border-slate-200">
                <tr>
                  <th className={`${TH}`}>Receive Date</th>
                  <th className={`${TH}`}>MR No.</th>
                  <th className={`${TH}`}>MR Date</th>
                  <th className={`${TH}`}>Division</th>
                  <th className={`${TH}`}>Oil Type</th>
                  <th className={`${TH} text-right`}>Barrels</th>
                  <th className={`${TH} text-right`}>Gross (LTR)</th>
                  <th className={`${TH} text-right`}>Loss %</th>
                  <th className={`${TH} text-right text-green-700 font-bold`}>
                    Net (LTR)
                  </th>
                  <th className={`${TH} text-center`}>Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td
                      colSpan={10}
                      className="px-4 py-8 text-center text-slate-500"
                    >
                      Loading records...
                    </td>
                  </tr>
                ) : filteredTransactions.length === 0 ? (
                  <tr>
                    <td
                      colSpan={10}
                      className="px-4 py-8 text-center text-slate-500"
                    >
                      No oil inward records found for this selection.
                    </td>
                  </tr>
                ) : (
                  filteredTransactions.map((tx, idx) => {
                    const mrDateVal = tx.mrDate || getMrDate(tx.mrNo);
                    return (
                      <tr
                        key={tx.id || idx}
                        className={`hover:bg-slate-50 ${editingId === tx.id ? "bg-blue-50/50" : ""}`}
                      >
                        <td className={`${TD} whitespace-nowrap`}>
                          {formatDDMMYYYY(tx.date)}
                        </td>
                        <td className={`${TD} font-medium text-slate-900`}>
                          {tx.mrNo}
                        </td>
                        <td className={`${TD} whitespace-nowrap text-slate-700`}>
                          {formatDDMMYYYY(mrDateVal)}
                        </td>
                        <td className={`${TD} whitespace-nowrap`}>
                          {tx.division}
                        </td>
                        <td className={`${TD}`}>
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${tx.oilType === "Fresh" ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700"}`}
                          >
                            {tx.oilType}
                          </span>
                        </td>
                        <td className={`${TD} text-right font-mono tabular-nums`}>
                          {tx.barrels}
                        </td>
                        {/* THE MARKER (AUDIT F97). Every other Fresh row is a multiple of
                            210, so 195 beside "1 barrel" reads as a typo without it - and the
                            reader most likely to 'correct' it is reconciling months later. */}
                        <td className={`${TD} text-right font-mono tabular-nums`}>
                          {tx.grossLiters.toFixed(2)}
                          {tx.grossLitersManual && (
                            <span
                              title={`Typed by the operator. The default for ${tx.barrels} barrel(s) would be ${tx.barrels * FRESH_LITRES_PER_BARREL} L.`}
                              className="ml-1.5 align-middle text-[9px] font-bold uppercase tracking-wide text-amber-800 bg-amber-100 border border-amber-300 px-1 py-0.5 rounded"
                            >
                              manual
                            </span>
                          )}
                        </td>
                        <td className={`${TD} text-right font-mono tabular-nums text-slate-400`}>
                          {tx.filtrationLossPercent}%
                        </td>
                        <td className={`${TD} text-right font-mono tabular-nums font-bold text-green-700`}>
                          {tx.netLiters.toFixed(2)}
                        </td>
                        <td className={`${TD} text-center`}>
                          <button
                            onClick={() => handleEdit(tx)}
                            className="p-1.5 text-blue-600 hover:bg-blue-100 rounded transition-colors"
                            title="Edit transaction"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
                {/* Aggregate Totals for Transactions */}
                {!loading && filteredTransactions.length > 0 && (
                  <tr className="bg-slate-100 font-bold text-slate-900 border-t-2 border-slate-300">
                    <td
                      colSpan={6}
                      className="px-4 py-3 text-right uppercase text-xs tracking-wider"
                    >
                      SUB TOTAL ({filterDivision !== 'All' ? filterDivision : 'All Divisions'}{filterDateMode === 'upto' ? ` - Up to ${formatDDMMYYYY(filterUptoDate)}` : ''}):
                    </td>
                    <td className={`${TD} text-right font-mono tabular-nums`}>
                      {filteredTransactions
                        .reduce((sum, item) => sum + item.grossLiters, 0)
                        .toFixed(2)}
                    </td>
                    <td></td>
                    <td className={`${TD} text-right font-mono tabular-nums text-green-700`}>
                      {filteredTransactions
                        .reduce((sum, item) => sum + item.netLiters, 0)
                        .toFixed(2)}
                    </td>
                    <td></td>
                  </tr>
                )}
              </tbody>
            </table>
          ) : (
            <table className={TABLE}>
              <thead className="bg-slate-50 text-xs uppercase text-slate-500 font-bold border-b border-slate-200">
                <tr>
                  <th className={`${TH}`}>MR No.</th>
                  <th className={`${TH}`}>MR Date</th>
                  <th className={`${TH}`}>Division</th>
                  <th className={`${TH} text-right text-amber-700`}>
                    Total Shortage (LTR)
                  </th>
                  <th className={`${TH} text-right text-blue-700`}>
                    Oil Received (LTR)
                  </th>
                  <th className={`${TH} text-right text-slate-900 font-bold`}>
                    Net Pending / Shortage (LTR)
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {/* THE OPENING POSITION, AS LINES IN THE REGISTER (AUDIT F88).
                    Not a figure in a summary card off to one side - a labelled line per
                    division at the head of the ledger, naming the tender it came from and
                    saying in words which way it runs. A carried balance is part of what is
                    owed, so it belongs in the register that reports what is owed. */}
                {!loading && showOpeningLines && (
                  <>
                    {openingLines.map(({ division, litres }) => {
                      const d = describeOil(litres);
                      return (
                        <tr key={`opening-${division}`} className="bg-indigo-50/60">
                          <td className="px-4 py-2.5 font-bold text-indigo-900" colSpan={2}>
                            Previous AT net pending &mdash; carried from {openingSourceLabel}
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap font-semibold text-indigo-900">
                            {division}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono tabular-nums text-indigo-400" colSpan={2}>
                            &mdash;
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <span className={`font-mono tabular-nums font-black ${d.agencyIsOwed ? 'text-red-700' : d.sign ? 'text-emerald-700' : 'text-slate-700'}`}>
                              {d.signed}
                            </span>
                            {/* THE DIRECTION IN WORDS, beside the number and not inferable
                                from it. "-2120.00" alone does not say who owes whom. */}
                            <span className="block text-[10px] font-bold uppercase tracking-wide text-indigo-800">
                              {d.direction}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                    {/* The agency total alongside the divisions, because both are settled:
                        the divisions individually, and the agency's overall position. */}
                    {filterDivision === 'All' && (() => {
                      const d = describeOil(openingBalance);
                      return (
                        <tr className="bg-indigo-100 border-t border-indigo-200">
                          <td className="px-4 py-2.5 font-black text-indigo-900 uppercase text-xs tracking-wider" colSpan={3}>
                            Opening balance, all divisions &mdash; carried from {openingSourceLabel}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono tabular-nums text-indigo-400" colSpan={2}>
                            &mdash;
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <span className={`font-mono tabular-nums font-black ${d.agencyIsOwed ? 'text-red-700' : d.sign ? 'text-emerald-700' : 'text-slate-700'}`}>
                              {d.signed}
                            </span>
                            <span className="block text-[10px] font-bold uppercase tracking-wide text-indigo-800">
                              {d.direction}
                            </span>
                          </td>
                        </tr>
                      );
                    })()}
                  </>
                )}
                {loading ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-8 text-center text-slate-500"
                    >
                      Loading summary...
                    </td>
                  </tr>
                ) : filteredSummary.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-8 text-center text-slate-500"
                    >
                      No external inspections or oil records found for this
                      selection.
                    </td>
                  </tr>
                ) : (
                  filteredSummary.map((summary, idx) => {
                    const pending =
                      summary.totalShortage - summary.totalReceived;
                    return (
                      <tr key={idx} className="hover:bg-slate-50">
                        <td className={`${TD} font-medium text-slate-900`}>
                          {summary.mrNo}
                        </td>
                        <td className={`${TD} whitespace-nowrap text-slate-700`}>
                          {formatDDMMYYYY(summary.mrDate)}
                        </td>
                        <td className={`${TD} whitespace-nowrap`}>
                          {summary.division}
                        </td>
                        <td className={`${TD} text-right font-mono tabular-nums text-amber-700`}>
                          {summary.totalShortage.toFixed(2)}
                        </td>
                        <td className={`${TD} text-right font-mono tabular-nums text-blue-700`}>
                          {summary.totalReceived.toFixed(2)}
                        </td>
                        <td className={`${TD} text-right font-mono tabular-nums font-bold`}>
                          <span
                            className={
                              pending > 0 ? "text-red-600" : "text-green-600"
                            }
                          >
                            {pending > 0 ? `+${pending.toFixed(2)}` : pending.toFixed(2)}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
                {/* Aggregate Totals Row.
                    ⚠ ALSO RENDERED WITH NO MR ROWS, when a balance carried in (AUDIT F88). A
                    tender that opened at +2120 litres and has recorded no movement yet still
                    stands at +2120, and suppressing the total because the MR list is empty would
                    report the paperwork rather than the oil. */}
                {!loading && (filteredSummary.length > 0 || showOpeningLines) && (() => {
                  const d = describeOil(subTotalNetBalance);
                  return (
                  <tr className="bg-slate-100 font-bold text-slate-900 border-t-2 border-slate-300">
                    <td
                      colSpan={3}
                      className="px-4 py-3 text-right uppercase text-xs tracking-wider"
                    >
                      SUB TOTAL ({filterDivision !== 'All' ? filterDivision : 'All Divisions'}{filterDateMode === 'upto' ? ` - Up to ${formatDDMMYYYY(filterUptoDate)}` : ''}):
                      {showOpeningLines && (
                        <span className="block normal-case tracking-normal text-[10px] font-semibold text-indigo-800">
                          includes {describeOil(openingForFilter).signed} carried from {openingSourceLabel}
                        </span>
                      )}
                    </td>
                    <td className={`${TD} text-right font-mono tabular-nums text-amber-700 font-bold`}>
                      {subTotalShortage.toFixed(2)}
                    </td>
                    <td className={`${TD} text-right font-mono tabular-nums text-blue-700 font-bold`}>
                      {subTotalReceived.toFixed(2)}
                    </td>
                    <td className={`${TD} text-right`}>
                      <span className={`font-mono tabular-nums font-black ${d.agencyIsOwed ? 'text-red-700' : d.sign ? 'text-emerald-700' : 'text-slate-900'}`}>
                        {d.signed}
                      </span>
                      <span className="block text-[10px] font-bold uppercase tracking-wide text-slate-700">
                        {d.direction}
                      </span>
                    </td>
                  </tr>
                  );
                })()}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
