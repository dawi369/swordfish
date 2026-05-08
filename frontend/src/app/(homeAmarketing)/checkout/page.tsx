"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowLeft, ShieldCheck, Wrench } from "lucide-react";
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

export default function CheckoutPage() {
  return (
    <div className="min-h-screen">
      <div className="relative z-10 mx-auto flex max-w-3xl px-6 py-24">
        <motion.div
          initial="initial"
          animate="animate"
          variants={ANIMATION_CONFIG.stagger}
          className="w-full"
        >
          <motion.div variants={ANIMATION_CONFIG.fadeInUp} className="mb-6">
            <Link
              href="/pricing"
              className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft aria-hidden="true" className="h-4 w-4" />
              Back
            </Link>
          </motion.div>

          <motion.section
            variants={ANIMATION_CONFIG.fadeInUp}
            className="rounded-lg border border-white/10 bg-black/35 p-6 backdrop-blur-md md:p-8"
          >
            <div className="space-y-6">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-md border border-amber-400/20 bg-amber-400/10 text-amber-300">
                <Wrench aria-hidden="true" className="h-5 w-5" />
              </div>

              <div className="space-y-3">
                <p className="font-mono text-xs uppercase tracking-[0.3em] text-muted-foreground">
                  Checkout
                </p>
                <h1 className="font-space text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
                  Polar checkout not connected yet.
                </h1>
                <p className="max-w-xl text-base leading-7 text-muted-foreground">
                  This route is reserved for the hosted Polar checkout redirect. Customers will
                  subscribe there; Swordfish will update local billing state from Polar webhooks.
                </p>
              </div>

              <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-center gap-2">
                  <ShieldCheck aria-hidden="true" className="h-4 w-4 text-green" />
                  <p className="text-sm font-medium text-foreground">Hosted payment flow</p>
                </div>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  No card data should be collected inside Swordfish. Polar will own checkout,
                  customer portal, invoices, and payment method updates.
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <Button asChild className="rounded-md bg-white text-black hover:bg-white/90">
                  <Link href="/billing">Go to Billing</Link>
                </Button>
                <Button asChild variant="outline" className="rounded-md border-white/10 bg-white/[0.03]">
                  <Link href="/pricing">Go to Pricing</Link>
                </Button>
              </div>
            </div>
          </motion.section>
        </motion.div>
      </div>
    </div>
  );
}
