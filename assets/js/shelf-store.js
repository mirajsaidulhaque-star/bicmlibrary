/* ============================================================
   Shelf store — single source of truth for saved books
   ------------------------------------------------------------
   • Signed in  -> Firestore (users/{uid}/shelf)
   • Guest      -> localStorage, merged into Firestore on login
   • Optimistic updates with a short "pending" window so the UI
     never flickers while the server acknowledges a write.
   ============================================================ */

import { db } from "./firebase-config.js";
import { watchAuth, toast } from "./auth-core.js";
import {
    collection,
    query,
    orderBy,
    getDocs,
    doc,
    setDoc,
    deleteDoc,
    updateDoc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const GUEST_KEY = "bicm_guest_shelf_v1";
const CACHE_PREFIX = "bicm_shelf_cache_v1:";
const PENDING_TTL = 10000;

const state = {
    user: null,
    books: [],
    ready: false,
    error: null
};

const listeners = new Set();
const pending = new Map();
let started = false;

/* ------------------------------------------------------------
   Small helpers
   ------------------------------------------------------------ */
function bn(number) {
    return String(number).replace(/\d/g, (digit) => "০১২৩৪৫৬৭৮৯"[Number(digit)]);
}

function timeOf(value) {
    if (!value) return 0;
    if (typeof value === "number") return value;
    if (typeof value.toMillis === "function") return value.toMillis();
    if (value instanceof Date) return value.getTime();
    return 0;
}

function sortBooks(list) {
    return list.slice().sort((a, b) => timeOf(b.addedAt) - timeOf(a.addedAt));
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
        /* storage full or blocked — ignore */
    }
}

function readGuest() {
    const list = readJson(GUEST_KEY, []);
    return Array.isArray(list) ? list.filter((book) => book && book.id) : [];
}

function writeGuest(list) {
    writeJson(GUEST_KEY, list);
}

function cacheKey(uid) {
    return CACHE_PREFIX + uid;
}

function normalizeBook(meta) {
    return {
        id: String(meta.id || "").slice(0, 60),
        title: String(meta.title || "শিরোনাম নেই").slice(0, 200),
        author: String(meta.author || "").slice(0, 120),
        category: String(meta.category || "").slice(0, 80),
        categorySlug: String(meta.categorySlug || "home").slice(0, 40),
        coverUrl: String(meta.coverUrl || "").slice(0, 500),
        readUrl: String(meta.readUrl || "").slice(0, 500),
        status: ["unread", "reading", "done"].includes(meta.status) ? meta.status : "unread",
        addedAt: meta.addedAt || Date.now()
    };
}

function emit() {
    listeners.forEach((listener) => {
        try {
            listener();
        } catch (error) {
            console.warn("[shelf] listener failed", error);
        }
    });
}

/* ------------------------------------------------------------
   Public read API
   ------------------------------------------------------------ */
export function initStore() {
    if (started) return;
    started = true;

    watchAuth((user) => {
        state.user = user;
        state.error = null;

        if (!user) {
            state.books = sortBooks(readGuest());
            state.ready = true;
            emit();
            return;
        }

        state.books = sortBooks(readJson(cacheKey(user.uid), []));
        emit();
        attachUser(user);
    });
}

export function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function getBooks() {
    return state.books;
}

export function getUser() {
    return state.user;
}

export function isReady() {
    return state.ready;
}

export function getError() {
    return state.error;
}

export function isSaved(id) {
    return state.books.some((book) => book.id === id);
}

/* ------------------------------------------------------------
   Firestore sync
   ------------------------------------------------------------ */
async function attachUser(user) {
    /* Load server truth first so a guest copy of a book that already
       exists on another device is never re-created (that would be an
       update, which the rules disallow for shelf documents). */
    await loadShelf(user.uid);
    if (!state.user || state.user.uid !== user.uid) return;

    const guest = readGuest();
    if (!guest.length) return;

    const existing = new Set(state.books.map((book) => book.id));
    const toMerge = guest.filter((book) => !existing.has(book.id));

    if (!toMerge.length) {
        writeGuest([]);
        return;
    }

    const results = await Promise.allSettled(
        toMerge.map((book) => saveDoc(user.uid, book))
    );
    const leftovers = toMerge.filter((_, index) => results[index].status === "rejected");

    writeGuest(leftovers);

    if (leftovers.length === 0) {
        toast(`${bn(toMerge.length)}টি বই আপনার অ্যাকাউন্টে যোগ হয়েছে`);
    }

    await loadShelf(user.uid, leftovers);
}

