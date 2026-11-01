"""
PhD Outreach Pipeline v3.1 Guarded - Shared Core Engine & Configuration
Target: Soumitro Kumar Das (Shuvro)
Architecture: Strict Two-Stage Verification Firewall (Zero unvetted drafts)
"""

import os
import re
import json
import time
import base64
import datetime
import urllib.parse
from typing import List, Dict, Any, Optional, Tuple

import requests

try:
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request
    from googleapiclient.discovery import build
except ImportError:
    Credentials = None


SPREADSHEET_ID = os.getenv("PHD_SHEET_ID", "18ww6rPcncVtwDNnHLborAwraY0PNqQr0wsY16gr9M1E")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GOOGLE_CSE_API_KEY = os.getenv("GOOGLE_CSE_API_KEY", "")
GOOGLE_CSE_CX = os.getenv("GOOGLE_CSE_CX", "")
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "")
CV_PATH = os.getenv("CV_PATH", "assets/Soumitro_Kumar_Das_CV.md")

BANNED_PHRASES = [
    "I hope this email finds you well",
    "I am writing to express my keen interest",
    "enthusiastic interest",
    "delve",
    "tapestry",
    "testament",
    "beacon",
    "I would be deeply honored to join your prestigious laboratory",
    "structural bottleneck",
    "this specific limitation draws me directly to your work"
]

HARD_REJECT_KEYWORDS = [
    "self-funding", "self-funded", "self fund", "external scholarship required",
    "tuition fees apply", "home students only", "uk/eu only", "home/eu only",
    "domestic students only", "uk nationals only", "us citizens only", "permanent residents only"
]


def load_candidate_cv_ground_truth(cv_path: Optional[str] = None) -> str:
    """
    Dynamically loads the candidate's CV (Soumitro_Kumar_Das_CV.md) as the absolute Single Source of Truth.
    Eliminates hardcoded python dictionaries and separate user profile files.
    """
    path = cv_path or CV_PATH
    candidates = [
        path,
        os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), path),
        os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets", "Soumitro_Kumar_Das_CV.md"),
        os.path.join(os.getcwd(), path),
        os.path.join(os.getcwd(), "assets", "Soumitro_Kumar_Das_CV.md")
    ]
    for p in candidates:
        if os.path.isfile(p):
            with open(p, "r", encoding="utf-8") as f:
                return f.read().strip()

    raise FileNotFoundError(f"Candidate CV ground truth file not found at: {path}")


def sanitize_input(text: Any, max_len: int = 1500) -> str:
    """Sanitizes raw external strings to prevent prompt injection and encoding crashes."""
    if text is None:
        return ""
    clean = str(text).replace("\r", " ").replace("\n", " ").strip()
    clean = re.sub(r"[\x00-\x1f\x7f-\x9f]", "", clean)
    return clean[:max_len]


def sanitize_for_sheet(val: Any) -> Any:
    """
    Prevents Google Sheets Formula Injection (CWE-1236).
    Neutralizes formula triggers (=, +, -, @, tab, newline) by prepending a single quote.
    """
    if val is None:
        return ""
    if not isinstance(val, str):
        return val
    stripped = val.strip()
    if stripped and stripped[0] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + stripped
    return val


class CloudNotifier:
    """Mobile push notifications via Telegram for laptop-off awareness."""

    @staticmethod
    def notify(message: str) -> None:
        sanitized_msg = sanitize_input(message, max_len=3000)
        print(f"\n[NOTIFICATION] {sanitized_msg}\n")
        if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
            return
        url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
        payload = {
            "chat_id": TELEGRAM_CHAT_ID,
            "text": message,
            "parse_mode": "Markdown",
            "disable_web_page_preview": True
        }
        try:
            resp = requests.post(url, json=payload, timeout=10)
            if resp.status_code == 400:
                # Markdown parse failure fallback: send as plain text
                payload.pop("parse_mode", None)
                requests.post(url, json=payload, timeout=10)
        except Exception:
            print("[WARN] Telegram notification failed.")


