/* ============================================================
   Auth core — all Firebase Auth calls in one place.
   Every function throws an Error whose message is already in
   Bengali, so the UI never shows raw Firebase codes.
   ============================================================ */

import { auth, db, ACTION_SETTINGS } from "./firebase-config.js";

import {
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signInWithPopup,
    signInWithRedirect,
    getRedirectResult,
    GoogleAuthProvider,
    signOut,
    sendPasswordResetEmail,
    sendEmailVerification,
    updateProfile,
    onAuthStateChanged,
    setPersistence,
    browserLocalPersistence,
    browserSessionPersistence,
    applyActionCode,
    verifyPasswordResetCode,
    confirmPasswordReset
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
    doc,
    getDoc,
    setDoc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* ------------------------------------------------------------
   Bengali messages
   ------------------------------------------------------------ */
const MESSAGES = {
    "auth/invalid-email": "ইমেইলের ঠিকানাটি সঠিক নয়।",
    "auth/missing-email": "ইমেইল লিখুন।",
    "auth/user-disabled": "এই অ্যাকাউন্টটি বন্ধ করে দেওয়া হয়েছে।",
    "auth/user-not-found": "ইমেইল বা পাসওয়ার্ড সঠিক নয়।",
    "auth/wrong-password": "ইমেইল বা পাসওয়ার্ড সঠিক নয়।",
    "auth/invalid-credential": "ইমেইল বা পাসওয়ার্ড সঠিক নয়।",
    "auth/invalid-login-credentials": "ইমেইল বা পাসওয়ার্ড সঠিক নয়।",
    "auth/email-already-in-use": "এই ইমেইলে ইতিমধ্যে একটি অ্যাকাউন্ট আছে। লগইন করুন।",
    "auth/weak-password": "পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।",
    "auth/too-many-requests": "অনেকবার চেষ্টা করা হয়েছে। কিছুক্ষণ পর আবার চেষ্টা করুন।",
    "auth/network-request-failed": "ইন্টারনেট সংযোগ পাওয়া যায়নি। আবার চেষ্টা করুন।",
    "auth/popup-blocked": "ব্রাউজার পপআপ ব্লক করেছে। আবার চেষ্টা করুন, অথবা ইমেইল দিয়ে লগইন করুন।",
    "auth/operation-not-allowed": "এই লগইন পদ্ধতিটি এই মুহূর্তে চালু নেই।",
    "auth/unauthorized-domain": "এই ওয়েবসাইটের ডোমেইন Firebase-এ অনুমোদিত নয়।",
    "auth/unauthorized-continue-uri": "ইমেইলের লিংকের ডোমেইন Firebase-এ অনুমোদিত নয়।",
    "auth/account-exists-with-different-credential": "এই ইমেইল অন্য একটি লগইন পদ্ধতিতে নিবন্ধিত।",
    "auth/requires-recent-login": "নিরাপত্তার জন্য আবার লগইন করুন।",
    "auth/expired-action-code": "লিংকটির মেয়াদ শেষ হয়ে গেছে। নতুন লিংক চান।",
    "auth/invalid-action-code": "লিংকটি সঠিক নয় বা আগেই ব্যবহার করা হয়েছে।",
    "auth/user-mismatch": "লিংকটি অন্য একটি অ্যাকাউন্টের।",
    "auth/missing-password": "পাসওয়ার্ড লিখুন।",
    "auth/internal-error": "সার্ভারে সমস্যা হয়েছে। একটু পর আবার চেষ্টা করুন।"
};

const SILENT_CODES = new Set([
    "auth/popup-closed-by-user",
    "auth/cancelled-popup-request"
]);

export function messageFor(error) {
    const code = (error && error.code) || "";
    if (MESSAGES[code]) return MESSAGES[code];
    if (/network|offline|failed to fetch/i.test((error && error.message) || "")) {
        return MESSAGES["auth/network-request-failed"];
    }
    return "কিছু একটা সমস্যা হয়েছে। আবার চেষ্টা করুন।";
}

export function isSilent(error) {
    return SILENT_CODES.has((error && error.code) || "");
}

/* ------------------------------------------------------------
   Validation helpers (kept here so every page agrees)
   ------------------------------------------------------------ */
export function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value || "").trim());
}

export const MIN_PASSWORD_LENGTH = 6;

/* ------------------------------------------------------------
   Users document
   ------------------------------------------------------------ */
export async function ensureUserDoc(user, name) {
    if (!user) return;
    const ref = doc(db, "users", user.uid);
    try {
        const snapshot = await getDoc(ref);
        if (snapshot.exists()) return;

        const displayName =
            String(name || user.displayName || "").trim().slice(0, 80) || "পাঠক";

        await setDoc(ref, {
            displayName,
            email: String(user.email || "").slice(0, 200),
            photoURL: user.photoURL || "",
            createdAt: serverTimestamp()
        });
    } catch (error) {
        /* Never block sign-in because of a profile write.
           (A fresh project with default rules will land here.) */
        console.warn("[auth] could not create user profile:", error && error.code);
    }
}

