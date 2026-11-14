/* ============================================================
   মজলিস অনলাইন লাইব্রেরি — Firebase bootstrap
   ------------------------------------------------------------
   This file is loaded by every page (through auth.js).
   The config below is a PUBLIC identifier, not a secret:
   access is controlled by Firestore security rules.
   ============================================================ */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
    getFirestore,
    initializeFirestore,
    persistentLocalCache,
    persistentSingleTabManager
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export const firebaseConfig = {
    apiKey: "AIzaSyAqo_fZLIZEav_iCd6QiUIzgu4kyPSGc6Q",
    authDomain: "mojlish-library.firebaseapp.com",
    projectId: "mojlish-library",
    storageBucket: "mojlish-library.firebasestorage.app",
    messagingSenderId: "1064239238426",
    appId: "1:1064239238426:web:77683eca6b086f7646b0a3"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

/* Firestore with offline cache. Falls back gracefully in
   private-browsing modes where IndexedDB is unavailable. */
let firestoreInstance;
try {
    firestoreInstance = initializeFirestore(app, {
        localCache: persistentLocalCache({
            tabManager: persistentSingleTabManager({})
        })
    });
} catch (error) {
    console.warn("[firebase] persistent cache unavailable, using memory cache", error);
    firestoreInstance = getFirestore(app);
}
export const db = firestoreInstance;

/* Site root, resolved from this module's own URL.
   Works both on http://localhost/... and on
   https://<user>.github.io/<repo>/ without hard-coding. */
export const SITE_ROOT = new URL("../../", import.meta.url).href;

export function siteUrl(page = "") {
    return new URL(page, SITE_ROOT).href;
}

/* Where Firebase sends users after they click a link in an
   email (verify / reset). This URL must be an authorised
   domain in the Firebase console. */
export const ACTION_SETTINGS = {
    url: siteUrl("login.html"),
    handleCodeInApp: false
};
