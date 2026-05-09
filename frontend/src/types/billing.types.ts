/**
 * Billing System Types
 *
 * Provider-agnostic type definitions for the billing system.
 * Designed to work with Stripe, LemonSqueezy, and Paddle.
 */

// ============================================================================
// Enums
// ============================================================================

export type SubscriptionTier = "free" | "pro";

export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "incomplete"
  | "paused";

export type BillingProvider = "stripe" | "lemonsqueezy" | "paddle" | "manual";

export type PaymentMethodType = "card" | "paypal" | "bank_transfer" | "unknown";

export type CardBrand =
  | "visa"
  | "mastercard"
  | "amex"
  | "discover"
  | "diners"
  | "jcb"
  | "unionpay"
  | "unknown";

// ============================================================================
// Core Interfaces
// ============================================================================

export interface Subscription {
  id: string;
  userId: string;
  tier: SubscriptionTier;
  provider: BillingProvider;
  providerCustomerId: string | null;
  providerSubscriptionId: string | null;
  providerPriceId: string | null;
  status: SubscriptionStatus;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  paymentMethod: PaymentMethod | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentMethod {
  type: PaymentMethodType;
  last4: string | null;
  brand: CardBrand | null;
  expMonth: number | null;
  expYear: number | null;
}

export interface Transaction {
  id: string;
  date: string;
  description: string;
  amount: number;
  currency: string;
  status: "succeeded" | "pending" | "failed" | "refunded";
  invoiceUrl?: string;
}

// ============================================================================
// Tier Feature Definitions
// ============================================================================

export interface TierFeature {
  name: string;
  included: boolean;
  limit?: string;
}

export interface TierInfo {
  id: SubscriptionTier;
  name: string;
  price: number;
  priceDisplay: string;
  interval: "month" | "year" | "once";
  description: string;
  features: TierFeature[];
  popular?: boolean;
}

export const TIER_CONFIG: Record<SubscriptionTier, TierInfo> = {
  free: {
    id: "free",
    name: "Free",
    price: 0,
    priceDisplay: "$0",
    interval: "month",
    description: "Legacy plan - not available for new users",
    features: [
      { name: "Delayed market data", included: true },
      { name: "All contracts except front month", included: true },
      { name: "Basic charting", included: true },
      { name: "Real-time data", included: false },
      { name: "Front month access", included: false },
      { name: "AI signals", included: false },
    ],
  },
  pro: {
    id: "pro",
    name: "Pro",
    price: 34.99,
    priceDisplay: "$34.99",
    interval: "month",
    description: "7-day free trial, then $34.99/mo",
    features: [
      { name: "Full access to the Swordfish platform", included: true },
      { name: "Personal support", included: true },
    ],
  },
};

// ============================================================================
// Database Row Types (matching Supabase schema)
// ============================================================================

export interface SubscriptionRow {
  id: string;
  user_id: string;
  tier: SubscriptionTier;
  provider: BillingProvider;
  provider_customer_id: string | null;
  provider_subscription_id: string | null;
  provider_price_id: string | null;
  status: SubscriptionStatus;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  canceled_at: string | null;
  payment_method_type: string | null;
  payment_method_last4: string | null;
  payment_method_brand: string | null;
  payment_method_exp_month: number | null;
  payment_method_exp_year: number | null;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Convert database row to Subscription interface
 */
export function rowToSubscription(row: SubscriptionRow): Subscription {
  return {
    id: row.id,
    userId: row.user_id,
    tier: row.tier,
    provider: row.provider,
    providerCustomerId: row.provider_customer_id,
    providerSubscriptionId: row.provider_subscription_id,
    providerPriceId: row.provider_price_id,
    status: row.status,
    currentPeriodStart: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: row.cancel_at_period_end,
    canceledAt: row.canceled_at,
    paymentMethod:
      row.payment_method_type || row.payment_method_last4
        ? {
            type: (row.payment_method_type as PaymentMethodType) || "unknown",
            last4: row.payment_method_last4,
            brand: (row.payment_method_brand as CardBrand) || null,
            expMonth: row.payment_method_exp_month,
            expYear: row.payment_method_exp_year,
          }
        : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Check if subscription has active access
 */
export function isSubscriptionActive(subscription: Subscription | null): boolean {
  if (!subscription) return false;
  return ["active", "trialing"].includes(subscription.status);
}

/**
 * Check if user has pro tier access
 */
export function hasProAccess(subscription: Subscription | null): boolean {
  return isSubscriptionActive(subscription) && subscription?.tier === "pro";
}
