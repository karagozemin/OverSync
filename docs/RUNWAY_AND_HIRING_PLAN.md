# RUNWAY & HIRING PLAN

## Overview
This document outlines how capital allocated to **OverSync** translates into concrete delivery capacity.  It presents a three‑scenario runway matrix (3‑month, 6‑month, 12‑month) that maps every contracted or engineering role to a specific technical milestone.  Capital is strictly siloed between **Everyday Team Runway** (core product delivery) and **Audit Vendor Fees** (compliance & security).  The plan is built on capital‑efficient assumptions – leveraging milestone‑based contractors where possible – and defines founder‑led responsibilities and a down‑scaling path for reduced funding scenarios.

---

## 1. Scenarios Matrix
| Timeline | Role | Type | Monthly Cost (USD) | Milestone(s) Supported | Capital Silo |
|----------|------|------|-------------------|-----------------------|--------------|
| **3‑Month** | **Contractor – Front‑End Engineer** (React/TypeScript) | Contractor | $8,000 | UI Re‑design for Pilot Dashboard, onboarding flow | Everyday Team |
| | **Contractor – Backend Engineer** (Node.js/TS) | Contractor | $9,500 | Data‑resolver micro‑services, Soroban hardening v1 | Everyday Team |
| | **Audit Vendor – Security Review** | Vendor | $6,000 | Independent audit of data‑resolvers, compliance checklist | Audit Vendor |
| **6‑Month** | **Contractor – Full‑Stack Engineer** (React + Node) | Contractor | $12,000 | End‑to‑end Pilot Monitoring Setup, automated reporting | Everyday Team |
| | **Contractor – Cloud Ops Engineer** (AWS/GCP) | Contractor | $7,500 | CI/CD pipeline hardening, scalable infra for pilot | Everyday Team |
| | **Audit Vendor – SOC‑2 Type I** | Vendor | $9,000 | Formal SOC‑2 readiness, risk register finalisation | Audit Vendor |
| **12‑Month** | **Senior Engineer – Platform (Full‑Time)** | Full‑Time | $18,000 | Core platform stability, soroban‑hardening v2, multi‑tenant architecture | Everyday Team |
| | **Senior Engineer – Data & Analytics (Full‑Time)** | Full‑Time | $17,500 | Advanced data resolvers, analytics dashboards, pilot metrics | Everyday Team |
| | **Audit Vendor – SOC‑2 Type II** | Vendor | $12,000 | Ongoing compliance, continuous monitoring, audit reporting | Audit Vendor |

*All contractor engagements are structured as **milestone‑based contracts**: payment is released upon delivery of the associated milestone, reducing upfront risk.*

---

## 2. Milestone Binding (Justification)
| Role | Milestone(s) | Technical Deliverable | Impact on Product Delivery |
|------|--------------|----------------------|----------------------------|
| Front‑End Contractor (3 mo) | UI Re‑design for Pilot Dashboard | Complete React component library, responsive UI, user‑testing feedback loop | Enables clear visualisation for pilot partners, reduces churn risk |
| Backend Contractor (3 mo) | Data‑resolver micro‑services, Soroban hardening v1 | Implement robust API layer, error handling, transaction signing, and initial Soroban hardening | Provides reliable data pipeline for pilot, meets security baseline |
| Full‑Stack Contractor (6 mo) | Pilot Monitoring Setup | Real‑time monitoring dashboard, automated alerts, KPI reporting | Gives stakeholders visibility, supports iterative pilot improvements |
| Cloud Ops Contractor (6 mo) | Scalable CI/CD & Infra | Deployable Terraform modules, auto‑scaling clusters, cost‑optimised resources | Guarantees uptime for pilot, prepares for scale |
| Senior Platform Engineer (12 mo) | Soroban hardening v2, Multi‑tenant platform | Refactor core ledger integration, tenancy isolation, performance benchmarks | Allows expansion to multiple pilot customers without refactor |
| Senior Data Engineer (12 mo) | Advanced resolvers & analytics | ETL pipelines, analytical models, dashboard visualisation of pilot metrics | Drives data‑driven decisions, key for investor reporting |

---

## 3. Capital Siloing
- **Everyday Team Runway** – Directly funds the engineering roles listed above.  Funds are allocated month‑by‑month based on the scenario matrix and are tracked in a simple spreadsheet (capital‑runway‑tracker.xlsx) that records spend vs. milestone completion.
- **Audit Vendor Fees** – Held in a separate budget line.  These fees are paid to external auditors and remain untouched by day‑to‑day operational spend.  This segregation protects runway calculations from audit cost volatility.

---

## 4. Conservative Financial Guardrails
1. **Milestone‑Based Contractors** – Contractors are engaged on a per‑milestone basis; no long‑term salary commitments until the associated deliverable is accepted.
2. **Founder‑Led Responsibilities** – The founding team retains ownership of:
   - Overall system architecture & technical direction
   - Strategic pilot coordination & partner engagement
   - Core security posture (threat modeling, key signing policies)
   - Investor communications & runway reporting
3. **Down‑Scaling List (If Funding < Expected)**
   - **Defer Full‑Time Senior Engineers** – Replace with additional short‑term contractors or split responsibilities among existing founders.
   - **Postpone SOC‑2 Type II** – Conduct a lightweight internal security assessment and schedule external audit for a later quarter.
   - **Reduce Cloud Ops Scope** – Use managed services (e.g., Vercel/Netlify) for static front‑end hosting; limit auto‑scaling to a lower baseline.
   - **Trim UI Enhancements** – Prioritise core dashboard functionality; defer advanced visual polish to a later sprint.

---

## 5. Summary of Runway Assumptions
| Scenario | Total Monthly Burn (USD) | Runway (Months) | Funding Required |
|----------|--------------------------|----------------|-----------------|
| 3‑Month | $23,500 (contractors + audit) | 3 | $70,500 |
| 6‑Month | $31,500 (incl. additional contractors) | 6 | $189,000 |
| 12‑Month | $49,500 (full‑time + audit) | 12 | $594,000 |

The above figures assume **no salary overhead for founders** (founders remain equity‑only) and a **10 % contingency buffer** is included in the “Funding Required” column to cover unexpected expenses.

---

## 6. Governance & Reporting
- **Weekly Milestone Review** – Founders and contractors meet to confirm progress, sign‑off deliverables, and release next‑phase payments.
- **Monthly Runway Dashboard** – Live tracker (Google Sheets) publicly shared with investors; updates automatically from expense receipts.
- **Audit Vendor Reporting** – Audit vendor provides a quarterly compliance report that is filed under the Audit Vendor silo.

---

*Prepared by the OverSync Product & Operations Team – Issue #105 – 2026‑06‑28*
