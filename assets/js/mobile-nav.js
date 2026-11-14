/* ============================================================
   Mobile tab bar — হোম · খুঁজুন · আমার বই · প্রোফাইল
   ------------------------------------------------------------
   Injected into every page that loads auth.js (like shelf-ui),
   so the 18 existing pages never need editing. Visible only at
   the mobile breakpoint (≤ 768px, see CSS); on wider screens it
   stays in the DOM but display:none.

   Not injected on the login page — auth screens stay clean.
   Search and profile pages are placeholders for now.
   ============================================================ */

import { siteUrl } from "./firebase-config.js";
import { initStore, subscribe, getBooks } from "./shelf-store.js";

const TABS = [
    {
        id: "home",
        file: "index.html",
        label: "হোম",
        icon: "fa-house"
    },
    {
        id: "search",
        file: "search.html",
        label: "খুঁজুন",
        icon: "fa-magnifying-glass"
    },
    {
        id: "shelf",
        file: "my-shelf.html",
        label: "আমার বই",
        icon: "fa-book",
        badge: true
    },
    {
        id: "profile",
        file: "profile.html",
        label: "প্রোফাইল",
        icon: "fa-user"
    }
];

function currentPageFile() {
    const path = window.location.pathname;
    const last = path.split("/").pop();

    /* Directory roots (…/bicmlibrary/ and …/bicmlibrary/catagory/)
       count as index.html */
    if (!last || !last.includes(".")) return "index.html";
    return last.toLowerCase();
}

function bn(number) {
    return String(number).replace(/\d/g, (digit) => "০১২৩৪৫৬৭৮৯"[Number(digit)]);
}

function buildBar() {
    const bar = document.createElement("nav");
    bar.className = "mobile-tabbar";
    bar.setAttribute("role", "navigation");
    bar.setAttribute("aria-label", "নিচের মূল মেনু");
    bar.hidden = true;

    const active = currentPageFile();

    TABS.forEach((tab) => {
        const link = document.createElement("a");
        link.className = "tabbar-item";
        link.href = siteUrl(tab.file);
        link.dataset.tab = tab.id;

        if (tab.file === active) {
            link.classList.add("is-active");
            link.setAttribute("aria-current", "page");
        }

        const icon = document.createElement("i");
        icon.className = `fas ${tab.icon}`;
        icon.setAttribute("aria-hidden", "true");
        link.appendChild(icon);

        const label = document.createElement("span");
        label.className = "tabbar-label";
        label.textContent = tab.label;
        link.appendChild(label);

        if (tab.badge) {
            const badge = document.createElement("span");
            badge.className = "tabbar-badge";
            badge.hidden = true;
            link.appendChild(badge);
        }

        bar.appendChild(link);
    });

    document.body.appendChild(bar);
    document.body.classList.add("has-tabbar");
    bar.hidden = false;
    return bar;
}

function paintBadge(bar) {
    const badge = bar.querySelector(".tabbar-badge");
    if (!badge) return;

    const count = getBooks().length;
    if (count > 0) {
        badge.hidden = false;
        badge.textContent = count > 99 ? "৯৯+" : bn(count);
    } else {
        badge.hidden = true;
    }
}

const isAuthPage = document.body.classList.contains("auth-page");

if (!isAuthPage) {
    initStore();

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => {
            const bar = buildBar();
            subscribe(() => paintBadge(bar));
            paintBadge(bar);
        }, { once: true });
    } else {
        const bar = buildBar();
        subscribe(() => paintBadge(bar));
        paintBadge(bar);
    }
}
