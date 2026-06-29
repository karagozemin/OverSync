# Customer Discovery Log — OverSync

> **Privacy notice:** This file lives in a public repository.
> Do **not** record names, email addresses, phone numbers, wallet addresses,
> employer names, or any other personally identifying information (PII).
> Use participant codes (`WU-001`, `RO-001`, `DEV-001`) throughout.

---

## Quick links

- [Adoption Experiments Tracker](../docs/ADOPTION_EXPERIMENTS.md) *(create if not yet present)*
- [Pilot Plan](../docs/PILOT_PLAN.md) *(create if not yet present)*
- [Monthly Learning Update format](#monthly-learning-update-format) *(see bottom of this file)*

---

## Participant categories

| Code prefix | Category |
|-------------|----------|
| `WU-###` | Wallet user — end-users sending or receiving cross-chain funds |
| `RO-###` | Resolver operator — node runners, liquidity providers, solver operators |
| `DEV-###` | Developer — teams building on or integrating OverSync APIs/SDKs |

---

## Log entries

Copy the relevant section template below for each interview or async response.
One entry per participant per session. Sessions from the same participant on
different dates get separate entries with the same code and an incrementing
session suffix: `WU-003 / S2`.

---

### Section A — Wallet user entry

```
## WU-[###] / S[n]  ·  [YYYY-MM]

### Participant snapshot
- Category: Wallet user
- Recruitment source (e.g., Discord, referral, testnet sign-up): ___
- Region / time zone (broad, e.g., "West Africa / UTC+1"): ___
- Self-described technical comfort (1 = non-technical · 5 = developer): ___

### Use case
Describe what they are trying to accomplish (no PII):
___

### Current bridge workflow
How do they move funds today? Which chains, wallets, bridge UIs?
___

### Pain points
What is frustrating, slow, expensive, or risky about that workflow?
1. ___
2. ___
3. ___

### Trust assumptions they care about
Which of the following did they mention or respond strongly to?
- [ ] "I don't want a third party holding my funds at any point"
- [ ] "I need to see the transaction status in real time"
- [ ] "I need to know the fee before I confirm"
- [ ] "I want to be able to recover funds if something goes wrong"
- [ ] "I need the bridge to be audited / open source"
- [ ] Other: ___

### Testnet demo feedback
If a testnet demo was shown, record reactions:
- First impression (1-5): ___
- What confused them: ___
- What they liked: ___
- Feature they asked for: ___

### Adoption blocker
What would prevent them from switching to OverSync?
- [ ] Gas / fee cost
- [ ] Supported chains / tokens not matching their needs
- [ ] Speed of settlement
- [ ] No mobile wallet support
- [ ] Lack of trust / audit trail
- [ ] Not enough liquidity
- [ ] Other: ___

### Permission to quote anonymously
- [ ] Yes — may use direct quotes with no attribution
- [ ] Yes — may paraphrase with no attribution
- [ ] No — internal use only

### Interviewer notes
Any additional context not captured above:
___
```

---

### Section B — Resolver operator entry

```
## RO-[###] / S[n]  ·  [YYYY-MM]

### Participant snapshot
- Category: Resolver operator
- Recruitment source: ___
- Operational scale (e.g., "runs 2-3 personal nodes", "operates commercial solver"): ___
- Chains currently served: ___
- Self-described technical comfort (1 = non-technical · 5 = developer): ___

### Use case
What are they trying to solve by operating a resolver node?
___

### Current bridge / solver workflow
How do they participate in cross-chain liquidity today?
___

### Pain points
What makes resolver operation difficult today?
1. ___
2. ___
3. ___

### Trust assumptions they care about
- [ ] "Slashing / penalty conditions must be clearly defined and bounded"
- [ ] "I need reliable uptime guarantees from the protocol"
- [ ] "I need transparent fee / MEV sharing rules"
- [ ] "I want to be able to exit liquidity without lock-up"
- [ ] "I need an audit of the resolver smart contract"
- [ ] "I need documentation / SDK to integrate quickly"
- [ ] Other: ___

### Testnet demo feedback
If a testnet demo was shown:
- Ease of node setup (1-5): ___
- Clarity of resolver dashboard: ___
- What broke or confused them: ___
- Feature they asked for: ___

### Adoption blocker
What would prevent them from running an OverSync resolver?
- [ ] Capital requirements for collateral / bonding
- [ ] Unclear return on liquidity deployed
- [ ] Technical complexity of setup
- [ ] Smart contract risk / no audit
- [ ] Regulatory / compliance uncertainty
- [ ] Insufficient transaction volume to be profitable
- [ ] Other: ___

### Permission to quote anonymously
- [ ] Yes — may use direct quotes with no attribution
- [ ] Yes — may paraphrase with no attribution
- [ ] No — internal use only

### Interviewer notes
___
```

---

### Section C — Developer entry

```
## DEV-[###] / S[n]  ·  [YYYY-MM]

### Participant snapshot
- Category: Developer
- Recruitment source: ___
- Type of project they are building: ___
- Primary chains they target: ___
- Self-described technical comfort (1 = non-technical · 5 = developer): ___

### Use case
What are they trying to build with OverSync?
___

### Current bridge / integration workflow
Which bridge APIs, SDKs, or aggregators do they use today?
___

### Pain points
What is painful about current integration options?
1. ___
2. ___
3. ___

### Trust assumptions they care about
- [ ] "I need a stable, versioned API with a deprecation policy"
- [ ] "I need low-latency quote and settlement endpoints"
- [ ] "I need webhook / event streams for settlement status"
- [ ] "I need TypeScript / SDK support — not raw RPC"
- [ ] "I need open-source contracts I can audit or fork"
- [ ] "I need a sandbox / testnet I can reset freely"
- [ ] Other: ___

### Testnet demo / API walkthrough feedback
If a demo or API walkthrough was done:
- Time-to-first-successful-call (minutes): ___
- Documentation clarity (1-5): ___
- What was missing from the docs: ___
- SDK feature they asked for: ___

### Adoption blocker
What would prevent them from integrating OverSync?
- [ ] Missing SDK for their language / framework
- [ ] API instability / breaking changes risk
- [ ] Insufficient testnet tooling
- [ ] No SLA / uptime guarantees
- [ ] Compliance / legal uncertainty for their product
- [ ] OverSync chains don't cover their users' chains
- [ ] Other: ___

### Permission to quote anonymously
- [ ] Yes — may use direct quotes with no attribution
- [ ] Yes — may paraphrase with no attribution
- [ ] No — internal use only

### Interviewer notes
___
```

---

## Monthly learning update format

At the start of each month, add an update below using this structure.
Updates are cumulative: each entry stands alone without needing prior entries.

```
## Learning update — [YYYY-MM]

### Interviews conducted this month
- Wallet users:       [n] new  /  [n] total to date
- Resolver operators: [n] new  /  [n] total to date
- Developers:         [n] new  /  [n] total to date

### Top 3 pain points (by frequency of mention, all categories combined)
1. [Pain point] — mentioned by [n] of [total] participants
2. [Pain point] — mentioned by [n] of [total] participants
3. [Pain point] — mentioned by [n] of [total] participants

### Top adoption blocker this month
[Blocker] — blocking [n] participants. Linked experiment: [link or "not yet started"]

### Trust signal most frequently cited
[Trust assumption] — mentioned by [n] participants

### Testnet demo conversion
- Demos given:  [n]
- "Would use in production": [n] ([%])
- "Would not use / unclear": [n] ([%])

### Hypotheses confirmed this month
- [Hypothesis] → [Evidence]

### Hypotheses invalidated this month
- [Hypothesis] → [Counter-evidence] → [Revised hypothesis]

### Experiment or pilot action triggered
- [ ] New experiment opened: [link]
- [ ] Pilot plan updated: [link]
- [ ] No action — observation only

### Notable anonymous quotes
> "[Quote]" — WU-###

> "[Quote]" — RO-###

### Next month focus
[What category or question to prioritize, and why]
```

---

## Guidance for interviewers

### Before the interview

1. Confirm there are no PII fields in this file before the session.
2. Assign the next available participant code from the relevant prefix sequence.
3. Review the linked [Adoption Experiments Tracker](../docs/ADOPTION_EXPERIMENTS.md)
   to know which hypotheses are currently live so you can probe for them.

   ### During the interview

   - Use the relevant section template (A, B, or C) as a loose guide, not a
     rigid script. Follow the conversation; fill gaps async.
     - Do not record full sentences of quotes during the call — capture the
       sentiment and paraphrase; get permission to quote before writing verbatim.
       - If the participant brings up a topic not on the template, add a free-form
         note under "Interviewer notes" and flag it for the next monthly update.

         ### After the interview

         1. Fill in the template within 24 hours while memory is fresh.
         2. Commit the new entry to a **private branch** and open a PR for internal
            review before merging to `main` — a second pair of eyes catches
               accidental PII before it enters git history.
               3. If the session surfaces a new blocker or confirms/invalidates a hypothesis,
                  update the [Adoption Experiments Tracker](../docs/ADOPTION_EXPERIMENTS.md).

                  ### What counts as PII (never commit)

                  - Full name, username, social handle
                  - Email, phone, messaging handle
                  - Employer, project name (if identifying)
                  - Wallet address or ENS name
                  - Country narrower than a broad region (e.g., a specific city)
                  - Any combination of attributes that could identify one person

                  ---

                  *Template version: 1.0 · Maintained by OverSync core team*
                  *Closes #[issue-number] — add the issue number when filing the PR*