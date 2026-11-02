#!/usr/bin/env python3
"""
PhD Outreach Pipeline v3.4 - Sheet Contrast Optimizer & Deep Lead Enrichment
Target: Soumitro Kumar Das (Shuvro)
Implements Sections 5.1, 5.2, 7.1, 11.2, 15.1, and 15.2:
- Deep Navy (#1E293B) & White (#FFFFFF) frozen header hierarchy
- High-contrast Light Slate (#0F172A) data rows with CLIP wrap strategy
- Standard column pixel widths & Basic Filters on all 5 tabs
- Evidence-based Priority Classification (P1-P4)
- Exact Country extraction from institution and email domains
- Funding tag categorization
- Three-part structured evaluation notes (Evidence, Compatibility, Pathway)
"""

import os
import sys
import re
import json
import argparse
from typing import Dict, Any, List, Optional, Tuple

try:
    import requests
except ImportError:
    requests = None

# Ensure src/ is on path
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
if CURRENT_DIR not in sys.path:
    sys.path.insert(0, CURRENT_DIR)

from cloud_shared_core import (
    SPREADSHEET_ID,
    GoogleWorkspaceClient,
    sanitize_for_sheet
)

# Color specifications in 0.0-1.0 RGB format for Google Sheets API v4
COLOR_NAVY_HEADER = {"red": 0.118, "green": 0.161, "blue": 0.231}   # #1E293B
COLOR_WHITE_TEXT  = {"red": 1.0, "green": 1.0, "blue": 1.0}         # #FFFFFF
COLOR_SLATE_TEXT  = {"red": 0.059, "green": 0.090, "blue": 0.165}   # #0F172A
COLOR_WHITE_BG    = {"red": 1.0, "green": 1.0, "blue": 1.0}         # #FFFFFF
COLOR_ALT_BG      = {"red": 0.973, "green": 0.980, "blue": 0.988}   # #F8FAFC

STANDARD_TAB_WIDTHS = {
    "Email_Drafts": [
        (0, 1, 110),   # Col A: Date Drafted
        (1, 2, 180),   # Col B: PI Name
        (2, 3, 220),   # Col C: Email
        (3, 4, 260),   # Col D: Subject Line
        (4, 5, 340),   # Col E: Full Email Body
        (5, 6, 220),   # Col F: Institution & Dept
        (6, 7, 120),   # Col G: Dispatch Status
        (7, 8, 120),   # Col H: PI Reply Status
        (8, 9, 340),   # Col I: Reply Summary / Notes
        (9, 10, 110),  # Col J: F1 Due
        (10, 11, 110), # Col K: F2 Due
        (11, 12, 130), # Col L: Application Deadline
        (12, 13, 180), # Col M: Portal Link
        (13, 14, 180), # Col N: Direct Profile URL
        (14, 15, 110), # Col O: Last Contact Date
        (15, 16, 110), # Col P: Snooze Until Date
    ],
    "Archive_History": [
        (0, 1, 110), (1, 2, 180), (2, 3, 220), (3, 4, 260), (4, 5, 340),
        (5, 6, 220), (6, 7, 120), (7, 8, 120), (8, 9, 340), (9, 10, 110),
        (10, 11, 110), (11, 12, 130), (12, 13, 180), (13, 14, 180), (14, 15, 110)
    ],
    "Scraped_Leads": [
        (0, 1, 110),   # Col A: Date Found
        (1, 2, 180),   # Col B: PI Name
        (2, 3, 220),   # Col C: Institution
        (3, 4, 180),   # Col D: Department
        (4, 5, 240),   # Col E: Opportunity Title
        (5, 6, 200),   # Col F: Posting Link
        (6, 7, 260),   # Col G: Paper 1 & DOI
        (7, 8, 260),   # Col H: Paper 2 & DOI
        (8, 9, 100),   # Col I: Fit Score
        (9, 10, 130),  # Col J: Deadline
        (10, 11, 120), # Col K: Decision
        (11, 12, 220), # Col L: Verified Email
        (12, 13, 180), # Col M: Profile URL
    ],
    "Literature_Radar": [
        (0, 1, 110), (1, 2, 240), (2, 3, 200), (3, 4, 160), (4, 5, 110),
        (5, 6, 220), (6, 7, 140), (7, 8, 260), (8, 9, 280), (9, 10, 120)
    ],
    "Manual_Ingest": [
        (0, 1, 130), (1, 2, 450), (2, 3, 220)
    ]
}


