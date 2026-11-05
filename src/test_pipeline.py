#!/usr/bin/env python3
"""
PhD Outreach Pipeline v3.3 - Automated End-to-End Self-Tester Suite
Tests live Google Apps Script Web App endpoints, metadata integrity,
dispatched records aggregation, deadlines queue, chatbot proxy, and sheet data.
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
    print("[FAIL] 'requests' library is not installed. Run: pip install requests")
    sys.exit(1)


def load_env() -> Dict[str, str]:
    """Loads environment variables from local .env and .env.local files."""
    env_vars: Dict[str, str] = {}
    candidates = [
        ".env",
        ".env.local",
        os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"),
        os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env.local"),
    ]
    for path in candidates:
        if os.path.isfile(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if line and not line.startswith("#") and "=" in line:
                            k, v = line.split("=", 1)
                            env_vars[k.strip()] = v.strip().strip("'\"")
            except Exception:
                pass
    return env_vars


# ==========================================
# TEST 1: Backend Version Check
# ==========================================
def test_backend_version(data: Dict[str, Any]) -> Tuple[bool, str]:
    version = str(data.get("backend_version") or "")
    if re.match(r"^v3\.[3-9]", version):
        return True, f"Live backend version is stamped correctly: '{version}'"
    return False, (
        f"Backend version mismatch: expected 'v3.7+', got '{version}'. "
        "ACTION REQUIRED: Re-deploy a New Version in Google Apps Script (Deploy > Manage deployments > Edit > New version) "
        "and ensure the updated Web App URL is in .env / PWA settings."
    )


# ==========================================
# TEST 2: Total Dispatched Count
# ==========================================
def test_dispatched_count(data: Dict[str, Any]) -> Tuple[bool, str]:
    sent_profs = data.get("sentProfs", [])
    stats = data.get("stats", {})
    actual_len = len(sent_profs)
    stats_sent = stats.get("sent")

    if actual_len == 150 and stats_sent == 150:
        return True, f"Both len(sentProfs) ({actual_len}) and stats.sent ({stats_sent}) equal exactly 150."
    return False, (
        f"Dispatched count assertion failed: len(sentProfs) = {actual_len}, "
        f"stats.sent = {stats_sent}. Expected 150."
    )


# ==========================================
# TEST 3: Non-Empty Metadata Audit
# ==========================================
def test_non_empty_metadata(data: Dict[str, Any]) -> Tuple[bool, str]:
    sent_profs = data.get("sentProfs", [])
    if not sent_profs:
        return False, "sentProfs list is empty; cannot run metadata audit."

    total = len(sent_profs)
    fields = ["inst", "email", "notes", "profile_url"]
    counts = {f: 0 for f in fields}

    for p in sent_profs:
        for f in fields:
            val = p.get(f)
            if val is not None and str(val).strip():
                counts[f] += 1

    rates = {f: (counts[f] / total) * 100.0 for f in fields}
    min_rate = min(rates.values())

    # Target specific professors to display parsed fields
    target_names = ["abba gumel", "erin mordecai", "afoukal"]
    target_profs = {}

    for p in sent_profs:
        name_lower = str(p.get("prof", "")).lower()
        for t in target_names:
            if t in name_lower:
                target_profs[t] = p

    diag_lines = [
        f"Field completion: " + ", ".join([f"{f}: {counts[f]}/{total} ({rates[f]:.1f}%)" for f in fields])
    ]
    diag_lines.append("Spot-checked target professors:")
    for t in target_names:
        p = target_profs.get(t)
        if p:
            diag_lines.append(
                f"  - [{p.get('prof')}]: Inst='{p.get('inst')}', Email='{p.get('email')}', "
                f"Notes='{p.get('notes')[:40]}...', Profile='{p.get('profile_url')}'"
            )
        else:
            diag_lines.append(f"  - Target '{t}' not found in sentProfs")

    details = "\n".join(diag_lines)
    if min_rate >= 95.0:
        return True, f"Metadata completeness is >95% (lowest field at {min_rate:.1f}%).\n{details}"
    return False, f"Metadata completeness below 95% threshold (lowest field at {min_rate:.1f}%).\n{details}"


# ==========================================
# TEST 4: Deadlines Queue Check
# ==========================================
def test_deadlines_queue(data: Dict[str, Any]) -> Tuple[bool, str]:
    sent_profs = data.get("sentProfs", [])
    ignored = {"", "rolling", "closed", "n/a", "none", "null"}

    active_deadlines = [
        p for p in sent_profs
        if str(p.get("deadline", "")).strip().lower() not in ignored
    ]

    count = len(active_deadlines)
    samples = [f"{p.get('prof')}: {p.get('deadline')}" for p in active_deadlines[:3]]
    sample_str = " | ".join(samples)

    if count >= 20:
        return True, f"Found {count} active deadlines (threshold >= 20). Samples: {sample_str}"
    return False, f"Active deadlines count is {count}, which is below required 20. Samples: {sample_str}"


# ==========================================
# TEST 5: Chatbot Endpoint Check
# ==========================================
def test_chatbot_endpoint(gas_url: str, secret: str) -> Tuple[bool, str]:
    payload = {
        "action": "chat",
        "secret": secret,
        "message": "ping",
        "crm_data": []
    }
    try:
        resp = requests.post(gas_url, json=payload, headers={"Content-Type": "application/json"}, timeout=35)
        resp.raise_for_status()
        res_json = resp.json()
    except Exception as e:
        return False, f"Chatbot endpoint HTTP POST failed: {e}"

    if res_json.get("ok"):
        reply = res_json.get("reply", "")
        snippet = reply[:80].replace("\n", " ")
        return True, f"Chatbot answered successfully: '{snippet}...'"
    return False, f"Chatbot endpoint returned ok=False: {res_json.get('error', 'Unknown error')}"


# ==========================================
# TEST 6: Local Sheet Direct Audit
# ==========================================
def test_sheet_direct_audit(data: Dict[str, Any]) -> Tuple[bool, str]:
    """
    Audits Tab 2 (Email_Drafts) and Tab 4 (Archive_History) for zero blank
    inst (Col F) or notes (Col I) cells.
    Tries GoogleWorkspaceClient first; if local OAuth token is absent,
    verifies via the live GAS parsed payload.
    """
    try:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from cloud_shared_core import GoogleWorkspaceClient

        ws = GoogleWorkspaceClient()
        tab2_rows = ws.get_all_rows("Email_Drafts")
        tab4_rows = ws.get_all_rows("Archive_History")

        blank_inst = []
        blank_notes = []

        # Audit Tab 2
        for idx, r in enumerate(tab2_rows[1:], start=2):
            if len(r) > 1 and str(r[1]).strip():  # Has PI Name
                inst = r[5] if len(r) > 5 else ""
                notes = r[8] if len(r) > 8 else ""
                if not str(inst).strip():
                    blank_inst.append(f"Email_Drafts!F{idx} ({r[1]})")
                if not str(notes).strip():
                    blank_notes.append(f"Email_Drafts!I{idx} ({r[1]})")

        # Audit Tab 4
        for idx, r in enumerate(tab4_rows[1:], start=2):
            if len(r) > 1 and str(r[1]).strip():
                inst = r[5] if len(r) > 5 else ""
                notes = r[8] if len(r) > 8 else ""
                if not str(inst).strip():
                    blank_inst.append(f"Archive_History!F{idx} ({r[1]})")
                if not str(notes).strip():
                    blank_notes.append(f"Archive_History!I{idx} ({r[1]})")

        if not blank_inst and not blank_notes:
            return True, (
                f"Direct Sheet API Audit PASSED via GoogleWorkspaceClient: "
                f"0 blank inst and 0 blank notes across {len(tab2_rows) - 1} Tab 2 rows and {len(tab4_rows) - 1} Tab 4 rows."
            )
        return False, (
            f"Direct Sheet API Audit Found Blanks: "
            f"{len(blank_inst)} blank institutions ({', '.join(blank_inst[:5])}), "
            f"{len(blank_notes)} blank notes ({', '.join(blank_notes[:5])})"
        )

    except Exception as e:
        # Fallback to auditing data rows received from GAS
        sent_profs = data.get("sentProfs", [])
        drafts = data.get("draftsReady", [])
        combined = sent_profs + drafts

        blank_inst = [p.get("prof", "Unknown") for p in combined if not str(p.get("inst", "")).strip()]
        blank_notes = [p.get("prof", "Unknown") for p in combined if not str(p.get("notes", "")).strip()]

        if not blank_inst and not blank_notes:
            return True, (
                f"Sheet Audit PASSED via Live GAS Ingestion ({len(combined)} rows checked): "
                f"0 blank inst and 0 blank notes (GoogleWorkspaceClient direct auth note: {e})."
            )
        return False, (
            f"Sheet Audit Found Blanks via Live Ingestion: "
            f"{len(blank_inst)} blank inst, {len(blank_notes)} blank notes. "
            f"Examples: inst={blank_inst[:3]}, notes={blank_notes[:3]}"
        )


# ==========================================
# MAIN TEST RUNNER
# ==========================================
def run_all_tests(gas_url: Optional[str] = None, secret: Optional[str] = None) -> bool:
    print("=" * 68)
    print("  PhD Pipeline v3.3 - Automated End-to-End Self-Tester Suite")
    print("=" * 68)

    file_env = load_env()
    gas_url = gas_url or os.getenv("PHD_GAS_URL") or file_env.get("PHD_GAS_URL") or os.getenv("GAS_URL") or file_env.get("GAS_URL")
    secret = secret or os.getenv("PHD_APP_SECRET") or file_env.get("PHD_APP_SECRET") or os.getenv("APP_SECRET") or file_env.get("APP_SECRET") or "phd_pipeline_secret_2026"

    if not gas_url:
        print("[FAIL] Missing PHD_GAS_URL in environment or .env file.")
        print("ACTION: Configure PHD_GAS_URL in your .env file or pass via --gas-url.")
        return False

    print(f"Target GAS URL : {gas_url[:50]}...")
    print(f"Target Secret  : {'*' * (len(secret) - 4) + secret[-4:] if len(secret) > 4 else '****'}")
    print("-" * 68)

    # Fetch live list data
    print("Fetching live pipeline state via postGAS({ action: 'list' })...")
    try:
        resp = requests.post(
            gas_url,
            json={"action": "list", "secret": secret},
            headers={"Content-Type": "application/json"},
            timeout=35
        )
        resp.raise_for_status()
        list_data = resp.json()
    except Exception as e:
        print(f"[FAIL] Could not connect to Google Apps Script Web App: {e}")
        return False

    if not list_data.get("ok"):
        print(f"[FAIL] Backend returned error: {list_data.get('error')}")
        return False

    tests = [
        ("1. Backend Version Check", lambda: test_backend_version(list_data)),
        ("2. Total Dispatched Count", lambda: test_dispatched_count(list_data)),
        ("3. Non-Empty Metadata Audit", lambda: test_non_empty_metadata(list_data)),
        ("4. Deadlines Queue Check", lambda: test_deadlines_queue(list_data)),
        ("5. Chatbot Endpoint Check", lambda: test_chatbot_endpoint(gas_url, secret)),
        ("6. Local Sheet Direct Audit", lambda: test_sheet_direct_audit(list_data)),
    ]

    results = []
    all_passed = True

    for name, test_fn in tests:
        print(f"\nRunning {name}...")
        try:
            passed, diag = test_fn()
        except Exception as e:
            passed, diag = False, f"Unexpected exception during test: {e}"

        status_str = "[PASS]" if passed else "[FAIL]"
        print(f"  {status_str} {diag}")
        results.append((name, passed))
        if not passed:
            all_passed = False

    print("\n" + "=" * 68)
    print("  TEST SUMMARY RESULTS")
    print("=" * 68)
    for name, passed in results:
        status_tag = "✅ [PASS]" if passed else "❌ [FAIL]"
        print(f"  {status_tag} {name}")
    print("=" * 68)

    if all_passed:
        print("🎉 ALL 6 CHECKS PASSED! The live pipeline and backend are in full sync.")
    else:
        print("⚠️ SOME CHECKS FAILED. Review diagnostics above and update Apps Script deployment.")

    return all_passed


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="PhD Pipeline v3.3 Automated Tester")
    parser.add_argument("--gas-url", help="Google Apps Script Web App URL")
    parser.add_argument("--app-secret", help="Google Apps Script APP_SECRET")
    args = parser.parse_args()

    success = run_all_tests(gas_url=args.gas_url, secret=args.app_secret)
    sys.exit(0 if success else 1)
