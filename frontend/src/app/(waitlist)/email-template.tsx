import * as React from "react";

interface WaitlistEmailProps {
  email: string;
}

export const WaitlistEmail: React.FC<WaitlistEmailProps> = ({ email }) => (
  <div style={{ fontFamily: "sans-serif", lineHeight: "1.5", color: "#333" }}>
    <h2 style={{ fontSize: "24px", fontWeight: "bold", marginBottom: "20px" }}>
      Welcome to the Swordfish Waitlist
    </h2>
    <p>
      Thank you for joining the waitlist for <strong>Swordfish</strong> — the
      professional high-fidelity terminal for futures traders.
    </p>
    <p>
      We&apos;ve secured your spot for <strong>{email}</strong>.
    </p>
    <p>
      We are currently heads-down building the most advanced trading interface
      on the market. You&apos;ll be among the first to get access when we open up.
    </p>
    <hr style={{ margin: "30px 0", borderTop: "1px solid #eaeaea" }} />
    <p style={{ fontSize: "14px", color: "#666" }}>
      To the moon (and back safely with trailing stops),
      <br />
      The Swordfish Team
    </p>
  </div>
);
