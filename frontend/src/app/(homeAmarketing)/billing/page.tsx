"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight, Loader2, ReceiptText } from "lucide-react";
import { useAuth } from "@/providers/auth-provider";
import { Button } from "@/components/ui/button";
import { ensureUserSubscription } from "@/lib/supabase/subscriptions";
import { isSubscriptionActive, TIER_CONFIG, type Subscription } from "@/types/billing.types";

const ANIMATION_CONFIG = {
  fadeInUp: {
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0 },
  },
  stagger: {
    animate: { transition: { staggerChildren: 0.1 } },
  },
};

function formatBillingDate(value: string | null | undefined) {
  if (!value) return "No scheduled billing cycle";

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function getStatusLabel(subscription: Subscription | null) {
  if (!subscription) return "Not configured";

  if (subscription.status === "trialing") return "Trial running";
  if (subscription.status === "past_due") return "Past due";
  if (subscription.status === "incomplete") return "Setup incomplete";
  if (subscription.status === "paused") return "Paused";
  if (subscription.status === "canceled") return "Canceled";
  if (subscription.status === "unpaid") return "Unpaid";
  return "Active";
}

function getBillingAction(subscription: Subscription | null) {
  const isPro = subscription?.tier === "pro";

  if (isPro) {
    return {
      href: "/billing/portal",
      label: "Manage billing",
    };
  }

  return {
    href: "/checkout",
    label: "Upgrade to Pro",
  };
}

export default function BillingPage() {
  const { user, loading: authLoading } = useAuth();
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
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
          <p className="mt-4 text-muted-foreground">Loading billing...</p>
        </div>
      </div>
    );
  }

  const billingAction = getBillingAction(subscription);

  return (
    <div className="min-h-screen relative overflow-hidden">
      <div className="relative z-10 mx-auto max-w-4xl px-6 py-24">
        <motion.div
          initial="initial"
          animate="animate"
          variants={ANIMATION_CONFIG.stagger}
          className="space-y-10"
        >
          <motion.header variants={ANIMATION_CONFIG.fadeInUp}>
            <h1 className="font-space text-4xl font-bold tracking-tight text-foreground md:text-5xl">
              Billing
            </h1>
            <p className="mt-4 max-w-2xl text-lg leading-relaxed text-muted-foreground">
              Manage your plan, access state, and payment method.
            </p>
          </motion.header>

          <motion.section variants={ANIMATION_CONFIG.fadeInUp}>
            <div className="rounded-lg border border-white/10 bg-black/35 p-6 backdrop-blur-md md:p-8">
              <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="mb-8 flex h-12 w-12 items-center justify-center rounded-md border border-amber-400/20 bg-amber-400/10 text-amber-300">
                    <ReceiptText className="h-6 w-6" />
                  </div>
                  <p className="font-mono text-xs uppercase tracking-[0.3em] text-muted-foreground">
                    Current plan
                  </p>
                  <h2 className="mt-3 font-space text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
                    {TIER_CONFIG[subscription?.tier || "free"].name}
                  </h2>
                  <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground">
                    {isSubscriptionActive(subscription)
                      ? "Terminal access is enabled."
                      : "Terminal access is limited until billing is active."}
                  </p>
                </div>

                <div className="shrink-0 rounded-lg border border-white/10 bg-white/[0.03] p-5 md:min-w-52">
                  <p className="font-mono text-xs uppercase tracking-[0.24em] text-muted-foreground">
                    Status
                  </p>
                  <p className="mt-3 text-lg font-medium text-foreground">
                    {getStatusLabel(subscription)}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {formatBillingDate(subscription?.currentPeriodEnd)}
                  </p>
                </div>
              </div>

              <div className="mt-8">
                <Button asChild className="rounded-md bg-white text-black hover:bg-white/90">
                  <Link href={billingAction.href}>
                    {billingAction.label}
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
              </div>
            </div>
          </motion.section>
        </motion.div>
      </div>
    </div>
  );
}