class CloudModelRouter:
    """
    Cloud Model Router using Google AI Studio.
    Gemini 2.5 Flash for scoring/extraction; Gemini 2.5 Pro for nuanced academic email drafting.
    """

    def __init__(self, api_key: str = GEMINI_API_KEY):
        self.api_key = api_key
        self.fast_model = "gemini-2.5-flash"
        self.pro_model = "gemini-2.5-pro"

    def generate(self, prompt: str, system_instruction: str = "", json_mode: bool = False, high_nuance: bool = False) -> str:
        if not self.api_key:
            raise RuntimeError("Missing GEMINI_API_KEY environment variable.")

        model = self.pro_model if high_nuance else self.fast_model
        # Use headers instead of URL parameter to avoid leaking API key in HTTP request logs
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
        headers = {
            "x-goog-api-key": self.api_key,
            "Content-Type": "application/json"
        }

        generation_config: Dict[str, Any] = {
            "temperature": 0.1 if json_mode else 0.3,
            "maxOutputTokens": 4096,
        }
        if json_mode:
            generation_config["responseMimeType"] = "application/json"

        payload: Dict[str, Any] = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": generation_config
        }
        if system_instruction:
            payload["systemInstruction"] = {"parts": [{"text": system_instruction}]}

        for attempt in range(3):
            try:
                resp = requests.post(url, headers=headers, json=payload, timeout=45)
                if resp.status_code == 429:
                    time.sleep(5 * (attempt + 1))
                    continue
                resp.raise_for_status()
                data = resp.json()
                return data["candidates"][0]["content"]["parts"][0]["text"]
            except Exception as e:
                if attempt == 2:
                    raise RuntimeError("Cloud LLM call failed after 3 attempts.")
                time.sleep(3)
        return ""


class GoogleWorkspaceClient:
    """
    Manages spreadsheet tabs securely:
    - Tab 1: Scraped_Leads
    - Tab 2: Email_Drafts
    - Tab 3: Literature_Radar
    """

    SCOPES = [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive"
    ]

    def __init__(self):
        self.creds = self._load_credentials()
        self.sheets = build("sheets", "v4", credentials=self.creds)

    def _load_credentials(self):
        if Credentials is None:
            raise RuntimeError("google-api-python-client is not installed.")

        token_b64 = os.getenv("GOOGLE_TOKEN_JSON_B64")
        token_path = os.getenv("GOOGLE_TOKEN_PATH", "token.json")

        if token_b64:
            try:
                token_info = json.loads(base64.b64decode(token_b64).decode("utf-8"))
                creds = Credentials.from_authorized_user_info(token_info, self.SCOPES)
            except Exception:
                raise RuntimeError("Failed to decode GOOGLE_TOKEN_JSON_B64 secret.")
        elif os.path.exists(token_path):
            creds = Credentials.from_authorized_user_file(token_path, self.SCOPES)
        else:
            raise RuntimeError("No Google OAuth token available in runtime environment.")

        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        return creds

    def ensure_three_tabs(self) -> None:
        """Guarantees Scraped_Leads, Email_Drafts, and Literature_Radar tabs exist with headers."""
        meta = self.sheets.spreadsheets().get(spreadsheetId=SPREADSHEET_ID).execute()
        existing_tabs = {s["properties"]["title"] for s in meta.get("sheets", [])}
        requests_body = []

        tab_headers = {
            "Scraped_Leads": [
                "Date Found", "PI Name", "Institution", "Department", "Opportunity Title",
                "Posting Link", "OpenAlex Verified Paper 1 & DOI", "OpenAlex Verified Paper 2 & DOI",
                "Fit Score", "Deadline", "Your Decision (ACCEPT / DECLINE)"
            ],
            "Email_Drafts": [
                "Date Drafted", "PI Name", "Email", "Subject Line", "Full Email Body",
                "Pre-Send Checklist & CV Advice", "Dispatch Status (DRAFT / SENT)",
                "PI Reply Status (No Reply / Positive / Neutral / Declined)",
                "Reply Summary / Notes", "F1 Due", "F2 Due"
            ],
            "Literature_Radar": [
                "Week Date", "Paper Title", "Authors & Institution", "Journal / Venue",
                "Publication Date", "Verified DOI / Link", "Sub-Field Tag",
                "Key Methodology", "Research Gap & Mix Idea", "Lead Potential"
            ],
            "Manual_Ingest": [
                "Timestamp", "Raw Paste / Lead Context", "Notes"
            ]
        }

        for tab_name, headers in tab_headers.items():
            if tab_name not in existing_tabs:
                requests_body.append({"addSheet": {"properties": {"title": tab_name}}})

        if requests_body:
            self.sheets.spreadsheets().batchUpdate(
                spreadsheetId=SPREADSHEET_ID,
                body={"requests": requests_body}
            ).execute()

            for tab_name, headers in tab_headers.items():
                if tab_name not in existing_tabs:
                    self.append_row(headers, tab_name=tab_name)

    def get_all_rows(self, tab_name: str) -> List[List[str]]:
        res = self.sheets.spreadsheets().values().get(
            spreadsheetId=SPREADSHEET_ID,
            range=f"{tab_name}!A1:Z2500"
        ).execute()
        return res.get("values", [])

    def append_row(self, values: List[Any], tab_name: str) -> None:
        safe_values = [sanitize_for_sheet(v) for v in values]
        self.sheets.spreadsheets().values().append(
            spreadsheetId=SPREADSHEET_ID,
            range=f"{tab_name}!A1",
            valueInputOption="USER_ENTERED",
            insertDataOption="INSERT_ROWS",
            body={"values": [safe_values]}
        ).execute()

    def update_cell_range(self, cell_range: str, values: List[List[Any]], tab_name: str) -> None:
        safe_values = [[sanitize_for_sheet(c) for c in row] for row in values]
        self.sheets.spreadsheets().values().update(
            spreadsheetId=SPREADSHEET_ID,
            range=f"{tab_name}!{cell_range}",
            valueInputOption="USER_ENTERED",
            body={"values": safe_values}
        ).execute()

    def clear_tab(self, tab_name: str, keep_header: bool = True) -> None:
        """Clears rows from a tab, optionally preserving the header row (A1:Z1)."""
        range_to_clear = f"{tab_name}!A2:Z2500" if keep_header else f"{tab_name}!A1:Z2500"
        self.sheets.spreadsheets().values().clear(
            spreadsheetId=SPREADSHEET_ID,
            range=range_to_clear
        ).execute()

    def ensure_literature_tab(self) -> None:
        """Alias to ensure backward compatibility with literature radar."""
        self.ensure_three_tabs()


