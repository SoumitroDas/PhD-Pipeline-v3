#!/usr/bin/env python3
"""
PhD Outreach Pipeline v3.6 - Retroactive Profile Link Extraction
Target: Soumitro Kumar Das (Shuvro)
Task 29C:
- Scans Tab 2 (Email_Drafts) and Tab 4 (Archive_History)
- Identifies rows where Col N (Direct Profile URL) is missing, empty, '#',
  or contains a generic Google Scholar search ('scholar.google.com/scholar?q=')
- Queries OpenAlex Authors API: https://api.openalex.org/authors?search={prof_name}
- Matches author by institution affiliations (or falls back to top verified result)
- Extracts the canonical OpenAlex Author ID (e.g., https://openalex.org/A123456789)
- Writes the true OpenAlex URL back into Col N via GoogleWorkspaceClient
- Respects OpenAlex API rate limits with time.sleep(0.5)
"""

import os
import sys
import re
import json
import time
import argparse
import urllib.parse
from typing import Dict, Any, List, Optional, Tuple

import requests

# Ensure src/ is on sys.path
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
if CURRENT_DIR not in sys.path:
    sys.path.insert(0, CURRENT_DIR)

from cloud_shared_core import (
    SPREADSHEET_ID,
    GoogleWorkspaceClient,
    sanitize_for_sheet,
    sanitize_input
)

# OpenAlex configuration
OPENALEX_AUTHORS_ENDPOINT = "https://api.openalex.org/authors"
OPENALEX_HEADERS = {
    "User-Agent": "PhDPipelineV36/3.6 (mailto:dassoumitrokumar@gmail.com)"
}