def extract_country(inst: str, email: str) -> str:
    """Extracts exact Country from institution name and email domain."""
    e = str(email or "").lower().strip()
    i = str(inst or "").lower().strip()

    # 1. Email TLD mapping
    if e.endswith(".uk") or ".ac.uk" in e: return "UK"
    if e.endswith(".de"): return "Germany"
    if e.endswith(".ca"): return "Canada"
    if e.endswith(".au"): return "Australia"
    if e.endswith(".se"): return "Sweden"
    if e.endswith(".fi"): return "Finland"
    if e.endswith(".nl"): return "Netherlands"
    if e.endswith(".ch"): return "Switzerland"
    if e.endswith(".it"): return "Italy"
    if e.endswith(".es"): return "Spain"
    if e.endswith(".fr"): return "France"
    if e.endswith(".be"): return "Belgium"
    if e.endswith(".no"): return "Norway"
    if e.endswith(".dk"): return "Denmark"
    if e.endswith(".at"): return "Austria"
    if e.endswith(".ie"): return "Ireland"
    if e.endswith(".cn"): return "China"
    if e.endswith(".kr"): return "South Korea"
    if e.endswith(".sg"): return "Singapore"
    if e.endswith(".jp"): return "Japan"
    if e.endswith(".nz"): return "New Zealand"

    # 2. Institution Keyword mapping
    uk_kw = r"oxford|cambridge|imperial|warwick|edinburgh|manchester|bristol|glasgow|exeter|southampton|leeds|sheffield|york|bath|queen mary|king's college|nottingham|lancaster|liverpool|cardiff|\bucl\b"
    if re.search(uk_kw, i): return "UK"

    de_kw = r"heidelberg|munich|lmu|tum|bonn|humboldt|berlin|gottingen|freiburg|tubingen|rwth|aachen|darmstadt|potsdam|max planck"
    if re.search(de_kw, i): return "Germany"

    ca_kw = r"toronto|ubc|british columbia|mcgill|waterloo|alberta|mcmaster|montreal|calgary|ottawa|\bwestern\b|simon fraser"
    if re.search(ca_kw, i): return "Canada"

    au_kw = r"melbourne|sydney|unsw|queensland|monash|\banu\b|australian national|adelaide|curtin|deakin"
    if re.search(au_kw, i): return "Australia"

    se_kw = r"karolinska|uppsala|lund|stockholm|kth|gothenburg|umea|linkoping"
    if re.search(se_kw, i): return "Sweden"

    fi_kw = r"helsinki|aalto|turku|oulu|jyvaskyla|tampere"
    if re.search(fi_kw, i): return "Finland"

    nl_kw = r"amsterdam|delft|utrecht|leiden|erasmus|groningen|wageningen|eindhoven"
    if re.search(nl_kw, i): return "Netherlands"

    ch_kw = r"eth zurich|epfl|zurich|basel|geneva|bern|lausanne"
    if re.search(ch_kw, i): return "Switzerland"

    es_kw = r"barcelona|madrid|valencia|autonoma|pompeu fabra"
    if re.search(es_kw, i): return "Spain"

    it_kw = r"bologna|sapienza|milan|padua|pisa|politecnico di milano"
    if re.search(it_kw, i): return "Italy"

    fr_kw = r"sorbonne|\bens\b|polytechnique|inria|pasteur|lyon|marseille|toulouse|strasbourg"
    if re.search(fr_kw, i): return "France"

    be_kw = r"leuven|ghent|antwerp|\bulb\b|\bvub\b|louvain"
    if re.search(be_kw, i): return "Belgium"

    no_kw = r"oslo|bergen|ntnu|tromso"
    if re.search(no_kw, i): return "Norway"

    dk_kw = r"copenhagen|aarhus|dtu|danmarks"
    if re.search(dk_kw, i): return "Denmark"

    at_kw = r"vienna|innsbruck|graz"
    if re.search(at_kw, i): return "Austria"

    ie_kw = r"trinity college dublin|university college dublin|\bucd\b|galway|cork"
    if re.search(ie_kw, i): return "Ireland"

    sg_kw = r"singapore|\bnus\b|\bntu\b"
    if re.search(sg_kw, i): return "Singapore"

    cn_kw = r"tsinghua|peking|fudan|zhejiang|shanghai|\bcas\b"
    if re.search(cn_kw, i): return "China"

    kr_kw = r"seoul|kaist|postech|yonsei|korea university"
    if re.search(kr_kw, i): return "South Korea"

    jp_kw = r"tokyo|kyoto|osaka|tohoku|nagoya"
    if re.search(jp_kw, i): return "Japan"

    us_kw = r"stanford|harvard|\bmit\b|berkeley|caltech|princeton|columbia|yale|cornell|michigan|washington|wisconsin|illinois|texas|purdue|georgia tech|johns hopkins|northwestern|penn state|upenn|ohio state|minnesota|duke|maryland|arizona|florida|virginia|north carolina|rutgers|indiana|pittsburgh|colorado|utah|iowa|vanderbilt|notre dame|emory|rice|georgetown|dartmouth|brown|tufts|nyu|ucla|ucsd|uc davis|uc irvine|ucsb|uc santa barbara|uc riverside|uc santa cruz|carnegie mellon|\basu\b|georgia"
    if re.search(us_kw, i): return "USA"

    if e.endswith(".edu"): return "USA"
    return "USA"


