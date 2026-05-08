"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { CheckCircle2 } from "lucide-react";
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

export default function CheckoutSuccessPage() {
  return (
    <div className="min-h-screen relative overflow-hidden">
      <div className="relative z-10 mx-auto flex max-w-3xl px-6 py-24">
        <motion.section
          initial="initial"
          animate="animate"
          variants={ANIMATION_CONFIG.stagger}
          className="w-full rounded-lg border border-white/10 bg-black/35 p-6 backdrop-blur-md md:p-8"
        >
          <motion.div variants={ANIMATION_CONFIG.fadeInUp}>
            <div className="mb-8 flex h-12 w-12 items-center justify-center rounded-md border border-green/25 bg-green/10 text-green">
              <CheckCircle2 aria-hidden="true" className="h-6 w-6" />
            </div>
            <p className="font-mono text-xs uppercase tracking-[0.3em] text-muted-foreground">
              Checkout success
            </p>
            <h1 className="mt-3 font-space text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
              Subscription update received.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground">
              This is the reserved return page for Polar checkout. When webhooks are connected,
              billing state will update automatically after checkout completes.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild className="rounded-md bg-white text-black hover:bg-white/90">
                <Link href="/terminal">Open Terminal</Link>
              </Button>
              <Button asChild variant="outline" className="rounded-md border-white/10 bg-white/[0.03]">
                <Link href="/billing">View Billing</Link>
              </Button>
            </div>
          </motion.div>
        </motion.section>
      </div>
    </div>
  );
}
