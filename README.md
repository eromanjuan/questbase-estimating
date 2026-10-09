# Questbase Estimating & Proposals

One underwriting sheet for any kind of construction. An estimator opens a ticket for a job, picks the scope of work, confirms what is included, and fills in the underwriting sheet: what the client pays, what the job costs, and what is left. The estimator submits it. An approver sees the profit and anything that looks off, then approves it or sends it back with a note. Approval unlocks the client proposal as a PDF.

## What is here

| Path | What it is |
|---|---|
| `public/` | The app. A static site served by Firebase Hosting. |
| `public/index.html` | The page. Open it and the app runs. |
| `public/app.js` | The screens: ticket queue, one ticket, Setup, auth, people. |
| `public/app.css` | The Quest Base look. |
| `public/firebase-config.js` | **Your Firebase web app config.** Paste it in before deploying. |
| `public/vendor/` | jsPDF and the shared rule engine, served locally. |
| `functions/` | The API: auth, state sync, ticket actions, people, the proposal PDF. |
| `shared/` | The rule engine and proposal sheet, shared by the browser and the server. |
| `scripts/` | One-time migration scripts and the number test. |
| `firestore.rules` | Who may read and write what. |
| `firebase.json` | Hosting, Firestore and Functions config. |

## Running it

### 1. Set up Firebase

1. Go to the [Firebase console](https://console.firebase.google.com/u/2/project/quest-estimating/overview) → **Build → Firestore Database** → **Create database** (production mode is fine).
2. Go to **Build → Authentication** → **Get started** → enable **Email/Password**.
3. Go to **Project settings → General → Your apps** → **Web app** (the `</>` icon) → register it → copy the `firebaseConfig` object into `public/firebase-config.js`.
4. Go to **Project settings → Service accounts** → **Generate new private key**. In the Firebase console's **Functions** settings (or your hosting environment), set `FIREBASE_API_KEY` to your web API key (from the same Project settings page).

### 2. Deploy

```bash
npm install -g firebase-tools
firebase login
firebase deploy
```

The app is then at **https://quest-estimating.web.app**.

### 3. First run

Open the site. With no accounts yet it asks you to create the first one — that account is the **approver**. The approver can add other people under **People** in the top bar, as estimators or approvers.

## How it works

- **Templates** are the underwriting sheets. Two come built in: **Framing** (costed by the day with a crew) and **Roofing** (costed by the piece, with materials). More are added in Setup.
- **A ticket** is one job. The estimator picks the scope of work, answers the questions, and fills in the sheet. The approver sees the quote, the profit and the flags, then approves or sends it back.
- **Approval** unlocks the proposal PDF, drawn from the same layout pass as the on-screen preview.
- **Every figure is computed twice**: in the browser for live editing, and on the server when a ticket is submitted or approved. The server's number is the one stored.

## The rule engine

`shared/qb-rules.js` and `shared/qb-sheet.js` are plain modules that run in the browser and on the server. The browser loads them as scripts; the server requires them. The same code produces the same numbers in both places.

`npm test` checks the engine against every figure in the original handoff document — Abraham's framing and roofing sheets, to the cent.

## Data

Firestore collections:

| Collection | What it holds |
|---|---|
| `templates/{id}` | One template: its scopes of work, questions, lines, prices, rates, wording. |
| `tickets/{id}` | One ticket: its scope, answers, underwriting, status, history, frozen copy, snapshot. |
| `users/{id}` | Name, email, password hash, role. |
| `sessions/{token}` | A sign-in session. |
| `kv/{key}` | The ticket number counter and the last estimator's name. |

## Known limits

- Two people editing the same ticket at once: last save wins. There is no locking yet.
- The PDF uses the built-in Helvetica face, so a name with letters outside Western European is folded to plain Latin letters.
- Notifications (an email to the approver on submit) are not built.
- The letterhead is fixed to Quest Roofing. If proposals go out under another company, it has to become data.
