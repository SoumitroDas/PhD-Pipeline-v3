/**
 * PhD Outreach Pipeline v3.7 - Google Apps Script Backend Proxy
 * Serves PWA client requests with APP_SECRET token authentication.
 *
 * Tab Schema:
 * Tab 1: Scraped_Leads
 * Tab 2: Email_Drafts (16 Columns: Col A:O + Col P: Snooze Until Date)
 * Tab 3: Literature_Radar
 * Tab 4: Archive_History (15 Columns: Col A:O)
 * Tab 5: Manual_Ingest
 */

const SHEET_ID = PropertiesService.getScriptProperties().getProperty("SHEET_ID") || "YOUR_SHEET_ID_HERE";
const BACKEND_VERSION = "v3.7";

function getStoredSecret() {
  const sp = PropertiesService.getScriptProperties();
  return sp.getProperty("APP_SECRET") || "phd_pipeline_secret_2026";
}

function verifyAuth(payload) {
  const secret = payload && payload.secret;
  const expected = getStoredSecret();
  if (!secret || secret !== expected) {
    throw new Error("Unauthorized: Invalid APP_SECRET token");
  }
}

function getRankedGeminiModels(apiKey) {
  const cache = CacheService.getScriptCache();
  const cachedWinner = cache.get("BEST_GEMINI_MODEL");

  const defaultPriority = [
    "models/gemini-3.8-flash",
    "models/gemini-3.6-flash",
    "models/gemini-3.5-flash-lite",
    "models/gemini-3.1-flash-lite",
    "models/gemini-2.0-flash",
    "models/gemini-1.5-flash",
    "models/gemini-1.5-pro"
  ];

  let discovered = [];
  try {
    const res = UrlFetchApp.fetch("https://generativelanguage.googleapis.com/v1beta/models?key=" + encodeURIComponent(apiKey), { muteHttpExceptions: true });
    if (res.getResponseCode() === 200) {
      const data = JSON.parse(res.getContentText());
      (data.models || []).forEach(function(m) {
        const name = m.name || "";
        const methods = m.supportedGenerationMethods || [];
        if (
          methods.indexOf("generateContent") !== -1 &&
          name.indexOf("models/gemini-") === 0 &&
          !/embedding|imagen|veo|tts|audio|live|vision|banana|robotics|computer-use/i.test(name)
        ) {
          discovered.push(name);
        }
      });

      discovered.sort(function(a, b) {
        const mVerA = a.match(/gemini-(\d+(?:\.\d+)?)/i);
        const mVerB = b.match(/gemini-(\d+(?:\.\d+)?)/i);
        const verA = mVerA ? parseFloat(mVerA[1]) : 0;
        const verB = mVerB ? parseFloat(mVerB[1]) : 0;
        if (verA !== verB) return verB - verA;

        const tierA = (a.indexOf("-flash") !== -1 && a.indexOf("-flash-lite") === -1) ? 3 : (a.indexOf("flash") !== -1 ? 2 : 1);
        const tierB = (b.indexOf("-flash") !== -1 && b.indexOf("-flash-lite") === -1) ? 3 : (b.indexOf("flash") !== -1 ? 2 : 1);
        return tierB - tierA;
      });
    }
  } catch (e) {}

  const ordered = [];
  if (cachedWinner) {
    ordered.push(cachedWinner);
  }
  const combined = discovered.concat(defaultPriority);
  for (let i = 0; i < combined.length; i++) {
    const candidate = combined[i];
    if (ordered.indexOf(candidate) === -1) {
      ordered.push(candidate);
    }
  }
  return ordered;
}

function getWorkingGeminiModels(apiKey) {
  return getRankedGeminiModels(apiKey);
}

function invokeBestAvailableGemini(apiKey, promptText, temperature, systemInstruction) {
  if (!apiKey) return { ok: false, error: "GEMINI_API_KEY is missing." };
  const models = getRankedGeminiModels(apiKey);
  let lastErr = "No models available";
  const temp = (typeof temperature === "number") ? temperature : 0.2;
  const fullPrompt = systemInstruction ? (systemInstruction + "\n\n" + promptText) : promptText;

  for (let m = 0; m < models.length; m++) {
    const modelName = models[m];
    const mPath = modelName.indexOf("/") !== -1 ? modelName : ("models/" + modelName);
    const url = "https://generativelanguage.googleapis.com/v1beta/" + mPath + ":generateContent?key=" + encodeURIComponent(apiKey);
    try {
      const res = UrlFetchApp.fetch(url, {
        method: "POST",
        contentType: "application/json",
        payload: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: fullPrompt }] }],
          generationConfig: { temperature: temp, maxOutputTokens: 2048 }
        }),
        muteHttpExceptions: true
      });
      const status = res.getResponseCode();
      const txt = res.getContentText();
      let json = {};
      try { json = JSON.parse(txt); } catch (e) {}

      if (status === 200 && json.candidates && json.candidates[0] && json.candidates[0].content && json.candidates[0].content.parts) {
        const parts = json.candidates[0].content.parts;
        const answer = parts.filter(function(p) { return !p.thought && p.text; }).map(function(p) { return p.text; }).join("\n").trim();
        if (answer) {
          try {
            CacheService.getScriptCache().put("BEST_GEMINI_MODEL", modelName, 21600); // 6 hours
          } catch (ce) {}
          return { ok: true, reply: answer, model: modelName };
        }
      }

      lastErr = (json.error && json.error.message) ? json.error.message : ("HTTP " + status + ": " + txt.slice(0, 200));
    } catch (netErr) {
      lastErr = netErr.message || String(netErr);
    }
  }
  return { ok: false, error: "Gemini API Error: " + lastErr };
}

function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({
    ok: true,
    backend_version: BACKEND_VERSION,
    message: "PhD Command Center " + BACKEND_VERSION + " Backend Live",
    timestamp: new Date().toISOString()
  })).setMimeType(ContentService.MimeType.JSON);
}

function formatCellDate(val) {
  if (!val) return "";
  if (val instanceof Date) {
    return Utilities.formatDate(val, "Asia/Dhaka", "yyyy-MM-dd");
  }
  return String(val).trim();
}

function getSheetCaseInsensitive(ss, name) {
  if (!ss || !name) return null;
  const direct = ss.getSheetByName(name);
  if (direct) return direct;
  const cleanTarget = name.toLowerCase().replace(/[\s_-]/g, "");
  const sheets = ss.getSheets();
  for (let i = 0; i < sheets.length; i++) {
    const sName = sheets[i].getName().toLowerCase().replace(/[\s_-]/g, "");
    if (sName === cleanTarget) return sheets[i];
  }
  return null;
}

function getSheetDataRows(sheet) {
  if (!sheet) return [];
  const lr = sheet.getLastRow();
  const lc = sheet.getLastColumn();
  if (lr <= 1 || lc < 1) return [];
  return sheet.getRange(2, 1, lr - 1, lc).getValues();
}

/**
 * Extracts Country from institution and email domain.
 */
