/* ============================================================
   "আমার বই" page controller
   Renders the shared shelf store with filters and search.
   ============================================================ */

import { siteUrl } from "./firebase-config.js";
import {
    initStore,
    subscribe,
    getBooks,
    getUser,
    getError,
    isReady,
    removeBook,
    markReading,
    setStatus
} from "./shelf-store.js";

const grid = document.getElementById("shelfGrid");
const stateBox = document.getElementById("shelfState");
const toolbar = document.getElementById("shelfToolbar");
const searchInput = document.getElementById("shelfSearch");
const countEl = document.getElementById("shelfCount");
const filters = Array.from(document.querySelectorAll("[data-filter]"));

const STATUS_LABEL = {
    unread: "পড়া হয়নি",
    reading: "পড়ছি",
    done: "পড়া শেষ"
};

let activeFilter = "all";
let searchTerm = "";

initStore();

/* ------------------------------------------------------------
   Utilities
   ------------------------------------------------------------ */
function bn(number) {
    return String(number).replace(/\d/g, (digit) => "০১২৩৪৫৬৭৮৯"[Number(digit)]);
}

function h(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function loginHref() {
    return `${siteUrl("login.html")}?next=${encodeURIComponent(
        window.location.pathname + window.location.search
    )}`;
}

/* ------------------------------------------------------------
   States
   ------------------------------------------------------------ */
function setState(kind, message) {
    stateBox.innerHTML = "";
    grid.hidden = true;
    toolbar.hidden = true;

    if (kind === "ready") {
        stateBox.hidden = true;
        return;
    }

    stateBox.hidden = false;

    if (kind === "loading") {
        const wrap = h("div", "shelf-panel is-loading");
        wrap.appendChild(h("div", "shelf-spinner"));
        wrap.appendChild(h("p", "shelf-panel-text", "আপনার শেলফ লোড হচ্ছে..."));
        stateBox.appendChild(wrap);
        return;
    }

    if (kind === "guest") {
        const wrap = h("div", "shelf-panel");
        const icon = h("div", "shelf-panel-icon");
        icon.innerHTML = '<i class="fas fa-bookmark" aria-hidden="true"></i>';
        wrap.appendChild(icon);
        wrap.appendChild(h("h2", "shelf-panel-title", "আপনার ব্যক্তিগত বইয়ের তাক"));
        wrap.appendChild(h("p", "shelf-panel-text",
            "বই সংরক্ষণ করতে এবং যেকোনো ডিভাইস থেকে আবার পেতে লগইন করুন।"));
        const link = h("a", "auth-submit", "লগইন করুন");
        link.href = loginHref();
        wrap.appendChild(link);
        stateBox.appendChild(wrap);
        return;
    }

    if (kind === "error") {
        const wrap = h("div", "shelf-panel");
        const icon = h("div", "shelf-panel-icon");
        icon.dataset.tone = "error";
        icon.innerHTML = '<i class="fas fa-triangle-exclamation" aria-hidden="true"></i>';
        wrap.appendChild(icon);
        wrap.appendChild(h("h2", "shelf-panel-title", "শেলফ লোড করা যায়নি"));
        wrap.appendChild(h("p", "shelf-panel-text", message || "আবার চেষ্টা করুন।"));
        const retry = h("button", "auth-submit is-ghost", "আবার চেষ্টা করুন");
        retry.type = "button";
        retry.addEventListener("click", () => window.location.reload());
        wrap.appendChild(retry);
        stateBox.appendChild(wrap);
        return;
    }

    if (kind === "empty") {
        const wrap = h("div", "shelf-panel");
        const icon = h("div", "shelf-panel-icon");
        icon.innerHTML = '<i class="fas fa-book-open" aria-hidden="true"></i>';
        wrap.appendChild(icon);
        wrap.appendChild(h("h2", "shelf-panel-title", "তাকটি এখনো খালি"));
        wrap.appendChild(h("p", "shelf-panel-text",
            "যেকোনো বইয়ের প্রচ্ছদে বুকমার্ক আইকনে ক্লিক করলে বইটি এখানে জমা হবে।"));
        const browse = h("a", "auth-submit", "বই ব্রাউজ করুন");
        browse.href = siteUrl("books_category.html");
        wrap.appendChild(browse);
        stateBox.appendChild(wrap);
    }
}

/* ------------------------------------------------------------
   Guest notice
   ------------------------------------------------------------ */
function renderGuestNote(user) {
    let note = document.getElementById("shelfGuestNote");

    if (user) {
        if (note) note.remove();
        return;
    }

    if (note) return;

    note = document.createElement("div");
    note.id = "shelfGuestNote";
    note.className = "shelf-guest-note";

    const text = document.createElement("span");
    text.textContent =
        "এই বইগুলো এই ব্রাউজারে সংরক্ষিত আছে। লগইন করলে সব ডিভাইসে স্থায়ীভাবে থাকবে।";

    const link = document.createElement("a");
    link.href = loginHref();
    link.textContent = "লগইন করুন";

    note.append(text, link);
    toolbar.parentElement.insertBefore(note, toolbar);
}

/* ------------------------------------------------------------
   Card
   ------------------------------------------------------------ */
function renderCard(book) {
    const card = h("article", "shelf-card");

    const coverLink = h("a", "shelf-cover");
    coverLink.href = book.readUrl || "#";
    coverLink.target = "_blank";
    coverLink.rel = "noopener noreferrer";
    coverLink.setAttribute("aria-label", `${book.title || "বই"} পড়ুন`);
    coverLink.addEventListener("click", () => markReading(book.id));

    const fallback = h("span", "shelf-cover-fallback");
    fallback.innerHTML = '<i class="fas fa-book" aria-hidden="true"></i>';
    coverLink.appendChild(fallback);

    if (book.coverUrl) {
        const image = new Image();
        image.src = book.coverUrl;
        image.alt = "";
        image.loading = "lazy";
        image.className = "shelf-cover-img";
        image.addEventListener("load", () => coverLink.classList.add("has-image"));
        image.addEventListener("error", () => image.remove());
        coverLink.appendChild(image);
    }

    const status = h("span", "shelf-status");
    status.dataset.status = book.status || "unread";
    status.textContent = STATUS_LABEL[book.status] || STATUS_LABEL.unread;
    coverLink.appendChild(status);

    card.appendChild(coverLink);

    const body = h("div", "shelf-body");
    body.appendChild(h("h3", "shelf-title", book.title || "শিরোনাম নেই"));

    if (book.author) {
        const author = h("p", "shelf-author");
        author.innerHTML = '<i class="fas fa-user-pen" aria-hidden="true"></i>';
        author.appendChild(document.createTextNode(book.author));
        body.appendChild(author);
    }

    if (book.category) {
        body.appendChild(h("span", "shelf-chip", book.category));
    }

    const actions = h("div", "shelf-actions");

    const read = h("a", "shelf-btn is-primary");
    read.href = book.readUrl || "#";
    read.target = "_blank";
    read.rel = "noopener noreferrer";
    read.innerHTML = '<i class="fas fa-book-open" aria-hidden="true"></i><span>পড়ুন</span>';
    read.addEventListener("click", async () => {
        await markReading(book.id);
        followStatus(book.id);
    });
    actions.appendChild(read);

    const isDone = book.status === "done";
    const state_ = h("button", `shelf-btn is-state${isDone ? " is-done" : ""}`);
    state_.type = "button";
    state_.dataset.statusAction = isDone ? "reading" : "done";
    state_.setAttribute(
        "aria-label",
        isDone
            ? `${book.title || "বই"} আবার পড়ছি হিসেবে চিহ্নিত করুন`
            : `${book.title || "বই"} পড়া শেষ হিসেবে চিহ্নিত করুন`
    );
    state_.title = isDone ? "আবার পড়ছি" : "পড়া শেষ";
    state_.innerHTML = isDone
        ? '<i class="fas fa-rotate-left" aria-hidden="true"></i>'
        : '<i class="fas fa-check" aria-hidden="true"></i>';
    state_.addEventListener("click", async () => {
        await setStatus(book.id, state_.dataset.statusAction);
        followStatus(book.id);
    });
    actions.appendChild(state_);

    const remove = h("button", "shelf-btn is-remove");
    remove.type = "button";
    remove.setAttribute("aria-label", `${book.title || "বই"} শেলফ থেকে সরান`);
    remove.title = "শেলফ থেকে সরান";
    remove.innerHTML = '<i class="fas fa-trash-can" aria-hidden="true"></i>';
    remove.addEventListener("click", () => removeBook(book.id));
    actions.appendChild(remove);

    body.appendChild(actions);
    card.appendChild(body);

    return card;
}

/* A status change can make the book stop matching the filter the reader
   is currently looking at. Jump back to "সব" so the card does not seem to
   vanish — that is indistinguishable from a delete. */
function followStatus(id) {
    if (activeFilter === "all") return;

    const current = getBooks().find((item) => item.id === id);
    if (!current) return;

    if ((current.status || "unread") !== activeFilter) setFilter("all");
}

/* ------------------------------------------------------------
   Rendering
   ------------------------------------------------------------ */
function applyFilters() {
    const books = getBooks();
    const user = getUser();

    if (!isReady()) {
        setState("loading");
        return;
    }

    if (!books.length) {
        setState(user ? "empty" : "guest");
        if (countEl) countEl.textContent = "০টি বই";
        return;
    }

    const error = getError();
    if (error === "permission-denied" && !user) {
        setState("guest");
        return;
    }

    renderGuestNote(user);
    setState("ready");
    toolbar.hidden = false;
    grid.hidden = false;

    const term = searchTerm.trim().toLowerCase();
    const visible = books.filter((book) => {
        const statusOk =
            activeFilter === "all" || (book.status || "unread") === activeFilter;
        if (!statusOk) return false;
        if (!term) return true;
        return [book.title, book.author, book.category]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(term));
    });

    grid.innerHTML = "";

    if (!visible.length) {
        const note = h("div", "shelf-noresults");
        note.innerHTML = '<i class="fas fa-magnifying-glass" aria-hidden="true"></i>';
        note.appendChild(h("p", null, "এই ফিল্টারে কোনো বই পাওয়া যায়নি।"));
        grid.appendChild(note);
    } else {
        const fragment = document.createDocumentFragment();
        visible.forEach((book) => fragment.appendChild(renderCard(book)));
        grid.appendChild(fragment);
    }

    if (countEl) countEl.textContent = `${bn(visible.length)}টি বই`;
}

function render() {
    const error = getError();

    if (error && error !== "permission-denied") {
        const message =
            error === "unavailable"
                ? "ইন্টারনেট সংযোগ পাওয়া যায়নি। একটু পর আবার চেষ্টা করুন।"
                : "শেলফ লোড করা যায়নি। আবার চেষ্টা করুন।";
        setState("error", message);
        return;
    }

    applyFilters();
}

/* ------------------------------------------------------------
   Wiring
   ------------------------------------------------------------ */
function setFilter(name) {
    activeFilter = name;

    filters.forEach((item) => {
        const active = item.dataset.filter === name;
        item.classList.toggle("is-active", active);
        item.setAttribute("aria-selected", String(active));
    });

    applyFilters();
}

filters.forEach((button) => {
    button.addEventListener("click", () => setFilter(button.dataset.filter));
});

if (searchInput) {
    searchInput.addEventListener("input", () => {
        searchTerm = searchInput.value;
        applyFilters();
    });
}

subscribe(render);

/* render() shows the loading panel itself while the store is not ready,
   and paints the grid right away if it already is. */
render();
