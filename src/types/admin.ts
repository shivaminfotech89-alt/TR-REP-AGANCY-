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
  /**
   * OPTIONAL CALL-BACK NUMBER, given on the ticket. Google sign-in returns no phone, and
   * this app has no user profile collection - see the note in SupportTickets. Absent when
   * they did not give one; never stored as an empty string.
   */
  userPhone?: string;
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

/**
 * ⚠ DECLARED, AND STILL USED BY NOTHING. Kept as the intended shape of a
 * `subscriptions/{agencyId}` document, which is the next thing to be built - a VENDOR-OWNED
 * collection no client may write. It is not the shape of anything that exists today: the live
 * database has zero subscription documents and no agency carries a subscription field.
 *
 * `planAmount` records what was ACTUALLY CHARGED at the time, which is deliberately not the
 * same thing as SUBSCRIPTION_INCLUSIVE_INR in lib/pricing.ts. The constant is today's price;
 * this is the price on an invoice already issued. When the price changes those must differ, and
 * a subscription that recomputed its own amount from the current constant would rewrite history
 * on a document a GST invoice points at.
 */
export interface AgencySubscription {
  agencyId: string;
  agencyName: string;
  ownerEmail: string;
  status: 'active' | 'trial' | 'expired' | 'suspended';
  /** What was charged, in rupees, inclusive of GST. Not re-derived from the current price. */
  planAmount: number;
  currency: string; // 'INR'
  startDate: number;
  expiryDate: number;
  razorpayPaymentId?: string;
  razorpayOrderId?: string;
  lastPaymentDate?: number;
}

/**
 * ⚠ NO SECRETS IN THIS TYPE, BY CONSTRUCTION. `keySecret` and `webhookSecret` were fields
 * here, written by the Admin Panel to `system_config/razorpay` - a document that was
 * world-readable, so the first Save would have published an API secret to the open internet.
 * Both are gone. The key secret is the Functions secret RAZORPAY_KEY_SECRET, which the client
 * cannot read; a webhook secret, when there is a webhook, belongs in the same place.
 *
 * ⚠ AND NO PRICE. `annualFeePerAgency` was a number input in a browser. A price that can be
 * edited from a browser is a price that can disagree with a GST invoice already issued. It is
 * SUBSCRIPTION_INCLUSIVE_INR in lib/pricing.ts, in version control.
 *
 * What is left is not secret: whether the gateway is on, whether it is in test mode, and the
 * publishable Key ID (`rzp_test_...`), which is designed to sit in client code.
 */
export interface RazorpaySettings {
  enabled: boolean;
  testMode: boolean;
  keyId: string;
}

export interface SystemSettings {
  maintenanceMode: boolean;
  maintenanceMessage?: string;
  announcementBanner?: string;
  announcementActive?: boolean;
  superAdminEmail: string; // 'shivaminfotech89@gmail.com'
  updatedAt?: number;
}
