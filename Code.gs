/**
 * PhD Outreach Pipeline v3.1 - Google Apps Script Backend Proxy
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
const BACKEND_VERSION = "v3.3";

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
  const notes = String(r[8] || "").trim();                  // notes = r[8] (Reply Summary / Notes)
  const f1 = formatCellDate(r[9]);                          // f1 = r[9] (F1 Due)
  const f2 = formatCellDate(r[10]);                         // f2 = r[10] (F2 Due)
  const deadline = String(r[11] || "Rolling").trim();       // deadline = r[11] (Application Deadline & Reqs)
  const portal = String(r[12] || "").trim();                // portal = r[12] (Dept / Portal Link)
  const profile_url = String(r[13] || "").trim();           // profile_url = r[13] (Direct Profile URL)
  const last_contact = formatCellDate(r[14]) || dateStr;    // last_contact = r[14] (Last Contact Date)
  const snoozeUntil = formatCellDate(r[15]);                // snoozeUntil = r[15] (Optional Snooze Until Date)

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
    notes: notes,
    reply_notes: notes,
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
      const pendingLeads = [], allScrapedLeads = [];
      const nowMs = new Date(todayDhaka + "T00:00:00Z").getTime();

      getSheetDataRows(getSheetCaseInsensitive(ss, "Scraped_Leads")).forEach((r, idx) => {
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
        const leadObj = {
          row: idx + 2, tab: "Scraped_Leads", date: dateFound, prof: profName,
          inst: String(r[2] || "").trim(), dept: String(r[3] || "").trim(),
          opp: String(r[4] || "").trim(), link: String(r[5] || "").trim(),
          paper: String(r[6] || "").trim(), paper2: String(r[7] || "").trim(),
          fit: String(r[8] || "").trim(), deadline: String(r[9] || "Rolling").trim(),
          status: normStatus, email: String(r[11] || "").trim(),
          profile_url: String(r[12] || "").trim()
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
            if (isPos || isNeut || !item.status || /no reply|pending|sent/i.test(item.status)) {
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
        snoozed: snoozed
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

      triggerGitHubWorkflow(daemon, extraInputs);
      return ContentService.createTextOutput(JSON.stringify({ ok: true, daemon: daemon })).setMimeType(ContentService.MimeType.JSON);
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
      const models = ["gemini-2.5-flash", "gemini-2.0-flash"];
      let lastErr = "";
      for (let m = 0; m < models.length; m++) {
        const url = "https://generativelanguage.googleapis.com/v1beta/models/" + models[m] + ":generateContent?key=" + encodeURIComponent(apiKey);
        const res = UrlFetchApp.fetch(url, {
          method: "POST",
          contentType: "application/json",
          payload: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: sysPrompt + "\n\nUser Question: " + String(data.message || "") }] }],
            generationConfig: { temperature: 0.3, maxOutputTokens: 2048 }
          }),
          muteHttpExceptions: true
        });
        const txt = res.getContentText();
        let json = {};
        try { json = JSON.parse(txt); } catch (e) {}
        if (res.getResponseCode() === 200 && json.candidates && json.candidates[0] && json.candidates[0].content && json.candidates[0].content.parts) {
          const parts = json.candidates[0].content.parts;
          const answer = parts.filter(function(p) { return !p.thought && p.text; }).map(function(p) { return p.text; }).join("\n").trim();
          if (answer) {
            return ContentService.createTextOutput(JSON.stringify({ ok: true, reply: answer, model: models[m] })).setMimeType(ContentService.MimeType.JSON);
          }
        }
        lastErr = (json.error && json.error.message) ? json.error.message : ("HTTP " + res.getResponseCode() + ": " + txt.slice(0, 200));
      }
      return ContentService.createTextOutput(JSON.stringify({ ok: false, error: "Gemini API Error: " + lastErr })).setMimeType(ContentService.MimeType.JSON);
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
  const repo = sp.getProperty("GITHUB_REPO") || "shuvro-das/phd-pipeline-v3";
  const url = "https://api.github.com/repos/" + repo + "/actions/workflows/phd_pipeline_v3.yml/dispatches";
  const inputs = { daemon: daemonName, dry_run: false };
  if (extraInputs && typeof extraInputs === "object") {
    for (const k in extraInputs) {
      if (extraInputs[k] !== undefined && extraInputs[k] !== null) {
        inputs[k] = extraInputs[k];
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
