"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { motion, useMotionValueEvent, useScroll, AnimatePresence } from "framer-motion";
import { usePathname } from "next/navigation";
import { Navbar } from "@/components/common/navbar";
import { ChevronLeft } from "lucide-react";

export function Header() {
  const [hidden, setHidden] = useState(false);
  const { scrollY } = useScroll();
  const pathname = usePathname();

  useMotionValueEvent(scrollY, "change", (latest) => {
    const previous = scrollY.getPrevious() ?? 0;

    // Hide when scrolling down, show when scrolling up
    if (latest > previous && latest > 10) {
      setHidden(true);
    } else {
      setHidden(false);
    }
  });

  // Don't show header on login page - Move after hooks to satisfy Rules of Hooks
  // if (pathname === "/login") return null;

  return (
    <motion.header
      className="sticky top-0 z-50 w-full text-foreground"
      variants={{
        visible: { y: 0 },
        hidden: { y: "-100%" },
      }}
      animate={hidden ? "hidden" : "visible"}
      transition={{ duration: 0.3, ease: "easeInOut" }}
    >
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-14 items-center justify-center">
          <AnimatePresence mode="wait">
            {pathname === "/login" ? (
              <motion.div
                key="login-header"
                initial={{ opacity: 0, y: -10, filter: "blur(5px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: 10, filter: "blur(5px)" }}
                transition={{ duration: 0.1, ease: "easeOut" }}
                className="flex items-center justify-center"
              >
                <Link href="/" className="opacity-60 hover:opacity-100 transition-opacity">
                  <ChevronLeft className="h-6 w-6" />
                </Link>
              </motion.div>
            ) : (
              <motion.div
                key="default-header"
                initial={{ opacity: 0, y: 10, filter: "blur(5px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -10, filter: "blur(5px)" }}
                transition={{ duration: 0.1, ease: "easeOut" }}
                className="flex items-center gap-4"
              >
                <Link href="/" className="flex items-center">
                  <motion.div
                    layoutId="header-logo"
                    layout="position"
                    className="flex items-center will-change-transform"
                  >
                    <Image
                      src="/mk3LogoTransparent.png"
                      // src="/cleaned_up_logo.svg"
                      alt="Swordfish Logo"
                      width={40}
                      height={40}
                      priority
                      fetchPriority="high"
                      className="h-10 w-auto"
                    />
                  </motion.div>
                </Link>
                <Navbar />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.header>
  );
}
