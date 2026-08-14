import React, { useState, useEffect } from 'react';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, query, getDocs, doc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { useAgency, Agency } from '../lib/AgencyContext';
import { SupportTicket, TicketStatus, UserRoleRecord, UserRoleType, RazorpaySettings, SystemSettings } from '../types/admin';
import { 
  ShieldCheck, Users, Building2, CreditCard, LifeBuoy, Settings, 
  RefreshCw, Search, CheckCircle2, AlertTriangle, Clock, PlusCircle, 
  Trash2, Lock, Key, DollarSign, Sparkles, MessageSquare, Send, Check, AlertCircle, ToggleLeft, ToggleRight
} from 'lucide-react';

export default function AdminPanel() {
  const { agencies, updateAgency } = useAgency();
  const currentUser = auth.currentUser;
  const isSuperAdminEmail = currentUser?.email === 'shivaminfotech89@gmail.com';

  const [activeTab, setActiveTab] = useState<'agencies' | 'users' | 'tickets' | 'razorpay' | 'system'>('agencies');
  const [loading, setLoading] = useState(true);

  // Firestore Data State
  const [allAgencies, setAllAgencies] = useState<Agency[]>([]);
  const [userRoles, setUserRoles] = useState<UserRoleRecord[]>([]);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [razorpaySettings, setRazorpaySettings] = useState<RazorpaySettings>({
    enabled: true,
    testMode: true,
    keyId: 'rzp_test_agency_3999_key',
    keySecret: '••••••••••••••••',
    annualFeePerAgency: 3999,
  });
  const [systemSettings, setSystemSettings] = useState<SystemSettings>({
    maintenanceMode: false,
    maintenanceMessage: 'System undergoes scheduled maintenance. Normal ops resume shortly.',
    announcementBanner: '⚡ Razorpay Annual Agency Subscription Gateway (₹3,999/yr) is active!',
    announcementActive: true,
    superAdminEmail: 'shivaminfotech89@gmail.com'
  });

  // UI state for search & modals
  const [searchTerm, setSearchTerm] = useState('');
  const [ticketStatusFilter, setTicketStatusFilter] = useState<string>('ALL');
  
  // Ticket Reply Drawer
  const [selectedTicket, setSelectedTicket] = useState<SupportTicket | null>(null);
  const [replyText, setReplyText] = useState('');
  const [newStatus, setNewStatus] = useState<TicketStatus>('In Progress');
  const [replySubmitting, setReplySubmitting] = useState(false);

  // User Role Add/Edit Modal
  const [showUserModal, setShowUserModal] = useState(false);
  const [userModalEmail, setUserModalEmail] = useState('');
  const [userModalRole, setUserModalRole] = useState<UserRoleType>('manager');
  const [userModalAgencyId, setUserModalAgencyId] = useState('');

  // Fetch all admin data
  const fetchAdminData = async () => {
    if (!isSuperAdminEmail) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      // 1. Fetch Agencies
      const agSnap = await getDocs(collection(db, 'agencies'));
      const agList = agSnap.docs.map(d => ({ id: d.id, ...d.data() } as Agency));
      setAllAgencies(agList.length > 0 ? agList : agencies);

      // 2. Fetch User Roles
      const roleSnap = await getDocs(collection(db, 'user_roles'));
      const roleList = roleSnap.docs.map(d => ({ id: d.id, ...d.data() } as UserRoleRecord));
      setUserRoles(roleList);

      // 3. Fetch Support Tickets
      const ticketSnap = await getDocs(collection(db, 'support_tickets'));
      const tktList = ticketSnap.docs.map(d => ({ id: d.id, ...d.data() } as SupportTicket));
      tktList.sort((a, b) => b.createdAt - a.createdAt);
      setTickets(tktList);

      // 4. Fetch System Settings if present
      const sysSnap = await getDocs(collection(db, 'system_config'));
      sysSnap.docs.forEach(doc => {
        if (doc.id === 'razorpay') setRazorpaySettings(doc.data() as RazorpaySettings);
        if (doc.id === 'general') setSystemSettings(doc.data() as SystemSettings);
      });

    } catch (err) {
      console.error('Error loading admin data:', err);
      // Fallback gracefully without breaking UI
      setLoading(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAdminData();
  }, [currentUser?.email]);

  if (!isSuperAdminEmail) {
    return (
      <div className="max-w-3xl mx-auto my-12 bg-white rounded-2xl border border-slate-200 shadow-lg p-8 text-center space-y-4">
        <div className="w-16 h-16 bg-amber-100 border border-amber-300 rounded-full flex items-center justify-center mx-auto text-amber-600">
          <ShieldCheck className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-black text-slate-900">Super Admin Access Restricted</h2>
        <p className="text-xs text-slate-600 max-w-md mx-auto leading-relaxed">
          The Super Admin Command Center and Razorpay Subscription Gateway control panel is reserved exclusively for <strong className="text-blue-700">shivaminfotech89@gmail.com</strong>.
        </p>
        <div className="pt-2">
          <span className="text-[11px] text-slate-500 bg-slate-100 px-3 py-1.5 rounded-lg border inline-block">
            Logged in as: <strong className="text-slate-800">{currentUser?.email || 'Guest'}</strong>
          </span>
        </div>
      </div>
    );
  }

  // --- AGENCY ACTIONS ---
  const handleUpdateSubscription = async (agencyId: string, status: 'active' | 'trial' | 'expired' | 'suspended', planAmount: number = 3999) => {
    try {
      const now = Date.now();
      const oneYearMs = 365 * 24 * 60 * 60 * 1000;
      const updatePayload = {
        subscriptionStatus: status,
        subscriptionPlanAmount: planAmount,
        subscriptionLastPaid: now,
        subscriptionExpiryDate: now + oneYearMs,
      };

      await updateAgency(agencyId, updatePayload);
      alert(`Agency subscription updated to ${status.toUpperCase()} for ₹${planAmount}/year! Expiry set to 1 year from now.`);
      fetchAdminData();
    } catch (err) {
      console.error('Error updating agency subscription:', err);
      alert('Failed to update agency subscription.');
    }
  };

  // --- USER ROLE ACTIONS ---
  const handleSaveUserRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userModalEmail.trim()) return;

    try {
      const docId = userModalEmail.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
      const payload: UserRoleRecord = {
        id: docId,
        email: userModalEmail.trim().toLowerCase(),
        role: userModalRole,
        agencyId: userModalAgencyId || 'all',
        agencyName: allAgencies.find(a => a.id === userModalAgencyId)?.name || 'All Agencies',
        status: 'active',
        updatedAt: Date.now(),
        updatedBy: currentUser?.email || 'admin'
      };

      await setDoc(doc(db, 'user_roles', docId), payload);
      alert(`User ${userModalEmail} role updated to ${userModalRole.toUpperCase()}`);
      setShowUserModal(false);
      setUserModalEmail('');
      fetchAdminData();
    } catch (err) {
      console.error('Error saving user role:', err);
      alert('Failed to update user role.');
    }
  };

  const handleToggleUserStatus = async (roleRecord: UserRoleRecord) => {
    try {
      const newStatus = roleRecord.status === 'active' ? 'suspended' : 'active';
      await updateDoc(doc(db, 'user_roles', roleRecord.id), { status: newStatus, updatedAt: Date.now() });
      fetchAdminData();
    } catch (err) {
      console.error('Error toggling user status:', err);
    }
  };

  // --- TICKET REPLY ACTIONS ---
  const handleReplyTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTicket || !replyText.trim()) return;

    setReplySubmitting(true);
    try {
      const now = Date.now();
      const ticketRef = doc(db, 'support_tickets', selectedTicket.id);
      await updateDoc(ticketRef, {
        adminReply: replyText.trim(),
        repliedAt: now,
        repliedBy: currentUser?.email || 'shivaminfotech89@gmail.com',
        status: newStatus,
        updatedAt: now
      });

      alert(`Reply saved and ticket status updated to ${newStatus}!`);
      setSelectedTicket(null);
      setReplyText('');
      fetchAdminData();
    } catch (err) {
      console.error('Error replying to ticket:', err);
      alert('Failed to send reply.');
    } finally {
      setReplySubmitting(false);
    }
  };

  // --- SYSTEM & RAZORPAY CONFIG ACTIONS ---
  const handleSaveRazorpayConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await setDoc(doc(db, 'system_config', 'razorpay'), razorpaySettings);
      alert('Razorpay Payment Configuration (₹3,999/agency) saved successfully!');
    } catch (err) {
      console.error('Error saving Razorpay settings:', err);
      alert('Failed to save settings.');
    }
  };

  const handleSaveSystemSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await setDoc(doc(db, 'system_config', 'general'), {
        ...systemSettings,
        updatedAt: Date.now()
      });
      alert('Global Web App & Maintenance settings updated!');
    } catch (err) {
      console.error('Error saving system settings:', err);
      alert('Failed to update settings.');
    }
  };

  // Compute metrics
  const totalAgenciesCount = allAgencies.length;
  const activeAgenciesCount = allAgencies.filter(a => (a as any).subscriptionStatus === 'active' || !(a as any).subscriptionStatus).length;
  const openTicketsCount = tickets.filter(t => t.status === 'Open' || t.status === 'In Progress').length;
  const totalRevenueCollected = activeAgenciesCount * 3999;

  // Filtered ticket list
  const filteredTickets = tickets.filter(t => {
    const matchesSearch = t.subject.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          t.ticketNo.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          t.userEmail.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = ticketStatusFilter === 'ALL' || t.status === ticketStatusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-12">
      
      {/* Top Admin Header */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 rounded-2xl p-6 text-white shadow-xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border border-slate-700">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2 bg-amber-500/20 border border-amber-400/40 rounded-xl text-amber-400">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-black tracking-tight">SUPER ADMIN COMMAND CENTER</h1>
                <span className="bg-amber-400 text-slate-950 font-black text-[10px] px-2 py-0.5 rounded uppercase">
                  Full Access
                </span>
              </div>
              <p className="text-slate-400 text-xs mt-0.5">
                Authorized Super Admin: <span className="text-amber-300 font-bold">shivaminfotech89@gmail.com</span>
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 bg-slate-800/80 p-2 rounded-xl border border-slate-700/80 text-xs">
          <button 
            onClick={fetchAdminData}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold flex items-center gap-1.5 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Sync Data</span>
          </button>
        </div>
      </div>

      {/* Overview Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-blue-600">
            <Building2 className="w-6 h-6" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Total Registered Agencies</span>
            <span className="text-xl font-black text-slate-900">{totalAgenciesCount}</span>
            <span className="text-[11px] text-green-600 font-semibold block">{activeAgenciesCount} Active Paid</span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-600">
            <CreditCard className="w-6 h-6" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Razorpay Subscription Revenue</span>
            <span className="text-xl font-black text-slate-900">₹{totalRevenueCollected.toLocaleString()}</span>
            <span className="text-[11px] text-slate-500 block">@ ₹3,999 / Agency / Yr</span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-purple-50 border border-purple-200 rounded-xl text-purple-600">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Managed User Roles</span>
            <span className="text-xl font-black text-slate-900">{userRoles.length} Users</span>
            <span className="text-[11px] text-purple-600 font-semibold block">Full RBAC Control</span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-600">
            <LifeBuoy className="w-6 h-6" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Support Tickets</span>
            <span className="text-xl font-black text-slate-900">{tickets.length}</span>
            <span className="text-[11px] text-amber-700 font-bold block">{openTicketsCount} Pending Admin Action</span>
          </div>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="flex border-b border-slate-200 bg-white p-1.5 rounded-xl border shadow-sm gap-2">
        <button
          onClick={() => setActiveTab('agencies')}
          className={`flex-1 py-2.5 px-4 rounded-lg font-bold text-xs flex items-center justify-center gap-2 transition-all ${
            activeTab === 'agencies' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Building2 className="w-4 h-4" />
          <span>Agencies & Subscriptions (₹3,999/yr)</span>
        </button>

        <button
          onClick={() => setActiveTab('users')}
          className={`flex-1 py-2.5 px-4 rounded-lg font-bold text-xs flex items-center justify-center gap-2 transition-all ${
            activeTab === 'users' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>User & Role Management</span>
        </button>

        <button
          onClick={() => setActiveTab('tickets')}
          className={`flex-1 py-2.5 px-4 rounded-lg font-bold text-xs flex items-center justify-center gap-2 transition-all relative ${
            activeTab === 'tickets' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <LifeBuoy className="w-4 h-4" />
          <span>Support Tickets Desk</span>
          {openTicketsCount > 0 && (
            <span className="bg-red-500 text-white text-[10px] px-1.5 py-0.2 rounded-full font-extrabold ml-1">
              {openTicketsCount}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('razorpay')}
          className={`flex-1 py-2.5 px-4 rounded-lg font-bold text-xs flex items-center justify-center gap-2 transition-all ${
            activeTab === 'razorpay' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <CreditCard className="w-4 h-4" />
          <span>Razorpay Integration</span>
        </button>

        <button
          onClick={() => setActiveTab('system')}
          className={`flex-1 py-2.5 px-4 rounded-lg font-bold text-xs flex items-center justify-center gap-2 transition-all ${
            activeTab === 'system' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Settings className="w-4 h-4" />
          <span>Web App Controls</span>
        </button>
      </div>

      {/* --- TAB 1: AGENCIES & SUBSCRIPTION MANAGEMENT --- */}
      {activeTab === 'agencies' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-6">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-4 border-b border-slate-100">
            <div>
              <h2 className="text-base font-bold text-slate-900">Registered Agencies & Razorpay Subscriptions</h2>
              <p className="text-xs text-slate-500">Manage agency active statuses, annual subscription fees (₹3,999/yr), and renewal dates</p>
            </div>
            <div className="bg-blue-50 border border-blue-200 p-2.5 rounded-xl text-xs text-blue-900 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-blue-600" />
              <span>Standard Agency Subscription: <strong>₹3,999 / year per agency</strong></span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-y border-slate-200 text-slate-700 uppercase tracking-wider font-bold text-[10px]">
                  <th className="p-3">Agency Name</th>
                  <th className="p-3">Contact Email & GSTIN</th>
                  <th className="p-3">Subscription Status</th>
                  <th className="p-3">Plan Price</th>
                  <th className="p-3">Expiry Date</th>
                  <th className="p-3 text-right">Admin Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {allAgencies.map((agency) => {
                  const subStatus = (agency as any).subscriptionStatus || 'active';
                  const expiryMs = (agency as any).subscriptionExpiryDate || (Date.now() + 365*24*60*60*1000);
                  const planAmt = (agency as any).subscriptionPlanAmount || 3999;

                  return (
                    <tr key={agency.id} className="hover:bg-slate-50 transition-colors">
                      <td className="p-3 font-bold text-slate-900">
                        {agency.name}
                        <span className="block text-[10px] font-mono text-slate-400">ID: {agency.id}</span>
                      </td>
                      <td className="p-3 text-slate-600">
                        <div>{agency.email || 'No email set'}</div>
                        <span className="text-[10px] text-slate-400">GSTIN: {agency.gstin || 'N/A'}</span>
                      </td>
                      <td className="p-3">
                        {subStatus === 'active' && (
                          <span className="px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-green-100 text-green-800 border border-green-300">
                            ACTIVE PAID
                          </span>
                        )}
                        {subStatus === 'trial' && (
                          <span className="px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-blue-100 text-blue-800 border border-blue-300">
                            TRIAL PERIOD
                          </span>
                        )}
                        {subStatus === 'expired' && (
                          <span className="px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-red-100 text-red-800 border border-red-300">
                            EXPIRED
                          </span>
                        )}
                        {subStatus === 'suspended' && (
                          <span className="px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-amber-100 text-amber-800 border border-amber-300">
                            SUSPENDED
                          </span>
                        )}
                      </td>
                      <td className="p-3 font-extrabold text-slate-900">
                        ₹{planAmt} <span className="text-[10px] font-normal text-slate-400">/ yr</span>
                      </td>
                      <td className="p-3 text-slate-600 font-medium">
                        {new Date(expiryMs).toLocaleDateString()}
                      </td>
                      <td className="p-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => handleUpdateSubscription(agency.id, 'active', 3999)}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[10px] px-3 py-1.5 rounded-lg shadow-sm"
                            title="Renew +1 Year for ₹3,999"
                          >
                            +1 Year (₹3,999)
                          </button>
                          <button
                            onClick={() => handleUpdateSubscription(agency.id, subStatus === 'suspended' ? 'active' : 'suspended', planAmt)}
                            className="bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold text-[10px] px-2.5 py-1.5 rounded-lg"
                          >
                            {subStatus === 'suspended' ? 'Unsuspend' : 'Suspend'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* --- TAB 2: USER & ROLE MANAGEMENT --- */}
      {activeTab === 'users' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-6">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-4 border-b border-slate-100">
            <div>
              <h2 className="text-base font-bold text-slate-900">User Role & RBAC Permissions Management</h2>
              <p className="text-xs text-slate-500">Manage full user roles across web app (Super Admin, Manager, Operator, Viewer)</p>
            </div>
            <button
              onClick={() => setShowUserModal(true)}
              className="bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs px-4 py-2 rounded-xl flex items-center gap-2 shadow"
            >
              <PlusCircle className="w-4 h-4" />
              <span>Assign / Add User Role</span>
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-y border-slate-200 text-slate-700 uppercase tracking-wider font-bold text-[10px]">
                  <th className="p-3">User Email</th>
                  <th className="p-3">Assigned Role</th>
                  <th className="p-3">Agency Scope</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Last Updated</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {/* Default Super Admin row */}
                <tr className="bg-amber-50/50">
                  <td className="p-3 font-bold text-slate-900 flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-amber-600" />
                    <span>shivaminfotech89@gmail.com</span>
                    <span className="text-[9px] bg-amber-500 text-white font-black px-1.5 py-0.2 rounded">SUPER ADMIN</span>
                  </td>
                  <td className="p-3">
                    <span className="px-2.5 py-1 rounded text-[10px] font-black bg-amber-100 text-amber-900 border border-amber-300">
                      SUPER ADMIN
                    </span>
                  </td>
                  <td className="p-3 font-bold text-indigo-700">Global (All Agencies)</td>
                  <td className="p-3">
                    <span className="text-green-700 font-bold">Active</span>
                  </td>
                  <td className="p-3 text-slate-400">System Core</td>
                  <td className="p-3 text-right text-slate-400 text-[10px]">Protected Master</td>
                </tr>

                {userRoles.map((ur) => (
                  <tr key={ur.id} className="hover:bg-slate-50 transition-colors">
                    <td className="p-3 font-semibold text-slate-900">{ur.email}</td>
                    <td className="p-3">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-800 border uppercase">
                        {ur.role}
                      </span>
                    </td>
                    <td className="p-3 text-slate-600">{ur.agencyName || 'All Agencies'}</td>
                    <td className="p-3">
                      {ur.status === 'active' ? (
                        <span className="text-green-600 font-bold">Active</span>
                      ) : (
                        <span className="text-red-600 font-bold">Suspended</span>
                      )}
                    </td>
                    <td className="p-3 text-slate-500">{new Date(ur.updatedAt).toLocaleDateString()}</td>
                    <td className="p-3 text-right">
                      <button
                        onClick={() => handleToggleUserStatus(ur)}
                        className="text-xs text-blue-600 hover:text-blue-800 font-bold"
                      >
                        {ur.status === 'active' ? 'Suspend' : 'Activate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* --- TAB 3: SUPPORT TICKETS DESK --- */}
      {activeTab === 'tickets' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-6">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-4 border-b border-slate-100">
            <div>
              <h2 className="text-base font-bold text-slate-900">User Generated Support Tickets</h2>
              <p className="text-xs text-slate-500">Manage questions and issues raised by users across the web application</p>
            </div>

            <div className="flex items-center gap-3">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="Search ticket, email..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9 pr-3 py-1.5 border border-slate-300 rounded-lg text-xs outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <select
                value={ticketStatusFilter}
                onChange={(e) => setTicketStatusFilter(e.target.value)}
                className="p-1.5 border border-slate-300 rounded-lg text-xs font-semibold outline-none bg-white"
              >
                <option value="ALL">All Statuses</option>
                <option value="Open">Open Only</option>
                <option value="In Progress">In Progress</option>
                <option value="Resolved">Resolved</option>
              </select>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-y border-slate-200 text-slate-700 uppercase tracking-wider font-bold text-[10px]">
                  <th className="p-3">Ticket #</th>
                  <th className="p-3">User Email & Agency</th>
                  <th className="p-3">Subject & Category</th>
                  <th className="p-3">Priority</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Created Date</th>
                  <th className="p-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredTickets.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50 transition-colors">
                    <td className="p-3 font-extrabold text-blue-700">#{t.ticketNo}</td>
                    <td className="p-3">
                      <div className="font-bold text-slate-900">{t.userEmail}</div>
                      <div className="text-[10px] text-slate-400">{t.agencyName || 'General'}</div>
                    </td>
                    <td className="p-3">
                      <div className="font-bold text-slate-900 line-clamp-1">{t.subject}</div>
                      <span className="text-[10px] text-slate-500 font-medium bg-slate-100 px-1.5 py-0.2 rounded">
                        {t.category}
                      </span>
                    </td>
                    <td className="p-3 font-bold">{t.priority}</td>
                    <td className="p-3 font-bold">{t.status}</td>
                    <td className="p-3 text-slate-500">{new Date(t.createdAt).toLocaleDateString()}</td>
                    <td className="p-3 text-right">
                      <button
                        onClick={() => {
                          setSelectedTicket(t);
                          setReplyText(t.adminReply || '');
                          setNewStatus(t.status);
                        }}
                        className="bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-bold px-3 py-1.5 rounded-lg shadow-sm inline-flex items-center gap-1"
                      >
                        <MessageSquare className="w-3.5 h-3.5" /> Reply & Resolve
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* --- TAB 4: RAZORPAY INTEGRATION CONFIG --- */}
      {activeTab === 'razorpay' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-6">
          <div className="pb-4 border-b border-slate-100">
            <h2 className="text-base font-bold text-slate-900">Razorpay Annual Subscription Gateway (₹3,999/yr)</h2>
            <p className="text-xs text-slate-500">Configure Razorpay payment gateway credentials for agency subscription billing</p>
          </div>

          <form onSubmit={handleSaveRazorpayConfig} className="max-w-2xl space-y-5">
            <div className="bg-slate-900 text-white p-5 rounded-2xl space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold uppercase text-slate-300">Gateway Status</span>
                <button
                  type="button"
                  onClick={() => setRazorpaySettings(prev => ({ ...prev, enabled: !prev.enabled }))}
                  className={`px-3 py-1 rounded-full text-xs font-black uppercase ${
                    razorpaySettings.enabled ? 'bg-green-500 text-slate-950' : 'bg-slate-700 text-slate-300'
                  }`}
                >
                  {razorpaySettings.enabled ? 'ENABLED' : 'DISABLED'}
                </button>
              </div>

              <div className="flex justify-between items-center border-t border-slate-800 pt-3">
                <span className="text-xs font-bold uppercase text-slate-300">Mode</span>
                <button
                  type="button"
                  onClick={() => setRazorpaySettings(prev => ({ ...prev, testMode: !prev.testMode }))}
                  className={`px-3 py-1 rounded-full text-xs font-black uppercase ${
                    razorpaySettings.testMode ? 'bg-amber-400 text-slate-950' : 'bg-blue-500 text-white'
                  }`}
                >
                  {razorpaySettings.testMode ? 'TEST MODE' : 'LIVE PRODUCTION'}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Razorpay Key ID</label>
              <input
                type="text"
                value={razorpaySettings.keyId}
                onChange={(e) => setRazorpaySettings(prev => ({ ...prev, keyId: e.target.value }))}
                className="w-full border border-slate-300 rounded-lg p-2.5 text-xs font-mono focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Razorpay Key Secret</label>
              <input
                type="password"
                value={razorpaySettings.keySecret}
                onChange={(e) => setRazorpaySettings(prev => ({ ...prev, keySecret: e.target.value }))}
                className="w-full border border-slate-300 rounded-lg p-2.5 text-xs font-mono focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Annual Subscription Fee per Agency (INR)</label>
              <input
                type="number"
                value={razorpaySettings.annualFeePerAgency}
                onChange={(e) => setRazorpaySettings(prev => ({ ...prev, annualFeePerAgency: Number(e.target.value) }))}
                className="w-full border border-slate-300 rounded-lg p-2.5 text-xs font-bold focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>

            <button
              type="submit"
              className="bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs px-6 py-3 rounded-xl shadow-md"
            >
              Save Razorpay Settings
            </button>
          </form>
        </div>
      )}

      {/* --- TAB 5: WEB APP & MAINTENANCE CONTROLS --- */}
      {activeTab === 'system' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-6">
          <div className="pb-4 border-b border-slate-100">
            <h2 className="text-base font-bold text-slate-900">Web Application & Maintenance Controls</h2>
            <p className="text-xs text-slate-500">Configure global app banners, broadcast notices, and system availability</p>
          </div>

          <form onSubmit={handleSaveSystemSettings} className="max-w-2xl space-y-5">
            <div className="p-4 rounded-xl border border-amber-200 bg-amber-50 space-y-3">
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="font-bold text-sm text-amber-900">System Maintenance Mode</h3>
                  <p className="text-xs text-amber-700">When enabled, non-admin users see a maintenance banner</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSystemSettings(prev => ({ ...prev, maintenanceMode: !prev.maintenanceMode }))}
                  className={`px-4 py-1.5 rounded-full text-xs font-black ${
                    systemSettings.maintenanceMode ? 'bg-red-600 text-white' : 'bg-slate-200 text-slate-700'
                  }`}
                >
                  {systemSettings.maintenanceMode ? 'MAINTENANCE ON' : 'NORMAL MODE'}
                </button>
              </div>

              {systemSettings.maintenanceMode && (
                <input
                  type="text"
                  value={systemSettings.maintenanceMessage}
                  onChange={(e) => setSystemSettings(prev => ({ ...prev, maintenanceMessage: e.target.value }))}
                  placeholder="Maintenance message..."
                  className="w-full border border-amber-300 rounded-lg p-2 text-xs font-medium bg-white"
                />
              )}
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Global Broadcast Notice Banner</label>
              <textarea
                rows={2}
                value={systemSettings.announcementBanner}
                onChange={(e) => setSystemSettings(prev => ({ ...prev, announcementBanner: e.target.value }))}
                className="w-full border border-slate-300 rounded-lg p-2.5 text-xs font-medium focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>

            <button
              type="submit"
              className="bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs px-6 py-3 rounded-xl shadow-md"
            >
              Save System Broadcast Settings
            </button>
          </form>
        </div>
      )}

      {/* Modal: Add User Role */}
      {showUserModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 p-6 space-y-4">
            <h3 className="font-bold text-base text-slate-900">Assign User Role (RBAC)</h3>
            
            <form onSubmit={handleSaveUserRole} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">User Email Address</label>
                <input
                  type="email"
                  required
                  value={userModalEmail}
                  onChange={(e) => setUserModalEmail(e.target.value)}
                  placeholder="e.g. operator@agency.com"
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-xs font-medium outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Role Type</label>
                <select
                  value={userModalRole}
                  onChange={(e) => setUserModalRole(e.target.value as UserRoleType)}
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-xs font-medium outline-none bg-white"
                >
                  <option value="manager">Manager (Full Agency Ops)</option>
                  <option value="operator">Operator (Inspection Data Entry)</option>
                  <option value="viewer">Viewer (Read-Only Reports)</option>
                  <option value="admin">Super Admin (System Control)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Agency Scope</label>
                <select
                  value={userModalAgencyId}
                  onChange={(e) => setUserModalAgencyId(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-xs font-medium outline-none bg-white"
                >
                  <option value="">Global / All Agencies</option>
                  {allAgencies.map(a => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowUserModal(false)}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700"
                >
                  Save User Role
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Reply Support Ticket */}
      {selectedTicket && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-xl w-full shadow-2xl border border-slate-200 p-6 space-y-4">
            <div className="flex justify-between items-center border-b pb-3">
              <h3 className="font-bold text-base text-slate-900">Reply to Ticket #{selectedTicket.ticketNo}</h3>
              <button onClick={() => setSelectedTicket(null)} className="text-slate-400 hover:text-slate-700 font-bold">✕</button>
            </div>

            <div className="bg-slate-50 p-3 rounded-lg text-xs space-y-1">
              <div><strong>User:</strong> {selectedTicket.userEmail} ({selectedTicket.agencyName})</div>
              <div><strong>Subject:</strong> {selectedTicket.subject}</div>
              <div className="text-slate-700 italic border-t pt-2 mt-2">{selectedTicket.description}</div>
            </div>

            <form onSubmit={handleReplyTicket} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Update Ticket Status</label>
                <select
                  value={newStatus}
                  onChange={(e) => setNewStatus(e.target.value as TicketStatus)}
                  className="w-full border border-slate-300 rounded-lg p-2 text-xs font-medium bg-white"
                >
                  <option value="In Progress">In Progress</option>
                  <option value="Resolved">Resolved</option>
                  <option value="Closed">Closed</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Admin Response Message</label>
                <textarea
                  required
                  rows={4}
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Type official admin response..."
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-xs outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t">
                <button
                  type="button"
                  onClick={() => setSelectedTicket(null)}
                  className="px-4 py-2 border rounded-lg text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={replySubmitting}
                  className="px-5 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 flex items-center gap-1.5"
                >
                  <Send className="w-3.5 h-3.5" /> Save Reply & Update
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
