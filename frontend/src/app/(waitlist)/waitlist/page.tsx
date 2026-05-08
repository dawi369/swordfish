"use client";
import React, { useState } from "react";
import Image from "next/image";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { BackgroundBeams } from "@/components/ui/background-beams";
import { Footer } from "@/components/common/footer";
import { addToWaitlist } from "@/app/(waitlist)/actions";
import { ANALYTICS_EVENTS, captureAnalyticsEvent } from "@/lib/analytics";

const ANIMATION_CONFIG = {
  fadeInUp: {
    initial: { opacity: 0, y: 16 },
    animate: { opacity: 1, y: 0 },
  },
  stagger: {
    animate: { transition: { staggerChildren: 0.1 } },
  },
};

export default function WaitlistPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<{ success: boolean; message: string } | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setStatus(null);

    const result = await addToWaitlist(email);
    setStatus(result);
    setIsLoading(false);

    if (result.success) {
      captureAnalyticsEvent(ANALYTICS_EVENTS.waitlistSubmitted, {
        source: "waitlist_page",
      });
      setEmail("");
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-neutral-950 text-white">
      <BackgroundBeams className="opacity-70" />

      <div className="relative z-10">
        <motion.header
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 pt-8"
        >
          <div className="flex items-center gap-4">
            <Image
              src="/mk3LogoTransparent.png"
              alt="Swordfish"
              width={44}
              height={44}
              className="h-11 w-11"
            />
            <div className="text-sm uppercase tracking-[0.2em] text-white/70">Swordfish</div>
          </div>
        </motion.header>

        <main className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-12 px-6 pb-24 pt-16 lg:grid-cols-[1.05fr_0.95fr]">
          <motion.section
            initial="initial"
            animate="animate"
            variants={ANIMATION_CONFIG.stagger}
            className="flex flex-col justify-center"
          >
            <motion.p
              variants={ANIMATION_CONFIG.fadeInUp}
              className="mb-4 text-xs uppercase tracking-[0.35em] text-white/50"
            >
              Futures Intelligence
            </motion.p>
            <motion.h1
              variants={ANIMATION_CONFIG.fadeInUp}
              className="text-4xl font-bold uppercase leading-[0.9] tracking-tight text-white md:text-6xl font-space"
            >
              Signal over noise.
              <span className="block text-white/60">Trade with clarity.</span>
            </motion.h1>
            <motion.p
              variants={ANIMATION_CONFIG.fadeInUp}
              className="mt-6 max-w-xl text-base leading-relaxed text-white/65 md:text-lg"
            >
              Swordfish is a professional futures terminal built for intuitiveness, clarity, and confidence.
              Advanced charting, multi-contract comparisons and spreads, and a non intrusive AI research layer that
              works with you, inside a clean, low-latency UI.
            </motion.p>

            <motion.div
              variants={ANIMATION_CONFIG.fadeInUp}
              className="mt-8 grid gap-4 text-sm text-white/60"
            >
              <div className="flex items-center gap-3">
                <span className="h-1 w-1 rounded-full bg-white/60" />
                Institutional-grade charting with precise multi-symbol comparisons.
              </div>
              <div className="flex items-center gap-3">
                <span className="h-1 w-1 rounded-full bg-white/60" />
                A focused, elegant interface designed for fast, frictionless work.
              </div>
              <div className="flex items-center gap-3">
                <span className="h-1 w-1 rounded-full bg-white/60" />
                AI layer for scenario analysis, summaries, and decision support.
              </div>
            </motion.div>

            <motion.div
              variants={ANIMATION_CONFIG.fadeInUp}
              className="mt-10 text-xs uppercase tracking-[0.3em] text-white/50"
            >
              Estimated launch: <span className="text-white/70">Q3 2026</span>
            </motion.div>
          </motion.section>

          <motion.aside
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="flex flex-col gap-6"
          >
            <div className="rounded-2xl border border-white/10 bg-black/40 p-8 backdrop-blur">
              <div className="text-xs uppercase tracking-[0.3em] text-white/50">Join the waitlist</div>
              <h2 className="mt-4 text-2xl font-semibold text-white">Request early access</h2>
              <p className="mt-3 text-sm text-white/60">
                We are opening access in waves. Share your email to secure a spot.
              </p>

              <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
                <input
                  type="email"
                  id="email"
                  name="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  disabled={isLoading}
                  className="h-14 w-full rounded-xl border border-white/10 bg-black/50 px-4 text-base text-white placeholder:text-white/30 focus:border-white/30 focus:outline-none focus:ring-2 focus:ring-white/10"
                />
                <button
                  type="submit"
                  disabled={isLoading}
                  className="group flex h-14 items-center justify-center gap-2 rounded-xl bg-white px-6 text-base font-semibold text-neutral-950 transition-all hover:bg-white/90 disabled:cursor-not-allowed disabled:bg-white/40"
                >
                  {isLoading ? "Joining..." : "Request Invite"}
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </button>
                {status && (
                  <p className={`text-sm text-center ${status.success ? "text-emerald-300" : "text-red-400"}`}>
                    {status.message}
                  </p>
                )}
                <p className="text-center text-s text-white/50 italic">
                  Don&apos;t use your grandpa&apos;s tools.
                </p>
              </form>
            </div>
          </motion.aside>
        </main>

        <Footer />
      </div>
    </div>
  );
}