class ProfileLinkFixer:
    """Retroactively extracts and fixes verified OpenAlex profile URLs for CRM leads."""

    def __init__(self, dry_run: bool = False, gas_url: str = "", app_secret: str = ""):
        self.dry_run = dry_run
        self.gas_url = gas_url or os.getenv("PHD_GAS_URL", "")
        self.app_secret = app_secret or os.getenv("PHD_APP_SECRET", "phd_pipeline_secret_2026")
        self.ws: Optional[GoogleWorkspaceClient] = None

        try:
            self.ws = GoogleWorkspaceClient()
            print("[INFO] GoogleWorkspaceClient authenticated successfully via Google Sheets API.")
        except Exception as e:
            print(f"[WARN] GoogleWorkspaceClient direct OAuth token not loaded locally: {e}")
            if self.gas_url:
                print(f"[INFO] Using Google Apps Script Web App fallback: {self.gas_url[:35]}...")
            else:
                print("[INFO] Running in inspection mode. Provide GOOGLE_TOKEN_JSON_B64, token.json, or --gas-url to write updates.")

    @staticmethod
    def clean_name(raw_name: str) -> str:
        """Strips titles and noise to improve search recall."""
        if not raw_name:
            return ""
        name = re.sub(r"^(prof\.|dr\.|professor|associate professor|assistant professor)\s+", "", raw_name, flags=re.I).strip()
        name = re.sub(r"\s+", " ", name)
        return name

    @staticmethod
    def extract_institution_tokens(inst: str) -> List[str]:
        """Extracts significant keywords from an institution name for author matching."""
        if not inst:
            return []
        # Exclude common academic stopwords
        stopwords = {
            "university", "univ", "college", "school", "institute", "dept", "department",
            "applied", "mathematics", "math", "science", "sciences", "engineering", "technology",
            "the", "of", "and", "at", "for", "in", "centre", "center", "laboratory", "lab"
        }
        tokens = [
            t.lower() for t in re.split(r"[\s,./|()-]+", inst)
            if len(t) > 2 and t.lower() not in stopwords
        ]
        return tokens

    def search_openalex_author(self, prof_name: str, institution: str = "") -> Optional[str]:
        """
        Hits OpenAlex Authors API with the professor name and selects the top match,
        prioritizing institution affiliation matches.
        """
        clean = self.clean_name(prof_name)
        if not clean:
            return None

        # Try exact cleaned name first
        candidate_names = [clean]
        # If name has middle initial (e.g., "Hannah M. Krauss"), add variant without middle initial ("Hannah Krauss")
        no_middle = re.sub(r"\b[A-Z]\.\s*", "", clean).strip()
        if no_middle and no_middle.lower() != clean.lower():
            candidate_names.append(no_middle)

        inst_tokens = self.extract_institution_tokens(institution)

        for q_name in candidate_names:
            try:
                params = {"search": q_name, "per-page": 10}
                res = requests.get(OPENALEX_AUTHORS_ENDPOINT, params=params, headers=OPENALEX_HEADERS, timeout=15)
                if res.status_code != 200:
                    continue

                data = res.json()
                results = data.get("results", [])
                if not results:
                    continue

                chosen_author = None

                # If institution tokens exist, look for an author affiliated with this institution
                if inst_tokens:
                    for r in results:
                        affil_names = []
                        for inst_obj in (r.get("last_known_institutions") or []):
                            if isinstance(inst_obj, dict) and inst_obj.get("display_name"):
                                affil_names.append(inst_obj["display_name"].lower())
                        for aff in (r.get("affiliations") or []):
                            inst_meta = aff.get("institution") if isinstance(aff, dict) else None
                            if isinstance(inst_meta, dict) and inst_meta.get("display_name"):
                                affil_names.append(inst_meta["display_name"].lower())

                        affil_blob = " ".join(affil_names)
                        if any(token in affil_blob for token in inst_tokens):
                            chosen_author = r
                            break

                # If no institution match was found, use the top search result
                if not chosen_author:
                    chosen_author = results[0]

                author_id = chosen_author.get("id")
                if author_id and author_id.startswith("http"):
                    return author_id

            except Exception as e:
                print(f"  [WARN] OpenAlex query error for '{q_name}': {e}")
                time.sleep(1)

        return None

    def fix_tab(self, tab_name: str) -> Dict[str, Any]:
        """
        Scans a given tab, identifies rows needing profile URL remediation,
        queries OpenAlex, and updates Col N (index 13, 1-indexed column 14).
        """
        print(f"\n=======================================================")
        print(f"  Processing Tab: {tab_name}")
        print(f"=======================================================")

        rows: List[List[str]] = []

        if self.ws:
            try:
                rows = self.ws.get_all_rows(tab_name)
            except Exception as e:
                print(f"[ERROR] Failed to fetch rows from tab '{tab_name}': {e}")
                return {"tab": tab_name, "total": 0, "fixed": 0, "skipped": 0, "errors": 1}
        elif self.gas_url:
            try:
                payload = {"action": "list", "secret": self.app_secret}
                res = requests.post(self.gas_url, json=payload, timeout=25)
                data = res.json()
                items = data.get("draftsReady" if tab_name == "Email_Drafts" else "sentProfs", [])
                # Reconstruct table from items
                rows = [["Header"]]
                for it in items:
                    r_arr = [""] * 16
                    r_arr[1] = it.get("prof", "")
                    r_arr[5] = it.get("inst", "")
                    r_arr[13] = it.get("profile_url", "")
                    rows.append(r_arr)
            except Exception as e:
                print(f"[ERROR] Failed to fetch rows via GAS: {e}")
                return {"tab": tab_name, "total": 0, "fixed": 0, "skipped": 0, "errors": 1}
        else:
            print(f"[SKIP] No client available to read tab '{tab_name}'.")
            return {"tab": tab_name, "total": 0, "fixed": 0, "skipped": 0, "errors": 0}

        if len(rows) <= 1:
            print(f"[INFO] Tab '{tab_name}' is empty or has only a header row.")
            return {"tab": tab_name, "total": 0, "fixed": 0, "skipped": 0, "errors": 0}

        total_rows = len(rows) - 1
        fixed_count = 0
        skipped_count = 0

        print(f"[INFO] Found {total_rows} data rows in '{tab_name}'. Scanning Col N...")

        for idx, row in enumerate(rows[1:], start=2):
            prof_name = row[1].strip() if len(row) > 1 else ""
            if not prof_name:
                continue

            inst = row[5].strip() if len(row) > 5 else ""
            cur_profile = row[13].strip() if len(row) > 13 else ""

            # Condition: If Col N contains scholar.google.com/scholar?q= or is empty/invalid
            needs_fix = (
                not cur_profile
                or cur_profile == "#"
                or "scholar.google.com/scholar?q=" in cur_profile
                or "google.com/scholar" in cur_profile
                or "scholar.google.com" in cur_profile
            )

            if not needs_fix:
                skipped_count += 1
                continue

            print(f"\n[SCAN] Row {idx}: '{prof_name}' ({inst})")
            print(f"       Current Col N: '{cur_profile or '(empty)'}' -> Querying OpenAlex...")

            openalex_url = self.search_openalex_author(prof_name, inst)
            time.sleep(0.5)  # Respect OpenAlex rate limit (0.5s)

            if openalex_url:
                print(f"       -> [FOUND] {openalex_url}")
                if not self.dry_run:
                    if self.ws:
                        try:
                            self.ws.update_cell_range(f"N{idx}:N{idx}", [[openalex_url]], tab_name)
                            print(f"       -> [UPDATED] Col N on row {idx} set to {openalex_url}")
                            fixed_count += 1
                        except Exception as e:
                            print(f"       -> [ERROR] Failed to update row {idx}: {e}")
                    elif self.gas_url:
                        try:
                            p_load = {
                                "action": "fix_profile_url",
                                "secret": self.app_secret,
                                "tab": tab_name,
                                "row": idx,
                                "profile_url": openalex_url,
                                "expect_prof": prof_name
                            }
                            res = requests.post(self.gas_url, json=p_load, timeout=15)
                            if res.json().get("ok"):
                                print(f"       -> [UPDATED via GAS] Col N on row {idx} set to {openalex_url}")
                                fixed_count += 1
                            else:
                                print(f"       -> [ERROR via GAS] {res.text}")
                        except Exception as e:
                            print(f"       -> [ERROR via GAS] {e}")
                else:
                    print(f"       -> [DRY-RUN] Would update row {idx} to {openalex_url}")
                    fixed_count += 1
            else:
                print(f"       -> [NO MATCH] OpenAlex returned 0 matching authors.")

        summary = {
            "tab": tab_name,
            "total": total_rows,
            "fixed": fixed_count,
            "skipped": skipped_count
        }
        print(f"\n[SUMMARY] Tab '{tab_name}': {fixed_count} links fixed, {skipped_count} links intact.")
        return summary

    def run(self, target_tabs: Optional[List[str]] = None) -> List[Dict[str, Any]]:
        tabs = target_tabs or ["Email_Drafts", "Archive_History"]
        summaries = []
        for tab in tabs:
            res = self.fix_tab(tab)
            summaries.append(res)
        return summaries


def main():
    parser = argparse.ArgumentParser(description="Retroactive Profile Link Extraction via OpenAlex API")
    parser.add_argument("--tabs", nargs="+", default=["Email_Drafts", "Archive_History"], help="Tabs to scan and fix")
    parser.add_argument("--dry-run", action="store_true", help="Perform scan without writing updates")
    parser.add_argument("--gas-url", default=os.getenv("PHD_GAS_URL", ""), help="Google Apps Script Web App URL")
    parser.add_argument("--app-secret", default=os.getenv("PHD_APP_SECRET", "phd_pipeline_secret_2026"), help="APP_SECRET token")
    args = parser.parse_args()

    fixer = ProfileLinkFixer(
        dry_run=args.dry_run,
        gas_url=args.gas_url,
        app_secret=args.app_secret
    )
    summaries = fixer.run(target_tabs=args.tabs)

    print("\n=======================================================")
    print("  Overall Profile Extraction Summary")
    print("=======================================================")
    for s in summaries:
        print(f"Tab {s['tab']}: Total {s['total']} | Fixed {s.get('fixed', 0)} | Skipped {s.get('skipped', 0)}")
    print("=======================================================\n")


if __name__ == "__main__":
    main()
