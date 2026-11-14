/* ============================================================
   Announcements bell — ঘোষণা ও সংবাদ
   ------------------------------------------------------------
   A public, one-way feed. Every visitor sees the same items;
   nothing is stored per user, so it costs almost nothing.

   • Firestore collection: announcements/{id}
     fields: title, body, createdAt, url?, type?, active?
     Written from the Firebase console only (rules deny writes).
   • The bell shows a red dot when something is newer than the
     visitor's last-seen time (per browser, in localStorage).
   • The list is cached locally for 30 minutes, so repeat page
     loads cost zero Firestore reads and the panel works offline.
   • Injected like shelf-ui/mobile-nav: no page is ever edited.

   PREVIEW MODE (for local UI testing only):
   set localStorage.bicm_announce_preview to a JSON array of
   { id, title, body, createdAt(ms), url?, type? } and the panel
   renders that instead of Firestore. It only affects the browser
   that set it, so it can never touch real visitors.
   ============================================================ */

import { db } from "./firebase-config.js";
import {
    collection,
    query,
    orderBy,
    limit,
    getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const CACHE_KEY = "bicm_ann_cache_v1";
const SEEN_KEY = "bicm_ann_seen_v1";
const PREVIEW_KEY = "bicm_announce_preview";
const CACHE_TTL = 30 * 60 * 1000;   /* 30 minutes */
const MAX_ITEMS = 10;

const state = {
    items: null,      /* normalized list, newest first */
    ready: false,
    failed: false
};

const MONTHS_BN = [
    "জানুয়ারি", "ফেব্রুয়ারি", "মার্চ", "এপ্রিল", "মে", "জুন",
    "জুলাই", "আগস্ট", "সেপ্টেম্বর", "অক্টোবর", "নভেম্বর", "ডিসেম্বর"
];

/* ------------------------------------------------------------
   Small helpers
   ------------------------------------------------------------ */
function bn(number) {
    return String(number).replace(/\d/g, (digit) => "০১২৩৪৫৬৭৮৯"[Number(digit)]);
}

function readJson(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return fallback;
        const parsed = JSON.parse(raw);
        return parsed ?? fallback;
    } catch (error) {
        return fallback;
    }
}

function writeJson(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
        /* storage blocked — the bell simply never remembers */
    }
}

function timeOf(value) {
    if (!value) return 0;
    if (typeof value === "number") return value;
    if (typeof value.toMillis === "function") return value.toMillis();
    if (value instanceof Date) return value.getTime();
    if (typeof value.seconds === "number") return value.seconds * 1000;
    return 0;
}

function formatDate(ms) {
    if (!ms) return "";
    const date = new Date(ms);
    return `${bn(date.getDate())} ${MONTHS_BN[date.getMonth()]} ${bn(date.getFullYear())}`;
}

function normalize(doc) {
    const data = doc.data ? doc.data() : doc;
    const title = String(data.title || "").trim();
    if (!title) return null;

    const url = String(data.url || "").trim();
    return {
        id: doc.id || String(data.id || ""),
        title: title.slice(0, 140),
        body: String(data.body || "").trim().slice(0, 500),
        createdAt: timeOf(data.createdAt),
        url: /^https?:\/\//i.test(url) ? url : "",
        type: ["news", "notice", "offer"].includes(data.type) ? data.type : "news",
        active: data.active === false ? false : true
    };
}

function lastSeen() {
    return Number(readJson(SEEN_KEY, 0)) || 0;
}

function markAllSeen() {
    const newest = state.items && state.items.length
        ? Math.max(...state.items.map((item) => item.createdAt || 0), Date.now())
        : Date.now();
    writeJson(SEEN_KEY, newest);
    paintBell();
}

function hasUnread() {
    if (!state.items) return false;
    return state.items.some((item) => (item.createdAt || 0) > lastSeen());
}

/* ------------------------------------------------------------
   Data
   ------------------------------------------------------------ */
function readPreview() {
    const raw = readJson(PREVIEW_KEY, null);
    if (!Array.isArray(raw) || !raw.length) return null;
    const items = raw
        .map((item) => normalize({ id: String(item.id || item.title), ...item }))
        .filter(Boolean)
        .filter((item) => item.active)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, MAX_ITEMS);
    return items;
}

