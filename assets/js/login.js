/* ============================================================
   Login page controller
   ------------------------------------------------------------
   Handles: sign in, sign up, Google, forgot password,
   reset-password links, email-verification links,
   "already signed in" state, and ?next= redirects.
   ============================================================ */

import { siteUrl } from "./firebase-config.js";
import {
    signInWithEmail,
    signUpWithEmail,
    signInWithGoogle,
    logoutUser,
    sendResetEmail,
    resendVerificationEmail,
    completeRedirectSignIn,
    checkResetCode,
    completePasswordReset,
    applyVerifyCode,
    refreshCurrentUser,
    watchAuth,
    messageFor,
    isSilent,
    isValidEmail,
    isVerified,
    toast,
    MIN_PASSWORD_LENGTH
} from "./auth-core.js";

const params = new URLSearchParams(window.location.search);
const actionMode = params.get("mode");
const oobCode = params.get("oobCode");
const wantsVerify = params.get("verify") === "1";

const els = {
    signin: document.getElementById("formSignin"),
    signup: document.getElementById("formSignup"),
    forgot: document.getElementById("formForgot"),
    reset: document.getElementById("formReset"),
    status: document.getElementById("viewStatus"),
    account: document.getElementById("viewAccount")
};
const tabs = document.getElementById("authTabs");
const head = document.getElementById("authHead");
const alertBox = document.getElementById("authAlert");

let nextUrl = resolveNext(params.get("next"));
let actionFlow = false;
let finishing = false;
let redirecting = false;

/* ------------------------------------------------------------
   Helpers
   ------------------------------------------------------------ */
function resolveNext(raw) {
    if (!raw) return null;
    try {
        const url = new URL(raw, window.location.origin);
        if (url.origin !== window.location.origin) return null;
        return url.href;
    } catch (error) {
        return null;
    }
}

function showView(name) {
    Object.keys(els).forEach((key) => {
        els[key].hidden = key !== name;
    });

    const withTabs = name === "signin" || name === "signup";
    tabs.hidden = !withTabs;
    /* Forgot / reset views carry their own heading inside the form. */
    head.hidden = !withTabs;

    if (withTabs) {
        tabs.querySelectorAll("[data-tab]").forEach((button) => {
            const active = button.dataset.tab === name;
            button.classList.toggle("is-active", active);
            button.setAttribute("aria-selected", String(active));
        });
    }

    clearAlert();
}

function setAlert(type, message) {
    if (!message) return clearAlert();
    alertBox.hidden = false;
    alertBox.dataset.type = type;
    alertBox.textContent = message;
}

function clearAlert() {
    alertBox.hidden = true;
    alertBox.removeAttribute("data-type");
    alertBox.textContent = "";
}

function setBusy(button, busy) {
    if (!button) return;
    button.dataset.loading = busy ? "true" : "false";
    button.disabled = busy;
}

function setFieldError(input, message) {
    const field = input.closest(".auth-field");
    if (!field) return;
    field.classList.toggle("has-error", Boolean(message));
    const hint = field.querySelector(".auth-hint");
    if (hint) {
        hint.hidden = !message;
        hint.textContent = message || "";
    }
}

function clearFieldErrors(form) {
    form.querySelectorAll(".auth-field").forEach((field) => {
        field.classList.remove("has-error");
        const hint = field.querySelector(".auth-hint");
        if (hint) {
            hint.hidden = true;
            hint.textContent = "";
        }
    });
}

function clearActionParams() {
    const keep = nextUrl ? `?next=${encodeURIComponent(nextUrl)}` : "";
    window.history.replaceState({}, "", window.location.pathname + keep);
}

function finish(user) {
    if (finishing) return;
    finishing = true;
    redirecting = true;
    if (user) toast("সফলভাবে লগইন হয়েছে");
    const destination = nextUrl || siteUrl("my-shelf.html");
    window.setTimeout(() => window.location.replace(destination), 450);
}

/* ------------------------------------------------------------
   Status / account views
   ------------------------------------------------------------ */
