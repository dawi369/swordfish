"use client";
import { useEffect, useState } from "react";
import { motion, MotionProps } from "framer-motion";
import { cn } from "@/lib/utils";

type TextScrambleProps = {
  children: string;
  duration?: number;
  speed?: number;
  characterSet?: string;
  as?: "span" | "p";
  className?: string;
  trigger?: boolean;
  onScrambleComplete?: () => void;
  loop?: boolean;
} & MotionProps;

const defaultChars =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

const MOTION_COMPONENTS = {
  p: motion.p,
  span: motion.span,
} as const;

export function TextScramble({
  children,
  duration = 0.8,
  speed = 0.04,
  characterSet = defaultChars,
  className,
  as: Component = "p",
  trigger = true,
  onScrambleComplete,
  loop = false,
  ...props
}: TextScrambleProps) {
  const [displayText, setDisplayText] = useState(children);
  const text = children;

  useEffect(() => {
    if (!trigger && !loop) return;

    const startTime = Date.now();
    const length = text.length;

    const animate = () => {
      const now = Date.now();
      const progress = Math.min((now - startTime) / (duration * 1000), 1);

      if (loop) {
        const nextText = text
          .split("")
          .map((char) => {
            if (char === " ") return char;
            return characterSet[
              Math.floor(Math.random() * characterSet.length)
            ];
          })
          .join("");
        setDisplayText(nextText);
        return;
      }

      if (progress === 1) {
        setDisplayText(text);
        onScrambleComplete?.();
        clearInterval(interval);
        return;
      }

      const nextText = text
        .split("")
        .map((char, index) => {
          if (char === " ") return char;
          if (index < length * progress) {
            return char;
          }
          return characterSet[Math.floor(Math.random() * characterSet.length)];
        })
        .join("");

      setDisplayText(nextText);
    };

    const interval = setInterval(animate, speed * 1000);

    return () => clearInterval(interval);
  }, [trigger, loop, text, duration, speed, characterSet, onScrambleComplete]);

  const MotionComponent = MOTION_COMPONENTS[Component];

  return (
    <MotionComponent className={cn(className)} {...props}>
      {displayText}
    </MotionComponent>
  );
}