async function fetchAnnouncements() {
    /* Preview mode short-circuits Firestore entirely. */
    const preview = readPreview();
    if (preview) {
        state.items = preview;
        state.ready = true;
        paintBell();
        return;
    }

    const cached = readJson(CACHE_KEY, null);
    if (cached && Array.isArray(cached.items) &&
        Date.now() - cached.fetchedAt < CACHE_TTL) {
        state.items = cached.items;
        state.ready = true;
        paintBell();
        return;
    }

    try {
        const snapshot = await getDocs(
            query(
                collection(db, "announcements"),
                orderBy("createdAt", "desc"),
                limit(MAX_ITEMS * 2)
            )
        );

        state.items = snapshot.docs
            .map(normalize)
            .filter(Boolean)
            .filter((item) => item.active)
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, MAX_ITEMS);

        state.ready = true;
        state.failed = false;

        writeJson(CACHE_KEY, {
            fetchedAt: Date.now(),
            items: state.items
        });

        paintBell();
    } catch (error) {
        state.failed = true;
        state.ready = true;

        if (cached && Array.isArray(cached.items)) {
            state.items = cached.items;
            paintBell();
        } else {
            /* No rules / offline / nothing published yet — stay quiet. */
            state.items = [];
            paintBell();
        }

        console.warn("[announcements] load failed", error && error.code);
    }
}

/* ------------------------------------------------------------
   Injection
   ------------------------------------------------------------ */
const isAuthPage = document.body.classList.contains("auth-page");

let bellButton = null;
let bellDot = null;
let panelRoot = null;
let panelList = null;
let panelOpen = false;
let lastFocus = null;

function injectBell() {
    const container = document.querySelector(".header .container");
    if (!container) return;

    bellButton = document.createElement("button");
    bellButton.type = "button";
    bellButton.className = "bell-button";
    bellButton.setAttribute("aria-label", "ঘোষণা ও সংবাদ");
    bellButton.setAttribute("aria-haspopup", "dialog");
    bellButton.setAttribute("aria-expanded", "false");
    bellButton.title = "ঘোষণা ও সংবাদ";
    bellButton.hidden = true;   /* shown once data knows there is something */

    bellDot = document.createElement("span");
    bellDot.className = "bell-dot";
    bellDot.hidden = true;

    const icon = document.createElement("i");
    icon.className = "far fa-bell";
    icon.setAttribute("aria-hidden", "true");

    bellButton.append(icon, bellDot);

    const slot = container.querySelector(".auth-slot");
    const toggle = container.querySelector(".nav-toggle");
    container.insertBefore(bellButton, slot || toggle || null);

    bellButton.addEventListener("click", () => {
        if (panelOpen) closePanel();
        else openPanel();
    });

    buildPanel();
    paintBell();
}

function buildPanel() {
    panelRoot = document.createElement("div");
    panelRoot.className = "bell-root";
    panelRoot.hidden = true;
    panelRoot.innerHTML = `
        <div class="bell-backdrop" data-close></div>
        <section class="bell-panel" role="dialog" aria-modal="true"
                 aria-labelledby="bellPanelTitle">
            <header class="bell-head">
                <h2 id="bellPanelTitle">
                    <i class="fas fa-bullhorn" aria-hidden="true"></i> ঘোষণা ও সংবাদ
                </h2>
                <button type="button" class="bell-close" data-close aria-label="বন্ধ করুন">
                    <i class="fas fa-xmark" aria-hidden="true"></i>
                </button>
            </header>
            <div class="bell-list"></div>
        </section>`;

    document.body.appendChild(panelRoot);
    panelList = panelRoot.querySelector(".bell-list");

    panelRoot.addEventListener("click", (event) => {
        if (event.target.closest("[data-close]")) closePanel();
    });

    document.addEventListener("keydown", (event) => {
        if (!panelOpen) return;

        if (event.key === "Escape") {
            event.preventDefault();
            closePanel();
            return;
        }

        if (event.key !== "Tab") return;

        const focusable = Array.from(
            panelRoot.querySelectorAll('a[href], button:not([disabled])')
        ).filter((node) => node.offsetParent !== null);
        if (!focusable.length) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    });
}

