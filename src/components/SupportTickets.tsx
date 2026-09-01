import React, { useState, useEffect } from 'react';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, query, where, getDocs, addDoc, orderBy } from 'firebase/firestore';
import { useAgency } from '../lib/AgencyContext';
import { CARD, CARD_PAD } from '../lib/ui';
import { SupportTicket, TicketCategory, TicketPriority } from '../types/admin';
import { LifeBuoy, PlusCircle, MessageSquare, Clock, CheckCircle2, AlertCircle, RefreshCw, Send, ShieldAlert, Sparkles } from 'lucide-react';
import { formatDDMMYYYY } from '../lib/utils';

export default function SupportTickets() {
  const { activeAgency } = useAgency();
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<SupportTicket | null>(null);

  // Form fields
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState<TicketCategory>('Technical Issue');
  const [priority, setPriority] = useState<TicketPriority>('Medium');
  const [description, setDescription] = useState('');

  const userEmail = auth.currentUser?.email || '';

  const fetchUserTickets = async () => {
    if (!auth.currentUser) return;
    setLoading(true);
    try {
      const q = query(
        collection(db, 'support_tickets'),
        where('userId', '==', auth.currentUser.uid)
      );
      const snap = await getDocs(q);
      const list = snap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as SupportTicket[];
      
      // Sort manually by createdAt desc
      list.sort((a, b) => b.createdAt - a.createdAt);
      setTickets(list);
    } catch (err) {
      console.error('Error loading tickets:', err);
      handleFirestoreError(err, OperationType.LIST, 'support_tickets');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUserTickets();
  }, [userEmail]);

  const handleCreateTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser || !subject.trim() || !description.trim()) {
      alert('Please fill in both the Subject and Description.');
      return;
    }

    setSubmitting(true);
    try {
      const ticketNo = `TKT-${Math.floor(100000 + Math.random() * 900000)}`;
      const now = Date.now();
      const newTicket: Omit<SupportTicket, 'id'> = {
        ticketNo,
        userId: auth.currentUser.uid,
        userEmail: auth.currentUser.email || 'unknown@user.com',
        agencyId: activeAgency?.id || 'none',
        agencyName: activeAgency?.name || 'General User',
        subject: subject.trim(),
        category,
        priority,
        status: 'Open',
        description: description.trim(),
        createdAt: now,
        updatedAt: now
      };

      await addDoc(collection(db, 'support_tickets'), newTicket);
      
      alert(`Support ticket #${ticketNo} successfully created! Our Super Admin team (shivaminfotech89@gmail.com) will review your query.`);
      setSubject('');
      setDescription('');
      setShowCreateModal(false);
      fetchUserTickets();
    } catch (err) {
      console.error('Error creating ticket:', err);
      handleFirestoreError(err, OperationType.CREATE, 'support_tickets');
      alert('Failed to submit ticket. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'Open':
        return <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300 flex items-center gap-1"><Clock className="w-3 h-3" /> Open</span>;
      case 'In Progress':
        return <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-800 border border-blue-300 flex items-center gap-1"><RefreshCw className="w-3 h-3 animate-spin" /> In Progress</span>;
      case 'Resolved':
        return <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-green-100 text-green-800 border border-green-300 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Resolved</span>;
      default:
        return <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-700 border border-slate-300">{status}</span>;
    }
  };

  const getPriorityBadge = (priority: TicketPriority) => {
    switch (priority) {
      case 'Urgent':
        return <span className="text-xs font-extrabold text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded">Urgent</span>;
      case 'High':
        return <span className="text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">High</span>;
      case 'Medium':
        return <span className="text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded">Medium</span>;
      default:
        return <span className="text-xs font-medium text-slate-600 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded">Low</span>;
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Top Banner */}
      <div className="bg-slate-900 rounded-lg p-3 text-white flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border border-blue-800/40">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <LifeBuoy className="w-6 h-6 text-blue-400" />
            <h1 className="text-xl font-black tracking-tight">Help & Support Desk</h1>
            <span className="bg-blue-500/30 text-blue-300 text-[10px] font-bold px-2 py-0.5 rounded-full border border-blue-400/30">
              Admin Managed
            </span>
          </div>
          <p className="text-slate-300 text-xs leading-relaxed max-w-2xl">
            Have a question regarding Agency Management, Razorpay Annual Subscription (₹3,999/yr), Billing calculations, or technical support? Submit a ticket directly to Super Admin (<span className="text-amber-300 font-semibold">shivaminfotech89@gmail.com</span>).
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="bg-blue-600 hover:bg-blue-500 text-white font-bold px-5 py-3 rounded-xl shadow-lg transition-all flex items-center gap-2 text-sm shrink-0 border border-blue-400/30"
        >
          <PlusCircle className="w-4 h-4" />
          <span>Raise New Support Ticket</span>
        </button>
      </div>

      {/* Main Tickets List */}
      <div className={`${CARD} p-3`}>
        <div className="flex justify-between items-center mb-6 pb-4 border-b border-slate-100">
          <div>
            <h2 className="text-base font-bold text-slate-900">Your Support Tickets</h2>
            <p className="text-xs text-slate-500">Track current ticket status and view admin responses</p>
          </div>
          <button 
            onClick={fetchUserTickets} 
            className="text-xs text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1 p-2 rounded hover:bg-blue-50 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>

        {loading ? (
          <div className="text-center py-12 text-slate-400 text-sm">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-blue-500" />
            Loading your tickets...
          </div>
        ) : tickets.length === 0 ? (
          <div className="text-center py-12 border-2 border-dashed border-slate-200 rounded-xl bg-slate-50">
            <LifeBuoy className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <h3 className="text-sm font-bold text-slate-700">No Support Tickets Created Yet</h3>
            <p className="text-xs text-slate-500 mb-4 max-w-md mx-auto">
              If you run into any technical issues or have inquiries about your Razorpay Agency subscription, click below to submit a ticket.
            </p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="bg-blue-600 text-white text-xs font-bold px-4 py-2 rounded-lg hover:bg-blue-700 inline-flex items-center gap-2"
            >
              <PlusCircle className="w-4 h-4" />
              <span>Submit First Ticket</span>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {tickets.map((t) => (
              <div 
                key={t.id}
                onClick={() => setSelectedTicket(t)}
                className="p-4 rounded-xl border border-slate-200 hover:border-blue-400 bg-white hover:shadow-md transition-all cursor-pointer flex flex-col justify-between"
              >
                <div>
                  <div className="flex justify-between items-start gap-2 mb-2">
                    <span className="text-[11px] font-extrabold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                      #{t.ticketNo}
                    </span>
                    {getStatusBadge(t.status)}
                  </div>
                  <h3 className="font-bold text-sm text-slate-900 line-clamp-2 mb-1">{t.subject}</h3>
                  <p className="text-xs text-slate-600 line-clamp-3 mb-3">{t.description}</p>
                </div>

                <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                  <div className="flex items-center gap-1.5">
                    {getPriorityBadge(t.priority)}
                    <span className="bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded font-medium">{t.category}</span>
                  </div>
                  <span>{formatDDMMYYYY(t.createdAt)}</span>
                </div>

                {t.adminReply && (
                  <div className="mt-3 p-2.5 rounded-lg bg-green-50 border border-green-200 text-xs text-green-900 flex items-start gap-2">
                    <Sparkles className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold text-[10px] text-green-800 uppercase block">Admin Response:</span>
                      <p className="line-clamp-2 italic">{t.adminReply}</p>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* New Ticket Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="bg-slate-900 text-white p-5 flex justify-between items-center border-b border-slate-800">
              <div className="flex items-center gap-2">
                <LifeBuoy className="w-5 h-5 text-blue-400" />
                <h3 className="font-bold text-base">Generate Support Ticket</h3>
              </div>
              <button 
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-white text-lg font-bold p-1"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateTicket} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                  Topic / Subject <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="e.g. Razorpay Payment status or Estimate discrepancy"
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-xs font-medium focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                    Category
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as TicketCategory)}
                    className="w-full border border-slate-300 rounded-lg p-2 text-xs font-medium focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                  >
                    <option value="Razorpay & Billing">Razorpay & Subscription (₹3,999)</option>
                    <option value="Technical Issue">Technical Issue</option>
                    <option value="Feature Request">Feature Request</option>
                    <option value="Bug Report">Bug Report</option>
                    <option value="Account & Access">Account & Access</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                    Priority
                  </label>
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as TicketPriority)}
                    className="w-full border border-slate-300 rounded-lg p-2 text-xs font-medium focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                  >
                    <option value="Low">Low</option>
                    <option value="Medium">Medium</option>
                    <option value="High">High</option>
                    <option value="Urgent">Urgent</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                  Detailed Description <span className="text-red-500">*</span>
                </label>
                <textarea
                  required
                  rows={4}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Explain the problem or question in detail..."
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-xs font-medium focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>

              <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-[11px] text-slate-600">
                Ticket will be logged under email: <strong className="text-slate-900">{userEmail}</strong> ({activeAgency?.name || 'No Agency'}) and reviewed by Admin <strong className="text-blue-700">shivaminfotech89@gmail.com</strong>.
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                >
                  {submitting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  <span>Submit Ticket</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Ticket Detail Modal */}
      {selectedTicket && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-xl w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="bg-slate-900 text-white p-5 flex justify-between items-center">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-blue-400" />
                <h3 className="font-bold text-base">Ticket #{selectedTicket.ticketNo}</h3>
              </div>
              <button 
                onClick={() => setSelectedTicket(null)}
                className="text-slate-400 hover:text-white text-lg font-bold p-1"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
              <div className="flex justify-between items-start pb-3 border-b border-slate-100">
                <div>
                  <h2 className="text-base font-bold text-slate-900">{selectedTicket.subject}</h2>
                  <p className="text-xs text-slate-500">
                    Category: <strong>{selectedTicket.category}</strong> • Created {new Date(selectedTicket.createdAt).toLocaleString()}
                  </p>
                </div>
                {getStatusBadge(selectedTicket.status)}
              </div>

              <div className="space-y-1">
                <span className="text-[11px] font-bold text-slate-500 uppercase">Your Query:</span>
                <div className="bg-slate-50 border border-slate-200 p-2.5 rounded-lg text-xs text-slate-800 whitespace-pre-wrap leading-relaxed">
                  {selectedTicket.description}
                </div>
              </div>

              {selectedTicket.adminReply ? (
                <div className="space-y-1 pt-2">
                  <span className="text-[11px] font-bold text-green-700 uppercase flex items-center gap-1">
                    <Sparkles className="w-3.5 h-3.5 text-green-600" /> Super Admin Response (shivaminfotech89@gmail.com):
                  </span>
                  <div className="bg-green-50 border border-green-200 p-2.5 rounded-lg text-xs text-green-950 font-medium leading-relaxed whitespace-pre-wrap">
                    {selectedTicket.adminReply}
                  </div>
                  <p className="text-[10px] text-slate-400 text-right">
                    Replied at: {selectedTicket.repliedAt ? new Date(selectedTicket.repliedAt).toLocaleString() : 'Recently'}
                  </p>
                </div>
              ) : (
                <div className="bg-amber-50 border border-amber-200 p-2.5 rounded-lg text-xs text-amber-900 flex items-center gap-2">
                  <Clock className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>Your ticket is currently under review by Super Admin. Response will appear here once processed.</span>
                </div>
              )}
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-200 text-right">
              <button
                onClick={() => setSelectedTicket(null)}
                className="px-4 py-2 bg-slate-800 text-white rounded-lg text-xs font-bold hover:bg-slate-700"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