function statusView({ icon = "fa-circle-info", tone = "info", title, text, actions = [] }) {
    els.status.innerHTML = "";

    const badge = document.createElement("div");
    badge.className = "auth-status-icon";
    badge.dataset.tone = tone;
    badge.innerHTML = `<i class="fas ${icon}" aria-hidden="true"></i>`;

    const heading = document.createElement("h2");
    heading.className = "auth-status-title";
    heading.textContent = title;

    const paragraph = document.createElement("p");
    paragraph.className = "auth-status-text";
    paragraph.textContent = text;

    els.status.appendChild(badge);
    els.status.appendChild(heading);
    els.status.appendChild(paragraph);

    if (actions.length) {
        const row = document.createElement("div");
        row.className = "auth-status-actions";

        actions.forEach((action) => {
            if (action.href) {
                const link = document.createElement("a");
                link.className = `auth-submit${action.variant === "ghost" ? " is-ghost" : ""}`;
                link.href = action.href;
                link.textContent = action.label;
                row.appendChild(link);
                return;
            }

            const button = document.createElement("button");
            button.type = "button";
            button.className = `auth-submit${action.variant === "ghost" ? " is-ghost" : ""}`;
            button.textContent = action.label;
            button.addEventListener("click", async () => {
                try {
                    await action.onClick(button);
                } catch (error) {
                    setAlert("error", messageFor(error));
                } finally {
                    setBusy(button, false);
                }
            });
            row.appendChild(button);
        });

        els.status.appendChild(row);
    }

    showView("status");
}

function promptVerify(user, options = {}) {
    const prefix = options.fresh
        ? "অ্যাকাউন্ট তৈরি হয়েছে! "
        : "";

    statusView({
        tone: "info",
        icon: "fa-envelope-circle-check",
        title: "ইমেইল যাচাই করুন",
        text: `${prefix}আমরা ${user.email} ঠিকানায় একটি যাচাইয়ের লিংক পাঠিয়েছি। লিংকে ক্লিক করে অ্যাকাউন্ট নিশ্চিত করুন। ইমেইল না পেলে স্প্যাম ফোল্ডার দেখুন।`,
        actions: [
            {
                label: "আবার পাঠান",
                variant: "ghost",
                onClick: async (button) => {
                    setBusy(button, true);
                    await resendVerificationEmail(user);
                    toast("যাচাইয়ের ইমেইল আবার পাঠানো হয়েছে");
                }
            },
            {
                label: "পরে করব",
                onClick: async () => finish(user)
            }
        ]
    });
}

function accountView(user) {
    els.account.innerHTML = "";

    const avatar = document.createElement("div");
    avatar.className = "auth-account-avatar";
    if (/^https:\/\//i.test(user.photoURL || "")) {
        const image = new Image();
        image.src = user.photoURL;
        image.alt = "";
        image.referrerPolicy = "no-referrer";
        avatar.appendChild(image);
    } else {
        avatar.textContent = (user.displayName || user.email || "প").charAt(0).toUpperCase();
    }

    const name = document.createElement("h2");
    name.className = "auth-account-name";
    name.textContent = user.displayName || "পাঠক";

    const mail = document.createElement("p");
    mail.className = "auth-account-mail";
    mail.textContent = user.email || "";

    els.account.appendChild(avatar);
    els.account.appendChild(name);
    els.account.appendChild(mail);

    if (!isVerified(user)) {
        const note = document.createElement("p");
        note.className = "auth-account-note";
        note.textContent = "আপনার ইমেইল এখনো যাচাই করা হয়নি।";
        els.account.appendChild(note);
    }

    const actions = document.createElement("div");
    actions.className = "auth-status-actions";

    const proceed = document.createElement("button");
    proceed.type = "button";
    proceed.className = "auth-submit";
    proceed.textContent = nextUrl ? "চালিয়ে যান" : "আমার বই দেখুন";
    proceed.addEventListener("click", () => finish(user));
    actions.appendChild(proceed);

    if (!isVerified(user)) {
        const verify = document.createElement("button");
        verify.type = "button";
        verify.className = "auth-submit is-ghost";
        verify.textContent = "ইমেইল যাচাই করুন";
        verify.addEventListener("click", () => {
            promptVerify(user);
        });
        actions.appendChild(verify);
    }

    const logout = document.createElement("button");
    logout.type = "button";
    logout.className = "auth-submit is-ghost";
    logout.textContent = "লগআউট";
    logout.addEventListener("click", async () => {
        try {
            await logoutUser();
            showView("signin");
            toast("লগআউট হয়েছে");
        } catch (error) {
            setAlert("error", messageFor(error));
        }
    });
    actions.appendChild(logout);

    els.account.appendChild(actions);
    showView("account");
}

/* ------------------------------------------------------------
   Forms
   ------------------------------------------------------------ */
document.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => showView(button.dataset.tab));
});

document.querySelectorAll("[data-goto]").forEach((button) => {
    button.addEventListener("click", () => showView(button.dataset.goto));
});

