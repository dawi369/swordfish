"use client";

import React, { useEffect } from "react";
import { motion } from "framer-motion";
import { ScrambleTitle } from "@/components/home/scramble-title";
import { ANIMATION_CONFIG, SCRAMBLE_DELAYS } from "@/app/(homeAmarketing)/constants";
import { useUIStore } from "@/store/use-ui-store";

import { Tooltip } from "@/components/ui/tooltip-card";
import {
  FuturesCard,
  SentimentCard,
  LabsCard,
  BacktestingCard,
  useMarketStatus,
} from "@/components/home/feature-tooltip-cards";

const { fadeInUp, stagger } = ANIMATION_CONFIG;
export default function Home() {
  const { setIsHoveringBackground } = useUIStore();

  const marketStatus = useMarketStatus();

  useEffect(() => {
    const currentUrl = new URL(window.location.href);
    if (!currentUrl.searchParams.has("code")) return;

    currentUrl.pathname = "/auth/callback";
    window.location.replace(currentUrl.toString());
  }, []);

  return (
    <div className="min-h-screen text-white selection:bg-primary/30 selection:text-primary-foreground overflow-x-hidden">
      <main className="relative z-10">
        {/* Centered Hero Section */}
        <section className="min-h-screen flex flex-col items-center justify-center px-6 pt-32 pb-20 text-center">
          <motion.div
            initial="initial"
            animate="animate"
            variants={stagger}
            className="max-w-5xl mx-auto space-y-12"
          >
            {/* Headline */}
            <motion.h1
              variants={fadeInUp}
              onMouseEnter={() => setIsHoveringBackground(true)}
              onMouseLeave={() => setIsHoveringBackground(false)}
              className="text-6xl md:text-[7rem] font-bold tracking-tight font-space leading-[0.85] uppercase"
            >
              <span className="block italic font-light text-muted-foreground/60 transition-colors hover:text-white duration-500">
                <ScrambleTitle delay={SCRAMBLE_DELAYS.line1}>Futures</ScrambleTitle>
              </span>
              <span className="block bg-linear-to-b from-white to-white/40 bg-clip-text text-transparent">
                <ScrambleTitle delay={SCRAMBLE_DELAYS.line2}>Amplified</ScrambleTitle>
              </span>
              <span className="block text-primary">
                <ScrambleTitle delay={SCRAMBLE_DELAYS.line3}>Intelligence</ScrambleTitle>
              </span>
            </motion.h1>

            {/* Description */}
            <motion.div
              variants={fadeInUp}
              className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto font-light leading-relaxed"
            >
              Turn market noise into institutional clarity. The professional high-fidelity terminal for{" "}
              <Tooltip content={<FuturesCard marketStatus={marketStatus} />}>
                <span className="font-medium text-foreground cursor-pointer decoration-dotted underline decoration-white/20 hover:decoration-white/50 underline-offset-4 transition-all">
                  futures
                </span>
              </Tooltip>
              , powered by real-time data, market-wide{" "}
              <Tooltip content={<SentimentCard />}>
                <span className="font-medium text-foreground cursor-pointer decoration-dotted underline decoration-white/20 hover:decoration-white/50 underline-offset-4 transition-all">
                  contextual sentiment
                </span>
              </Tooltip>
              ,{" "}
              <Tooltip content={<LabsCard />}>
                <span className="font-medium text-foreground cursor-pointer decoration-dotted underline decoration-white/20 hover:decoration-white/50 underline-offset-4 transition-all">
                  AI-driven labs
                </span>
              </Tooltip>
              , and{" "}
              <Tooltip content={<BacktestingCard />}>
                <span className="font-medium text-foreground cursor-pointer decoration-dotted underline decoration-white/20 hover:decoration-white/50 underline-offset-4 transition-all">
                  precision backtesting
                </span>
              </Tooltip>
              .
            </motion.div>

            {/* CTA Group */}
            <motion.div
              variants={fadeInUp}
              className="flex flex-wrap items-center justify-center gap-6"
            >
              {/* <Link href="/onboarding">
                <button
                  onMouseEnter={() => setIsHoveringBackground(true)}
                  onMouseLeave={() => setIsHoveringBackground(false)}
                  className="group relative h-16 px-12 overflow-hidden rounded-full bg-linear-to-br from-primary via-primary to-primary/80 text-primary-foreground font-bold text-lg transition-all hover:scale-105 hover:shadow-[0_0_50px_-10px_rgba(var(--primary-rgb),0.6)] active:scale-95 flex items-center gap-3"
                >
                  <div className="absolute inset-0 bg-linear-to-r from-transparent via-white/30 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700 ease-in-out pointer-events-none" />
                  <span className="relative z-10 flex items-center gap-3">
                    Onboarding
                    <Sparkles className="w-5 h-5 group-hover:rotate-12 transition-transform" />
                  </span>
                </button>
              </Link> */}
            </motion.div>
          </motion.div>

          {/* Hero Graphic Section */}
          {/* <motion.div
            initial={{ opacity: 0, y: 100 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6, duration: 1, ease: [0.22, 1, 0.36, 1] }}
            className="mt-24 relative w-full max-w-6xl mx-auto"
          > */}
            {/* Glow Behind Image */}
            {/* <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[80%] h-[60%] bg-primary/20 blur-[120px] rounded-full pointer-events-none opacity-50" /> */}

            {/* <Image
              src="/images/home_material_1.png"
              alt="Swordfish Experimental Interface"
              width={1800}
              height={1000}
              priority
              className="w-full h-auto object-contain select-none drop-shadow-[0_20px_50px_rgba(0,0,0,0.5)]"
            /> */}
          {/* </motion.div> */}
        </section>

        {/* Bento Feature Section */}
        {/* <section className="py-40 px-6 max-w-7xl mx-auto space-y-24"> */}
        {/* <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center space-y-4"
          >
            <h2 className="text-4xl md:text-5xl font-bold font-space uppercase">
              engineered for <br />
              <span className="italic font-black text-6xl md:text-7xl lowercase bg-linear-to-r from-primary via-primary/80 to-primary bg-clip-text text-transparent inline-block">
                you
              </span>
            </h2>
            <p className="text-muted-foreground text-lg max-w-xl mx-auto">
              Elite features designed for professional futures traders who demand perfection.
            </p>
          </motion.div> */}

        {/* Bento Grid */}
        {/* <div className="grid grid-cols-1 md:grid-cols-3 gap-6 auto-rows-[300px]"> */}
        {/* Large Card 1: Speed */}
        {/* <motion.div
              whileHover={{ y: -5 }}
              className="md:col-span-2 relative p-8 rounded-3xl border border-white/8 bg-white/3 backdrop-blur-xl overflow-hidden group border-linear-to-b from-white/10 to-transparent"
            >
              <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:opacity-20 transition-opacity">
                <Zap size={120} strokeWidth={1} />
              </div>
              <div className="relative h-full flex flex-col justify-end space-y-4">
                <div className="w-12 h-12 rounded-2xl bg-primary/20 flex items-center justify-center text-primary border border-primary/20">
                  <Zap size={24} />
                </div>
                <h3 className="text-3xl font-bold font-space tracking-tight">LATENCY IS LETHAL</h3>
                <p className="text-muted-foreground text-lg max-w-md">
                  Our global edge network delivers direct-to-exchange data with sub-millisecond
                  precision. Never miss a tick.
                </p>
              </div>
            </motion.div> */}

        {/* Small Card 1: Security */}
        {/* <motion.div
              whileHover={{ y: -5 }}
              className="relative p-8 rounded-3xl border border-white/8 bg-white/3 backdrop-blur-xl overflow-hidden group"
            >
              <div className="h-full flex flex-col justify-between">
                <div className="w-12 h-12 rounded-2xl bg-blue-500/20 flex items-center justify-center text-blue-400 border border-blue-500/20">
                  <Shield size={24} />
                </div>
                <div className="space-y-2">
                  <h3 className="text-2xl font-bold font-space">FORTRESS</h3>
                  <p className="text-muted-foreground">
                    Institutional security protocols for every user.
                  </p>
                </div>
              </div>
            </motion.div> */}

        {/* Small Card 2: Analytics */}
        {/* <motion.div
              whileHover={{ y: -5 }}
              className="relative p-8 rounded-3xl border border-white/8 bg-white/3 backdrop-blur-xl overflow-hidden group"
            >
              <div className="h-full flex flex-col justify-between">
                <div className="w-12 h-12 rounded-2xl bg-amber-500/20 flex items-center justify-center text-amber-500 border border-amber-500/20">
                  <BarChart3 size={24} />
                </div>
                <div className="space-y-2">
                  <h3 className="text-2xl font-bold font-space">SIGNALS</h3>
                  <p className="text-muted-foreground">
                    Real-time sentiment and volume flow analytics.
                  </p>
                </div>
              </div>
            </motion.div> */}

        {/* Large Card 2: Global Reach */}
        {/* <motion.div
              whileHover={{ y: -5 }}
              className="md:col-span-2 relative p-8 rounded-3xl border border-white/8 bg-white/3 backdrop-blur-xl overflow-hidden group"
            >
              <div className="absolute -bottom-10 -right-10 opacity-5 group-hover:opacity-10 transition-opacity">
                <Globe size={300} strokeWidth={1} />
              </div>
              <div className="relative h-full flex flex-col justify-end space-y-4">
                <div className="w-12 h-12 rounded-2xl bg-purple-500/20 flex items-center justify-center text-purple-400 border border-purple-500/20">
                  <Globe size={24} />
                </div>
                <h3 className="text-3xl font-bold font-space tracking-tight">GLOBAL LIQUIDITY</h3>
                <p className="text-muted-foreground text-lg max-w-md">
                  Connect to over 100 global futures markets through a single, unified interface.
                </p>
              </div>
            </motion.div>
          </div>
        </section> */}

        {/* Platform Demo Section */}
        {/* <section className="pt-60 pb-30 px-6 max-w-6xl mx-auto">
          <PlatformDemoSection variants={fadeInUp} />
        </section> */}
      </main>
    </div>
  );
}
