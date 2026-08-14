export type UserRoleType = 'admin' | 'manager' | 'operator' | 'viewer';

export interface UserRoleRecord {
  id: string;
  email: string;
  role: UserRoleType;
  agencyId?: string;
  agencyName?: string;
  status: 'active' | 'suspended';
  updatedAt: number;
  updatedBy?: string;
}

export type TicketCategory = 'Razorpay & Billing' | 'Technical Issue' | 'Feature Request' | 'Bug Report' | 'Account & Access';
export type TicketPriority = 'Low' | 'Medium' | 'High' | 'Urgent';
export type TicketStatus = 'Open' | 'In Progress' | 'Resolved' | 'Closed';

export interface SupportTicket {
  id: string;
  ticketNo: string;
  userId: string;
  userEmail: string;
  agencyId?: string;
  agencyName?: string;
  subject: string;
  category: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  description: string;
  adminReply?: string;
  repliedAt?: number;
  repliedBy?: string;
  createdAt: number;
  updatedAt: number;
}

export interface AgencySubscription {
  agencyId: string;
  agencyName: string;
  ownerEmail: string;
  status: 'active' | 'trial' | 'expired' | 'suspended';
  planAmount: number; // e.g. 3999
  currency: string; // 'INR'
  startDate: number;
  expiryDate: number;
  razorpayPaymentId?: string;
  razorpayOrderId?: string;
  lastPaymentDate?: number;
}

export interface RazorpaySettings {
  enabled: boolean;
  testMode: boolean;
  keyId: string;
  keySecret: string;
  annualFeePerAgency: number; // 3999
  webhookSecret?: string;
}

export interface SystemSettings {
  maintenanceMode: boolean;
  maintenanceMessage?: string;
  announcementBanner?: string;
  announcementActive?: boolean;
  superAdminEmail: string; // 'shivaminfotech89@gmail.com'
  updatedAt?: number;
}