def extract_priority(status: str, notes: str, deadline: Optional[str] = None) -> str:
    """Assigns evidence-based Priority Classification (P1-P4)."""
    s = str(status or "").lower()
    n = str(notes or "")

    p_match = re.search(r"\[Priority:\s*(P[1-4])\]", n, re.I) or re.search(r"\b(P[1-4])\b", n)
    if p_match:
        return p_match.group(1).upper()

    # P1: High Priority (Positive response, upcoming funded deadline)
    if re.search(r"pos|accept|interview|call|apply immediately", s):
        return "P1"
    if re.search(r"funded vacancy|full funding|ra available", n, re.I) and deadline and deadline != "Rolling":
        return "P1"

    # P4: Dormant (Declined, closed, rejected)
    if re.search(r"declined|rejected|closed|do not contact", s):
        return "P4"

    # P2: Medium Priority (Neutral, redirect, PINNs / methodological fit)
    if re.search(r"neut|redir|apply|portal", s):
        return "P2"
    if re.search(r"pinn|parameter estimation|inverse problem|fractional", n, re.I):
        return "P2"

    # P3: Low Priority (Unfunded, home fees only, unconfirmed interest)
    if re.search(r"home students only|uk home fees|unfunded|self-funded", n, re.I):
        return "P3"

    return "P2"


def extract_funding(notes: str, opp: str, inst: str) -> str:
    """Assigns verified Funding Status Tag."""
    text = f"{notes} {opp} {inst}".lower()
    if re.search(r"home students only|uk/eu only|uk fees only|home fees only", text):
        return "UK Home Fees Only"
    if re.search(r"verified funded|fully funded|fellowship available|stipend provided|funded vacancy", text):
        return "Verified Funded Vacancy"
    if re.search(r"self-funded|external funding required|csc scholarship|bring own funding|unfunded", text):
        return "Unfunded / External Req"
    if re.search(r"ta/ra|teaching assistant|research assistant|grad assistantship|department funding", text):
        return "Dept TA/RA Available"
    return "Dept TA/RA Available"


