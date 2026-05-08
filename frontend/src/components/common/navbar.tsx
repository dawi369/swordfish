"use client";

import * as React from "react";
import Link from "next/link";
import { Terminal, Sparkles, FlaskConical } from "lucide-react";
import { motion } from "framer-motion";

import { useIsMobile } from "@/hooks/use-mobile";
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
  navigationMenuTriggerStyle,
} from "@/components/ui/navigation-menu";
import { AuthIndicator } from "@/components/common/auth-indicator";

export function Navbar() {
  const isMobile = useIsMobile();

  return (
    <>
      <NavigationMenu viewport={!isMobile} suppressHydrationWarning>
        <NavigationMenuList className="flex-wrap">
          <NavigationMenuItem>
            <NavigationMenuTrigger
              className="opacity-60 hover:opacity-100 transition-opacity"
              suppressHydrationWarning
            >
              Features
            </NavigationMenuTrigger>
            <NavigationMenuContent>
              <ul className="grid gap-2 md:w-[400px] lg:w-[500px] lg:grid-cols-[.75fr_1fr]">
                <li className="row-span-3">
                  <NavigationMenuLink asChild>
                    <Link
                      href="/terminal?view=terminal"
                      className="group flex h-full w-full flex-col justify-end rounded-md border border-white/5 bg-white/0 p-4 no-underline outline-none transition-all duration-500 select-none hover:border-white/10 hover:bg-white/5 md:p-6"
                    >
                      <div className="mb-2 text-lg font-bold font-space text-foreground transition-colors flex items-center gap-2 group-hover:text-primary">
                        <Terminal className="h-5 w-5 transition-colors duration-500 text-muted-foreground group-hover:text-primary" />
                        Terminal
                      </div>
                      <p className="text-muted-foreground text-sm leading-tight font-mono">
                        Beautifully designed, lightning fast.
                      </p>
                    </Link>
                  </NavigationMenuLink>
                </li>
                <ListItem href="/terminal?view=ai-lab" title="AI Lab" icon={Sparkles}>
                  {/* <ListItem href="/terminal?view=ai-lab" title="AI Lab" icon={BrainCircuit}> */}
                  See what the data sees. Powered by the latest systems.
                </ListItem>
                <ListItem href="/terminal?view=backtesting" title="Backtesting" icon={FlaskConical}>
                  Test your edge. Run historical simulations and validate strategies.
                </ListItem>
                {/* <ListItem href="/terminal?view=sentiment" title="Market Sentiment" icon={Activity}> */}
                {/* <ListItem href="/terminal?view=sentiment" title="Market Sentiment" icon={Scale}>
                  Feel the market. Understand the pulse of futures trading across all asset classes.
                </ListItem> */}
              </ul>
            </NavigationMenuContent>
          </NavigationMenuItem>

          <NavigationMenuItem>
            <NavigationMenuLink asChild className={navigationMenuTriggerStyle()}>
              <Link href="/mission" className="opacity-60 hover:opacity-100 transition-opacity">
                Thesis
              </Link>
            </NavigationMenuLink>
          </NavigationMenuItem>

          <NavigationMenuItem>
            <NavigationMenuLink asChild className={navigationMenuTriggerStyle()}>
              <Link href="/pricing" className="opacity-60 hover:opacity-100 transition-opacity">
                Pricing
              </Link>
            </NavigationMenuLink>
          </NavigationMenuItem>
        </NavigationMenuList>
      </NavigationMenu>
      <motion.div layoutId="header-auth" layout="position" className="will-change-transform">
        <AuthIndicator align="right" />
      </motion.div>
    </>
  );
}

function ListItem({
  title,
  children,
  href,
  icon: Icon,
  ...props
}: React.ComponentPropsWithoutRef<"li"> & {
  href: string;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <li {...props}>
      <NavigationMenuLink asChild>
        <Link
          href={href}
          className="group block select-none space-y-1 rounded-md p-3 leading-none no-underline outline-none transition-all duration-500 hover:bg-white/5 focus:bg-accent focus:text-accent-foreground"
        >
          <div className="text-sm leading-none font-medium flex items-center gap-2 group-hover:text-primary transition-colors duration-500">
            {Icon && (
              <Icon className="h-4 w-4 text-muted-foreground transition-colors duration-500 group-hover:text-primary" />
            )}
            {title}
          </div>
          <p className="text-muted-foreground line-clamp-2 text-sm leading-snug">{children}</p>
        </Link>
      </NavigationMenuLink>
    </li>
  );
}
