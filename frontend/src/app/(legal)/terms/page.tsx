"use client";

import { motion } from "framer-motion";

const ANIMATION_CONFIG = {
  fadeInUp: {
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0 },
  },
  stagger: {
    animate: { transition: { staggerChildren: 0.1 } },
  },
};

export default function TermsPage() {
  return (
    <div className="min-h-screen relative">
      <div className="relative z-10 mx-auto max-w-4xl px-6 py-24">
        <motion.div
          initial="initial"
          animate="animate"
          variants={ANIMATION_CONFIG.stagger}
        >
          {/* Header */}
          <motion.div variants={ANIMATION_CONFIG.fadeInUp} className="mb-16">
            <h1 className="text-4xl font-bold font-space tracking-tight text-foreground md:text-5xl mb-6">
              Terms of Service
            </h1>
            <p className="text-xl text-muted-foreground">
              Last updated: February 4, 2026
            </p>
          </motion.div>

          {/* Content */}
          <motion.div
            variants={ANIMATION_CONFIG.fadeInUp}
            className="prose prose-invert prose-lg max-w-none text-muted-foreground"
          >
            <section className="mb-12">
              <h2 className="text-2xl font-semibold text-foreground mb-4">
                1. Acceptance of Terms
              </h2>
              <p className="leading-relaxed">
                By accessing and using Swordfish (&quot;the Platform&quot;), you agree to be
                bound by these Terms of Service. If you do not agree to these
                terms, please do not use our services. The Platform provides market
                analysis tools and data visualization for informational purposes
                only.
              </p>
            </section>

            <section className="mb-12">
              <h2 className="text-2xl font-semibold text-foreground mb-4">
                2. Financial Disclaimer
              </h2>
              <p className="leading-relaxed mb-4">
                Swordfish is not a registered investment advisor, broker-dealer, or
                financial institution. The data, signals, and visualizations
                provided on the Platform are for educational and informational
                purposes only and do not constitute financial advice, investment
                recommendations, or an offer to buy or sell any securities or
                financial instruments.
              </p>
              <p className="leading-relaxed">
                Trading in financial markets involves a high degree of risk and may
                not be suitable for all investors. You acknowledge that you are
                solely responsible for your investment decisions and that Swordfish
                shall not be liable for any losses incurred.
              </p>
            </section>

            <section className="mb-12">
              <h2 className="text-2xl font-semibold text-foreground mb-4">
                3. User Account & Security
              </h2>
              <p className="leading-relaxed">
                You are responsible for maintaining the confidentiality of your
                account credentials and for all activities that occur under your
                account. You agree to notify us immediately of any unauthorized use
                of your account or any other breach of security. We reserve the
                right to terminate accounts that violate these terms or engage in
                suspicious activity.
              </p>
            </section>

            <section className="mb-12">
              <h2 className="text-2xl font-semibold text-foreground mb-4">
                4. Subscription & Billing
              </h2>
              <p className="leading-relaxed mb-4">
                Access to certain features requires a paid subscription. By
                subscribing, you authorize us to charge your payment method for the
                agreed-upon fees. Subscriptions automatically renew unless cancelled
                before the end of the current billing period.
              </p>
              <p className="leading-relaxed">
                We offer a 7-day free trial for new users. You may cancel at any
                time during the trial to avoid being charged. Refunds are handled
                on a case-by-case basis at our sole discretion.
              </p>
            </section>

            <section className="mb-12">
              <h2 className="text-2xl font-semibold text-foreground mb-4">
                5. Intellectual Property
              </h2>
              <p className="leading-relaxed">
                All content, features, and functionality of the Platform, including
                but not limited to design, code, data, and algorithms, are the
                exclusive property of Swordfish and are protected by international
                copyright, trademark, and other intellectual property laws. You may
                not copy, modify, distribute, or reverse engineer any part of the
                Platform without our prior written consent.
              </p>
            </section>

            <section className="mb-12">
              <h2 className="text-2xl font-semibold text-foreground mb-4">
                6. Changes to Terms
              </h2>
              <p className="leading-relaxed">
                We reserve the right to modify these terms at any time. We will
                notify users of any material changes via email or a prominent notice
                on the Platform. Your continued use of the Platform after such
                modifications constitutes your acknowledgment and agreement to the
                modified terms.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">
                7. Contact Us
              </h2>
              <p className="leading-relaxed">
                If you have any questions about these Terms, please contact us at{" "}
                <a
                  href="mailto:legal@swordfish.com"
                  className="text-foreground underline underline-offset-4 hover:text-primary transition-colors"
                >
                  david.erwin.cz68@gmail.com
                </a>
                .
              </p>
            </section>
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
}
