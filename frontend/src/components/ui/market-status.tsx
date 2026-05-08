"use client";

import { useEffect, useState } from "react";

export function MarketStatus() {
  const [status, setStatus] = useState<{
    isOpen: boolean;
    text: string;
    timeUntilOpen?: string;
  } | null>(null);

  useEffect(() => {
    const calculateStatus = () => {
      // Get current time in ET
      const now = new Date();
      const etString = now.toLocaleString("en-US", {
        timeZone: "America/New_York",
      });
      const etDate = new Date(etString);

      const day = etDate.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
      const hour = etDate.getHours();

      // Market Hours (ET):
      // Open: Sunday 18:00 to Friday 17:00
      // Daily Break: Mon-Thu 17:00 to 18:00

      let isOpen = false;
      const nextOpenDate = new Date(etDate);

      // Check if Weekend Closed
      // Friday >= 17:00
      // Saturday (All day)
      // Sunday < 18:00
      if (day === 5 && hour >= 17) {
        // Friday after close -> Open Sunday 18:00
        isOpen = false;
        nextOpenDate.setDate(etDate.getDate() + 2);
        nextOpenDate.setHours(18, 0, 0, 0);
      } else if (day === 6) {
        // Saturday -> Open Sunday 18:00
        isOpen = false;
        nextOpenDate.setDate(etDate.getDate() + 1);
        nextOpenDate.setHours(18, 0, 0, 0);
      } else if (day === 0 && hour < 18) {
        // Sunday before open -> Open Sunday 18:00
        isOpen = false;
        nextOpenDate.setHours(18, 0, 0, 0);
      } else if (day >= 1 && day <= 4 && hour >= 17 && hour < 18) {
        // Daily Break (Mon-Thu 17:00-18:00)
        isOpen = false;
        nextOpenDate.setHours(18, 0, 0, 0);
      } else {
        isOpen = true;
      }

      if (isOpen) {
        setStatus({ isOpen: true, text: "Market Open" });
      } else {
        const diffMs = nextOpenDate.getTime() - etDate.getTime();
        if (diffMs <= 0) {
          // Should be open, fallback
          setStatus({ isOpen: true, text: "Market Open" });
          return;
        }

        const hours = Math.floor(diffMs / (1000 * 60 * 60));
        const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diffMs % (1000 * 60)) / 1000);

        const pad = (n: number) => n.toString().padStart(2, "0");
        const timeString = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;

        setStatus({
          isOpen: false,
          text: `Opens in ${timeString}`,
          timeUntilOpen: timeString,
        });
      }
    };

    calculateStatus();
    const interval = setInterval(calculateStatus, 1000);
    return () => clearInterval(interval);
  }, []);

  if (!status) {
    return (
      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-mono uppercase tracking-wider opacity-0">
        Loading...
      </div>
    );
  }

  return (
    <div
      className={`inline-flex items-center gap-2 px-3 py-1 rounded-full border text-xs font-mono uppercase tracking-wider transition-colors duration-300 ${
        status.isOpen
          ? "bg-primary/10 border-primary/20 text-primary"
          : "bg-orange-500/10 border-orange-500/20 text-orange-500"
      }`}
    >
      <span className="relative flex h-2 w-2">
        {status.isOpen && (
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-current opacity-75"></span>
        )}
        <span className="relative inline-flex rounded-full h-2 w-2 bg-current"></span>
      </span>
      {status.text}
    </div>
  );
}
