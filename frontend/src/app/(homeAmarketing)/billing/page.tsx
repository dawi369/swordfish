"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { CreditCard, Plus } from "lucide-react";
import { useAuth } from "@/providers/auth-provider";
import { Button } from "@/components/ui/button";
import { PaymentCard } from "@/components/billing/payment-card";
import { EmptyPaymentCard } from "@/components/billing/payment-card";
import { CurrentPlanSummary } from "@/components/billing/plan-card";
import { ensureUserSubscription } from "@/lib/supabase/subscriptions";
import type { Subscription } from "@/types/billing.types";

const ANIMATION_CONFIG = {
  fadeInUp: {
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0 },
  },
  stagger: {
    animate: { transition: { staggerChildren: 0.1 } },
  },
};

export default function BillingPage() {
  const { user, profile, loading: authLoading } = useAuth();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function loadSubscription() {
      if (authLoading) {
        setLoading(true);
        return;
      }

      if (!user) {
        setSubscription(null);
        setLoading(false);
        return;
      }

      setLoading(true);

      try {
        // Ensure user has a subscription (creates free tier if none)
        const sub = await ensureUserSubscription(user.id);
        if (!active) return;
        setSubscription(sub);
      } catch (error) {
        if (!active) return;
        console.error("Error loading subscription:", error);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadSubscription();

    return () => {
      active = false;
    };
  }, [user, authLoading]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent" />
          <p className="mt-4 text-muted-foreground">Loading billing...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div className="relative z-10 mx-auto max-w-6xl px-6 py-12 md:py-16">
        <motion.div initial="initial" animate="animate" variants={ANIMATION_CONFIG.stagger}>
          <motion.header variants={ANIMATION_CONFIG.fadeInUp} className="mb-10">
            <h1 className="max-w-3xl text-balance font-space text-4xl font-semibold tracking-[-0.05em] text-foreground md:text-5xl">
              Billing
            </h1>
          </motion.header>

          <motion.section variants={ANIMATION_CONFIG.fadeInUp} className="mb-10">
            <CurrentPlanSummary subscription={subscription} />
          </motion.section>

          <motion.section variants={ANIMATION_CONFIG.fadeInUp} className="mb-10">
            <div className="rounded-[32px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.015))] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.2)]">
              <div className="mb-5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/6">
                    <CreditCard aria-hidden="true" className="h-4 w-4 text-white/72" />
                  </div>
                  <h2 className="font-space text-2xl font-semibold tracking-[-0.04em] text-foreground">
                    Payment Method
                  </h2>
                </div>
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  className="rounded-full border-white/12 bg-white/4 hover:bg-white/8"
                >
                  <Link href="/checkout">
                    <Plus aria-hidden="true" className="mr-1 h-4 w-4" />
                    Add Card
                  </Link>
                </Button>
              </div>
              {subscription?.paymentMethod ? (
                <PaymentCard
                  paymentMethod={subscription.paymentMethod}
                  cardHolder={profile?.display_name || user?.email || "Card Holder"}
                  isActive
                />
              ) : (
                <EmptyPaymentCard />
              )}
            </div>
          </motion.section>
        </motion.div>
      </div>
    </div>
  );
}
