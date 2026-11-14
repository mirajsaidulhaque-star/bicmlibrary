/* ============================================================
   Shelf UI — bookmark buttons, header badge, slide-in drawer
   ------------------------------------------------------------
   Runs on every page that loads auth.js (the shelf page itself
   keeps its own grid, so the drawer is skipped there).
   ============================================================ */

import { siteUrl } from "./firebase-config.js";
import {
    initStore,
    subscribe,
    getBooks,
    getUser,
    isSaved,
    toggleBook,
    removeBook,
    markReading,
    setStatus
} from "./shelf-store.js";

const STATUS_LABEL = {
    unread: "পড়া হয়নি",
    reading: "পড়ছি",
    done: "পড়া শেষ"
};

const isShelfPage = document.body.classList.contains("shelf-page");

initStore();

if (isShelfPage) {
    /* Grid handled by shelf-page.js */
} else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
} else {
    bootstrap();
}

let drawerRoot = null;
let drawerPanel = null;
let drawerBody = null;
let drawerFoot = null;
let drawerOpen = false;
let lastFocus = null;

/* ============================================================
   Boot
   ============================================================ */
function bootstrap() {
    injectCardButtons();
    subscribe(() => {
        paintButtons();
        updateHeader();
        if (drawerOpen) renderDrawer();
    });
    paintButtons();
    updateHeader();

    document.addEventListener("click", (event) => {
        const trigger = event.target.closest(".auth-shelf");
        if (!trigger) return;
        event.preventDefault();
        openDrawer();
    });

    document.addEventListener("bicm:auth-rendered", updateHeader);

    document.addEventListener("keydown", (event) => {
        if (!drawerOpen) return;

        if (event.key === "Escape") {
            event.preventDefault();
            closeDrawer();
            return;
        }

        if (event.key !== "Tab") return;

        const focusable = Array.from(
            drawerPanel.querySelectorAll('a[href], button:not([disabled])')
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

/* ============================================================
   Card metadata
   ============================================================ */
function pageInfo() {
    let category = "বাছাই করা বই";
    let slug = "home";

    const match = window.location.pathname.match(/\/catagory\/([^/]+)\.html$/i);
    if (match) slug = match[1].toLowerCase();

    const heading =
        document.querySelector("#category-title") ||
        document.querySelector(".category-banner h1");

    if (heading && match) {
        const clone = heading.cloneNode(true);
        clone.querySelectorAll("small").forEach((node) => node.remove());
        const text = clone.textContent.replace(/\s+/g, " ").trim();
        if (text) category = text;
    }

    return {
        category: category.slice(0, 80),
        categorySlug: slug.slice(0, 40)
    };
}

function driveIdFrom(url) {
    if (!url) return "";
    const match =
        url.match(/\/file\/d\/([A-Za-z0-9_-]{10,})/) ||
        url.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
    return match ? match[1] : "";
}

function fallbackId(seed) {
    let hash = 5381;
    const text = String(seed || "book");
    for (let index = 0; index < text.length; index += 1) {
        hash = ((hash << 5) + hash + text.charCodeAt(index)) >>> 0;
    }
    let id = `fb_${hash.toString(36)}`;
    while (id.length < 10) id += "0";
    return id.slice(0, 60);
}

function metaFor(card) {
    const readLink =
        card.querySelector(".btn-read") ||
        card.querySelector(".book-cover-link") ||
        card.querySelector('a[href*="drive.google.com"]');

    const readUrl = readLink ? readLink.href : "";
    const image = card.querySelector("img");
    const coverUrl = image ? image.src : "";
    const title = (card.querySelector(".title")?.textContent || "").replace(/\s+/g, " ").trim();
    const author = (card.querySelector(".author")?.textContent || "").replace(/\s+/g, " ").trim();
    const info = pageInfo();

    const id =
        driveIdFrom(readUrl) ||
        driveIdFrom(coverUrl) ||
        fallbackId(title || readUrl || coverUrl);

    return {
        id,
        title: (title || "শিরোনাম নেই").slice(0, 200),
        author: author.slice(0, 120),
        category: info.category,
        categorySlug: info.categorySlug,
        coverUrl: coverUrl.slice(0, 500),
        readUrl: readUrl.slice(0, 500),
        status: "unread"
    };
}

/* ============================================================
   Bookmark buttons on cards
   ============================================================ */
function injectCardButtons() {
    document.querySelectorAll(".book-card").forEach((card) => {
        if (card.dataset.shelfReady === "1") return;
        card.dataset.shelfReady = "1";
        card.classList.add("has-shelf");

        const meta = metaFor(card);

        const button = document.createElement("button");
        button.type = "button";
        button.className = "shelf-toggle";
        button.dataset.shelfBtn = "";
        button.dataset.bookId = meta.id;
        button.setAttribute("aria-pressed", "false");
        button.setAttribute("aria-label", "আমার বইয়ে যোগ করুন");
        button.innerHTML = '<i class="far fa-bookmark" aria-hidden="true"></i>';

        button.addEventListener("click", async (event) => {
            event.preventDefault();
            event.stopPropagation();
            await toggleBook(meta);
        });

        card.appendChild(button);
    });
}

function paintButtons() {
    document.querySelectorAll("[data-shelf-btn]").forEach((button) => {
        const saved = isSaved(button.dataset.bookId);
        button.classList.toggle("is-saved", saved);
        button.setAttribute("aria-pressed", String(saved));
        button.setAttribute("aria-label", saved ? "আমার বই থেকে সরান" : "আমার বইয়ে যোগ করুন");
        button.innerHTML = `<i class="${saved ? "fas" : "far"} fa-bookmark" aria-hidden="true"></i>`;
    });
}

/* ============================================================
   Header badge
   ============================================================ */
function bn(number) {
    return String(number).replace(/\d/g, (digit) => "০১২৩৪৫৬৭৮৯"[Number(digit)]);
}

function updateHeader() {
    const trigger = document.querySelector(".auth-slot .auth-shelf");
    if (!trigger) return;

    const user = getUser();
    const count = getBooks().length;

    trigger.hidden = !user && count === 0;

    let badge = trigger.querySelector(".auth-badge");
    if (count > 0) {
        if (!badge) {
            badge = document.createElement("span");
            badge.className = "auth-badge";
            trigger.appendChild(badge);
        }
        badge.textContent = count > 99 ? "৯৯+" : bn(count);
    } else if (badge) {
        badge.remove();
    }
}

/* ============================================================
   Drawer
   ============================================================ */
function ensureDrawer() {
    if (drawerRoot) return;

    drawerRoot = document.createElement("div");
    drawerRoot.className = "shelf-drawer-root";
    drawerRoot.hidden = true;
    drawerRoot.innerHTML = `
        <div class="shelf-drawer-backdrop" data-close></div>
        <aside class="shelf-drawer" role="dialog" aria-modal="true"
               aria-labelledby="shelfDrawerTitle">
            <header class="shelf-drawer-head">
                <h2 id="shelfDrawerTitle">
                    <i class="fas fa-bookmark" aria-hidden="true"></i> আমার বই
                </h2>
                <button type="button" class="shelf-drawer-close" data-close
                        aria-label="বন্ধ করুন">
                    <i class="fas fa-xmark" aria-hidden="true"></i>
                </button>
            </header>
            <div class="shelf-drawer-body"></div>
            <div class="shelf-drawer-foot"></div>
        </aside>`;

    document.body.appendChild(drawerRoot);

    drawerPanel = drawerRoot.querySelector(".shelf-drawer");
    drawerBody = drawerRoot.querySelector(".shelf-drawer-body");
    drawerFoot = drawerRoot.querySelector(".shelf-drawer-foot");

    drawerRoot.addEventListener("click", (event) => {
        if (event.target.closest("[data-close]")) closeDrawer();
    });
}

function openDrawer() {
    ensureDrawer();
    lastFocus = document.activeElement;
    renderDrawer();

    drawerRoot.hidden = false;
    document.body.classList.add("shelf-drawer-open");
    drawerOpen = true;

    requestAnimationFrame(() => drawerRoot.classList.add("is-open"));

    const close = drawerPanel.querySelector(".shelf-drawer-close");
    if (close) close.focus({ preventScroll: true });
}

function closeDrawer() {
    if (!drawerOpen) return;
    drawerOpen = false;

    drawerRoot.classList.remove("is-open");
    document.body.classList.remove("shelf-drawer-open");

    window.setTimeout(() => {
        if (!drawerOpen && drawerRoot) drawerRoot.hidden = true;
    }, 300);

    if (lastFocus && typeof lastFocus.focus === "function") {
        lastFocus.focus({ preventScroll: true });
    }
}

function renderDrawer() {
    renderDrawerBody();
    renderDrawerFoot();
}

function renderDrawerBody() {
    const books = getBooks();
    drawerBody.innerHTML = "";

    if (!books.length) {
        const empty = document.createElement("div");
        empty.className = "shelf-drawer-empty";
        empty.innerHTML = '<i class="fas fa-book-open" aria-hidden="true"></i>';
        const title = document.createElement("p");
        title.className = "shelf-drawer-empty-title";
        title.textContent = "তাকটি এখনো খালি";
        const text = document.createElement("p");
        text.className = "shelf-drawer-empty-text";
        text.textContent = "যেকোনো বইয়ের প্রচ্ছদে বুকমার্ক আইকনে ক্লিক করলে বইটি এখানে জমা হবে।";
        empty.append(title, text);
        drawerBody.appendChild(empty);
        return;
    }

    const list = document.createElement("div");
    list.className = "shelf-rows";
    books.forEach((book) => list.appendChild(rowFor(book)));
    drawerBody.appendChild(list);
}

function rowFor(book) {
    const row = document.createElement("div");
    row.className = "shelf-row";

    const main = document.createElement("a");
    main.className = "shelf-row-main";
    main.href = book.readUrl || "#";
    main.target = "_blank";
    main.rel = "noopener noreferrer";
    main.addEventListener("click", () => markReading(book.id));

    const cover = document.createElement("span");
    cover.className = "shelf-row-cover";
    cover.innerHTML = '<i class="fas fa-book" aria-hidden="true"></i>';

    if (book.coverUrl) {
        const image = new Image();
        image.src = book.coverUrl;
        image.alt = "";
        image.loading = "lazy";
        image.addEventListener("error", () => image.remove());
        cover.appendChild(image);
    }

    const text = document.createElement("span");
    text.className = "shelf-row-text";

    const title = document.createElement("strong");
    title.textContent = book.title || "শিরোনাম নেই";

    const meta = document.createElement("small");
    meta.textContent = [
        book.author,
        STATUS_LABEL[book.status] || STATUS_LABEL.unread
    ].filter(Boolean).join(" · ");

    text.append(title, meta);
    main.append(cover, text);

    const isDone = book.status === "done";

    const stateBtn = document.createElement("button");
    stateBtn.type = "button";
    stateBtn.className = `shelf-row-state${isDone ? " is-done" : ""}`;
    stateBtn.dataset.statusAction = isDone ? "reading" : "done";
    stateBtn.title = isDone ? "আবার পড়ছি" : "পড়া শেষ";
    stateBtn.setAttribute(
        "aria-label",
        isDone
            ? `${book.title || "বই"} আবার পড়ছি হিসেবে চিহ্নিত করুন`
            : `${book.title || "বই"} পড়া শেষ হিসেবে চিহ্নিত করুন`
    );
    stateBtn.innerHTML = `<i class="${isDone ? "fas" : "far"} fa-circle-check" aria-hidden="true"></i>`;
    stateBtn.addEventListener("click", () =>
        setStatus(book.id, stateBtn.dataset.statusAction)
    );

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "shelf-row-remove";
    remove.setAttribute("aria-label", `${book.title || "বই"} শেলফ থেকে সরান`);
    remove.title = "শেলফ থেকে সরান";
    remove.innerHTML = '<i class="fas fa-trash-can" aria-hidden="true"></i>';
    remove.addEventListener("click", () => removeBook(book.id));

    row.append(main, stateBtn, remove);
    return row;
}

function renderDrawerFoot() {
    drawerFoot.innerHTML = "";

    if (getUser()) {
        const link = document.createElement("a");
        link.className = "shelf-drawer-all";
        link.href = siteUrl("my-shelf.html");
        link.innerHTML = 'সব বই দেখুন <i class="fas fa-arrow-right" aria-hidden="true"></i>';
        drawerFoot.appendChild(link);
        return;
    }

    const note = document.createElement("p");
    note.className = "shelf-drawer-note";
    note.textContent = "লগইন করলে এই বইগুলো আপনার অ্যাকাউন্টে সব ডিভাইসে সংরক্ষিত থাকবে।";

    const link = document.createElement("a");
    link.className = "auth-submit";
    link.href = `${siteUrl("login.html")}?next=${encodeURIComponent(
        window.location.pathname + window.location.search
    )}`;
    link.textContent = "লগইন করুন";

    drawerFoot.append(note, link);
}