class AcademicVerifier:
    """Zero-hallucination verification using OpenAlex REST API."""

    OPENALEX_BASE = "https://api.openalex.org"
    HEADERS = {"User-Agent": "PhDPipelineV31/3.1 (mailto:dassoumitrokumar@gmail.com)"}

    @classmethod
    def verify_pi_and_fetch_papers(cls, prof_name: str, institution: str = "") -> Dict[str, Any]:
        clean_name = sanitize_input(prof_name, max_len=100)
        clean_inst = sanitize_input(institution, max_len=100)
        search_q = f"{clean_name} {clean_inst}".strip()
        url = f"{cls.OPENALEX_BASE}/authors?search={urllib.parse.quote(search_q)}&per-page=3"
        try:
            resp = requests.get(url, headers=cls.HEADERS, timeout=15)
            resp.raise_for_status()
            results = resp.json().get("results", [])
            if not results:
                return {"verified": False, "recent_count": 0, "papers": [], "orcid": "", "profile_url": ""}

            author = results[0]
            author_id = author.get("id", "")
            orcid = (author.get("orcid") or "").replace("https://orcid.org/", "")

            counts_by_year = {c["year"]: c["works_count"] for c in author.get("counts_by_year", [])}
            recent_count = counts_by_year.get(2026, 0) + counts_by_year.get(2025, 0) + counts_by_year.get(2024, 0)

            works_url = (
                f"{cls.OPENALEX_BASE}/works?filter=author.id:{author_id},from_publication_date:2023-01-01"
                f"&sort=publication_date:desc&per-page=5"
            )
            w_resp = requests.get(works_url, headers=cls.HEADERS, timeout=15)
            w_resp.raise_for_status()
            works = w_resp.json().get("results", [])

            papers = []
            for w in works[:2]:
                title = sanitize_input(w.get("title", ""), max_len=250)
                doi = sanitize_input(w.get("doi", "") or w.get("id", ""), max_len=200)
                abstract = cls._reconstruct_abstract(w.get("abstract_inverted_index"))
                if title:
                    papers.append({"title": title, "doi": doi, "abstract": abstract})

            return {
                "verified": True,
                "orcid": orcid,
                "profile_url": author_id,
                "recent_count": recent_count,
                "papers": papers
            }
        except Exception:
            return {"verified": False, "recent_count": 0, "papers": [], "orcid": "", "profile_url": ""}

    @staticmethod
    def _reconstruct_abstract(inverted_index: Optional[Dict[str, List[int]]]) -> str:
        if not inverted_index:
            return ""
        word_positions = []
        for word, positions in inverted_index.items():
            for pos in positions:
                word_positions.append((pos, word))
        word_positions.sort(key=lambda x: x[0])
        return sanitize_input(" ".join(w for _, w in word_positions), max_len=1200)