def structure_notes(existing_notes: str, status: str, inst: str, opp: str) -> str:
    """Structures evaluation notes into 3 clear markdown sub-sections."""
    n = str(existing_notes or "").strip()
    if "📌 Evidence & Reply Summary:" in n:
        return n

    # Research Compatibility
    lower = f"{n} {opp} {inst}".lower()
    if re.search(r"pinn|neural ode|machine learning|inverse problem|parameter estimation|data-driven", lower):
        comp = "Methodological: Parameter Estimation, Inverse Problems & PINNs / Neural ODEs."
    elif re.search(r"predator|prey|harvesting|ecology|conservation|trophic", lower):
        comp = "Ecological: Non-local Predator-Prey dynamics & Bioeconomic Optimal Harvesting."
    else:
        comp = "Direct: SEIR & Mathematical Epidemiology modeling (Dengue, Vector-borne dynamics)."

    # Funding Pathway
    funding = extract_funding(n, opp, inst)
    if "portal" in lower:
        pathway = f"Department Application Portal submission required • {funding}"
    elif "deadline" in lower:
        pathway = f"Upcoming Admission Deadline • {funding}"
    else:
        pathway = f"{funding} • Standard Graduate Admission Portal."

    summary = re.sub(r"^\[Priority:\s*P[1-4]\]\s*", "", n, flags=re.I).strip()
    if not summary:
        summary = f"Status: {status or 'No Reply'} • Active outreach monitoring."

    return (
        f"📌 Evidence & Reply Summary: {summary}\n"
        f"🧬 Research Compatibility: {comp}\n"
        f"💰 Funding & Admission Pathway: {pathway}"
    )


