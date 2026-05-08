"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

const ANIMATION_CONFIG = {
  fadeInUp: {
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0 },
  },
  stagger: {
    animate: { transition: { staggerChildren: 0.1 } },
  },
};

export default function BillingPortalPage() {
  return (
    <div className="min-h-screen relative overflow-hidden">
      <div className="relative z-10 mx-auto flex max-w-3xl px-6 py-24">
        <motion.div
          initial="initial"
          animate="animate"
          variants={ANIMATION_CONFIG.stagger}
          className="w-full"
        >
          <motion.div variants={ANIMATION_CONFIG.fadeInUp} className="mb-6">
            <Link
              href="/billing"
              className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft aria-hidden="true" className="h-4 w-4" />
              Back to Billing
            </Link>
          </motion.div>

          <motion.section
            variants={ANIMATION_CONFIG.fadeInUp}
            className="rounded-lg border border-white/10 bg-black/35 p-6 backdrop-blur-md md:p-8"
          >
            <div className="mb-8 flex h-12 w-12 items-center justify-center rounded-md border border-amber-400/20 bg-amber-400/10 text-amber-300">
              <ShieldCheck aria-hidden="true" className="h-6 w-6" />
            </div>
            <p className="font-mono text-xs uppercase tracking-[0.3em] text-muted-foreground">
              Billing portal
            </p>
            <h1 className="mt-3 font-space text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
              Polar portal not connected yet.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground">
              This route is reserved for the hosted Polar customer portal. Once wired, customers
              will manage cards, invoices, receipts, and cancellation from Polar.
            </p>

            <div className="mt-8">
              <Button asChild variant="outline" className="rounded-md border-white/10 bg-white/[0.03]">
                <Link href="/billing">Return to Billing</Link>
              </Button>
            </div>
          </motion.section>
        </motion.div>
      </div>
    </div>
  );
}
