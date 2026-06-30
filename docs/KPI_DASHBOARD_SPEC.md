# OverSync KPI Dashboard Specification

This document defines the overarching narrative, decision thresholds, and key performance indicators (KPIs) required to determine our testnet traction and mainnet launch readiness. 

It explicitly maps to our canonical [Public Metrics Schema](./METRICS_SCHEMA.md) and our [User Adoption Experiments](./ADOPTION_EXPERIMENTS.md).

> [!NOTE]
> **Metric Types**
> - **Decision Metrics:** Strictly monitored. These dictate our "Launch Readiness" status via explicit Green/Yellow/Red thresholds.
> - **Vanity Metrics:** Tracked for general growth narrative and marketing, but do not block or influence mainnet deployment decisions.

---

## 1. Testnet Swap Funnel

### KPI 1: Swap Success Rate (Decision Metric)
- **Formula:** `(Total Successful Swaps / Total Initiated Swaps) * 100`
- **Source:** Coordinator logs (`/metrics` endpoint)
- **Cadence:** Daily
- **Owner:** Core Team (Backend)
- **Thresholds:** 
  - 🟢 **Green (Launch Ready):** > 98%
  - 🟡 **Yellow (Investigate):** 90% - 98%
  - 🔴 **Red (Blocker):** < 90%

### KPI 2: Time to Finality (Decision Metric)
- **Formula:** `Median(Time swap initiated - Time funds delivered to destination)`
- **Source:** On-chain events / Coordinator timing logs
- **Cadence:** Weekly
- **Owner:** Core Team (Relayer)
- **Thresholds:**
  - 🟢 **Green (Launch Ready):** < 30 seconds
  - 🟡 **Yellow (Investigate):** 30 - 60 seconds
  - 🔴 **Red (Blocker):** > 60 seconds

### KPI 3: Total Volume Swapped (Vanity Metric)
- **Formula:** `Sum(USD value of all successful swaps)`
- **Source:** On-chain events aggregate
- **Cadence:** Weekly
- **Owner:** Growth Team
- **Thresholds:** N/A (Informational only)

---

## 2. Resolver Participation

### KPI 4: Active Resolvers (Decision Metric)
- **Formula:** `Count(Unique resolvers completing ≥ 1 swap in a 7-day period)`
- **Source:** On-chain events
- **Cadence:** Weekly
- **Owner:** Resolver Operations Lead
- **Thresholds:**
  - 🟢 **Green (Launch Ready):** ≥ 5 active resolvers
  - 🟡 **Yellow (Investigate):** 2 - 4 active resolvers
  - 🔴 **Red (Blocker):** < 2 active resolvers

### KPI 5: Total Resolvers Registered (Vanity Metric)
- **Formula:** `Count(Total registered on-chain resolver IDs)`
- **Source:** On-chain registry state
- **Cadence:** Monthly
- **Owner:** Growth Team
- **Thresholds:** N/A (Informational only)

---

## 3. Refund Reliability

### KPI 6: Refund Success Rate (Decision Metric)
- **Formula:** `(Total Successful Refunds / Total Expired or Failed Swaps) * 100`
- **Source:** On-chain events & Coordinator logs
- **Cadence:** Daily
- **Owner:** Core Team (Smart Contracts)
- **Thresholds:**
  - 🟢 **Green (Launch Ready):** 100%
  - 🟡 **Yellow (Investigate):** N/A (Any failure is a blocker)
  - 🔴 **Red (Blocker):** < 100%

---

## 4. Contract / Event Health

### KPI 7: Missing Event Emission Rate (Decision Metric)
- **Formula:** `(Count of state changes without corresponding indexed event / Total state changes) * 100`
- **Source:** Indexer verification script vs. On-chain state
- **Cadence:** Weekly
- **Owner:** Core Team (Smart Contracts)
- **Thresholds:**
  - 🟢 **Green (Launch Ready):** 0%
  - 🟡 **Yellow (Investigate):** N/A 
  - 🔴 **Red (Blocker):** > 0%

---

## 5. Coordinator Uptime

### KPI 8: API & Relayer Uptime (Decision Metric)
- **Formula:** `(Total Uptime Minutes / Total Minutes in Month) * 100`
- **Source:** External monitoring (e.g., UptimeRobot / Datadog)
- **Cadence:** Monthly
- **Owner:** DevOps Lead
- **Thresholds:**
  - 🟢 **Green (Launch Ready):** ≥ 99.9%
  - 🟡 **Yellow (Investigate):** 99.0% - 99.89%
  - 🔴 **Red (Blocker):** < 99.0%

---

## 6. Open Security / Audit Checklist

### KPI 9: Critical/High Audit Findings Unresolved (Decision Metric)
- **Formula:** `Count(Open Critical + High severity findings from external audits)`
- **Source:** Security Audit Reports
- **Cadence:** Continuous
- **Owner:** Core Team (Security Lead)
- **Thresholds:**
  - 🟢 **Green (Launch Ready):** 0
  - 🟡 **Yellow (Investigate):** N/A 
  - 🔴 **Red (Blocker):** > 0

---

## 7. Adoption Experiments and Pilot Results

### KPI 10: End-User Pilot Conversion Rate (Decision Metric)
- **Formula:** `(Users who complete a pilot swap / Users who start the pilot flow) * 100`
- **Source:** Frontend analytics mapping to [Adoption Experiments](./ADOPTION_EXPERIMENTS.md)
- **Cadence:** Weekly (during pilot phases)
- **Owner:** Product Lead
- **Thresholds:**
  - 🟢 **Green (Launch Ready):** > 20%
  - 🟡 **Yellow (Investigate):** 10% - 20%
  - 🔴 **Red (Blocker):** < 10%
