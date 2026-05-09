# Billing Concern

Billing is intentionally thin until Polar is connected.

The frontend now has minimal, hosted-billing-ready surfaces:

- `/pricing` presents one Pro plan with a 7-day trial-first CTA.
- `/billing` shows current plan/access state from Supabase subscription data.
- `/checkout`, `/checkout/success`, and `/billing/portal` are placeholder routes reserved for Polar redirects and return flows.

Swordfish should not collect card data in-app. Polar should own checkout, customer portal, invoices, receipts, cancellations, and payment method updates. The app should only store and render the resulting subscription entitlement state.

## Deferred Work

- Polar checkout session creation
- Polar customer portal session creation
- Polar webhook handling
- subscription entitlement sync into Supabase
- transaction/invoice history display, if product needs it

## Current Rule

Do not let incomplete billing code shape the core terminal experience.

If billing remains incomplete at beta launch:
- keep account gating simple
- route billing actions to clear placeholder or disabled states
- document billing status clearly in product/admin docs
