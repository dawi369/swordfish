"use client";

import { motion } from "framer-motion";
import { ArrowRight, CircleDollarSign } from "lucide-react";

import { ANALYTICS_EVENTS, captureAnalyticsEvent } from "@/lib/analytics";
import { TIER_CONFIG } from "@/types/billing.types";

const ANIMATION_CONFIG = {
  fadeInUp: {
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0 },
  },
  stagger: {
    animate: { transition: { staggerChildren: 0.1 } },
  },
};

export default function PricingPage() {
  const proPlan = TIER_CONFIG.pro;

  const handleSubscribe = () => {
    captureAnalyticsEvent(ANALYTICS_EVENTS.pricingCtaClicked, {
      tier: "pro",
      cta: "start_free_trial",
      source: "pricing_page",
    });

    window.location.href = "/checkout";
  };

  return (
    <div className="min-h-screen relative overflow-hidden">
      <div className="relative z-10 mx-auto max-w-6xl px-6 py-24 md:py-32">
        <motion.div
          initial="initial"
          animate="animate"
          variants={ANIMATION_CONFIG.stagger}
          className="space-y-16"
        >
          <motion.section variants={ANIMATION_CONFIG.fadeInUp} className="mx-auto max-w-4xl text-center">
            <p className="mb-5 font-mono text-xs uppercase tracking-[0.35em] text-primary/70">
              Pricing
            </p>
            <h1 className="mx-auto max-w-4xl font-space text-4xl font-bold tracking-tight text-foreground md:text-6xl">
              One seat. The whole terminal.
            </h1>
            <p className="mx-auto mt-8 max-w-2xl text-lg leading-relaxed text-muted-foreground md:text-xl">
              Simple pricing for traders who want the full Swordfish surface without plan math,
              feature gates, or legacy terminal baggage.
            </p>
          </motion.section>

          <motion.section variants={ANIMATION_CONFIG.fadeInUp} className="mx-auto max-w-3xl">
            <div className="rounded-lg border border-white/10 bg-black/35 p-6 backdrop-blur-md md:p-8">
              <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="mb-8 flex h-12 w-12 items-center justify-center rounded-md border border-amber-400/20 bg-amber-400/10 text-amber-300">
                    <CircleDollarSign className="h-6 w-6" />
                  </div>
                  <p className="font-mono text-xs uppercase tracking-[0.3em] text-muted-foreground">
                    {proPlan.name}
                  </p>
                  <h2 className="mt-3 font-space text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
                    Full access
                  </h2>
                  <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground">
                    One clean monthly plan for the terminal, relationship views, support, and AI
                    usage as it comes online.
                  </p>
                </div>

                <div className="shrink-0 rounded-lg border border-white/10 bg-white/[0.03] p-5 md:min-w-48">
                  <div className="flex items-end gap-2">
                    <span className="font-space text-5xl font-semibold leading-none tracking-tight text-foreground">
                      {proPlan.priceDisplay}
                    </span>
                    <span className="pb-1.5 font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
                      / {proPlan.interval}
                    </span>
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground">7-day free trial first.</p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleSubscribe}
                className="mt-8 inline-flex h-12 w-full items-center justify-center gap-2 rounded-md bg-white px-5 text-sm font-semibold text-black transition hover:bg-white/90 md:w-auto"
              >
                Start 7-day free trial
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-8 grid gap-6 border-t border-white/10 pt-8 sm:grid-cols-2">
              {[
                {
                  title: "Trial first",
                  body: "Use the terminal before committing. Checkout starts with the 7-day trial.",
                },
                {
                  title: "Support included",
                  body: "Questions about access, workflows, or the product go straight to the team.",
                },
              ].map(({ title, body }) => (
                <div key={title}>
                  <p className="font-mono text-xs uppercase tracking-[0.28em] text-muted-foreground">
                    {title}
                  </p>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">{body}</p>
                </div>
              ))}
            </div>
          </motion.section>

          <motion.section variants={ANIMATION_CONFIG.fadeInUp} className="text-center">
            <a
              href="mailto:support@swordfish.com"
              className="text-sm text-muted-foreground underline underline-offset-4 transition hover:text-foreground"
            >
              Questions about pricing? Contact support.
            </a>
          </motion.section>
        </motion.div>
      </div>
    </div>
  );
}
