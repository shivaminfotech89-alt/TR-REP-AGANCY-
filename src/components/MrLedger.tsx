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
  writeBatch 
} from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { useAgency } from '../lib/AgencyContext';
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
  BookOpen
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
}

interface MrGroup {
  mrNo: string;
  dateOfIssue: string;
  division: string;
  repairType: string;
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
  prevAtNo?: string;
  prevJobNo?: string;
  prevDeliveryDate?: string;
  gpReason?: string;
  isNew?: boolean;
}

interface MrEditState {
  originalMrNo: string;
  mrNo: string;
  dateOfIssue: string;
  division: string;
  repairType: string;
  jobs: EditableJobEntry[];
  deletedJobIds: string[];
}

const COMMON_KVA_OPTIONS = ['10', '16', '25', '63', '100', '200', '250', '315', '500'];
const JOB_STATUSES = ['Received', 'Internal Inspected', 'Tested / OK', 'Dispatched', 'Scrap / Unrepairable', 'Under Repair'];

export default function MrLedger() {
  const { activeAgency, activeAtMaster, atMasters, predictNextJobNo } = useAgency();
  const [loading, setLoading] = useState(true);
  const [mrGroups, setMrGroups] = useState<MrGroup[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDivision, setSelectedDivision] = useState<string>('All');
  const [expandedMrs, setExpandedMrs] = useState<Set<string>>(new Set());
  
  // Notification Toast
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Full MR Edit Modal State
  const [editingMr, setEditingMr] = useState<MrEditState | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [deleteConfirmMr, setDeleteConfirmMr] = useState<MrGroup | null>(null);
  const [isDeletingMr, setIsDeletingMr] = useState(false);

  const fetchJobs = async () => {
    if (!auth.currentUser || !activeAgency) {
      setMrGroups([]);
      setLoading(false);
      return;
    }
    
    try {
      const q = query(
        collection(db, 'jobs'),
        where('ownerId', '==', auth.currentUser.uid),
        where('agencyId', '==', activeAgency.id),
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
            jobs: []
          };
        }
        groups[mrKey].jobs.push(job);
      });
      
      // Sort MRs by date (newest first)
      // Was `new Date(x || 0)` - a missing date became epoch 1970, which sorts last
      // only by accident and would sort FIRST if the direction were ever flipped.
      // byDateDesc sinks undated rows by construction, in either direction.
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
      jobs: group.jobs.map(j => ({
        id: j.id,
        jobNo: j.jobNo,
        capacityKva: String(j.capacityKva || '63'),
        make: j.make || '',
        serialNo: j.serialNo || '',
        coreType: j.coreType || 'CRGO',
        status: j.status || 'Received',
        prevAtNo: j.prevAtNo || '',
        prevJobNo: j.prevJobNo || '',
        prevDeliveryDate: j.prevDeliveryDate || '',
        gpReason: j.gpReason || '',
        isNew: false
      })),
      deletedJobIds: []
    });
  };

  // Add new transformer row to editing MR
  const handleAddTransformerToMr = () => {
    if (!editingMr) return;
    
    let nextJobNo = '';
    const lastJob = editingMr.jobs[editingMr.jobs.length - 1];
    const coreType = lastJob?.coreType || 'CRGO';
    const capacityKva = lastJob?.capacityKva || '63';

    if (activeAgency) {
      const info = predictNextJobNo(editingMr.division, coreType, editingMr.repairType);
      let highestNum = info.nextNum - 1;
      editingMr.jobs.forEach(j => {
        const parts = j.jobNo.split('-');
        if (parts.length > 1) {
          const num = parseInt(parts[parts.length - 1], 10);
          if (!isNaN(num) && num > highestNum) highestNum = num;
        }
      });
      nextJobNo = `${info.prefix}-${highestNum + 1}`;
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
            isNew: true
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
    
    if (!editingMr.mrNo.trim()) {
      alert('MR Number cannot be empty.');
      return;
    }

    if (editingMr.jobs.length === 0) {
      alert('MR must contain at least one transformer. If you wish to remove the whole MR, click "Delete Entire MR".');
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

    setIsSavingEdit(true);
    try {
      const batch = writeBatch(db);
      const now = Date.now();

      // 1. Delete removed jobs
      for (const delId of editingMr.deletedJobIds) {
        const docRef = doc(db, 'jobs', delId);
        batch.delete(docRef);
      }

      // 2. Update existing or insert new jobs
      for (const j of editingMr.jobs) {
        if (j.id && !j.isNew) {
          // Existing Job update
          const docRef = doc(db, 'jobs', j.id);
          batch.update(docRef, {
            mrNo: editingMr.mrNo.trim(),
            dateOfIssue: editingMr.dateOfIssue,
            division: editingMr.division,
            repairType: editingMr.repairType,
            isGp: editingMr.repairType === 'GP',
            jobNo: j.jobNo.trim(),
            capacityKva: Number(j.capacityKva),
            make: j.make.trim().toUpperCase(),
            serialNo: j.serialNo.trim().toUpperCase(),
            coreType: j.coreType,
            status: j.status,
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
            division: editingMr.division,
            repairType: editingMr.repairType,
            isGp: editingMr.repairType === 'GP',
            type: 'Distribution',
            jobNo: j.jobNo.trim(),
            capacityKva: Number(j.capacityKva),
            make: j.make.trim().toUpperCase(),
            serialNo: j.serialNo.trim().toUpperCase(),
            coreType: j.coreType || 'CRGO',
            status: j.status || 'Received',
            isClosed: false,
            atId: activeAtMaster ? activeAtMaster.id : '',
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

  // Delete entire MR and all its jobs
  const handleDeleteEntireMr = async () => {
    if (!deleteConfirmMr || !auth.currentUser || !activeAgency) return;
    
    setIsDeletingMr(true);
    try {
      const batch = writeBatch(db);
      for (const j of deleteConfirmMr.jobs) {
        const docRef = doc(db, 'jobs', j.id);
        batch.delete(docRef);
      }
      await batch.commit();

      setNotification({
        type: 'success',
        message: `✓ MR #${deleteConfirmMr.mrNo} and its ${deleteConfirmMr.jobs.length} transformer(s) deleted successfully.`
      });
      setTimeout(() => setNotification(null), 5000);

      setDeleteConfirmMr(null);
      if (editingMr?.originalMrNo === deleteConfirmMr.mrNo) {
        setEditingMr(null);
      }
      await fetchJobs();
    } catch (err) {
      console.error('Error deleting MR:', err);
      handleFirestoreError(err, OperationType.DELETE, 'jobs');
    } finally {
      setIsDeletingMr(false);
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
    
    return matchesSearch && matchesDivision;
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
            <p className="text-xs text-slate-500">Inward transformer intake records with full MR batch editing</p>
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
            <div className="flex items-center gap-1.5 min-w-0 sm:w-64">
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
              <div key={group.mrNo} className="bg-white hover:bg-slate-50/50 transition-colors">
                
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
                        <h3 className="font-bold text-slate-900 text-sm">
                          MR No: <span className="font-mono text-blue-600 font-black">{group.mrNo}</span>
                        </h3>
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
                  
                  {/* RIGHT: FULL MR EDIT & ACTION BUTTONS */}
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

                    <button
                      type="button"
                      onClick={() => setDeleteConfirmMr(group)}
                      className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg border border-transparent hover:border-rose-200 transition-colors cursor-pointer"
                      title="Delete entire MR"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                </div>
                
                {/* Collapsible Transformer Details Table */}
                {expandedMrs.has(group.mrNo) && (
                  <div className="bg-slate-50/90 p-3 sm:p-4 border-t border-slate-200 overflow-x-auto">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-bold text-slate-700">
                        Transformers in MR #{group.mrNo} ({group.jobs.length})
                      </span>
                      <button
                        type="button"
                        onClick={() => handleOpenFullMrEdit(group)}
                        className="text-[11px] text-blue-600 hover:underline font-bold flex items-center gap-1"
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
                          <tr key={job.id} className="hover:bg-white">
                            <td className="py-2 px-2.5 text-slate-400 font-mono">{idx + 1}</td>
                            <td className="py-2 px-2.5 font-mono font-bold text-slate-900">{job.jobNo}</td>
                            <td className="py-2 px-2.5 text-slate-700 uppercase">{job.make}</td>
                            <td className="py-2 px-2.5 font-semibold text-slate-800">{job.capacityKva} KVA</td>
                            <td className="py-2 px-2.5 font-mono text-slate-600">{job.serialNo}</td>
                            <td className="py-2 px-2.5 font-medium text-slate-700">{job.coreType || 'CRGO'}</td>
                            <td className="py-2 px-2.5">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                                job.status === 'Dispatched' 
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
                  <h3 className="font-bold text-sm sm:text-base">
                    Full MR Edit: <span className="font-mono text-blue-300">MR #{editingMr.originalMrNo}</span>
                  </h3>
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

            {/* MODAL BODY (SCROLLABLE) */}
            <div className="overflow-y-auto p-4 sm:p-6 space-y-5 flex-1 bg-slate-50/50">
              
              {/* SECTION 1: MR HEADER DETAILS */}
              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-3">
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
                  
                  <button
                    type="button"
                    onClick={handleAddTransformerToMr}
                    className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-lg text-xs font-bold flex items-center gap-1 transition-colors cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Unit to this MR</span>
                  </button>
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
              
              <button
                type="button"
                onClick={() => setDeleteConfirmMr({ mrNo: editingMr.originalMrNo, dateOfIssue: editingMr.dateOfIssue, division: editingMr.division, repairType: editingMr.repairType, jobs: editingMr.jobs as any })}
                className="text-xs font-bold text-rose-600 hover:text-rose-800 hover:bg-rose-50 px-3 py-2 rounded-xl transition-colors cursor-pointer self-start sm:self-auto"
              >
                Delete Entire MR
              </button>

              <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                <button
                  type="button"
                  onClick={() => setEditingMr(null)}
                  className="px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
                >
                  Cancel
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
      {/* DELETE MR CONFIRMATION MODAL */}
      {/* ========================================================================= */}
      {deleteConfirmMr && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-2xl p-5 sm:p-6 max-w-md w-full border border-rose-200">
            <div className="flex items-center gap-3 mb-3 text-rose-600">
              <div className="bg-rose-100 p-2.5 rounded-xl shrink-0">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Delete Entire MR?</h3>
                <p className="text-xs text-rose-600 font-medium">Permanent Action</p>
              </div>
            </div>

            <p className="text-slate-700 text-xs sm:text-sm mb-5 leading-relaxed bg-slate-50 p-3 rounded-xl border border-slate-200">
              Are you sure you want to delete <strong>MR #{deleteConfirmMr.mrNo}</strong> ({deleteConfirmMr.division})?
              <br />
              This will permanently delete all <strong>{deleteConfirmMr.jobs.length} transformer record(s)</strong> associated with this MR.
            </p>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={isDeletingMr}
                onClick={() => setDeleteConfirmMr(null)}
                className="px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
              >
                Cancel
              </button>

              <button
                type="button"
                disabled={isDeletingMr}
                onClick={handleDeleteEntireMr}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {isDeletingMr ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Deleting...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    <span>Yes, Delete MR</span>
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
