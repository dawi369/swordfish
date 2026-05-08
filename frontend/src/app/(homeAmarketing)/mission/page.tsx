"use client";

import { motion } from "framer-motion";
import { ArrowRight, GitBranch, Radar, Scale, Wheat } from "lucide-react";

const ANIMATION_CONFIG = {
  fadeInUp: {
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0 },
  },
  stagger: {
    animate: { transition: { staggerChildren: 0.1 } },
  },
};

export default function MissionPage() {
  return (
    <div className="min-h-screen relative overflow-hidden">
      <div className="relative z-10 mx-auto max-w-6xl px-6 py-24 md:py-32">
        <motion.div
          initial="initial"
          animate="animate"
          variants={ANIMATION_CONFIG.stagger}
          className="space-y-24"
        >
          <motion.section variants={ANIMATION_CONFIG.fadeInUp} className="mx-auto max-w-4xl text-center">
            <p className="mb-5 font-mono text-xs uppercase tracking-[0.35em] text-primary/70">
              Swordfish thesis
            </p>
            <h1 className="text-4xl font-bold font-space tracking-tight text-foreground md:text-6xl">
              Markets move in relationships.
            </h1>
            <p className="mx-auto mt-8 max-w-3xl text-lg leading-relaxed text-muted-foreground md:text-xl">
              We are building a futures terminal around the way serious traders actually reason:
              one contract rarely tells the whole story. The edge lives in the pressure between
              markets, where grain, energy, livestock, metals, rates, and currencies keep repricing
              each other in real time.
            </p>
          </motion.section>

          <motion.section
            variants={ANIMATION_CONFIG.fadeInUp}
            className="grid gap-4 md:grid-cols-[1.05fr_0.95fr]"
          >
            <div className="rounded-lg border border-white/10 bg-black/35 p-6 backdrop-blur-md md:p-8">
              <div className="mb-8 flex h-12 w-12 items-center justify-center rounded-md border border-amber-400/20 bg-amber-400/10 text-amber-300">
                <GitBranch className="h-6 w-6" />
              </div>
              <h2 className="font-space text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
                Intermarket context first.
              </h2>
              <p className="mt-5 text-base leading-relaxed text-muted-foreground md:text-lg">
                The useful question is not only what wheat is doing. It is what wheat changes
                about feed costs, herd economics, inflation expectations, and the trade we are about
                to make in pork bellies. Swordfish is meant to make those relationships visible
                before they become obvious.
              </p>
            </div>

            <div className="rounded-lg border border-white/10 bg-white/[0.03] p-6 md:p-8">
              <p className="font-mono text-xs uppercase tracking-[0.3em] text-muted-foreground">
                Example path
              </p>
              <div className="mt-8 space-y-4">
                {[
                  ["Wheat futures", "Input pressure changes"],
                  ["Feed economics", "Livestock margins adjust"],
                  ["Pork bellies", "Decision quality improves"],
                ].map(([label, detail], index, items) => (
                  <div key={label} className="flex items-center gap-4">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-white/10 bg-black/40">
                      {index === 0 ? (
                        <Wheat className="h-5 w-5 text-amber-300" />
                      ) : index === 1 ? (
                        <Scale className="h-5 w-5 text-blue" />
                      ) : (
                        <Radar className="h-5 w-5 text-green" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-foreground">{label}</p>
                      <p className="text-sm text-muted-foreground">{detail}</p>
                    </div>
                    {index < items.length - 1 && (
                      <ArrowRight className="hidden h-4 w-4 text-muted-foreground md:block" />
                    )}
                  </div>
                ))}
              </div>
            </div>
          </motion.section>

          <motion.section variants={ANIMATION_CONFIG.fadeInUp} className="grid gap-4 md:grid-cols-3">
            {[
              {
                title: "Cross-market maps",
                body: "Build the terminal around relationships between contracts, not isolated watchlists.",
              },
              {
                title: "Decision surfaces",
                body: "Show the conditions that matter to a trade before the trader has to assemble them manually.",
              },
              {
                title: "Trader discipline",
                body: "Inspired by Al Hargest's intermarket approach: study the linked markets, then act with context.",
              },
            ].map((item) => (
              <div key={item.title} className="rounded-lg border border-white/10 bg-white/[0.025] p-6">
                <h3 className="font-space text-lg font-semibold tracking-tight text-foreground">
                  {item.title}
                </h3>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">{item.body}</p>
              </div>
            ))}
          </motion.section>
        </motion.div>
      </div>
    </div>
  );
}