/* ------------------------------------------------------------
   Verification email — falls back if the continue URL is not
   yet an authorised domain, so signup never fails because of it.
   ------------------------------------------------------------ */
async function sendVerificationSafe(user) {
    if (!user || user.emailVerified) return;
    try {
        await sendEmailVerification(user, ACTION_SETTINGS);
    } catch (error) {
        const code = (error && error.code) || "";
        if (code === "auth/unauthorized-continue-uri" || code === "auth/invalid-continue-uri") {
            try {
                await sendEmailVerification(user);
            } catch (inner) {
                console.warn("[auth] verification email failed:", inner && inner.code);
            }
        } else {
            console.warn("[auth] verification email failed:", code);
        }
    }
}

/* ------------------------------------------------------------
   Sign up / sign in / sign out
   ------------------------------------------------------------ */
export async function signUpWithEmail({ name, email, password }) {
    const credential = await createUserWithEmailAndPassword(
        auth,
        String(email || "").trim(),
        password
    );

    const cleanName = String(name || "").trim().slice(0, 60);
    if (cleanName) {
        try {
            await updateProfile(credential.user, { displayName: cleanName });
        } catch (error) {
            console.warn("[auth] display name update failed", error);
        }
    }

    await ensureUserDoc(credential.user, cleanName);
    await sendVerificationSafe(credential.user);

    return credential.user;
}

export async function signInWithEmail({ email, password, remember = true }) {
    await setPersistence(
        auth,
        remember ? browserLocalPersistence : browserSessionPersistence
    );

    const credential = await signInWithEmailAndPassword(
        auth,
        String(email || "").trim(),
        password
    );

    await ensureUserDoc(credential.user);
    return credential.user;
}

export async function signInWithGoogle({ remember = true } = {}) {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });

    await setPersistence(
        auth,
        remember ? browserLocalPersistence : browserSessionPersistence
    );

    try {
        const credential = await signInWithPopup(auth, provider);
        await ensureUserDoc(credential.user);
        return credential.user;
    } catch (error) {
        const code = (error && error.code) || "";
        const shouldRedirect =
            code === "auth/popup-blocked" ||
            code === "auth/operation-not-supported-in-this-environment" ||
            code === "auth/web-storage-unsupported";

        if (shouldRedirect) {
            await signInWithRedirect(auth, provider);
            return null;
        }
        throw error;
    }
}

/* Completes the redirect-based Google flow (popup fallback).
   Returns the user when we are coming back from Google. */
export async function completeRedirectSignIn() {
    const result = await getRedirectResult(auth);
    if (result && result.user) {
        await ensureUserDoc(result.user);
        return result.user;
    }
    return null;
}

export async function logoutUser() {
    await signOut(auth);
}

/* ------------------------------------------------------------
   Password reset & email verification links
   ------------------------------------------------------------ */
export async function sendResetEmail(email) {
    try {
        await sendPasswordResetEmail(auth, String(email || "").trim(), ACTION_SETTINGS);
    } catch (error) {
        if ((error && error.code) === "auth/unauthorized-continue-uri") {
            await sendPasswordResetEmail(auth, String(email || "").trim());
            return;
        }
        throw error;
    }
}

export async function resendVerificationEmail(user) {
    if (!user) throw new Error("no-user");
    await sendVerificationSafe(user);
}

export async function checkResetCode(code) {
    return verifyPasswordResetCode(auth, code);
}

export async function completePasswordReset(code, password) {
    await confirmPasswordReset(auth, code, password);
}

export async function applyVerifyCode(code) {
    await applyActionCode(auth, code);
}

export async function refreshCurrentUser() {
    if (!auth.currentUser) return null;
    try {
        await auth.currentUser.reload();
    } catch (error) {
        console.warn("[auth] reload failed", error);
    }
    return auth.currentUser;
}

/* ------------------------------------------------------------
   State helpers
   ------------------------------------------------------------ */
export function watchAuth(callback) {
    return onAuthStateChanged(auth, callback);
}

export function currentUser() {
    return auth.currentUser;
}

export function isVerified(user) {
    if (!user) return false;
    if (user.emailVerified) return true;
    const providers = Array.isArray(user.providerData) ? user.providerData : [];
    return providers.some((provider) => provider.providerId === "google.com");
}

/* Small toast used by header + login page. */
export function toast(message, type = "success") {
    if (!message) return;
    let host = document.querySelector(".auth-toast-host");
    if (!host) {
        host = document.createElement("div");
        host.className = "auth-toast-host";
        host.setAttribute("aria-live", "polite");
        document.body.appendChild(host);
    }
    const item = document.createElement("div");
    item.className = "auth-toast";
    item.dataset.type = type;
    item.textContent = message;
    host.appendChild(item);

    requestAnimationFrame(() => item.classList.add("is-visible"));
    window.setTimeout(() => {
        item.classList.remove("is-visible");
        window.setTimeout(() => item.remove(), 260);
    }, 3600);
}