document.querySelectorAll(".pw-toggle").forEach((button) => {
    button.addEventListener("click", () => {
        const input = button.closest(".auth-input").querySelector("input");
        const reveal = input.type === "password";
        input.type = reveal ? "text" : "password";
        button.setAttribute("aria-label", reveal ? "পাসওয়ার্ড লুকান" : "পাসওয়ার্ড দেখুন");
        button.innerHTML = `<i class="fas ${reveal ? "fa-eye-slash" : "fa-eye"}" aria-hidden="true"></i>`;
    });
});

document.querySelectorAll("[data-google]").forEach((button) => {
    button.addEventListener("click", async () => {
        clearAlert();
        setBusy(button, true);
        try {
            const user = await signInWithGoogle({ remember: true });
            if (user) finish(user);
        } catch (error) {
            if (!isSilent(error)) setAlert("error", messageFor(error));
        } finally {
            setBusy(button, false);
        }
    });
});

/* --- sign in --- */
els.signin.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearAlert();
    clearFieldErrors(els.signin);

    const emailInput = els.signin.elements.email;
    const passwordInput = els.signin.elements.password;

    if (!isValidEmail(emailInput.value)) {
        setFieldError(emailInput, "সঠিক ইমেইল ঠিকানা লিখুন।");
        emailInput.focus();
        return;
    }
    if (!passwordInput.value) {
        setFieldError(passwordInput, "পাসওয়ার্ড লিখুন।");
        passwordInput.focus();
        return;
    }

    const submit = els.signin.querySelector('button[type="submit"]');
    setBusy(submit, true);

    try {
        const user = await signInWithEmail({
            email: emailInput.value,
            password: passwordInput.value,
            remember: els.signin.elements.remember.checked
        });

        if (isVerified(user)) {
            finish(user);
        } else {
            promptVerify(user);
        }
    } catch (error) {
        setAlert("error", messageFor(error));
        setFieldError(passwordInput, "");
    } finally {
        setBusy(submit, false);
    }
});

/* --- sign up --- */
els.signup.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearAlert();
    clearFieldErrors(els.signup);

    const nameInput = els.signup.elements.name;
    const emailInput = els.signup.elements.email;
    const passwordInput = els.signup.elements.password;
    const confirmInput = els.signup.elements.confirm;

    if (nameInput.value.trim().length < 2) {
        setFieldError(nameInput, "আপনার নাম লিখুন (কমপক্ষে ২ অক্ষর)।");
        nameInput.focus();
        return;
    }
    if (!isValidEmail(emailInput.value)) {
        setFieldError(emailInput, "সঠিক ইমেইল ঠিকানা লিখুন।");
        emailInput.focus();
        return;
    }
    if (passwordInput.value.length < MIN_PASSWORD_LENGTH) {
        setFieldError(passwordInput, `পাসওয়ার্ড কমপক্ষে ${MIN_PASSWORD_LENGTH} অক্ষরের হতে হবে।`);
        passwordInput.focus();
        return;
    }
    if (passwordInput.value !== confirmInput.value) {
        setFieldError(confirmInput, "দুটি পাসওয়ার্ড মিলছে না।");
        confirmInput.focus();
        return;
    }

    const submit = els.signup.querySelector('button[type="submit"]');
    setBusy(submit, true);

    try {
        const user = await signUpWithEmail({
            name: nameInput.value,
            email: emailInput.value,
            password: passwordInput.value
        });

        toast("অ্যাকাউন্ট তৈরি হয়েছে");
        promptVerify(user, { fresh: true });
    } catch (error) {
        const code = (error && error.code) || "";
        if (code === "auth/email-already-in-use") {
            showView("signin");
            els.signin.elements.email.value = emailInput.value.trim();
            els.signin.elements.password.focus();
            setAlert("error", messageFor(error));
        } else {
            setAlert("error", messageFor(error));
        }
    } finally {
        setBusy(submit, false);
    }
});

/* --- forgot password --- */
els.forgot.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearAlert();
    clearFieldErrors(els.forgot);

    const emailInput = els.forgot.elements.email;
    if (!isValidEmail(emailInput.value)) {
        setFieldError(emailInput, "সঠিক ইমেইল ঠিকানা লিখুন।");
        emailInput.focus();
        return;
    }

    const submit = els.forgot.querySelector('button[type="submit"]');
    setBusy(submit, true);

    try {
        await sendResetEmail(emailInput.value);
        statusView({
            tone: "success",
            icon: "fa-paper-plane",
            title: "রিসেট লিংক পাঠানো হয়েছে",
            text: `${emailInput.value.trim()} ঠিকানায় পাসওয়ার্ড রিসেট করার লিংক পাঠানো হয়েছে। ইমেইল না পেলে স্প্যাম ফোল্ডার দেখুন।`,
            actions: [
                {
                    label: "লগইনে ফিরুন",
                    href: siteUrl("login.html")
                }
            ]
        });
    } catch (error) {
        setAlert("error", messageFor(error));
    } finally {
        setBusy(submit, false);
    }
});

