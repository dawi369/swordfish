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

export default function PrivacyPage() {
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
              Privacy Policy
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
                1. Introduction
              </h2>
              <p className="leading-relaxed">
                At Swordfish (&quot;we,&quot; &quot;our,&quot; or &quot;us&quot;), we respect your privacy and
                are committed to protecting your personal data. This Privacy Policy
                explains how we collect, use, disclose, and safeguard your
                information when you use our trading analysis platform.
              </p>
            </section>

            <section className="mb-12">
              <h2 className="text-2xl font-semibold text-foreground mb-4">
                2. Information We Collect
              </h2>
              <p className="leading-relaxed mb-4">
                We collect information that you provide directly to us when you
                create an account, update your profile, or communicate with us. This
                may include:
              </p>
              <ul className="list-disc pl-6 space-y-2 mb-4">
                <li>Contact information (name, email address)</li>
                <li>Account credentials (username, password hash)</li>
                <li>Billing information (processed securely by our payment providers)</li>
                <li>Trading preferences and watchlist configurations</li>
              </ul>
              <p className="leading-relaxed">
                We also automatically collect certain technical data when you visit
                our site, such as your IP address, browser type, device
                information, and usage patterns within the application.
              </p>
            </section>

            <section className="mb-12">
              <h2 className="text-2xl font-semibold text-foreground mb-4">
                3. How We Use Your Information
              </h2>
              <p className="leading-relaxed mb-4">
                We use the collected information to:
              </p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Provide, maintain, and improve our services</li>
                <li>Process transactions and manage your subscription</li>
                <li>Send you technical notices, updates, and support messages</li>
                <li>Monitor and analyze trends, usage, and activities</li>
                <li>Detect, prevent, and address technical issues and fraud</li>
              </ul>
            </section>

            <section className="mb-12">
              <h2 className="text-2xl font-semibold text-foreground mb-4">
                4. Data Security
              </h2>
              <p className="leading-relaxed">
                We implement appropriate technical and organizational measures to
                protect your personal data against unauthorized access, alteration,
                disclosure, or destruction. However, no method of transmission over
                the Internet or electronic storage is 100% secure, and we cannot
                guarantee absolute security.
              </p>
            </section>

            <section className="mb-12">
              <h2 className="text-2xl font-semibold text-foreground mb-4">
                5. Third-Party Services
              </h2>
              <p className="leading-relaxed">
                We may use third-party service providers to facilitate our services
                (e.g., payment processing, analytics, hosting). These third parties
                have access to your data only to perform these tasks on our behalf
                and are obligated not to disclose or use it for other purposes.
              </p>
            </section>

            <section className="mb-12">
              <h2 className="text-2xl font-semibold text-foreground mb-4">
                6. Cookies
              </h2>
              <p className="leading-relaxed">
                We use cookies and similar tracking technologies to track the
                activity on our service and hold certain information. You can
                instruct your browser to refuse all cookies or to indicate when a
                cookie is being sent. However, if you do not accept cookies, you may
                not be able to use some portions of our service.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold text-foreground mb-4">
                7. Contact Us
              </h2>
              <p className="leading-relaxed">
                If you have any questions about this Privacy Policy, please contact
                us at{" "}
                <a
                  href="mailto:privacy@swordfish.com"
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