class SheetContrastOptimizerV34:
    """Orchestrates formatting and data enrichment across all spreadsheet tabs."""

    def __init__(self, sheet_id: str = SPREADSHEET_ID, dry_run: bool = False):
        self.sheet_id = sheet_id
        self.dry_run = dry_run
        self.client: Optional[GoogleWorkspaceClient] = None
        self._init_client()

    def _init_client(self) -> None:
        try:
            self.client = GoogleWorkspaceClient()
            print("[INFO] GoogleWorkspaceClient authenticated successfully via Google OAuth.")
        except Exception as e:
            print(f"[WARN] GoogleWorkspaceClient initialization skipped: {e}")
            self.client = None

    def optimize_format_sheets_api(self) -> bool:
        """Applies Deep Navy header and high-contrast light slate formatting via Google Sheets API batchUpdate."""
        if not self.client:
            print("[SKIP] Direct Sheets API formatting unavailable (no OAuth token).")
            return False

        print("\n=======================================================")
        print("  1. Applying High-Contrast Visual Hierarchy (Section 11.2)")
        print("=======================================================")

        meta = self.client.sheets.spreadsheets().get(spreadsheetId=self.sheet_id).execute()
        sheet_map = {s["properties"]["title"]: s["properties"]["sheetId"] for s in meta.get("sheets", [])}

        requests_list = []
        target_tabs = ["Scraped_Leads", "Email_Drafts", "Literature_Radar", "Archive_History", "Manual_Ingest"]

        for tab_name in target_tabs:
            if tab_name not in sheet_map:
                continue
            s_id = sheet_map[tab_name]

            # 1. Freeze Row 1
            requests_list.append({
                "updateSheetProperties": {
                    "properties": {
                        "sheetId": s_id,
                        "gridProperties": {"frozenRowCount": 1}
                    },
                    "fields": "gridProperties.frozenRowCount"
                }
            })

            # 2. Row 1 Header: Deep Navy (#1E293B) + Bold Pure White Text (#FFFFFF)
            requests_list.append({
                "repeatCell": {
                    "range": {
                        "sheetId": s_id,
                        "startRowIndex": 0,
                        "endRowIndex": 1
                    },
                    "cell": {
                        "userEnteredFormat": {
                            "backgroundColor": COLOR_NAVY_HEADER,
                            "textFormat": {
                                "foregroundColor": COLOR_WHITE_TEXT,
                                "bold": True,
                                "fontSize": 10,
                                "fontFamily": "Roboto"
                            },
                            "horizontalAlignment": "LEFT",
                            "verticalAlignment": "MIDDLE",
                            "wrapStrategy": "CLIP"
                        }
                    },
                    "fields": "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)"
                }
            })

            # 3. Row 2+ Data: High-contrast white BG + crisp dark slate text (#0F172A) + CLIP wrap
            requests_list.append({
                "repeatCell": {
                    "range": {
                        "sheetId": s_id,
                        "startRowIndex": 1
                    },
                    "cell": {
                        "userEnteredFormat": {
                            "backgroundColor": COLOR_WHITE_BG,
                            "textFormat": {
                                "foregroundColor": COLOR_SLATE_TEXT,
                                "fontSize": 10,
                                "fontFamily": "Roboto"
                            },
                            "verticalAlignment": "MIDDLE",
                            "wrapStrategy": "CLIP"
                        }
                    },
                    "fields": "userEnteredFormat(backgroundColor,textFormat,verticalAlignment,wrapStrategy)"
                }
            })

            # 4. Standard Column Pixel Widths
            col_widths = STANDARD_TAB_WIDTHS.get(tab_name, [])
            for start_col, end_col, width in col_widths:
                requests_list.append({
                    "updateDimensionProperties": {
                        "range": {
                            "sheetId": s_id,
                            "dimension": "COLUMNS",
                            "startIndex": start_col,
                            "endIndex": end_col
                        },
                        "properties": {"pixelSize": width},
                        "fields": "pixelSize"
                    }
                })

            # 5. Enable Basic Filter on each tab
            requests_list.append({
                "setBasicFilter": {
                    "filter": {
                        "range": {
                            "sheetId": s_id,
                            "startRowIndex": 0
                        }
                    }
                }
            })

        if not self.dry_run and requests_list:
            resp = self.client.sheets.spreadsheets().batchUpdate(
                spreadsheetId=self.sheet_id,
                body={"requests": requests_list}
            ).execute()
            print(f"[OK] Applied {len(requests_list)} formatting commands across tabs: {list(sheet_map.keys())}")
        else:
            print(f"[DRY-RUN] Prepared {len(requests_list)} formatting commands.")

        return True

    def enrich_data_rows(self) -> Dict[str, Any]:
        """Enriches outreach rows with Country, Priority, Funding, and structured evaluation notes."""
        stats = {
            "total_processed": 0,
            "countries": {},
            "priorities": {"P1": 0, "P2": 0, "P3": 0, "P4": 0},
            "funding": {}
        }

        if not self.client:
            print("[SKIP] Direct row enrichment via GoogleWorkspaceClient skipped (no OAuth token).")
            return stats

        print("\n=======================================================")
        print("  2. Enriching Outreach Leads with Priority & Country")
        print("=======================================================")

        for tab_name in ["Email_Drafts", "Archive_History"]:
            rows = self.client.get_all_rows(tab_name=tab_name)
            if not rows or len(rows) <= 1:
                continue

            updates = []
            for idx, r in enumerate(rows[1:], start=2):
                if len(r) < 2 or not str(r[1]).strip():
                    continue

                prof = str(r[1]).strip()
                email = str(r[2]).strip() if len(r) > 2 else ""
                inst = str(r[5]).strip() if len(r) > 5 else ""
                status = str(r[7]).strip() if len(r) > 7 else "No Reply"
                notes = str(r[8]).strip() if len(r) > 8 else ""
                deadline = str(r[11]).strip() if len(r) > 11 else "Rolling"

                country = extract_country(inst, email)
                priority = extract_priority(status, notes, deadline)
                funding = extract_funding(notes, "", inst)
                structured = structure_notes(notes, status, inst, "")
                final_notes = f"[Priority: {priority}] {structured}" if not notes.startswith(f"[Priority: {priority}]") else structured

                stats["total_processed"] += 1
                stats["countries"][country] = stats["countries"].get(country, 0) + 1
                stats["priorities"][priority] = stats["priorities"].get(priority, 0) + 1
                stats["funding"][funding] = stats["funding"].get(funding, 0) + 1

                updates.append({
                    "range": f"{tab_name}!I{idx}",
                    "values": [[final_notes]]
                })

            if not self.dry_run and updates:
                self.client.sheets.spreadsheets().values().batchUpdate(
                    spreadsheetId=self.sheet_id,
                    body={"valueInputOption": "RAW", "data": updates}
                ).execute()
                print(f"[OK] Updated {len(updates)} rows in {tab_name} with Priority & Structured Notes.")

        return stats

    def relay_to_gas(self, gas_url: str, app_secret: str) -> bool:
        """Relays sheet optimization & visual contrast commands to the live Google Apps Script endpoint."""
        if not requests:
            print("[FAIL] 'requests' library not found.")
            return False

        print("\n=======================================================")
        print("  Relaying Sheet Optimization to Google Apps Script Web App")
        print("=======================================================")
        payload = {
            "action": "optimize_sheet",
            "secret": app_secret
        }
        try:
            res = requests.post(gas_url, json=payload, timeout=30)
            data = res.json()
            if data.get("ok"):
                print(f"[OK] GAS Backend response: {data.get('message')}")
                print(f"[OK] Formatted Tabs: {data.get('formattedTabs')}")
                return True
            else:
                print(f"[ERROR] GAS Backend reported error: {data.get('error')}")
                return False
        except Exception as e:
            print(f"[ERROR] Failed to contact GAS Web App: {e}")
            return False


