"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Lock, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/providers/auth-provider";
import { getUserSubscription } from "@/lib/supabase/subscriptions";
import { motion } from "framer-motion";

interface SubscriptionGuardProps {
  children: React.ReactNode;
}

export function SubscriptionGuard({ children }: SubscriptionGuardProps) {
  const { user, loading: authLoading, profileLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [hasAccess, setHasAccess] = useState(false);

  useEffect(() => {
    let active = true;

    async function checkSubscription() {
      if (authLoading || profileLoading) {
        setLoading(true);
        return;
      }

      if (!user) {
        setHasAccess(false);
        setLoading(false);
        return;
      }

      setLoading(true);

      try {
        const subscription = await getUserSubscription(user.id);
        if (!active) return;
        
        // Access Logic: Pro Tier AND (Active OR Trialing OR Past Due)
        const isPro = subscription?.tier === "pro";
        const isActive = 
          subscription?.status === "active" || 
          subscription?.status === "trialing" ||
          subscription?.status === "past_due";
        
        setHasAccess(isPro && isActive);
      } catch (error) {
        if (!active) return;
        console.error("Error checking subscription:", error);
        setHasAccess(false);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void checkSubscription();

    return () => {
      active = false;
    };
  }, [user, authLoading, profileLoading]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!hasAccess) {
    return (
      <div className="min-h-screen relative flex items-center justify-center p-4">
        {/* Back Button Header (Matches Global Header Style) */}
        <div className="absolute top-0 left-0 w-full h-14 flex items-center justify-center z-50">
          <Link href="/" className="opacity-60 hover:opacity-100 transition-opacity p-2 text-foreground">
             <ChevronLeft className="h-6 w-6" />
          </Link>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-md space-y-8 -mt-[16vh]"
        >
          <div className="text-center space-y-2">
            <h1 className="text-3xl font-bold tracking-tight">Pro Access Required</h1>
            <p className="text-muted-foreground">The terminal is available exclusively to Pro subscribers</p>
          </div>

          <div className="bg-card border border-border rounded-xl p-8 shadow-lg backdrop-blur-sm bg-opacity-50">
            <div className="space-y-6">
               <div className="flex justify-center">
                  <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                     <Lock className="h-6 w-6 text-primary" />
                  </div>
               </div>

               <div className="space-y-3 pt-2">
                 <div className="flex items-center gap-2 text-sm text-muted-foreground">
                   <div className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                   <span>Real-time market data...</span>
                 </div>
                 <div className="flex items-center gap-2 text-sm text-muted-foreground">
                   <div className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                   <span>AI Lab something</span>
                 </div>
                 <div className="flex items-center gap-2 text-sm text-muted-foreground">
                   <div className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                   <span>Some future feature</span>
                 </div>
               </div>

               <div className="space-y-3 pt-4">
                  <Link href="/checkout" className="block w-full">
                    <Button className="w-full group" size="lg">
                      Upgrade to Pro
                    </Button>
                  </Link>
                  {/* <Link href="/" className="block w-full">
                    <Button variant="ghost" className="w-full">
                      Return Home
                    </Button>
                  </Link> */}
               </div>
            </div>
          </div>
        </motion.div>
      </div>
    );
  }

  return <>{children}</>;
}