function payload(uid, book) {
    const clean = normalizeBook(book);
    return {
        bookId: clean.id,
        title: clean.title,
        author: clean.author,
        category: clean.category,
        categorySlug: clean.categorySlug,
        coverUrl: clean.coverUrl,
        readUrl: clean.readUrl,
        status: clean.status,
        addedAt: serverTimestamp()
    };
}

function saveDoc(uid, book) {
    const clean = normalizeBook(book);
    return setDoc(doc(db, "users", uid, "shelf", clean.id), payload(uid, clean));
}

async function loadShelf(uid, extras = []) {
    try {
        const snapshot = await getDocs(
            query(collection(db, "users", uid, "shelf"), orderBy("addedAt", "desc"))
        );

        const list = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
        const known = new Set(list.map((book) => book.id));
        extras.forEach((book) => {
            if (!known.has(book.id)) list.push(book);
        });

        state.books = sortBooks(list);
        state.error = null;
        state.ready = true;
        writeJson(cacheKey(uid), state.books);
        emit();
    } catch (error) {
        state.error = (error && error.code) || "unknown";
        state.ready = true;
        state.books = sortBooks([...state.books, ...extras]);
        emit();
    }
}

/* ------------------------------------------------------------
   Mutations
   ------------------------------------------------------------ */
export async function toggleBook(meta) {
    const book = normalizeBook(meta);
    if (!book.id) return;

    if (isSaved(book.id)) {
        await removeBook(book.id);
        return;
    }

    if (!state.user) {
        const guest = readGuest().filter((item) => item.id !== book.id);
        guest.unshift(book);
        writeGuest(guest);
        state.books = sortBooks(guest);
        emit();
        toast("সংরক্ষণ হয়েছে — লগইন করলে সব ডিভাইসে থাকবে");
        return;
    }

    pending.set(book.id, { type: "add", at: Date.now(), doc: book });
    state.books = sortBooks([book, ...state.books]);
    emit();

    try {
        await saveDoc(state.user.uid, book);
        writeJson(cacheKey(state.user.uid), state.books);
        toast("আমার বইয়ে যোগ হয়েছে");
    } catch (error) {
        pending.delete(book.id);
        state.books = state.books.filter((item) => item.id !== book.id);
        emit();
        reportWriteError(error);
    }
}

export async function removeBook(id) {
    if (!isSaved(id)) return;

    if (!state.user) {
        const guest = readGuest().filter((item) => item.id !== id);
        writeGuest(guest);
        state.books = sortBooks(guest);
        emit();
        toast("আমার বই থেকে সরানো হয়েছে");
        return;
    }

    const previous = state.books;
    pending.set(id, { type: "delete", at: Date.now() });
    state.books = state.books.filter((item) => item.id !== id);
    emit();

    try {
        await deleteDoc(doc(db, "users", state.user.uid, "shelf", id));
        writeJson(cacheKey(state.user.uid), state.books);
        toast("আমার বই থেকে সরানো হয়েছে");
    } catch (error) {
        pending.delete(id);
        state.books = previous;
        emit();
        reportWriteError(error);
    }
}

export async function markReading(id) {
    /* Opening a book for the first time moves it to "reading".
       A finished book stays "done" until the reader says otherwise. */
    const book = state.books.find((item) => item.id === id);
    if (!book || book.status !== "unread") return;

    await setStatus(id, "reading");
}

export async function setStatus(id, status) {
    if (!["unread", "reading", "done"].includes(status)) return;

    const book = state.books.find((item) => item.id === id);
    if (!book || book.status === status) return;

    if (!state.user) {
        const guest = readGuest().map((item) =>
            item.id === id ? { ...item, status } : item
        );
        writeGuest(guest);
        state.books = sortBooks(guest);
        emit();
        return;
    }

    const previous = state.books;
    state.books = state.books.map((item) =>
        item.id === id ? { ...item, status } : item
    );
    emit();

    try {
        await updateDoc(doc(db, "users", state.user.uid, "shelf", id), {
            status,
            updatedAt: serverTimestamp(),
            lastOpenedAt: serverTimestamp()
        });
        writeJson(cacheKey(state.user.uid), state.books);
    } catch (error) {
        state.books = previous;
        emit();
        reportWriteError(error);
    }
}

function reportWriteError(error) {
    const code = (error && error.code) || "";
    if (code === "permission-denied") {
        toast("শেলফে সংরক্ষণ করা যায়নি — Firestore নিয়ম প্রকাশ করা হয়েছে কি না দেখুন", "error");
    } else if (code === "unavailable" || code === "failed-precondition") {
        toast("ইন্টারনেট সংযোগ পাওয়া যায়নি, আবার চেষ্টা করুন", "error");
    } else {
        toast("সংরক্ষণ করা যায়নি, আবার চেষ্টা করুন", "error");
    }
}
