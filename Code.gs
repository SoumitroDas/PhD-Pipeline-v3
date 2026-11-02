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

const SHEET_ID = "18ww6rPcncVtwDNnHLborAwraY0PNqQr0wsY16gr9M1E";

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
    message: "PhD Command Center v3.1 Backend Live",
    timestamp: new Date().toISOString()
  })).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Parses a single 15-to-16 column outreach row using exact 0-indexed column schema (A:O / A:P).
 */
function parseOutreachRow(r, rowNum, tabName) {
  const dateStr = r[0] ? (r[0] instanceof Date ? Utilities.formatDate(r[0], "Asia/Dhaka", "yyyy-MM-dd") : String(r[0]).trim()) : "";
  const profName = String(r[1] || "").trim();
  const email = String(r[2] || "").trim();
  const subject = String(r[3] || "").trim();
  const body = String(r[4] || "").trim();
  const meta = String(r[5] || "").trim();                   // meta = r[5] (Institution)
  const dStat = String(r[6] || "").trim().toUpperCase();    // dStat = r[6] (Dispatch Status)
  const rStat = String(r[7] || "No Reply").trim();          // rStat = r[7] (PI Reply Status)
  const notes = String(r[8] || "").trim();                  // notes = r[8] (Reply Summary / Notes)
  const f1 = r[9] ? (r[9] instanceof Date ? Utilities.formatDate(r[9], "Asia/Dhaka", "yyyy-MM-dd") : String(r[9]).trim()) : "";
  const f2 = r[10] ? (r[10] instanceof Date ? Utilities.formatDate(r[10], "Asia/Dhaka", "yyyy-MM-dd") : String(r[10]).trim()) : "";
  const deadline = String(r[11] || "Rolling").trim();
  const portal = String(r[12] || "").trim();
  const profile_url = String(r[13] || "").trim();
  const last_contact = r[14] ? (r[14] instanceof Date ? Utilities.formatDate(r[14], "Asia/Dhaka", "yyyy-MM-dd") : String(r[14]).trim()) : dateStr;
  const snoozeUntil = r[15] ? (r[15] instanceof Date ? Utilities.formatDate(r[15], "Asia/Dhaka", "yyyy-MM-dd") : String(r[15]).trim()) : "";

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
    inst: meta,
    institution: meta,
    meta: meta,
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
    deadline: deadline,
    app_deadline: deadline,
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
      const tab1 = ss.getSheetByName("Scraped_Leads");
      const tab2 = ss.getSheetByName("Email_Drafts");
      const tab4 = ss.getSheetByName("Archive_History");

      const t1Data = tab1 && tab1.getLastRow() > 1 ? tab1.getRange(2, 1, tab1.getLastRow() - 1, 14).getValues() : [];
      const t2Data = tab2 && tab2.getLastRow() > 1 ? tab2.getRange(2, 1, tab2.getLastRow() - 1, 16).getValues() : [];
      const t4Data = tab4 && tab4.getLastRow() > 1 ? tab4.getRange(2, 1, tab4.getLastRow() - 1, 15).getValues() : [];

      const pendingLeads = [];
      let scraped = 0, approved = 0, drafted = 0, sent = 0, positive = 0;

      // Tab 1: Scraped Leads triage
      t1Data.forEach((r, idx) => {
        scraped++;
        const status = String(r[6] || "").trim(); // Col G: Status
        if (status === "PENDING_APPROVAL" || !status) {
          pendingLeads.push({
            row: idx + 2,
            prof: r[0],
            institution: r[1],
            email: r[2],
            paper_title: r[3],
            field_match: r[4],
            paper_doi: r[5],
            status: status || "PENDING_APPROVAL",
            paper_2_doi: r[7] || "",
            profile_url: r[12] || ""
          });
        } else if (status === "APPROVED") {
          approved++;
        }
      });

      const draftsReady = [];
      const sentProfs = [];
      const actionNeeded = [];
      const snoozed = [];

      // Tab 2: Email_Drafts (Active Outreach + Drafts Ready)
      t2Data.forEach((r, idx) => {
        const rowNum = idx + 2;
        const item = parseOutreachRow(r, rowNum, "Email_Drafts");
        if (!item.prof) return; // Skip empty row

        if (item.dispatch === "DRAFT") {
          drafted++;
          draftsReady.push(item);
        } else {
          // Dispatched lead (SENT)
          sent++;
          const isPos = /pos|accept|interview|call/i.test(item.status);
          const isNeut = /neut|redir|apply|portal/i.test(item.status);
          if (isPos) positive++;

          sentProfs.push(item);

          // Col P Snooze Engine check
          const isCurrentlySnoozed = item.snooze_until && todayDhaka < item.snooze_until;
          if (isCurrentlySnoozed) {
            snoozed.push(item);
          } else {
            if (isPos || isNeut || !item.status || item.status === "No Reply" || item.status === "SENT") {
              actionNeeded.push(item);
            }
          }
        }
      });

      // Tab 4: Archive_History (Historical Dispatches: Declined, Bounced, Closed, Expired F2)
      t4Data.forEach((r, idx) => {
        const rowNum = idx + 2;
        const item = parseOutreachRow(r, rowNum, "Archive_History");
        if (!item.prof) return; // Skip empty row

        // Every historical archive entry was dispatched (SENT)
        sent++;
        const isPos = /pos|accept|interview|call/i.test(item.status);
        if (isPos) positive++;

        sentProfs.push(item);
      });

      return ContentService.createTextOutput(JSON.stringify({
        ok: true,
        stats: {
          scraped: scraped,
          approved: approved,
          drafted: drafted,
          sent: sent,
          positive: positive,
          snoozed: snoozed.length
        },
        leads: pendingLeads,
        draftsReady: draftsReady,
        sentProfs: sentProfs,
        actionNeeded: actionNeeded,
        snoozed: snoozed
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 2. ACTION: snooze (Sets Col P: Snooze Until Date in Email_Drafts)
    if (data.action === "snooze") {
      const tabName = data.tab || "Email_Drafts";
      const tab = ss.getSheetByName(tabName);
      if (!tab) throw new Error("Tab not found: " + tabName);
      const row = Number(data.row);
      if (!row || row < 2) throw new Error("Invalid row index");

      if (data.expect_prof) {
        const curProf = String(tab.getRange(row, 2).getValue()).trim();
        if (curProf && curProf.toLowerCase() !== String(data.expect_prof).trim().toLowerCase()) {
          throw new Error("Row mismatch: expected " + data.expect_prof + " but found " + curProf);
        }
      }

      // Ensure Col P header exists
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
      const tab2 = ss.getSheetByName("Email_Drafts");
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
      const tab1 = ss.getSheetByName("Scraped_Leads");
      const row = Number(data.row);
      if (!row || row < 2) throw new Error("Invalid row index");

      if (data.expect_prof) {
        const curProf = String(tab1.getRange(row, 1).getValue()).trim();
        if (curProf && curProf.toLowerCase() !== String(data.expect_prof).trim().toLowerCase()) {
          throw new Error("Row mismatch: expected " + data.expect_prof + " but found " + curProf);
        }
      }

      const targetStatus = data.decision === "ACCEPT" ? "APPROVED" : (data.decision === "DECLINE" ? "REJECTED" : "PENDING_APPROVAL");
      tab1.getRange(row, 7).setValue(targetStatus); // Col G: Status

      return ContentService.createTextOutput(JSON.stringify({
        ok: true,
        row: row,
        decision: targetStatus
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 5. ACTION: manual_ingest (Appends raw lead text to Tab 5: Manual_Ingest)
    if (data.action === "manual_ingest") {
      const tab5 = ss.getSheetByName("Manual_Ingest");
      tab5.appendRow([data.timestamp || todayDhaka, data.text || "", "Pending Scout Parse"]);
      return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
    }

    // 6. ACTION: append_email_draft (Appends manually logged out-of-band sent email)
    if (data.action === "append_email_draft") {
      const tab2 = ss.getSheetByName("Email_Drafts");
      tab2.appendRow(data.values);
      return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
    }

    // 7. ACTION: log_reply (Updates PI Reply Status and notes in Tab 2)
    if (data.action === "log_reply") {
      const tab2 = ss.getSheetByName("Email_Drafts");
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

    // 8. ACTION: trigger_scout & trigger_drafter (GitHub Actions Relays)
    if (data.action === "trigger_scout" || data.action === "trigger_drafter") {
      const daemon = data.action === "trigger_scout" ? "scout" : "drafter";
      triggerGitHubWorkflow(daemon);
      return ContentService.createTextOutput(JSON.stringify({ ok: true, daemon: daemon })).setMimeType(ContentService.MimeType.JSON);
    }

    throw new Error("Unknown action: " + data.action);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      ok: false,
      error: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

function triggerGitHubWorkflow(daemonName) {
  const sp = PropertiesService.getScriptProperties();
  const token = sp.getProperty("GITHUB_PAT");
  if (!token) throw new Error("GITHUB_PAT not configured in Script Properties");
  const repo = sp.getProperty("GITHUB_REPO") || "shuvro-das/phd-pipeline-v3";
  const url = "https://api.github.com/repos/" + repo + "/actions/workflows/phd_pipeline_v3.yml/dispatches";
  const payload = {
    ref: "Smain",
    inputs: { daemon: daemonName, dry_run: false }
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