/* ------------------------------------------------------------
   Painting
   ------------------------------------------------------------ */
function paintBell() {
    if (!bellButton) return;

    const items = state.items;

    /* Keep the header clean until there is something to show:
       not loaded yet, load failed with no cache, or zero items. */
    const show = Boolean(state.ready && items && items.length > 0);
    bellButton.hidden = !show;
    if (!show) return;

    const unread = hasUnread();
    bellDot.hidden = !unread;
    bellButton.querySelector("i").className = unread
        ? "fas fa-bell"
        : "far fa-bell";
}

function renderList() {
    panelList.innerHTML = "";

    if (!state.ready) {
        const loading = document.createElement("div");
        loading.className = "bell-loading";
        loading.appendChild(document.createElement("span"));
        loading.appendChild(document.createTextNode("লোড হচ্ছে..."));
        panelList.appendChild(loading);
        return;
    }

    const items = state.items || [];

    if (!items.length) {
        const empty = document.createElement("div");
        empty.className = "bell-empty";
        empty.innerHTML = '<i class="far fa-bell-slash" aria-hidden="true"></i>';
        empty.appendChild(Object.assign(document.createElement("p"), {
            className: "bell-empty-title",
            textContent: "কোনো ঘোষণা নেই"
        }));
        empty.appendChild(Object.assign(document.createElement("p"), {
            className: "bell-empty-text",
            textContent: "নতুন ঘোষণা বা সংবাদ এখানে দেখা যাবে।"
        }));
        panelList.appendChild(empty);
        return;
    }

    const fragment = document.createDocumentFragment();
    items.forEach((item) => {
        const row = document.createElement("article");
        row.className = "bell-item";

        const icon = document.createElement("span");
        icon.className = "bell-item-icon";
        icon.dataset.type = item.type;

        const icons = {
            news: "fa-bullhorn",
            notice: "fa-circle-info",
            offer: "fa-gift"
        };
        icon.innerHTML = `<i class="fas ${icons[item.type]}" aria-hidden="true"></i>`;

        const body = document.createElement("div");
        body.className = "bell-item-body";

        const title = document.createElement("h3");
        title.textContent = item.title;

        body.appendChild(title);

        if (item.body) {
            body.appendChild(Object.assign(document.createElement("p"), {
                textContent: item.body
            }));
        }

        const meta = document.createElement("div");
        meta.className = "bell-item-meta";

        const date = document.createElement("span");
        date.textContent = formatDate(item.createdAt);
        meta.appendChild(date);

        if (item.url) {
            const link = document.createElement("a");
            link.href = item.url;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            link.textContent = "বিস্তারিত পড়ুন";
            meta.appendChild(link);
        }

        body.appendChild(meta);
        row.append(icon, body);
        fragment.appendChild(row);
    });

    panelList.appendChild(fragment);
}

/* ------------------------------------------------------------
   Open / close
   ------------------------------------------------------------ */
function openPanel() {
    if (!panelRoot) return;
    lastFocus = document.activeElement;

    renderList();
    markAllSeen();

    panelRoot.hidden = false;
    panelOpen = true;
    bellButton.setAttribute("aria-expanded", "true");

    requestAnimationFrame(() => panelRoot.classList.add("is-open"));

    const close = panelRoot.querySelector(".bell-close");
    if (close) close.focus({ preventScroll: true });
}

function closePanel() {
    if (!panelOpen) return;
    panelOpen = false;

    panelRoot.classList.remove("is-open");
    bellButton.setAttribute("aria-expanded", "false");

    window.setTimeout(() => {
        if (!panelOpen && panelRoot) panelRoot.hidden = true;
    }, 260);

    if (lastFocus && typeof lastFocus.focus === "function") {
        lastFocus.focus({ preventScroll: true });
    }
}

/* ------------------------------------------------------------
   Boot
   ------------------------------------------------------------ */
if (!isAuthPage) {
    const start = () => {
        injectBell();
        fetchAnnouncements();
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", start, { once: true });
    } else {
        start();
    }
}