function extractCountry(inst, email) {
  const e = String(email || "").toLowerCase();
  const i = String(inst || "").toLowerCase();

  if (e.endsWith(".uk") || e.includes(".ac.uk")) return "UK";
  if (e.endsWith(".de")) return "Germany";
  if (e.endsWith(".ca")) return "Canada";
  if (e.endsWith(".au")) return "Australia";
  if (e.endsWith(".se")) return "Sweden";
  if (e.endsWith(".fi")) return "Finland";
  if (e.endsWith(".nl")) return "Netherlands";
  if (e.endsWith(".ch")) return "Switzerland";
  if (e.endsWith(".it")) return "Italy";
  if (e.endsWith(".es")) return "Spain";
  if (e.endsWith(".fr")) return "France";
  if (e.endsWith(".be")) return "Belgium";
  if (e.endsWith(".no")) return "Norway";
  if (e.endsWith(".dk")) return "Denmark";
  if (e.endsWith(".at")) return "Austria";
  if (e.endsWith(".ie")) return "Ireland";
  if (e.endsWith(".cn")) return "China";
  if (e.endsWith(".kr")) return "South Korea";
  if (e.endsWith(".sg")) return "Singapore";
  if (e.endsWith(".jp")) return "Japan";
  if (e.endsWith(".nz")) return "New Zealand";

  if (/oxford|cambridge|imperial|warwick|edinburgh|manchester|bristol|glasgow|exeter|southampton|leeds|sheffield|york|bath|queen mary|king's college|nottingham|lancaster|liverpool|cardiff|ucl\b/i.test(i)) return "UK";
  if (/heidelberg|munich|lmu|tum|bonn|humboldt|berlin|gottingen|freiburg|tubingen|rwth|aachen|darmstadt|potsdam|max planck/i.test(i)) return "Germany";
  if (/toronto|ubc|british columbia|mcgill|waterloo|alberta|mcmaster|montreal|calgary|ottawa|western\b|simon fraser/i.test(i)) return "Canada";
  if (/melbourne|sydney|unsw|queensland|monash|anu\b|australian national|adelaide|curtin|deakin/i.test(i)) return "Australia";
  if (/karolinska|uppsala|lund|stockholm|kth|gothenburg|umea|linkoping/i.test(i)) return "Sweden";
  if (/helsinki|aalto|turku|oulu|jyvaskyla|tampere/i.test(i)) return "Finland";
  if (/amsterdam|delft|utrecht|leiden|erasmus|groningen|wageningen|eindhoven/i.test(i)) return "Netherlands";
  if (/eth zurich|epfl|zurich|basel|geneva|bern|lausanne/i.test(i)) return "Switzerland";
  if (/barcelona|madrid|valencia|autonoma|pompeu fabra/i.test(i)) return "Spain";
  if (/bologna|sapienza|milan|padua|pisa|politecnico di milano/i.test(i)) return "Italy";
  if (/sorbonne|ens\b|polytechnique|inria|pasteur|lyon|marseille|toulouse|strasbourg/i.test(i)) return "France";
  if (/leuven|ghent|antwerp|ulb\b|vub\b|louvain/i.test(i)) return "Belgium";
  if (/oslo|bergen|ntnu|tromso/i.test(i)) return "Norway";
  if (/copenhagen|aarhus|dtu|danmarks/i.test(i)) return "Denmark";
  if (/vienna|innsbruck|graz/i.test(i)) return "Austria";
  if (/trinity college dublin|university college dublin|ucd|galway|cork/i.test(i)) return "Ireland";
  if (/singapore|nus\b|ntu\b/i.test(i)) return "Singapore";
  if (/tsinghua|peking|fudan|zhejiang|shanghai|cas\b/i.test(i)) return "China";
  if (/seoul|kaist|postech|yonsei|korea university/i.test(i)) return "South Korea";
  if (/tokyo|kyoto|osaka|tohoku|nagoya/i.test(i)) return "Japan";
  if (/stanford|harvard|mit\b|berkeley|caltech|princeton|columbia|yale|cornell|michigan|washington|wisconsin|illinois|texas|purdue|georgia tech|johns hopkins|northwestern|penn state|upenn|ohio state|minnesota|duke|maryland|arizona|florida|virginia|north carolina|rutgers|indiana|pittsburgh|colorado|utah|iowa|vanderbilt|notre dame|emory|rice|georgetown|dartmouth|brown|tufts|nyu|ucla|ucsd|uc davis|uc irvine|ucsb|uc santa barbara|uc riverside|uc santa cruz|carnegie mellon|asu\b|georgia/i.test(i)) return "USA";

  if (e.endsWith(".edu")) return "USA";
  return "USA";
}

/**
 * Assigns evidence-based Priority (P1-P4).
 */
function extractPriority(status, notes, f1, deadline) {
  const s = String(status || "").toLowerCase();
  const n = String(notes || "");

  const pMatch = n.match(/\[Priority:\s*(P[1-4])\]/i) || n.match(/\b(P[1-4])\b/i);
  if (pMatch) return pMatch[1].toUpperCase();

  if (/pos|accept|interview|call|apply immediately/i.test(s)) return "P1";
  if (/funded vacancy|full funding|ra available/i.test(n) && deadline && deadline !== "Rolling") return "P1";

  if (/declined|rejected|closed|do not contact/i.test(s)) return "P4";

  if (/neut|redir|apply|portal/i.test(s)) return "P2";
  if (/pinn|parameter estimation|inverse problem|fractional/i.test(n)) return "P2";

  if (/home students only|uk home fees|unfunded|self-funded/i.test(n)) return "P3";

  return "P2";
}

/**
 * Assigns standard Funding Tag.
 */
function extractFunding(notes, opp, inst) {
  const text = (String(notes || "") + " " + String(opp || "") + " " + String(inst || "")).toLowerCase();
  if (/home students only|uk\/eu only|uk fees only|home fees only/i.test(text)) {
    return "UK Home Fees Only";
  }
  if (/verified funded|fully funded|fellowship available|stipend provided|funded vacancy/i.test(text)) {
    return "Verified Funded Vacancy";
  }
  if (/self-funded|external funding required|csc scholarship|bring own funding|unfunded/i.test(text)) {
    return "Unfunded / External Req";
  }
  if (/ta\/ra|teaching assistant|research assistant|grad assistantship|department funding/i.test(text)) {
    return "Dept TA/RA Available";
  }
  return "Dept TA/RA Available";
}

/**
 * Formats evaluation notes into clear 3-part structured breakdown.
 */
function structureNotes(existingNotes, status, inst, opp) {
  const n = String(existingNotes || "").trim();
  if (n.includes("📌 Evidence & Reply Summary:")) {
    return n;
  }

  let comp = "Direct: SEIR & Mathematical Epidemiology modeling (Dengue, Vector-borne dynamics).";
  const lower = (n + " " + String(opp || "") + " " + String(inst || "")).toLowerCase();
  if (/pinn|neural ode|machine learning|inverse problem|parameter estimation|data-driven/i.test(lower)) {
    comp = "Methodological: Parameter Estimation, Inverse Problems & PINNs / Neural ODEs.";
  } else if (/predator|prey|harvesting|ecology|conservation|trophic/i.test(lower)) {
    comp = "Ecological: Non-local Predator-Prey dynamics & Bioeconomic Optimal Harvesting.";
  }

  const fundingTag = extractFunding(n, opp, inst);
  let pathway = fundingTag + " • Standard Graduate Admission Portal.";
  if (lower.includes("portal")) pathway = "Department Application Portal submission required • " + fundingTag;
  if (lower.includes("deadline")) pathway = "Upcoming Admission Deadline • " + fundingTag;

  const summary = n ? n.replace(/^\[Priority:\s*P[1-4]\]\s*/i, "") : ("Status: " + (status || "No Reply") + " • Lead under active tracking.");

  return "📌 Evidence & Reply Summary: " + summary + "\n" +
         "🧬 Research Compatibility: " + comp + "\n" +
         "💰 Funding & Admission Pathway: " + pathway;
}

/**
 * Parses a single 15-to-16 column outreach row using exact 0-indexed column schema (A:O / A:P).
 */
function parseOutreachRow(r, rowNum, tabName) {
  const dateStr = formatCellDate(r[0]);
  const profName = String(r[1] || "").trim();
  const email = String(r[2] || "").trim();
  const subject = String(r[3] || "").trim();
  const body = String(r[4] || "").trim();
  const inst = String(r[5] || "").trim();                   // inst = r[5] (Institution & Dept)
  const dStat = String(r[6] || "").trim().toUpperCase();    // dStat = r[6] (Dispatch Status: DRAFT / SENT)
  const rStat = String(r[7] || "No Reply").trim();          // rStat = r[7] (PI Reply Status)
  const rawNotes = String(r[8] || "").trim();               // rawNotes = r[8] (Reply Summary / Notes)
  const f1 = formatCellDate(r[9]);                          // f1 = r[9] (F1 Due)
  const f2 = formatCellDate(r[10]);                         // f2 = r[10] (F2 Due)
  const deadline = String(r[11] || "Rolling").trim();       // deadline = r[11] (Application Deadline & Reqs)
  const portal = String(r[12] || "").trim();                // portal = r[12] (Dept / Portal Link)
  const profile_url = String(r[13] || "").trim();           // profile_url = r[13] (Direct Profile URL)
  const last_contact = formatCellDate(r[14]) || dateStr;    // last_contact = r[14] (Last Contact Date)
  const snoozeUntil = formatCellDate(r[15]);                // snoozeUntil = r[15] (Optional Snooze Until Date)

  const country = extractCountry(inst, email);
  const priority = extractPriority(rStat, rawNotes, f1, deadline);
  const funding = extractFunding(rawNotes, "", inst);
  const structuredNotes = structureNotes(rawNotes, rStat, inst, "");

  return {
    row: rowNum,
    tab: tabName,
    date: dateStr,
    date_drafted: dateStr,
    prof: profName,
    name: profName,
    email: email,
    recipient_email: email,
    subject: subject,
    subject_line: subject,
    body: body,
    full_body: body,
    email_body: body,
    inst: inst,
    institution: inst,
    meta: inst,
    dispatch: dStat,
    dispatch_status: dStat,
    status: rStat || "No Reply",
    reply_status: rStat || "No Reply",
    notes: structuredNotes,
    reply_notes: structuredNotes,
    raw_notes: rawNotes,
    country: country,
    priority: priority,
    funding: funding,
    f1: f1,
    f1_due: f1,
    f2: f2,
    f2_due: f2,
    deadline: deadline || "Rolling",
    app_deadline: deadline || "Rolling",
    portal: portal,
    portal_link: portal,
    profile_url: profile_url,
    profile: profile_url,
    direct_profile: profile_url,
    last_contact: last_contact,
    last_contact_date: last_contact,
    snooze_until: snoozeUntil
  };
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      throw new Error("Missing request payload");
    }
    const data = JSON.parse(e.postData.contents);
    verifyAuth(data);

    const ss = SpreadsheetApp.openById(SHEET_ID);
    const todayDhaka = Utilities.formatDate(new Date(), "Asia/Dhaka", "yyyy-MM-dd");

    // 1. ACTION: list (Returns live unified metrics across Email_Drafts + Archive_History)
    if (data.action === "list") {
      const tab1 = getSheetCaseInsensitive(ss, "Scraped_Leads");
      const tab2 = getSheetCaseInsensitive(ss, "Email_Drafts") || getSheetCaseInsensitive(ss, "Drafts");
      const tab4 = getSheetCaseInsensitive(ss, "Archive_History") || getSheetCaseInsensitive(ss, "Archive");

      const t1Data = getSheetDataRows(tab1);
      const t2Data = getSheetDataRows(tab2);
      const t4Data = getSheetDataRows(tab4);

      let scraped = 0, scrapedToday = 0, scrapedWeek = 0, approved = 0, rejected = 0, pending = 0;
      let drafted = 0, sent = 0, positive = 0; // FIXED ReferenceError: drafted is not defined
      const pendingLeads = [], allScrapedLeads = [];
      const nowMs = new Date(todayDhaka + "T00:00:00Z").getTime();

      t1Data.forEach((r, idx) => {
        const profName = String(r[1] || "").trim();
        if (!profName) return;
        scraped++;
        const dateFound = formatCellDate(r[0]);
        if (dateFound === todayDhaka) scrapedToday++;
        if (dateFound) {
          const dMs = new Date(dateFound + "T00:00:00Z").getTime();
          if (!isNaN(dMs) && (nowMs - dMs) >= 0 && (nowMs - dMs) <= 7 * 86400000) scrapedWeek++;
        }
        const rawDecision = String(r[10] || "PENDING_APPROVAL").trim().toUpperCase();
        let normStatus = "PENDING_APPROVAL";
        if (rawDecision === "APPROVED" || rawDecision === "ACCEPT" || rawDecision === "PROCESSED_DRAFT_READY") {
          normStatus = "APPROVED"; approved++;
        } else if (rawDecision === "REJECTED" || rawDecision === "DECLINE" || rawDecision === "DECLINED") {
          normStatus = "REJECTED"; rejected++;
        } else {
          pending++;
        }
        const leadInst = String(r[2] || "").trim();
        const leadEmail = String(r[11] || "").trim();
        const leadOpp = String(r[4] || "").trim();
        const leadFit = String(r[8] || "").trim();
        const leadDeadline = String(r[9] || "Rolling").trim();
        const leadCountry = extractCountry(leadInst, leadEmail);
        const leadPriority = extractPriority(normStatus, leadFit, null, leadDeadline);
        const leadFunding = extractFunding(leadOpp, leadFit, leadInst);
        const leadNotes = structureNotes(leadFit, normStatus, leadInst, leadOpp);

        const leadObj = {
          row: idx + 2, tab: "Scraped_Leads", date: dateFound, prof: profName,
          inst: leadInst, dept: String(r[3] || "").trim(),
          opp: leadOpp, link: String(r[5] || "").trim(),
          paper: String(r[6] || "").trim(), paper2: String(r[7] || "").trim(),
          fit: leadFit, deadline: leadDeadline,
          status: normStatus, email: leadEmail,
          profile_url: String(r[12] || "").trim(),
          country: leadCountry,
          priority: leadPriority,
          funding: leadFunding,
          notes: leadNotes
        };
        allScrapedLeads.push(leadObj);
        if (normStatus === "PENDING_APPROVAL") pendingLeads.push(leadObj);
      });

      const draftsReady = [];
      const sentProfs = [];
      const actionNeeded = [];
      const snoozed = [];

      function processOutreachRow(r, rowNum, tabName) {
        if (!r || !r[1] || !String(r[1]).trim()) return; // Skip empty PI name
        const item = parseOutreachRow(r, rowNum, tabName);
        if (!item.prof) return;

        if (item.dispatch === "DRAFT") {
          // Rows with dStat === 'DRAFT' go ONLY into draftsReady
          drafted++;
          draftsReady.push(item);
        } else if (item.dispatch === "SENT" || tabName === "Archive_History" || (!item.dispatch && item.date)) {
          // ANY row with dStat === 'SENT' (whether it comes from Email_Drafts or Archive_History)
          // MUST be appended to the unified sentProfs array and increment the stats.sent counter.
          sent++;
          sentProfs.push(item);

          const isPos = /pos|accept|interview|call/i.test(item.status);
          const isNeut = /neut|redir|apply|portal/i.test(item.status);
          if (isPos) positive++;

          // Col P Snooze Engine check
          const isCurrentlySnoozed = item.snooze_until && todayDhaka < item.snooze_until;
          if (isCurrentlySnoozed) {
            snoozed.push(item);
          } else {
            if (isPos || isNeut || !item.status || /no reply|pending|sent|follow-up/i.test(item.status)) {
              actionNeeded.push(item);
            }
          }
        }
      }

      // Tab 2: Email_Drafts (Active Outreach + Drafts Ready)
      t2Data.forEach((r, idx) => {
        processOutreachRow(r, idx + 2, "Email_Drafts");
      });

      // Tab 4: Archive_History (Historical Dispatched Leads)
      t4Data.forEach((r, idx) => {
        processOutreachRow(r, idx + 2, "Archive_History");
      });

      // Tab 3: Literature_Radar (Research Intelligence)
      const tab3 = getSheetCaseInsensitive(ss, "Literature_Radar") || getSheetCaseInsensitive(ss, "Radar");
      const literatureRadar = [];
      if (tab3) {
        getSheetDataRows(tab3).forEach((r, idx) => {
          const pTitle = String(r[1] || "").trim();
          if (!pTitle) return;
          literatureRadar.push({
            row: idx + 2,
            week_date: formatCellDate(r[0]) || String(r[0] || "").trim(),
            title: pTitle,
            authors_inst: String(r[2] || "").trim(),
            venue: String(r[3] || "").trim(),
            pub_date: formatCellDate(r[4]) || String(r[4] || "").trim(),
            doi: String(r[5] || "").trim(),
            tag: String(r[6] || "").trim(),
            methodology: String(r[7] || "").trim(),
            mix_idea: String(r[8] || "").trim(),
            lead_potential: String(r[9] || "Medium").trim(),
            abstract: String(r[10] || "").trim()
          });
        });
      }

      return ContentService.createTextOutput(JSON.stringify({
        ok: true,
        backend_version: BACKEND_VERSION,
        stats: {
          scraped: scraped,
          scrapedToday: scrapedToday,
          scrapedWeek: scrapedWeek,
          approved: approved,
          rejected: rejected,
          pending: pending,
          drafted: drafted,
          sent: sent,
          positive: positive,
          snoozed: snoozed.length
        },
        leads: pendingLeads,
        allScrapedLeads: allScrapedLeads,
        draftsReady: draftsReady,
        sentProfs: sentProfs,
        actionNeeded: actionNeeded,
        snoozed: snoozed,
        literatureRadar: literatureRadar
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 2. ACTION: snooze (Sets Col P: Snooze Until Date in Email_Drafts)
    if (data.action === "snooze") {
      const tabName = data.tab || "Email_Drafts";
      const tab = getSheetCaseInsensitive(ss, tabName) || getSheetCaseInsensitive(ss, "Email_Drafts");
      if (!tab) throw new Error("Tab not found: " + tabName);
      const row = Number(data.row);
      if (!row || row < 2) throw new Error("Invalid row index");

      if (data.expect_prof) {
        const curProf = String(tab.getRange(row, 2).getValue()).trim();
        if (curProf && curProf.toLowerCase() !== String(data.expect_prof).trim().toLowerCase()) {
          throw new Error("Row mismatch: expected " + data.expect_prof + " but found " + curProf);
        }
      }

      // Ensure Col P exists
      const maxCols = tab.getMaxColumns();
      if (maxCols < 16) {
        tab.insertColumnsAfter(maxCols, 16 - maxCols);
      }
      const pHeader = String(tab.getRange(1, 16).getValue() || "").trim();
      if (!pHeader) {
        tab.getRange(1, 16).setValue("Snooze Until Date");
      }

      tab.getRange(row, 16).setValue(data.snooze_date);

      return ContentService.createTextOutput(JSON.stringify({
        ok: true,
        row: row,
        snooze_date: data.snooze_date
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 3. ACTION: mark_draft_sent (Sets Dispatch Status to SENT, records sent date & calculates F1/F2)
    if (data.action === "mark_draft_sent") {
      const tab2 = getSheetCaseInsensitive(ss, "Email_Drafts");
      const row = Number(data.row);
      if (!row || row < 2) throw new Error("Invalid row index");

      if (data.expect_prof) {
        const curProf = String(tab2.getRange(row, 2).getValue()).trim();
        if (curProf && curProf.toLowerCase() !== String(data.expect_prof).trim().toLowerCase()) {
          throw new Error("Row mismatch: expected " + data.expect_prof + " but found " + curProf);
        }
      }

      tab2.getRange(row, 1).setValue(data.sent_date || todayDhaka); // Col A: Date Sent
      tab2.getRange(row, 7).setValue("SENT");                       // Col G: Dispatch Status
      tab2.getRange(row, 8).setValue("No Reply");                   // Col H: Reply Status
      if (data.f1) tab2.getRange(row, 10).setValue(data.f1);        // Col J: F1 Due
      if (data.f2) tab2.getRange(row, 11).setValue(data.f2);        // Col K: F2 Due
      tab2.getRange(row, 15).setValue(data.sent_date || todayDhaka);// Col O: Last Contact Date

      return ContentService.createTextOutput(JSON.stringify({
        ok: true,
        row: row,
        status: "SENT"
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 4. ACTION: swipe (Accept or Decline scraped lead in Tab 1)
    if (data.action === "swipe") {
      const tab1 = getSheetCaseInsensitive(ss, "Scraped_Leads");
      const row = Number(data.row);
      if (!row || row < 2) throw new Error("Invalid row index");
      if (data.expect_prof) {
        const curProf = String(tab1.getRange(row, 2).getValue()).trim(); // Col B is PI Name
        if (curProf && curProf.toLowerCase() !== String(data.expect_prof).trim().toLowerCase()) {
          throw new Error("Row mismatch: expected " + data.expect_prof + " but found " + curProf);
        }
      }
      const targetStatus = data.decision === "ACCEPT" ? "APPROVED" : (data.decision === "DECLINE" ? "REJECTED" : "PENDING_APPROVAL");
      tab1.getRange(row, 11).setValue(targetStatus); // Col K (11) is Your Decision
      return ContentService.createTextOutput(JSON.stringify({ ok: true, row: row, decision: targetStatus })).setMimeType(ContentService.MimeType.JSON);
    }

    // 5. ACTION: manual_ingest (Appends raw lead text to Tab 5: Manual_Ingest)
    if (data.action === "manual_ingest") {
      const tab5 = getSheetCaseInsensitive(ss, "Manual_Ingest");
      tab5.appendRow([data.timestamp || todayDhaka, data.text || "", "Pending Scout Parse"]);
      return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
    }

    // 6. ACTION: append_email_draft (Appends manually logged out-of-band sent email)
    if (data.action === "append_email_draft") {
      const tab2 = getSheetCaseInsensitive(ss, "Email_Drafts");
      tab2.appendRow(data.values);
      return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
    }

    // 7. ACTION: log_reply (Updates PI Reply Status and notes in Tab 2 or Archive)
    if (data.action === "log_reply") {
      const tabName = data.tab || "Email_Drafts";
      const tab2 = getSheetCaseInsensitive(ss, tabName) || getSheetCaseInsensitive(ss, "Email_Drafts");
      const row = Number(data.row);
      if (!row || row < 2) throw new Error("Invalid row index");

      if (data.expect_prof) {
        const curProf = String(tab2.getRange(row, 2).getValue()).trim();
        if (curProf && curProf.toLowerCase() !== String(data.expect_prof).trim().toLowerCase()) {
          throw new Error("Row mismatch: expected " + data.expect_prof + " but found " + curProf);
        }
      }

      tab2.getRange(row, 8).setValue(data.status);        // Col H: Reply Status
      tab2.getRange(row, 9).setValue(data.notes || "");   // Col I: Notes
      tab2.getRange(row, 15).setValue(todayDhaka);        // Col O: Last Contact Date

      return ContentService.createTextOutput(JSON.stringify({ ok: true, row: row, status: data.status })).setMimeType(ContentService.MimeType.JSON);
    }

    // ACTION: log_manual_comm (Manual Email & Communication Logger)
    if (data.action === "log_manual_comm") {
      const tabName = data.tab || "Email_Drafts";
      const tab2 = getSheetCaseInsensitive(ss, tabName) || getSheetCaseInsensitive(ss, "Email_Drafts") || getSheetCaseInsensitive(ss, "Drafts");
      if (!tab2) throw new Error("Tab not found: " + tabName);
      const row = Number(data.row);
      if (!row || row < 2) throw new Error("Invalid row index");

      if (data.expect_prof) {
        const curProf = String(tab2.getRange(row, 2).getValue()).trim();
        if (curProf && curProf.toLowerCase() !== String(data.expect_prof).trim().toLowerCase()) {
          throw new Error("Row mismatch: expected " + data.expect_prof + " but found " + curProf);
        }
      }

      const commDate = String(data.date || todayDhaka).trim();
      const direction = String(data.direction || "Sent by Me").trim();
      const newStatus = String(data.status || "No Reply").trim();
      const commNotes = String(data.notes || "").trim();

      // Append communication entry to Col I (Col 9 / Notes)
      const existingNotes = String(tab2.getRange(row, 9).getValue() || "").trim();
      const entryPrefix = `[${commDate} ${direction}]:`;
      const fullEntry = commNotes ? `${entryPrefix} ${commNotes}` : `${entryPrefix} (Logged in CRM)`;
      const updatedNotes = existingNotes ? `${existingNotes}\n\n${fullEntry}` : fullEntry;

      if (data.status) tab2.getRange(row, 8).setValue(data.status);      // Col H (Col 8): Reply Status (if provided)
      tab2.getRange(row, 9).setValue(updatedNotes);  // Col I (Col 9): Notes
      tab2.getRange(row, 15).setValue(commDate);     // Col O (Col 15): Last Contact Date

      return ContentService.createTextOutput(JSON.stringify({ 
        ok: true, 
        message: "Manual communication logged successfully", 
        row: row, 
        prof: data.expect_prof || "", 
        status: newStatus,
        last_contact: commDate,
        notes: updatedNotes
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 8. ACTION: trigger_scout, trigger_drafter, trigger_nagger, trigger_radar (GitHub Actions Relays)
    if (data.action === "trigger_scout" || data.action === "trigger_drafter" || data.action === "trigger_nagger" || data.action === "trigger_radar") {
      let daemon = "scout";
      if (data.action === "trigger_drafter") daemon = "drafter";
      else if (data.action === "trigger_nagger") daemon = "nagger";
      else if (data.action === "trigger_radar") daemon = "radar";

      const extraInputs = {};
      if (data.type) extraInputs.type = String(data.type);
      if (data.prof) extraInputs.prof = String(data.prof);
      if (data.row) extraInputs.row = String(data.row);
      if (data.research_area || data.area || data.cluster) extraInputs.area = String(data.research_area || data.area || data.cluster);
      if (data.target_country || data.country) extraInputs.country = String(data.target_country || data.country);
      if (data.target_university || data.university) extraInputs.university = String(data.target_university || data.university);
      if (data.target_department || data.department) extraInputs.department = String(data.target_department || data.department);

      triggerGitHubWorkflow(daemon, extraInputs);
      return ContentService.createTextOutput(JSON.stringify({ ok: true, daemon: daemon, inputs: extraInputs })).setMimeType(ContentService.MimeType.JSON);
    }

    // 9. ACTION: sync_calendar (Auto-syncs application deadlines to Google Calendar)
    if (data.action === "sync_calendar") {
      const cal = CalendarApp.getDefaultCalendar();
      if (!cal) throw new Error("Could not access default Google Calendar");

      const tab2 = getSheetCaseInsensitive(ss, "Email_Drafts") || getSheetCaseInsensitive(ss, "Drafts");
      const t2Data = getSheetDataRows(tab2);

      let syncedCount = 0;
      const syncedEvents = [];

      t2Data.forEach((r, idx) => {
        const profName = String(r[1] || "").trim();    // Col B: PI Name
        if (!profName) return;

        const inst = String(r[5] || "").trim();        // Col F: Institution & Dept
        const deadline = String(r[11] || "").trim();    // Col L: Application Deadline & Reqs
        const portal = String(r[12] || "").trim();      // Col M: Dept / Portal Link
        const profileUrl = String(r[13] || "").trim();  // Col N: Direct Profile URL

        const dateMatch = deadline.match(/\b(\d{4}-\d{2}-\d{2})\b/);
        if (!dateMatch) return;

        const isoDate = dateMatch[1];
        const dateParts = isoDate.split("-");
        const eventDate = new Date(Number(dateParts[0]), Number(dateParts[1]) - 1, Number(dateParts[2]));

        // Check if an event already exists for this professor on that date
        const existingEvents = cal.getEventsForDay(eventDate);
        const exists = existingEvents.some(ev => {
          const evTitle = ev.getTitle() || "";
          return evTitle.toLowerCase().includes(profName.toLowerCase());
        });

        if (!exists) {
          const eventTitle = "PhD Deadline: " + profName + (inst ? " - " + inst : "");
          let desc = "PhD Application Deadline & Requirements:\n" + deadline;
          if (portal && portal !== "#") {
            desc += "\n\nDepartment / Application Portal:\n" + portal;
          }
          if (profileUrl && profileUrl !== "#") {
            desc += "\n\nFaculty Profile:\n" + profileUrl;
          }

          cal.createAllDayEvent(eventTitle, eventDate, {
            description: desc
          });

          syncedCount++;
          syncedEvents.push({
            prof: profName,
            date: isoDate,
            title: eventTitle
          });
        }
      });

      return ContentService.createTextOutput(JSON.stringify({
        ok: true,
        synced: syncedCount,
        events: syncedEvents,
        message: "Successfully synced " + syncedCount + " deadline events to Google Calendar."
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 10. ACTION: chat (Gemini AI Chatbot Proxy)
    if (data.action === "chat") {
      const apiKey = (PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY") || "").trim();
      if (!apiKey) throw new Error("GEMINI_API_KEY is missing in Script Properties.");
      const sysPrompt = "You are the AI Academic Intelligence Assistant for Soumitro Kumar Das (M.Sc. Applied Mathematics, researching Compartmental Epidemiological Modeling, Parameter Estimation, PINNs/Neural ODEs, Fractional Calculus, and Predator-Prey/Harvesting systems).\n" +
        "Use his live CRM & Scraped Leads database below to answer questions about professors, compatibility, follow-ups, email drafting, and literature:\n" +
        JSON.stringify(data.crm_data || {});
      const userQ = String(data.message || "");
      const result = invokeBestAvailableGemini(apiKey, "User Question: " + userQ, 0.3, sysPrompt);
      return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
    }

    // 11. ACTION: set_priority (Updates Priority Classification P1-P4 in Column I)
    if (data.action === "set_priority") {
      const tabName = data.tab || "Email_Drafts";
      const tab = getSheetCaseInsensitive(ss, tabName) || getSheetCaseInsensitive(ss, "Email_Drafts");
      if (!tab) throw new Error("Tab not found: " + tabName);
      const row = Number(data.row);
      if (!row || row < 2) throw new Error("Invalid row: " + row);

      const expectProf = String(data.expect_prof || "").trim();
      if (expectProf) {
        const actualProf = String(tab.getRange(row, 2).getValue()).trim();
        if (actualProf.toLowerCase() !== expectProf.toLowerCase()) {
          throw new Error("Row mismatch: expected '" + expectProf + "', found '" + actualProf + "'");
        }
      }

      const newPriority = String(data.priority || "P1").toUpperCase();
      const currentNotes = String(tab.getRange(row, 9).getValue() || "").trim();
      const cleanedNotes = currentNotes.replace(/\[Priority:\s*P[1-4]\]\s*/i, "");
      const updatedNotes = "[Priority: " + newPriority + "] " + cleanedNotes;
      tab.getRange(row, 9).setValue(updatedNotes);

      return ContentService.createTextOutput(JSON.stringify({
        ok: true,
        row: row,
        prof: expectProf,
        priority: newPriority,
        notes: updatedNotes
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 12. ACTION: optimize_sheet (Applies Deep Navy / Light Slate Visual Hierarchy & Contrast Fix)
    if (data.action === "optimize_sheet") {
      const targetTabs = ["Scraped_Leads", "Email_Drafts", "Literature_Radar", "Archive_History", "Manual_Ingest"];
      const formatted = [];

      targetTabs.forEach(function(name) {
        const sheet = getSheetCaseInsensitive(ss, name);
        if (!sheet) return;
        const lr = sheet.getLastRow();
        const lc = sheet.getLastColumn();
        if (lc < 1) return;

        sheet.setFrozenRows(1);

        const headerRange = sheet.getRange(1, 1, 1, lc);
        headerRange.setBackground("#1E293B")
                   .setFontColor("#FFFFFF")
                   .setFontWeight("bold")
                   .setFontFamily("Roboto")
                   .setFontSize(10)
                   .setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);

        if (lr > 1) {
          const dataRange = sheet.getRange(2, 1, lr - 1, lc);
          dataRange.setBackground("#FFFFFF")
                   .setFontColor("#0F172A")
                   .setFontFamily("Roboto")
                   .setFontSize(10)
                   .setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
        }

        const widths = [110, 180, 220, 260, 340, 220, 120, 120, 320, 110, 110, 130, 180, 180, 110, 110];
        for (let c = 1; c <= Math.min(lc, widths.length); c++) {
          sheet.setColumnWidth(c, widths[c - 1]);
        }

        formatted.push(sheet.getName());
      });

      return ContentService.createTextOutput(JSON.stringify({
        ok: true,
        message: "Google Sheet contrast and visual hierarchy optimized successfully!",
        formattedTabs: formatted
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 13. ACTION: fetch_literature (Live Multi-Window Literature Fetch across 24h / 7d / 30d)
    if (data.action === "fetch_literature") {
      const windowStr = String(data.window || "7d").toLowerCase();
      let days = 7;
      if (windowStr === "24h") days = 1;
      else if (windowStr === "30d") days = 30;

      const d = new Date();
      d.setDate(d.getDate() - days);
      const fromDate = Utilities.formatDate(d, "UTC", "yyyy-MM-dd");

      const clusterKeywords = {
        epidemiology: "compartmental model SEIR dengue infectious disease reproduction number",
        parameter_estimation: "parameter estimation identifiability differential equations epidemic",
        pinns: "Physics-Informed Neural Networks PINNs differential equations dynamical systems",
        fractional: "fractional differential equations Caputo epidemic mathematical biology",
        predator_prey: "predator-prey harvesting bifurcation stability mathematical biology"
      };

      const selectedCluster = (data.cluster && clusterKeywords[data.cluster]) ? data.cluster : "epidemiology";
      const q = clusterKeywords[selectedCluster];

      let url = "https://api.openalex.org/works?search=" + encodeURIComponent(q) +
                "&filter=from_publication_date:" + fromDate + "&per-page=12&sort=publication_date:desc";

      let res = UrlFetchApp.fetch(url, {
        headers: { "User-Agent": "PhDPipeline/3.7 (mailto:dassoumitrokumar@gmail.com)" },
        muteHttpExceptions: true
      });

      let results = [];
      if (res.getResponseCode() === 200) {
        try {
          results = (JSON.parse(res.getContentText()) || {}).results || [];
        } catch (e) {}
      }

      if (results.length === 0) {
        // Fallback to most recent papers in that cluster regardless of narrow 24h window
        url = "https://api.openalex.org/works?search=" + encodeURIComponent(q) + "&per-page=12&sort=publication_date:desc";
        res = UrlFetchApp.fetch(url, {
          headers: { "User-Agent": "PhDPipeline/3.7 (mailto:dassoumitrokumar@gmail.com)" },
          muteHttpExceptions: true
        });
        if (res.getResponseCode() === 200) {
          try {
            results = (JSON.parse(res.getContentText()) || {}).results || [];
          } catch (e) {}
        }
      }

      const newPapers = [];
      let tab3 = getSheetCaseInsensitive(ss, "Literature_Radar") || getSheetCaseInsensitive(ss, "Radar");
      if (!tab3) {
        tab3 = ss.insertSheet("Literature_Radar");
        tab3.appendRow([
          "Week Date", "Paper Title", "Authors & Institution", "Journal / Venue",
          "Publication Date", "Verified DOI / Link", "Sub-Field Tag",
          "Key Methodology", "Research Gap & Mix Idea", "Lead Potential", "Abstract"
        ]);
      }

      for (let i = 0; i < Math.min(results.length, 10); i++) {
        const w = results[i];
        const title = String(w.title || "").trim();
        if (!title) continue;

        const doi = String(w.doi || w.id || "").trim();
        const pubDate = String(w.publication_date || "").trim();
        const venue = (w.primary_location && w.primary_location.source && w.primary_location.source.display_name) || "Academic Journal / Venue";

        const auths = w.authorships || [];
        const authorNames = auths.slice(0, 3).map(function(a) { return (a.author && a.author.display_name) || ""; }).filter(Boolean);
        let instName = "";
        if (auths.length > 0 && auths[auths.length - 1].institutions && auths[auths.length - 1].institutions.length > 0) {
          instName = auths[auths.length - 1].institutions[0].display_name || "";
        }
        const authorsInst = (authorNames.join(", ") + (instName ? " (" + instName + ")" : "")).trim();

        // Reconstruct inverted index abstract
        let abstract = "";
        if (w.abstract_inverted_index) {
          const wordsWithPos = [];
          for (const word in w.abstract_inverted_index) {
            const positions = w.abstract_inverted_index[word];
            for (let p = 0; p < positions.length; p++) {
              wordsWithPos.push({ pos: positions[p], word: word });
            }
          }
          wordsWithPos.sort(function(a, b) { return a.pos - b.pos; });
          abstract = wordsWithPos.map(function(item) { return item.word; }).join(" ").substring(0, 1000);
        }

        // Fast deterministic academic synthesis tailored strictly to Soumitro's research
        let methodology = "Non-linear compartmental ODE dynamical systems modeling & reproduction number (R0) stability analysis.";
        let mixIdea = "Extend with logistic carrying capacity in host-vector dynamics and Caputo fractional memory derivatives.";
        let leadPotential = "High";

        const textLower = (title + " " + abstract).toLowerCase();

        if (selectedCluster === "pinns" || textLower.includes("pinn") || textLower.includes("neural ode") || textLower.includes("machine learning")) {
          methodology = "Physics-Informed Neural Networks (PINNs) and Scientific Machine Learning (SciML) for differential equations.";
          mixIdea = "Embed mechanistic epidemic state constraints into loss function to discover unobserved transmission parameters.";
          leadPotential = "High";
        } else if (selectedCluster === "parameter_estimation" || textLower.includes("parameter estimation") || textLower.includes("identifiab")) {
          methodology = "Structural identifiability, inverse problem calibration, and profile likelihood / MCMC inference.";
          mixIdea = "Formulate hybrid mechanistic-PINN parameter estimation to recover latent time-varying infection rates.";
          leadPotential = "High";
        } else if (selectedCluster === "fractional" || textLower.includes("fractional") || textLower.includes("caputo") || textLower.includes("memory")) {
          methodology = "Caputo fractional-order differential equations modeling memory effects and hereditary dynamics.";
          mixIdea = "Incorporate Adams-Bashforth-Moulton predictor-corrector numerical schemes and calibrate fractional order alpha against empirical outbreak series.";
          leadPotential = "High";
        } else if (selectedCluster === "predator_prey" || textLower.includes("predator") || textLower.includes("harvesting") || textLower.includes("bifurcat")) {
          methodology = "Multi-species non-linear ODE dynamics with Hopf/Bogdanov-Takens bifurcation and limit cycle analysis.";
          mixIdea = "Introduce bioeconomic optimal harvesting controls and state-dependent carrying capacity to assess population persistence.";
          leadPotential = "Medium";
        }

        const paperObj = {
          week_date: todayDhaka,
          title: title,
          authors_inst: authorsInst,
          venue: venue,
          pub_date: pubDate,
          doi: doi,
          tag: selectedCluster.replace(/_/g, ' ').toUpperCase(),
          methodology: methodology,
          mix_idea: mixIdea,
          lead_potential: leadPotential,
          abstract: abstract
        };

        newPapers.push(paperObj);

        if (tab3) {
          tab3.appendRow([
            todayDhaka,
            title,
            authorsInst,
            venue,
            pubDate,
            doi,
            paperObj.tag,
            methodology,
            mixIdea,
            leadPotential,
            abstract
          ]);
        }
      }

      return ContentService.createTextOutput(JSON.stringify({
        ok: true,
        window: windowStr,
        cluster: selectedCluster,
        papers: newPapers
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 14. ACTION: convert_paper_to_lead (Converts literature radar paper to CRM lead & generates cold outreach draft)
    if (data.action === "convert_paper_to_lead") {
      const p = data.paper || {};
      if (!p.title) throw new Error("Missing paper title");

      // Extract PI name and institution
      let piName = "Professor";
      let piInst = "Academic Institution";
      const authorsInst = String(p.authors_inst || "");
      const instMatch = authorsInst.match(/\((.*?)\)$/);
      if (instMatch) {
        piInst = instMatch[1].trim();
      }
      const namesOnly = authorsInst.replace(/\(.*?\)$/, "").trim();
      const nameParts = namesOnly.split(/,\s*|\s+and\s+/);
      if (nameParts.length > 0 && nameParts[0].trim()) {
        piName = nameParts[nameParts.length - 1].trim() || nameParts[0].trim();
      }

      const subject = "Prospective PhD Applicant (Fall 2027) - Research Discussion on " + p.title.substring(0, 50);
      let emailBody = "";

      try {
        const prompt = "Candidate: Soumitro Kumar Das (Shuvro)\n" +
          "Background: First-author Q1 paper in Arab Journal of Basic and Applied Sciences (Taylor & Francis) on Dengue Transmission with Carrying Capacity ODEs, Fractional Calculus (Caputo), and Physics-Informed Neural Networks (PINNs).\n" +
          "Professor: " + piName + " (" + piInst + ")\n" +
          "Recent Paper: " + p.title + " (" + (p.venue || "") + ", " + (p.pub_date || "") + ")\n" +
          "DOI: " + (p.doi || "") + "\n" +
          "Extension Hypothesis: " + (p.mix_idea || "") + "\n\n" +
          "Write a concise, professional cold email (under 250 words) from Soumitro to Professor " + piName + ".\n" +
          "Guidelines: Mention their recent paper specifically, express interest in doctoral supervision for Fall 2027, propose the extension hypothesis concisely, and reference his published Dengue model. No generic flattery or banned clichés.";

        emailBody = callGeminiAPI(prompt, "You are a professional academic cold outreach writer.");
      } catch (e) {}

      if (!emailBody) {
        emailBody = "Dear Professor " + piName + ",\n\n" +
          "I hope this email finds you well. I recently read with great interest your latest paper titled \"" + p.title + "\" published in " + (p.venue || "recent proceedings") + ".\n\n" +
          "My research background is in compartmental dynamical systems, parameter estimation, and fractional-order modeling. In particular, I recently published first-author work on Dengue transmission dynamics with logistic carrying capacity in the Arab Journal of Basic and Applied Sciences (Taylor & Francis).\n\n" +
          "I noticed an exciting direction to extend your formulation: " + (p.mix_idea || "incorporating memory-dependent dynamics and PINN parameter estimation") + ".\n\n" +
          "I am applying for PhD positions for Fall 2027 and would be thrilled to explore prospective doctoral research under your guidance at " + piInst + ". Would you be open to a brief conversation or reviewing my CV?\n\n" +
          "Sincerely,\nSoumitro Kumar Das (Shuvro)\nApplied Mathematician | B.Sc. in Mathematics";
      }

      // Append to Tab 2 (Email_Drafts)
      const tab2 = getSheetCaseInsensitive(ss, "Email_Drafts") || getSheetCaseInsensitive(ss, "Drafts");
      if (tab2) {
        tab2.appendRow([
          todayDhaka,
          piName,
          p.email || "",
          subject,
          emailBody,
          "Radar Conversion from Paper: " + p.title.substring(0, 100),
          "DRAFT",
          "Pending",
          "Converted from Tab 3 Literature Radar (" + (p.doi || "") + ")",
          "",
          ""
        ]);
      }

      return ContentService.createTextOutput(JSON.stringify({
        ok: true,
        prof: piName,
        inst: piInst,
        email: p.email || "",
        subject: subject,
        body: emailBody
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 15. ACTION: save_radar_note (Persists personal note on a literature radar item)
    if (data.action === "save_radar_note") {
      const tab3 = getSheetCaseInsensitive(ss, "Literature_Radar") || getSheetCaseInsensitive(ss, "Radar");
      const row = Number(data.row);
      if (tab3 && row >= 2 && data.note !== undefined) {
        tab3.getRange(row, 11).setValue(String(data.note));
      }
      return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
    }

    // 16. ACTION: fix_profile_url (Updates Col M for Scraped_Leads, Col N for Email_Drafts/Archive_History)
    if (data.action === "fix_profile_url") {
      const tabName = data.tab || "Email_Drafts";
      const tab = getSheetCaseInsensitive(ss, tabName);
      if (!tab) throw new Error("Tab not found: " + tabName);
      const row = Number(data.row);
      if (!row || row < 2) throw new Error("Invalid row index");

      if (data.expect_prof) {
        const curProf = String(tab.getRange(row, 2).getValue()).trim();
        if (curProf && curProf.toLowerCase() !== String(data.expect_prof).trim().toLowerCase()) {
          throw new Error("Row mismatch: expected " + data.expect_prof + " but found " + curProf);
        }
      }

      const isScraped = tabName.toLowerCase().indexOf("scraped") !== -1;
      const targetCol = isScraped ? 13 : 14; // Col 13 (Col M) for Scraped_Leads, Col 14 (Col N) for Email_Drafts & Archive_History
      tab.getRange(row, targetCol).setValue(String(data.profile_url || "").trim());
      return ContentService.createTextOutput(JSON.stringify({ ok: true, row: row, col: targetCol, profile_url: data.profile_url })).setMimeType(ContentService.MimeType.JSON);
    }

    // 17. ACTION: raw_sheet_op (Universal bridge for Python daemons without direct OAuth credentials)
    if (data.action === "raw_sheet_op") {
      const op = String(data.op || "").trim();
      const tabName = String(data.tab || "").trim();
      const tab = tabName ? (getSheetCaseInsensitive(ss, tabName) || ss.getSheetByName(tabName)) : null;

      if (op === "get_all_rows") {
        if (!tab) return ContentService.createTextOutput(JSON.stringify({ ok: true, result: [] })).setMimeType(ContentService.MimeType.JSON);
        const lastRow = tab.getLastRow();
        const lastCol = tab.getLastColumn();
        if (lastRow < 1 || lastCol < 1) {
          return ContentService.createTextOutput(JSON.stringify({ ok: true, result: [] })).setMimeType(ContentService.MimeType.JSON);
        }
        const vals = tab.getRange(1, 1, lastRow, lastCol).getValues();
        return ContentService.createTextOutput(JSON.stringify({ ok: true, result: vals })).setMimeType(ContentService.MimeType.JSON);
      }

      if (op === "append_row") {
        if (!tab) throw new Error("Tab not found: " + tabName);
        const rowVals = Array.isArray(data.values) ? data.values : [];
        tab.appendRow(rowVals);
        return ContentService.createTextOutput(JSON.stringify({ ok: true, result: "Appended 1 row" })).setMimeType(ContentService.MimeType.JSON);
      }

      if (op === "append_rows") {
        if (!tab) throw new Error("Tab not found: " + tabName);
        const rows = Array.isArray(data.rows) ? data.rows : [];
        if (rows.length > 0) {
          const startRow = tab.getLastRow() + 1;
          const numCols = rows[0].length;
          tab.getRange(startRow, 1, rows.length, numCols).setValues(rows);
        }
        return ContentService.createTextOutput(JSON.stringify({ ok: true, result: "Appended " + rows.length + " rows" })).setMimeType(ContentService.MimeType.JSON);
      }

      if (op === "update_cell_range") {
        if (!tab) throw new Error("Tab not found: " + tabName);
        const rangeStr = String(data.range || "").trim();
        const vals = Array.isArray(data.values) ? data.values : [];
        if (rangeStr && vals.length > 0) {
          tab.getRange(rangeStr).setValues(vals);
        }
        return ContentService.createTextOutput(JSON.stringify({ ok: true, result: "Updated " + rangeStr })).setMimeType(ContentService.MimeType.JSON);
      }

      if (op === "clear_tab") {
        if (!tab) throw new Error("Tab not found: " + tabName);
        const keepHeader = data.keep_header !== false;
        const lastRow = tab.getLastRow();
        const lastCol = tab.getLastColumn();
        if (lastRow > (keepHeader ? 1 : 0) && lastCol > 0) {
          const startR = keepHeader ? 2 : 1;
          const numR = keepHeader ? (lastRow - 1) : lastRow;
          tab.getRange(startR, 1, numR, lastCol).clearContent();
        }
        return ContentService.createTextOutput(JSON.stringify({ ok: true, result: "Cleared " + tabName })).setMimeType(ContentService.MimeType.JSON);
      }

      if (op === "ensure_tabs") {
        const headersMap = data.tab_headers || {};
        for (const tName in headersMap) {
          let s = getSheetCaseInsensitive(ss, tName) || ss.getSheetByName(tName);
          if (!s) {
            s = ss.insertSheet(tName);
            const hdrs = headersMap[tName];
            if (Array.isArray(hdrs) && hdrs.length > 0) {
              s.appendRow(hdrs);
            }
          }
        }
        return ContentService.createTextOutput(JSON.stringify({ ok: true, result: "Tabs ensured" })).setMimeType(ContentService.MimeType.JSON);
      }

      throw new Error("Unsupported op: " + op);
    }

    throw new Error("Unknown action: " + data.action);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      ok: false,
      error: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

function triggerGitHubWorkflow(daemonName, extraInputs) {
  const sp = PropertiesService.getScriptProperties();
  const token = sp.getProperty("GITHUB_PAT");
  if (!token) throw new Error("GITHUB_PAT not configured in Script Properties");
  const repo = sp.getProperty("GITHUB_REPO") || "SoumitroDas/PhD-Pipeline-v3";
  const url = "https://api.github.com/repos/" + repo + "/actions/workflows/phd_pipeline_v3.yml/dispatches";
  const inputs = { daemon: daemonName, dry_run: "false" };
  if (extraInputs && typeof extraInputs === "object") {
    for (const k in extraInputs) {
      if (extraInputs[k] !== undefined && extraInputs[k] !== null) {
        inputs[k] = String(extraInputs[k]);
      }
    }
  }
  const payload = {
    ref: "Smain",
    inputs: inputs
  };
  const options = {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + token,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "PhD-Pipeline-GAS-Proxy"
    },
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  const res = UrlFetchApp.fetch(url, options);
  if (res.getResponseCode() >= 400) {
    throw new Error("GitHub API Error (" + res.getResponseCode() + "): " + res.getContentText());
  }
}

function callGeminiAPI(prompt, systemInstruction) {
  const apiKey = (PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY") || "").trim();
  if (!apiKey) return "";
  const result = invokeBestAvailableGemini(apiKey, prompt, 0.2, systemInstruction);
  return result.ok ? result.reply : "";
}
