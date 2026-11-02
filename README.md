# Autonomous PhD Outreach & Literature Radar Pipeline (v3.1 Guarded Cloud-Native Specification)

**Target Researcher:** Soumitro Kumar Das (Shuvro)  
**Affiliation:** University of Rajshahi, Bangladesh  
**Target PhD Intake:** Fall 2027 (Primary: September 2027 / Secondary: January 2027)  
**Core Fields:** Biomathematics, Mathematical Epidemiology, Fractional-Order Dynamical Systems (Caputo / Caputo-Fabrizio), PINNs, Parameter Estimation & Identifiability  
**System Architecture:** 100% "Laptop-Off" Cloud Execution (GitHub Actions) + **Strict Two-Stage Human-in-the-Loop Verification Firewall** + OpenAlex/arXiv Zero-Hallucination Radar + Mobile PWA Command Center  
**Release Version:** v3.1.0-PROD  
**Active Branch:** `Smain`  
**Deployment Directory:** `D:\AI\phd-pipeline-v3\`  

---

## 📑 Table of Contents
1. [The v3.1 Paradigm: Absolute Human-in-the-Loop Control](#1-the-v31-paradigm-absolute-human-in-the-loop-control)
2. [Five-Tab Cloud Spreadsheet Architecture](#2-five-tab-cloud-spreadsheet-architecture)
3. [End-to-End Workflow & Verification Gates](#3-end-to-end-workflow--verification-gates)
4. [Smart Drop Ingestion Engine (Tab 5)](#4-smart-drop-ingestion-engine-tab-5)
5. [Cloud Daemon Specifications (`src/`)](#5-cloud-daemon-specifications-src)
6. [Security Architecture & The PWA Proxy Posture](#6-security-architecture--the-pwa-proxy-posture)
7. [Local Data Sovereignty & Auto-Committing Markdown Logger](#7-local-data-sovereignty--auto-committing-markdown-logger)
8. [Candidate Ground Truth (Single Source of Truth)](#8-candidate-ground-truth-single-source-of-truth)
9. [Fit Scoring Rubric, Missing-Paper Fallback & Deadlines](#9-fit-scoring-rubric-missing-paper-fallback--deadlines)
10. [Email Generation Protocols & Behavioral Rules](#10-email-generation-protocols--behavioral-rules)
11. [Reply Logging & Communication Protocols](#11-reply-logging--communication-protocols)
12. [Mobile PWA Command Center (`/docs`)](#12-mobile-pwa-command-center-docs)
13. [Repository Hierarchy & Clean Directory Tree](#13-repository-hierarchy--clean-directory-tree)
14. [GitHub Secrets Reference Guide](#14-github-secrets-reference-guide)

---

## 1. The v3.1 Paradigm: Absolute Human-in-the-Loop Control

To eliminate all risks of AI hallucination, unverified paper citations, or over-personalized robotic tone, v3.1 introduces a **Strict Two-Stage Human-in-the-Loop Verification Firewall**:

1. **Stage 1 (Discovery & Vetting):** The automated Scout scans portals, LinkedIn, and OpenAlex. It deposits raw scraped leads into **Tab 1 (`Scraped_Leads`)**. No email drafts are ever created at this stage.
2. **Stage 2 (Manual Tinder-Style Gate):** You review the lead on your Android phone via the Mobile PWA (`docs/index.html`) or directly in Google Sheets. Swiping right (`ACCEPT`) or left (`DECLINE`) sets the status.
3. **Stage 3 (Draft Generation):** Only rows marked `APPROVED` are processed by the Drafter daemon, which generates the tailored email, checklist, and CV advice into **Tab 2 (`Email_Drafts`)**.
4. **Stage 4 (Manual Dispatch & Reply Tracking):** You review the draft in Tab 2, edit or copy it, dispatch it yourself from your personal email client, mark it **`SENT`**, and let the Nagger daemon automate follow-up cadences and reply sentiment analysis.

---

## 2. Five-Tab Cloud Spreadsheet Architecture

- **Master Sheet ID:** `18ww6rPcncVtwDNnHLborAwraY0PNqQr0wsY16gr9M1E`
- **Spreadsheet URL:** [Open Master Google Sheet](https://docs.google.com/spreadsheets/d/18ww6rPcncVtwDNnHLborAwraY0PNqQr0wsY16gr9M1E/edit)

| Tab Name | Deep Link | Purpose | Write Access |
|---|---|---|---|
| **Tab 1: `Scraped_Leads`** | [`#gid=0`](https://docs.google.com/spreadsheets/d/18ww6rPcncVtwDNnHLborAwraY0PNqQr0wsY16gr9M1E/edit#gid=0) | Pending queue from Friday Scout & Smart Drop | Scout, PWA Swipe decisions |
| **Tab 2: `Email_Drafts`** | [`#gid=1908064977`](https://docs.google.com/spreadsheets/d/18ww6rPcncVtwDNnHLborAwraY0PNqQr0wsY16gr9M1E/edit#gid=1908064977) | Active outreach, drafted by AI, manually dispatched, tracked by Nagger | Drafter, Nagger, Manual Sent |
| **Tab 3: `Literature_Radar`** | [`#gid=1384074094`](https://docs.google.com/spreadsheets/d/18ww6rPcncVtwDNnHLborAwraY0PNqQr0wsY16gr9M1E/edit#gid=1384074094) | Sunday OpenAlex & arXiv biomathematics intelligence feed | Scholar Radar |
| **Tab 4: `Archive_History`** | Sheet GID | Vault for closed, declined, expired, or completed leads | Nagger / Manual Archive |
| **Tab 5: `Manual_Ingest`** | Sheet GID | Staging area for raw unformatted text dropped from PWA | PWA Smart Drop, Scout (Consumer) |

### Tab Column Schemas

#### Tab 1: `Scraped_Leads` (Discovery & Vetting Queue)
* `Date Found` (Col A)
* `PI Name` (Col B)
* `Institution` (Col C)
* `Department` (Col D)
* `Opportunity Title` (Col E)
* `Posting Link` (Col F)
* `OpenAlex Verified Paper 1 & DOI` (Col G)
* `OpenAlex Verified Paper 2 & DOI` (Col H)
* `Fit Score` (Col I)
* `Deadline` (Col J)
* **`Status`** (Col K) — `PENDING_APPROVAL`, `APPROVED`, `REJECTED`.

#### Tab 2: `Email_Drafts` (Staging, Review & Dispatch Tracker)
* `Date Drafted` (Col A)
* `PI Name` (Col B)
* `Email` (Col C)
* `Subject Line` (Col D)
* `Full Email Body` (Col E)
* `Pre-Send Checklist & CV Advice` (Col F)
* **`Dispatch Status`** (Col G) — `DRAFT_GENERATED`, `SENT`.
* **`PI Reply Status`** (Col H) — `No Reply`, `Positive`, `Neutral`, `Declined`, `Redirect`.
* **`Reply Summary / Notes`** (Col I) — Paste professor responses here or log via PWA.
* `F1 Due` / `F2 Due` (Cols J & K) — Day-10 and Day-21 follow-up targets calculated in Asia/Dhaka time.

#### Tab 3: `Literature_Radar` (Sunday Research Feed)
* Weekly verified papers, methodology breakdowns, and mathematical epidemiology research mix ideas (OpenAlex/arXiv verified).

#### Tab 4: `Archive_History` (Vault)
* Preserves finished or declined outreach threads, maintaining a clean active pipeline in Tab 2.

#### Tab 5: `Manual_Ingest` (Smart Drop Staging)
* `Timestamp` (Col A)
* `Raw Opportunity Text` (Col B)
* `Processing Status` (Col C) — `Pending Scout Parse`, `PROCESSED`.

---

## 3. End-to-End Workflow & Verification Gates

```mermaid
flowchart TD
    subgraph "External Discovery & Manual Ingestion"
        A1["Weekly Scout Cron (Friday 06:00 AM)"]
        A2["PWA Smart Drop (Raw Text, LinkedIn, Email)"]
    end

    subgraph "Google Sheet Staging"
        A2 -->|POST via GAS| T5["Tab 5: Manual_Ingest"]
        A1 -->|Gemini Structuring| T1["Tab 1: Scraped_Leads (PENDING_APPROVAL)"]
        T5 -->|Scout Parses & Clears| T1
    end

    subgraph "Human-in-the-Loop Gate 1: Mobile Review"
        T1 -->|Real-Time Sync| PWA["Mobile PWA Swipe Deck (docs/index.html)"]
        PWA -->|Right Swipe: ACCEPT| T1_Approve["Col K: APPROVED"]
        PWA -->|Left Swipe: DECLINE| T1_Decline["Col K: REJECTED"]
    end

    subgraph "Cloud Execution Layer: Drafting"
        T1_Approve -->|Daily Drafter (08:00 AM)| DRAFT["Drafter Daemon (src/drafter_v3.py)"]
        DRAFT -->|Ground Truth: Soumitro_Kumar_Das_CV.md| T2["Tab 2: Email_Drafts (DRAFT_GENERATED)"]
    end

    subgraph "Human-in-the-Loop Gate 2: Dispatch & Logging"
        T2 -->|Review & Send from Personal Email| USER["Manual Email Dispatch"]
        USER -->|Mark SENT in Tab 2 or PWA| SENT["Status: SENT"]
        SENT -->|Daily Nagger (09:00 AM)| NAG["Nagger Daemon (src/nagger_v3.py)"]
        NAG -->|Tracks Day-10 & Day-21 Follow-ups| NAG
        NAG -->|Auto-Commits to Repo| LOG["assets/PhD_Outreach_Full_Log_V3.md"]
    end
```

---

## 4. Smart Drop Ingestion Engine (Tab 5)

The **Smart Drop** feature allows zero-friction ingestion of ad-hoc opportunities encountered outside scheduled scans:

1. **User Action:** You encounter a PhD call on LinkedIn, an academic mailing list, or a professor's lab website.
2. **One-Tap Drop:** Paste the messy, unformatted text into the PWA's **Smart Drop** tab.
3. **Staging:** The PWA dispatches the raw text to **Tab 5 (`Manual_Ingest`)** via the secure Google Apps Script API.
4. **Autonomous Structuring:** On its next run (or upon manual execution), `scout_v3.py` detects unprocessed rows in Tab 5, invokes Gemini to extract the PI Name, University, Department, Deadlines, and Links, queries OpenAlex for recent papers, populates **Tab 1 (`Scraped_Leads`)**, and marks Tab 5 as processed.

---

## 5. Cloud Daemon Specifications (`src/`)

### 5.1 `src/scout_v3.py` (Discovery & Ingestion)
- **Schedule:** Every Friday at 06:00 AM Asia/Dhaka (`0 0 * * 5` UTC).
- **Execution:** Scrapes academic portals, checks Tab 5 (`Manual_Ingest`), verifies PI papers against the OpenAlex API, and calculates fit scores.
- **Safety Rule:** Writes strictly to Tab 1 with `Status = PENDING_APPROVAL`. Never drafts emails or accesses mail clients.

### 5.2 `src/drafter_v3.py` (Ground-Truth Constrained Drafter)
- **Schedule:** Daily at 08:00 AM Asia/Dhaka (`0 2 * * *` UTC).
- **Execution:** Reads Tab 1 for rows where `Status == "APPROVED"`. Injects `assets/Soumitro_Kumar_Das_CV.md` as candidate ground truth.
- **Output:** Generates a 240–310 word tailored cold email, subject line, and pre-send checklist into Tab 2 (`Email_Drafts`).

### 5.3 `src/nagger_v3.py` (Follow-Up Cadence & Sovereign Logger)
- **Schedule:** Daily at 09:00 AM Asia/Dhaka (`0 3 * * *` UTC).
- **Execution:** Monitors Tab 2 for rows marked `SENT`. Calculates follow-up dates (F1: Day 10, F2: Day 21). Analyzes sentiment in Column I (`Reply Summary / Notes`).
- **Data Sovereignty:** Appends all dispatched emails and logged replies to `assets/PhD_Outreach_Full_Log_V3.md` and triggers an auto-commit back to the `Smain` branch.

### 5.4 `src/scholar_radar_v3.py` (Intelligence Feed)
- **Schedule:** Every Sunday at 07:00 AM Asia/Dhaka (`0 1 * * 0` UTC).
- **Execution:** Queries OpenAlex and arXiv for recent breakthroughs in fractional calculus, compartmental epidemic modeling, and PINNs. Appends findings to Tab 3 (`Literature_Radar`).

---

## 6. Security Architecture & The PWA Proxy Posture

The frontend mobile interface is designed with a **Zero-Secret Public Architecture**:

```
+-----------------------------------+
|  Mobile PWA (GitHub Pages)        |
|  - Static HTML/JS (docs/index.html)
|  - ZERO Secrets Stored in Source  |
|  - XSS Protection: esc() & safeUrl()
|  - Double-Tap Lock: isBusy flag   |
+-----------------+-----------------+
                  | Authenticated POST
                  | (PHD_APP_SECRET via Body)
                  v
+-----------------+-----------------+
|  Google Apps Script (GAS) Proxy   |
|  - Validates APP_SECRET Token     |
|  - Read/Write to Google Sheet     |
|  - Holds GITHUB_PAT Server-Side   |
|  - Relays Workflow Dispatches     |
+-----------------+-----------------+
                  |
                  v
+-----------------+-----------------+
|  GitHub Actions (Smain)           |
|  - 100% Cloud Cron Backend        |
|  - Secret Masking in Logs         |
|  - Ephemeral Runner Environment   |
+-----------------------------------+
```

- **Zero Exposed Keys:** The PWA contains no GitHub tokens, Google Service Account credentials, or private keys.
- **Proxy Authentication:** All writes and workflow triggers route through the Google Apps Script Web App requiring an `APP_SECRET` token configured once via the PWA settings gear (⚙️).
- **XSS & Link Security:** Input variables are sanitized using `esc()` and external links are validated with `safeUrl()` to prevent javascript URI injection.

---

## 7. Local Data Sovereignty & Auto-Committing Markdown Logger

To prevent vendor lock-in with cloud spreadsheets and maintain a local, searchable archive of all academic correspondence, the pipeline implements **Local Data Sovereignty**:

1. **Automatic Markdown Logging:** Whenever `nagger_v3.py` detects a `SENT` email or logs a professor reply in Tab 2, it appends a structured entry to [`assets/PhD_Outreach_Full_Log_V3.md`](file:///D:/AI/phd-pipeline-v3/assets/PhD_Outreach_Full_Log_V3.md):
   ```markdown
   ### [YYYY-MM-DD] Prof. Target Professor (Institution)
   - **Subject:** PhD Inquiry: Fractional-Order Dynamical Systems & Dengue Modeling
   - **Dispatch Date:** 2026-11-02
   - **Status:** SENT
   - **Body:** ...
   - **PI Reply:** Positive — Invited to interview
   ```
2. **Git Auto-Commit:** The GitHub Actions workflow automatically stages, commits, and pushes this file back to the `Smain` branch using a bot identity.
3. **Local Sync:** To update your local knowledge base or feed your personal AI tools, simply execute:
   ```bash
   git pull origin Smain
   ```

---

## 8. Candidate Ground Truth (Single Source of Truth)

In v3.1, all legacy hardcoded dictionaries and standalone profile files have been retired. The Drafter daemon reads directly from **[`assets/Soumitro_Kumar_Das_CV.md`](file:///D:/AI/phd-pipeline-v3/assets/Soumitro_Kumar_Das_CV.md)** as the absolute ground truth.

- **Candidate:** Soumitro Kumar Das (Shuvro), Applied Mathematician, University of Rajshahi, Bangladesh.
- **Target Intake:** Fall 2027 (Primary: September 2027 / Secondary: January 2027).
- **Core Research Pillars:**
  1. Fractional-Order Differential Equations (Caputo, Caputo-Fabrizio).
  2. Mathematical Epidemiology (Dengue, Vector-Borne, COVID-19).
  3. Physics-Informed Neural Networks (PINNs) & Parameter Estimation.
- **Published Articles:**
  - *"Role of Carrying Capacity in Dengue Control: A Mathematical Model on Waste Management and Public Awareness"*, Arab Journal of Basic and Applied Sciences (Q1, Scopus CiteScore 4.5, Taylor & Francis).
  - DOI: `10.1080/25765299.2026.2651569` | GitHub: `SoumitroDas/dengue-carrying-capacity-model-simulations`

---

## 9. Fit Scoring Rubric, Missing-Paper Fallback & Deadlines

### 10-Point Fit Rubric
Each opportunity is scored across five criteria (0–2 points each):
1. **Funding ($S_{\text{funding}}$):** Explicit full tuition waiver + livable graduate stipend.
2. **Eligibility ($S_{\text{eligibility}}$):** Bangladeshi / international applicants explicitly eligible.
3. **Timeline ($S_{\text{timeline}}$):** Aligns with Fall 2027 intake (or rolling admission).
4. **Methodology ($S_{\text{methods}}$):** Synergy with compartmental ODEs/FODEs, fractional calculus, PINNs, or parameter estimation.
5. **Activity ($S_{\text{activity}}$):** $\ge 2$ peer-reviewed papers in 2024–2026, active grants, history of international students.

### Missing-Paper Fallback Handling
To address edge cases where OpenAlex indexing is delayed or a professor recently changed institutions:
- The scoring prompt applies an explicit fallback strategy: if recent paper metadata is missing from OpenAlex, the Scout scores the lead based on verified institutional laboratory descriptions and flags the lead with `Paper: Institutional Review Required`.
- The Drafter automatically selects Email Structure `S3` (Profile-Only) or `S4` (Short Inquiry) rather than hallucinating paper citations.

---

## 10. Email Generation Protocols & Behavioral Rules

- **Word Count:** Strictly constrained between 240 and 310 words.
- **Approved Structure Tags:**
  - `S1`: Independent research proposal linked to PI's broader framework.
  - `S2`: Literature-linked (references candidate's published Dengue paper and PI's recent work).
  - `S3`: Profile-only outreach (used when specific paper DOIs are unavailable).
  - `S4`: Short concise inquiry.
- **Strictly Banned Phrasing (Anti-AI Clichés):**
  - ❌ *"I hope this email finds you well"*
  - ❌ *"I am writing to express my keen interest / enthusiastic interest"*
  - ❌ *"delve"*, *"tapestry"*, *"testament"*, *"beacon"*, *"plethora"*
  - ❌ *"I would be deeply honored to join your prestigious laboratory"*
  - ❌ *"structural bottleneck... this specific limitation draws me directly to your work"*

---

## 11. Reply Logging & Communication Protocols

1. **PWA Quick Reply (Mobile):** Tap the **Replies** pill in the PWA, enter the professor's name, select a category (`Positive`, `Neutral`, `Redirect`, `Declined`), paste snippet notes, and submit.
2. **Spreadsheet Paste (Direct):** Paste professor responses directly into **Tab 2, Column I (`Reply Summary / Notes`)**.
3. **Automated Parsing:** The daily `nagger_v3` daemon automatically classifies the response, stops follow-up timers for positive/declined threads, and updates [`assets/PhD_Outreach_Full_Log_V3.md`](file:///D:/AI/phd-pipeline-v3/assets/PhD_Outreach_Full_Log_V3.md).

---

## 12. Mobile PWA Command Center (`/docs`)

Hosted entirely on GitHub Pages from the `/docs` directory:

- **True AMOLED Dark Mode:** Tailwind CSS dark palette optimized for OLED screens.
- **Tinder-Style Swipe UI:** Review scraped leads with left/right touch gestures with a 160px drag threshold to prevent accidental swipes.
- **Real-Time Funnel Analytics:** Live Chart.js visualization of Scraped ➔ Approved ➔ Drafted ➔ Dispatched ➔ Positive velocity.
- **Touch-Safe Links:** Non-hijacked external links allowing instant paper reading on Android before swiping.
- **Offline Reliability:** Service Worker (`sw.js`) caching for seamless review in low-connectivity conditions.

---

## 13. Repository Hierarchy & Clean Directory Tree

```
D:\AI\phd-pipeline-v3\
│
├── .github\
│   └── workflows\
│       └── phd_pipeline_v3.yml         # GitHub Actions 4-cron serverless pipeline (Smain branch)
│
├── assets\
│   ├── drive_config.json               # Cloud IDs for Google Drive & Master Sheet
│   ├── email_structures.md             # Email style rules and structure tag reference
│   ├── PhD_Outreach_Full_Log_V3.md     # Auto-committing Markdown outreach & reply log
│   └── Soumitro_Kumar_Das_CV.md        # Single Source of Truth: Academic CV ground truth
│
├── docs\                               # GitHub Pages PWA Root
│   ├── 404.html                        # SPA routing fallback mirror
│   ├── index.html                      # Mobile PWA Command Center application
│   ├── manifest.json                   # Web App Manifest
│   └── sw.js                           # Offline caching Service Worker
│
├── local_auth\                         # Local developer authentication (Git-Ignored)
│   ├── credentials.json                # Google Cloud OAuth client secret
│   ├── setup_oauth.py                  # One-time local OAuth token generator
│   └── token.json                      # Refresh token (base64-encoded to GitHub Secrets)
│
├── src\                                # Cloud Python Backend
│   ├── cloud_shared_core.py            # Shared clients: Gemini LLM, Sheets, Drive, OpenAlex
│   ├── drafter_v3.py                   # Daily Drafter daemon (Populates Tab 2)
│   ├── nagger_v3.py                    # Daily Sent monitor, follow-up tracker & markdown logger
│   ├── scholar_radar_v3.py             # Sunday Literature Radar daemon
│   └── scout_v3.py                     # Friday Portal, LinkedIn & Tab 5 Ingest Scout daemon
│
├── .gitignore                          # Excludes secrets, tokens, logs, and compiled caches
├── cleanup.ps1                         # PowerShell temporary cache and compiler purger
├── README.md                           # Master technical specification & architecture manual
└── requirements.txt                    # Cloud execution dependencies

---
*Autonomous PhD Outreach & Literature Radar Pipeline v3.1 — Guarded Human-in-the-Loop Architecture.*
