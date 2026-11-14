/* ============================================================
   Header authentication widget
   ------------------------------------------------------------
   Injected into .header .container on every page, so no page
   markup has to be edited. Shows:
     signed out -> "লগইন" pill
     signed in  -> "আমার বই" shortcut + avatar menu
   ============================================================ */

import {
    watchAuth,
    logoutUser,
    isVerified,
    toast
} from "./auth-core.js";
import { siteUrl } from "./firebase-config.js";
import "./shelf-ui.js";

const LOGIN_URL = siteUrl("login.html");
const SHELF_URL = siteUrl("my-shelf.html");

if (!document.querySelector(".auth-slot")) {
    boot();
}

function boot() {
    const container = document.querySelector(".header .container");
    if (!container) return;

    const slot = document.createElement("div");
    slot.className = "auth-slot";

    const toggle = container.querySelector(".nav-toggle");
    if (toggle) {
        container.insertBefore(slot, toggle);
    } else {
        container.appendChild(slot);
    }

    let menuEl = null;
    let avatarBtn = null;

    function closeMenu() {
        if (!menuEl) return;
        menuEl.classList.remove("is-open");
        if (avatarBtn) avatarBtn.setAttribute("aria-expanded", "false");
    }

    document.addEventListener("click", (event) => {
        if (!menuEl || !menuEl.classList.contains("is-open")) return;
        if (slot.contains(event.target)) return;
        closeMenu();
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") closeMenu();
    });

    function loginHref() {
        const here = window.location.pathname + window.location.search + window.location.hash;
        return `${LOGIN_URL}?next=${encodeURIComponent(here)}`;
    }

    function renderSignedOut() {
        slot.innerHTML = "";
        slot.classList.remove("is-auth");
        menuEl = null;
        avatarBtn = null;

        /* Shown only when the guest has saved something locally;
           shelf-ui removes the [hidden] attribute. */
        const shelfLink = document.createElement("a");
        shelfLink.className = "auth-shelf";
        shelfLink.dataset.guestShelf = "";
        shelfLink.href = SHELF_URL;
        shelfLink.hidden = true;
        shelfLink.setAttribute("aria-label", "আমার বই");
        shelfLink.title = "আমার বই";
        shelfLink.innerHTML = '<i class="fas fa-bookmark" aria-hidden="true"></i>';
        slot.appendChild(shelfLink);

        const link = document.createElement("a");
        link.className = "auth-login";
        link.href = loginHref();
        link.innerHTML = '<i class="fas fa-user" aria-hidden="true"></i>';
        const label = document.createElement("span");
        label.textContent = "লগইন";
        link.appendChild(label);

        slot.appendChild(link);
        notifyRendered();
    }

    function renderSignedIn(user) {
        slot.innerHTML = "";
        slot.classList.add("is-auth");

        /* --- shortcut to the shelf --- */
        const shelfLink = document.createElement("a");
        shelfLink.className = "auth-shelf";
        shelfLink.href = SHELF_URL;
        shelfLink.setAttribute("aria-label", "আমার বই");
        shelfLink.title = "আমার বই";
        shelfLink.innerHTML = '<i class="fas fa-bookmark" aria-hidden="true"></i>';
        slot.appendChild(shelfLink);

        /* --- avatar + dropdown --- */
        const wrap = document.createElement("div");
        wrap.className = "auth-user";

        const button = document.createElement("button");
        button.type = "button";
        button.className = "auth-avatar";
        button.setAttribute("aria-haspopup", "menu");
        button.setAttribute("aria-expanded", "false");
        button.setAttribute("aria-label", "অ্যাকাউন্ট মেনু");

        applyAvatar(button, user);

        if (!isVerified(user)) {
            const dot = document.createElement("span");
            dot.className = "auth-verify-dot";
            dot.title = "ইমেইল যাচাই করা হয়নি";
            button.appendChild(dot);
        }

        const menu = document.createElement("div");
        menu.className = "auth-menu";
        menu.setAttribute("role", "menu");

        const head = document.createElement("div");
        head.className = "auth-menu-head";

        const nameEl = document.createElement("div");
        nameEl.className = "auth-menu-name";
        nameEl.textContent = user.displayName || "পাঠক";

        const mailEl = document.createElement("div");
        mailEl.className = "auth-menu-mail";
        mailEl.textContent = user.email || "Google অ্যাকাউন্ট";

        head.appendChild(nameEl);
        head.appendChild(mailEl);
        menu.appendChild(head);

        const shelfItem = document.createElement("a");
        shelfItem.href = SHELF_URL;
        shelfItem.setAttribute("role", "menuitem");
        shelfItem.innerHTML = '<i class="fas fa-bookmark" aria-hidden="true"></i><span></span>';
        shelfItem.querySelector("span").textContent = "আমার বই";
        menu.appendChild(shelfItem);

        if (!isVerified(user)) {
            const verifyItem = document.createElement("a");
            verifyItem.href = `${LOGIN_URL}?verify=1&next=${encodeURIComponent(
                window.location.pathname + window.location.search
            )}`;
            verifyItem.setAttribute("role", "menuitem");
            verifyItem.innerHTML = '<i class="fas fa-envelope-circle-check" aria-hidden="true"></i><span></span>';
            verifyItem.querySelector("span").textContent = "ইমেইল যাচাই করুন";
            menu.appendChild(verifyItem);
        }

        const logoutItem = document.createElement("button");
        logoutItem.type = "button";
        logoutItem.dataset.logout = "";
        logoutItem.setAttribute("role", "menuitem");
        logoutItem.innerHTML = '<i class="fas fa-right-from-bracket" aria-hidden="true"></i><span></span>';
        logoutItem.querySelector("span").textContent = "লগআউট";

        logoutItem.addEventListener("click", async () => {
            closeMenu();
            logoutItem.disabled = true;
            try {
                await logoutUser();
                toast("লগআউট হয়েছে");
            } catch (error) {
                toast("লগআউট করা যায়নি, আবার চেষ্টা করুন", "error");
            }
        });

        menu.appendChild(logoutItem);

        button.addEventListener("click", (event) => {
            event.stopPropagation();
            const isOpen = menu.classList.toggle("is-open");
            button.setAttribute("aria-expanded", String(isOpen));
        });

        wrap.appendChild(button);
        wrap.appendChild(menu);
        slot.appendChild(wrap);

        menuEl = menu;
        avatarBtn = button;

        notifyRendered();
    }

    function notifyRendered() {
        document.dispatchEvent(new CustomEvent("bicm:auth-rendered"));
    }

    function applyAvatar(button, user) {
        const photo = user.photoURL || "";
        if (/^https:\/\//i.test(photo)) {
            const img = document.createElement("img");
            img.src = photo;
            img.alt = "";
            img.referrerPolicy = "no-referrer";
            img.loading = "lazy";
            img.addEventListener("error", () => {
                img.remove();
                button.textContent = initialOf(user);
            });
            button.appendChild(img);
            return;
        }
        button.textContent = initialOf(user);
    }

    function initialOf(user) {
        const source = (user.displayName || user.email || "প").trim();
        return source.charAt(0).toUpperCase();
    }

    renderSignedOut();

    watchAuth((user) => {
        if (user) {
            renderSignedIn(user);
        } else {
            renderSignedOut();
        }
    });
}
