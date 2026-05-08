"use client";

import { motion } from "framer-motion";
import { STATS_DATA } from "@/app/(homeAmarketing)/constants";

interface StatsDisplayProps {
  variants?: React.ComponentProps<typeof motion.div>["variants"];
}

export function StatsDisplay({ variants }: StatsDisplayProps) {
  return (
    <motion.div
      variants={variants}
      className="pt-8 grid grid-cols-3 gap-8 border-t border-border/50"
    >
      {STATS_DATA.map((stat, index) => (
        <div key={index}>
          <div className="text-3xl font-bold font-space">{stat.value}</div>
          <div className="text-xs text-muted-foreground font-mono uppercase mt-1">
            {stat.label}
          </div>
        </div>
      ))}
    </motion.div>
  );
}