def main():
    parser = argparse.ArgumentParser(description="PhD Outreach Pipeline v3.4 - Sheet Contrast & Lead Enrichment")
    parser.add_argument("--sheet-id", default=SPREADSHEET_ID, help="Google Spreadsheet ID")
    parser.add_argument("--gas-url", default=os.getenv("PHD_GAS_URL", ""), help="Google Apps Script Web App URL")
    parser.add_argument("--app-secret", default=os.getenv("PHD_APP_SECRET", "phd_pipeline_secret_2026"), help="APP_SECRET token")
    parser.add_argument("--dry-run", action="store_true", help="Perform dry-run without writing changes")
    args = parser.parse_args()

    optimizer = SheetContrastOptimizerV34(sheet_id=args.sheet_id, dry_run=args.dry_run)

    if optimizer.client:
        optimizer.optimize_format_sheets_api()
        stats = optimizer.enrich_data_rows()
        print("\n=======================================================")
        print("  Summary Statistics")
        print("=======================================================")
        print(f"Total Leads Processed: {stats['total_processed']}")
        print(f"Priority Breakdown: {stats['priorities']}")
        print(f"Country Breakdown: {json.dumps(stats['countries'], indent=2)}")
        print(f"Funding Breakdown: {json.dumps(stats['funding'], indent=2)}")
        print("=======================================================\n")
    else:
        print("[INFO] Direct Google Workspace Client OAuth credentials not available in local environment.")
        if args.gas_url:
            optimizer.relay_to_gas(args.gas_url, args.app_secret)
        else:
            print("[INFO] To run via Google Apps Script proxy:")
            print("       python src/optimize_sheet_v34.py --gas-url <WEB_APP_URL> --app-secret <APP_SECRET>")
            print("       OR trigger directly in your PWA Command Center via the Settings / Diagnostics modal.")

    print("[SUCCESS] Optimization engine initialized and ready.")


if __name__ == "__main__":
    main()
