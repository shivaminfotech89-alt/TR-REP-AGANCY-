import React, { useState, useEffect, useMemo } from "react";
import { useAgency } from "../lib/AgencyContext";
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
  grossLiters: number;
  filtrationLossPercent: number;
  netLiters: number;
  createdAt?: any;
  ownerId?: string;
}

export default function OilInward() {
  const { activeAgency, activeAtMaster } = useAgency();
  const [transactions, setTransactions] = useState<OilTransaction[]>([]);
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
    grossLiters: 210,
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
  }, [activeAgency]);

  const fetchData = async () => {
    setLoading(true);
    try {
      if (!auth.currentUser || !activeAgency) return;

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

      const txDocs = txSnap.docs.map(
        (d) => ({ id: d.id, ...d.data() }) as OilTransaction,
      );
      txDocs.sort((a, b) => b.date - a.date);
      setTransactions(txDocs);

      setJobs(jobsSnap.docs.map((d) => ({ id: d.id, ...d.data() })));

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
    if (formData.oilType === "Fresh") {
      setFormData((prev) => ({ ...prev, barrels, grossLiters: barrels * 210 }));
    } else {
      setFormData((prev) => ({ ...prev, barrels }));
    }
  };

  const handleOilTypeChange = (type: "Fresh" | "Used") => {
    if (type === "Fresh") {
      setFormData((prev) => ({
        ...prev,
        oilType: type,
        grossLiters: prev.barrels * 210,
      }));
    } else {
      setFormData((prev) => ({ ...prev, oilType: type }));
    }
  };

  const calculateNetLiters = (gross: number, type: "Fresh" | "Used") => {
    if (type === "Fresh") return gross;
    return gross - gross * 0.05;
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeAgency || !auth.currentUser) return;

    try {
      const netLiters = calculateNetLiters(
        formData.grossLiters,
        formData.oilType,
      );

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
          filtrationLossPercent: formData.oilType === "Fresh" ? 0 : 5,
          netLiters,
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
      grossLiters: tx.grossLiters,
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
      grossLiters: 210,
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

      const insp = inspections.find(i => 
        (i.jobId === job.id || i.jobId === job.jobNo || i.id === job.inspectionId || (i.mrNo === job.mrNo && i.jobNo === job.jobNo)) &&
        (i.type === 'External' || !i.type || i.data?.oilCapLtrs !== undefined)
      ) || inspections.find(i => i.jobId === job.id);

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

  const subTotalNetBalance = useMemo(() => {
    return subTotalShortage - subTotalReceived;
  }, [subTotalShortage, subTotalReceived]);

  const exportToExcel = () => {
    const wsData: any[][] = [];

    const filterInfo = `Division: ${filterDivision} | Mode: ${filterDateMode === "upto" ? `Up to ${formatDDMMYYYY(filterUptoDate)}` : filterDateMode === "exact" ? `Date: ${formatDDMMYYYY(filterExactDate)}` : "All Dates"}`;

    if (viewMode === "transactions") {
      wsData.push(["OIL INWARD TRANSACTIONS LEDGER"]);
      wsData.push([`Agency: ${activeAgency?.name || ""}`, filterInfo]);
      wsData.push([]);
      wsData.push(["Receive Date", "MR No.", "MR Date", "Division", "Oil Type", "Barrels", "Gross (LTR)", "Loss %", "Net (LTR)"]);
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
          tx.filtrationLossPercent,
          Number(tx.netLiters.toFixed(2))
        ]);
      });
      const totalGross = filteredTransactions.reduce((sum, item) => sum + item.grossLiters, 0);
      const totalNet = filteredTransactions.reduce((sum, item) => sum + item.netLiters, 0);
      wsData.push([]);
      wsData.push(["Sub Total", "", "", "", "", "", Number(totalGross.toFixed(2)), "", Number(totalNet.toFixed(2))]);
    } else {
      wsData.push(["OIL MR-WISE SHORTAGE & INWARD SUMMARY"]);
      wsData.push([`Agency: ${activeAgency?.name || ""}`, filterInfo]);
      wsData.push([]);
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
      {/* Top Header & Stat Cards */}
      <div className="bg-white p-6 rounded shadow-sm border border-slate-200 space-y-4">
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
              <div className="text-base font-mono font-bold text-amber-900">
                {subTotalShortage.toFixed(2)} LTR
              </div>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded px-3 py-2 text-right">
              <div className="text-[10px] uppercase font-bold text-blue-700">
                Inward Received
              </div>
              <div className="text-base font-mono font-bold text-blue-900">
                {subTotalReceived.toFixed(2)} LTR
              </div>
            </div>

            <div className={`border rounded px-3 py-2 text-right ${subTotalNetBalance > 0 ? 'bg-rose-50 border-rose-200 text-rose-900' : subTotalNetBalance < 0 ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-slate-50 border-slate-200 text-slate-900'}`}>
              <div className="text-[10px] uppercase font-bold opacity-80">
                Net Balance
              </div>
              <div className="text-base font-mono font-black">
                {subTotalNetBalance >= 0 ? '+' : ''}{subTotalNetBalance.toFixed(2)} LTR
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
                className="text-xs font-mono font-bold bg-white border border-blue-300 rounded px-2 py-1 text-slate-800 focus:outline-none"
              />
              {availableMrDates.length > 0 && (
                <select
                  value={filterUptoDate}
                  onChange={(e) => setFilterUptoDate(e.target.value)}
                  className="text-xs font-mono font-semibold bg-white border border-blue-300 rounded px-2 py-1 text-slate-700 focus:outline-none max-w-[140px]"
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
                className="text-xs font-mono font-bold bg-white border border-slate-300 rounded px-2 py-1 text-slate-800 focus:outline-none"
              />
              {availableMrDates.length > 0 && (
                <select
                  value={filterExactDate}
                  onChange={(e) => setFilterExactDate(e.target.value)}
                  className="text-xs font-mono font-semibold bg-white border border-slate-300 rounded px-2 py-1 text-slate-700 focus:outline-none max-w-[140px]"
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
                Sub Total Shortage: <strong className="font-mono">{subTotalShortage.toFixed(2)} LTR</strong> |
                Total Inward: <strong className="font-mono">{subTotalReceived.toFixed(2)} LTR</strong> |
                Net Due: <strong className="font-mono">{subTotalNetBalance >= 0 ? '+' : ''}{subTotalNetBalance.toFixed(2)} LTR</strong>.
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="bg-white rounded shadow-sm border border-slate-200">
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
                <input
                  required
                  type="number"
                  step="0.01"
                  value={formData.grossLiters}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      grossLiters: parseFloat(e.target.value) || 0,
                    })
                  }
                  className="w-full px-3 py-2 text-sm border rounded focus:ring-1 focus:ring-blue-500 bg-white"
                  readOnly={formData.oilType === "Fresh"}
                  title={
                    formData.oilType === "Fresh"
                      ? "Fresh oil is fixed at 210L per barrel"
                      : "Enter actual received quantity for used oil"
                  }
                />
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
                    <span className="text-lg font-mono font-bold text-green-700">
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
                <button
                  type="submit"
                  className="flex items-center px-6 py-2 text-sm font-bold uppercase tracking-wider bg-green-600 text-white rounded hover:bg-green-700 transition-colors"
                >
                  <Save className="w-4 h-4 mr-2" />
                  {editingId ? "Update Entry" : "Save Inward Entry"}
                </button>
              </div>
            </form>
          </div>
        )}

        <div className="overflow-x-auto">
          {viewMode === "transactions" ? (
            <table className="w-full text-left text-sm text-slate-600">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500 font-bold border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3">Receive Date</th>
                  <th className="px-4 py-3">MR No.</th>
                  <th className="px-4 py-3">MR Date</th>
                  <th className="px-4 py-3">Division</th>
                  <th className="px-4 py-3">Oil Type</th>
                  <th className="px-4 py-3 text-right">Barrels</th>
                  <th className="px-4 py-3 text-right">Gross (LTR)</th>
                  <th className="px-4 py-3 text-right">Loss %</th>
                  <th className="px-4 py-3 text-right text-green-700 font-bold">
                    Net (LTR)
                  </th>
                  <th className="px-4 py-3 text-center">Actions</th>
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
                        <td className="px-4 py-3 whitespace-nowrap">
                          {formatDDMMYYYY(tx.date)}
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-900">
                          {tx.mrNo}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-slate-700">
                          {formatDDMMYYYY(mrDateVal)}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {tx.division}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${tx.oilType === "Fresh" ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700"}`}
                          >
                            {tx.oilType}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono">
                          {tx.barrels}
                        </td>
                        <td className="px-4 py-3 text-right font-mono">
                          {tx.grossLiters.toFixed(2)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-slate-400">
                          {tx.filtrationLossPercent}%
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-green-700">
                          {tx.netLiters.toFixed(2)}
                        </td>
                        <td className="px-4 py-3 text-center">
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
                    <td className="px-4 py-3 text-right font-mono">
                      {filteredTransactions
                        .reduce((sum, item) => sum + item.grossLiters, 0)
                        .toFixed(2)}
                    </td>
                    <td></td>
                    <td className="px-4 py-3 text-right font-mono text-green-700">
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
            <table className="w-full text-left text-sm text-slate-600">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500 font-bold border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3">MR No.</th>
                  <th className="px-4 py-3">MR Date</th>
                  <th className="px-4 py-3">Division</th>
                  <th className="px-4 py-3 text-right text-amber-700">
                    Total Shortage (LTR)
                  </th>
                  <th className="px-4 py-3 text-right text-blue-700">
                    Oil Received (LTR)
                  </th>
                  <th className="px-4 py-3 text-right text-slate-900 font-bold">
                    Net Pending / Shortage (LTR)
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
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
                        <td className="px-4 py-3 font-medium text-slate-900">
                          {summary.mrNo}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-slate-700">
                          {formatDDMMYYYY(summary.mrDate)}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {summary.division}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-amber-700">
                          {summary.totalShortage.toFixed(2)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-blue-700">
                          {summary.totalReceived.toFixed(2)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-bold">
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
                {/* Aggregate Totals Row */}
                {!loading && filteredSummary.length > 0 && (
                  <tr className="bg-slate-100 font-bold text-slate-900 border-t-2 border-slate-300">
                    <td
                      colSpan={3}
                      className="px-4 py-3 text-right uppercase text-xs tracking-wider"
                    >
                      SUB TOTAL ({filterDivision !== 'All' ? filterDivision : 'All Divisions'}{filterDateMode === 'upto' ? ` - Up to ${formatDDMMYYYY(filterUptoDate)}` : ''}):
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-amber-700 font-bold">
                      {subTotalShortage.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-blue-700 font-bold">
                      {subTotalReceived.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-black">
                      <span className={subTotalNetBalance > 0 ? 'text-red-700' : subTotalNetBalance < 0 ? 'text-emerald-700' : 'text-slate-900'}>
                        {subTotalNetBalance >= 0 ? '+' : ''}{subTotalNetBalance.toFixed(2)}
                      </span>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
