# Firebase setup — মজলিস অনলাইন লাইব্রেরি

Two console steps are still required before sign-in and the shelf work on the
live site. Both are one-time.

## 1. Authorise your GitHub Pages domain

Firebase → Authentication → **Settings** → **Authorized domains** → **Add domain**:

```
mirajsaidulhaque-star.github.io
```

Without this, Google sign-in fails with `auth/unauthorized-domain` and the
verification / reset links point at a domain Firebase refuses to redirect to.

`localhost` is already authorised, so local testing needs no extra step.

## 2. Create Firestore and publish the rules

Firestore → **Create database** → **Production mode** → location
**asia-south1 (Mumbai)**.

Then open the **Rules** tab, replace everything with the contents of
[`firestore.rules`](firestore.rules) in this folder, and **Publish**.

Quick checks after publishing:

- A signed-in user may read/write only `users/<their-own-uid>/…`
- Nobody can write to any other collection
- The shelf page will show a clear "permission" message instead of an empty
  list if rules were not published

## 3. Local testing

Firebase Auth does not work from `file://`, and `127.0.0.1` is not the
authorised host. Serve the folder and open it through `localhost`:

```powershell
cd "path\to\bicmlibrary"
python -m http.server 5500
```

Then open: <http://localhost:5500/index.html>

In VS Code you can use Live Server instead; any port is fine because Firebase
whitelists the hostname, not the port.

## 4. What to test

1. Home page → top-right **লগইন** button appears, header is not distorted.
2. A category page (e.g. `catagory/hadith.html`) → same button, relative paths work.
3. Sign up with a real email → account is created, a verification mail arrives
   (check spam), and the "ইমেইল যাচাই করুন" screen appears.
4. Log in with email + password → redirects back to the page you came from.
5. Log in with Google → avatar appears in the header, dropdown opens.
6. Open **আমার বই** → empty shelf message (or a permission message if rules are
   not published yet).
7. Log out from the avatar menu.

### Shelf checks (no account needed)

8. Any book card → click the bookmark icon at the top-right of the cover. The
   icon fills in, the header shows a **আমার বই** icon with a count badge, and a
   toast confirms the save.
9. Click the header shelf icon → the drawer slides in with the saved book.
   Press `Esc` or click the backdrop to close it.
10. Open **আমার বই** → the book appears in the grid with "পড়া হয়নি".
11. Click **পড়ুন** on a book → status becomes "পড়ছি". The **পড়ছি** filter then
   shows only that book, and search narrows the grid.
12. On a card, click the **✓** button → the chip turns green "পড়া শেষ" and the
   **পড়া শেষ** filter lists it. The same button (now ↺) puts the book back to
   "পড়ছি". The drawer has the same ✓ control on every row.
   While the **পড়া শেষ** filter is open, click ↺ → the shelf jumps to **সব** and
   the book stays visible as "পড়ছি" instead of disappearing.
13. Reload the page → the bookmark is still filled, the badge still counts it,
   and every status you set is still there.

### Signed-in checks (after steps 1 and 2)

13. While still logged out, save two or three books. Then log in → a toast says
    the books were added to your account, and the header count stays the same.
14. Open the site in a private window, log in with the same account → the same
    shelf appears, proving it is stored in Firestore and not just locally.
15. Mark a book "পড়া শেষ", then open the second window → it already reads
    "পড়া শেষ", so the status follows the account, not the browser.
16. Remove a book with the trash button → it disappears from the grid, the
    drawer, and the card bookmark in one step.

## 5. Errors you might see and what they mean

| Message | Cause |
|---|---|
| এই ওয়েবসাইটের ডোমেইন Firebase-এ অনুমোদিত নয় | Step 1 not done |
| শেলফ পড়ার অনুমতি পাওয়া যায়নি | Rules not published, or Firestore missing |
| এই লগইন পদ্ধতিটি এই মুহূর্তে চালু নেই | Provider not enabled in Authentication |
| ইন্টারনেট সংযোগ পাওয়া যায়নি | Offline while loading the shelf (cached books still show) |

## 6. How guest bookmarks merge

Guests (not logged in) can save books; those go to `localStorage` under
`bicm_guest_shelf_v1`, so the count badge and drawer work immediately.

On the first sign-in after that, `shelf-store.js`:

1. Loads the account's existing shelf from Firestore **first**.
2. Saves only the guest books whose ID is not already on the account. Books the
   account already has are skipped — re-creating them would be a write the
   rules reject, and would overwrite the status you set on another device.
3. Clears the guest list once every book has been transferred. Anything that
   failed (e.g. offline) stays in `localStorage` and is retried on the next
   page load.

Books are keyed by Google Drive file ID taken from the card link, so the same
book saved from the home page and from a category page is one entry.

## 7. How reading status works

Every saved book carries one `status` field with three values. Nothing is timed
or guessed — one transition is automatic, the rest are your clicks.

| Status | Bengali | Set when |
|---|---|---|
| `unread` | পড়া হয়নি | You save a book (the default) |
| `reading` | পড়ছি | You open the book with **পড়ুন** (or click it in the drawer) |
| `done` | পড়া শেষ | You press the **✓** button on the card or drawer row |

Rules that make it predictable:

- **Opening a book never un-finishes it.** A `done` book stays `done` when you
  open it again, so a re-read doesn't silently reset your shelf.
- **The ✓ button is a toggle.** On a `done` book it becomes ↺ and sets the book
  back to `reading`. There is no separate "reset" hidden anywhere.
- **A book never seems to vanish.** If you change a status while a filter is
  active and the book no longer matches it (e.g. clicking ↺ inside **পড়া শেষ**),
  the shelf switches back to **সব** automatically so the card stays on screen.
  Before this, the card disappeared, which was easy to mistake for a delete.
- **Saving again does not reset a status**, because re-saving an existing book
  is ignored by the store — it only ever adds new books.
- **Status travels with the account.** For signed-in readers it is written to
  the Firestore document (`status` + `updatedAt`), so it is the same on every
  device. For guests it lives in `localStorage` on that browser.
- **Guests keep their own status.** If a guest sets a book to `done` and then
  logs in on an account that already has that book, the account's status wins
  and the guest status is dropped. This is deliberate: it keeps the account the
  source of truth. Set it again on the shelf page if needed.

The **সব / পড়া হয়নি / পড়ছি / পড়া শেষ** filters read this field directly, and the
count next to the title ("২টি বই") shows how many books match the current
filter and search, not the total.

## 8. Still to build

- Profile editing (display name, photo)
- Sorting / manual reordering of the shelf
- A "continue reading" strip on the home page