/* --- set a new password (from email link) --- */
if (els.reset) {
    els.reset.addEventListener("submit", async (event) => {
        event.preventDefault();
        clearAlert();
        clearFieldErrors(els.reset);

        const passwordInput = els.reset.elements.password;
        const confirmInput = els.reset.elements.confirm;

        if (passwordInput.value.length < MIN_PASSWORD_LENGTH) {
            setFieldError(passwordInput, `পাসওয়ার্ড কমপক্ষে ${MIN_PASSWORD_LENGTH} অক্ষরের হতে হবে।`);
            passwordInput.focus();
            return;
        }
        if (passwordInput.value !== confirmInput.value) {
            setFieldError(confirmInput, "দুটি পাসওয়ার্ড মিলছে না।");
            confirmInput.focus();
            return;
        }

        const submit = els.reset.querySelector('button[type="submit"]');
        setBusy(submit, true);

        try {
            await completePasswordReset(oobCode, passwordInput.value);
            clearActionParams();
            statusView({
                tone: "success",
                icon: "fa-circle-check",
                title: "পাসওয়ার্ড বদলানো হয়েছে",
                text: "নতুন পাসওয়ার্ড দিয়ে এখন লগইন করতে পারেন।",
                actions: [
                    { label: "লগইনে যান", href: siteUrl("login.html") }
                ]
            });
        } catch (error) {
            setAlert("error", messageFor(error));
        } finally {
            setBusy(submit, false);
        }
    });
}

/* ------------------------------------------------------------
   Boot
   ------------------------------------------------------------ */
async function initResetFlow() {
    actionFlow = true;
    try {
        const email = await checkResetCode(oobCode);
        const slot = els.reset.querySelector("[data-reset-email]");
        if (slot) slot.textContent = email;
        showView("reset");
    } catch (error) {
        statusView({
            tone: "error",
            icon: "fa-circle-exclamation",
            title: "লিংকটি কাজ করছে না",
            text: messageFor(error),
            actions: [
                { label: "নতুন লিংক চান", href: siteUrl("login.html") },
                { label: "হোমে ফিরুন", href: siteUrl("index.html") }
            ]
        });
    }
}

async function initVerifyFlow() {
    actionFlow = true;
    try {
        await applyVerifyCode(oobCode);
        await refreshCurrentUser();
        clearActionParams();
        statusView({
            tone: "success",
            icon: "fa-envelope-circle-check",
            title: "ইমেইল যাচাই সম্পন্ন",
            text: "ধন্যবাদ! আপনার অ্যাকাউন্ট এখন সম্পূর্ণ সক্রিয়।",
            actions: [
                {
                    label: nextUrl ? "ফিরে যান" : "আমার বই দেখুন",
                    href: nextUrl || siteUrl("my-shelf.html")
                }
            ]
        });
    } catch (error) {
        statusView({
            tone: "error",
            icon: "fa-circle-exclamation",
            title: "যাচাই করা যায়নি",
            text: messageFor(error),
            actions: [
                { label: "লগইনে যান", href: siteUrl("login.html") }
            ]
        });
    }
}

async function init() {
    if (actionMode === "resetPassword" && oobCode) {
        return initResetFlow();
    }
    if (actionMode === "verifyEmail" && oobCode) {
        return initVerifyFlow();
    }
    if (actionMode === "recoverEmail") {
        actionFlow = true;
        return statusView({
            tone: "info",
            icon: "fa-envelope",
            title: "ইমেইল পুনরুদ্ধার",
            text: "এই লিংকটি ইমেইল পরিবর্তন পুনরুদ্ধারের জন্য। বর্তমানে অ্যাকাউন্টে লগইন করে সহায়তা নিন।",
            actions: [{ label: "লগইনে যান", href: siteUrl("login.html") }]
        });
    }

    try {
        const user = await completeRedirectSignIn();
        if (user) {
            finish(user);
            return;
        }
    } catch (error) {
        if (!isSilent(error)) {
            showView("signin");
            setAlert("error", messageFor(error));
        }
    }

    watchAuth(async (user) => {
        if (redirecting || actionFlow) return;

        if (!user) {
            showView("signin");
            return;
        }

        if (wantsVerify) {
            if (isVerified(user)) {
                toast("আপনার ইমেইল আগেই যাচাই করা হয়েছে");
                accountView(user);
            } else {
                promptVerify(user);
            }
            return;
        }

        accountView(user);
    });
}

init();
