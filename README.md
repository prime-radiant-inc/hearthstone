# Hearthstone

Your household's knowledge, always at hand.

Hearthstone gives babysitters, house-sitters, and family members instant answers to household questions — WiFi passwords, bedtime routines, emergency contacts, appliance quirks — drawn from the Google Docs you already maintain. Owners connect their docs once. Guests get a six-digit PIN and ask questions in plain language.

## How It Works

1. You run the server and create a household from the command line
2. You open the iOS app and enter your owner PIN
3. You connect your Google Drive and pick which docs to index
4. You invite a guest — the app shows a PIN and QR code
5. The guest enters the PIN and starts asking questions

Answers are grounded in your documents. The AI cites its sources, and guests can tap through to read the original.

## Prerequisites

- **[Bun](https://bun.sh)** (v1.1+) — the backend runtime
- **[Homebrew](https://brew.sh)** — for SQLite with extension support on macOS
- **Xcode 16+** — to build the iOS app
- **An OpenAI API key** — for embeddings and chat (GPT-5.4 / text-embedding-3-small)
- **A Google Cloud project** — for Drive access (see [Google Drive Setup](#google-drive-setup) below)

Install Homebrew's SQLite (required on macOS for vector search):

```bash
brew install sqlite
```

## Backend Setup

```bash
cd backend
bun install
```

Copy the example environment file and fill in your keys:

```bash
cp .env.example .env
```

Edit `.env`:

```
OPENAI_API_KEY=sk-...        # Required — your OpenAI API key
JWT_SECRET=some-random-string # Required — any secret string for signing tokens
APP_BASE_URL=http://localhost:3000
```

Leave `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` empty for now. Set them up later when you're ready for Google Drive. The server starts without them.

Start the server:

```bash
bun run dev
```

You should see: `Hearthstone backend running on http://localhost:3000`

## Create Your Household

In a second terminal:

```bash
cd backend
bun run create-household
```

Enter a household name and your email (used as a label, not for sending mail). The command prints a six-digit PIN:

```
Household name: The Anderson Home
Owner email: matt@example.com

✓ Created household "The Anderson Home"
✓ Owner PIN: 482901
  Expires: 2026-04-13

Enter this PIN in the Hearthstone app to sign in as the owner.
```

If your PIN expires, generate a new one:

```bash
bun run owner-pin
```

This lists your households. Pass the household ID to get a fresh PIN.

## iOS App

Open the Xcode project:

```bash
open ios/Hearthstone.xcodeproj
```

Select your target device or simulator, then build and run (Cmd+R).

The app opens to a PIN entry screen. Type the six-digit owner PIN from the previous step.

### Running on a Physical Device

To run on your iPhone, you need an Apple Developer account (free or paid). In Xcode, select the Hearthstone target, choose your team under Signing & Capabilities, connect your device, and run.

Debug builds connect to `localhost:3000`, which works on the simulator but not on a phone. For local testing on a physical device, temporarily change the debug URL in `APIClient.swift` to your Mac's local IP (both devices must be on the same WiFi network). For production testing, build with Release configuration — it connects to the Fly deployment URL.

## Google Drive Setup

Hearthstone reads your Google Docs to answer questions. This requires OAuth credentials from a Google Cloud project.

Google's console changes often, so these steps are directional rather than exact. The goal is to end up with a Client ID and Client Secret for a "Web application" OAuth client.

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a project (or use an existing one)
3. Enable the **Google Drive API** (APIs & Services > Library)
4. Configure the **OAuth consent screen** (APIs & Services > OAuth consent screen)
   - Choose "External" user type
   - Fill in the app name and your email
   - Add the scope `https://www.googleapis.com/auth/drive.readonly`
   - Add your Google account as a test user
5. Create **OAuth credentials** (APIs & Services > Credentials > Create Credentials > OAuth client ID)
   - Application type: Web application
   - Authorized redirect URI: `http://localhost:3000/connections/google-drive/callback`

   This redirect URI must match your `APP_BASE_URL` in `.env`. If you change the base URL (for production, for example), update the redirect URI in Google Cloud to match.

6. Copy the Client ID and Client Secret into your `.env`:

```
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
```

Restart the backend (`bun run dev`). In the iOS app, go to Documents and tap "Connect Google Drive."

## Inviting Guests

From the owner dashboard, tap **+ Add Guest**. Enter the guest's name and, optionally, their email (stored as a label, not used to send anything). The app displays a six-digit PIN and a QR code.

Share the PIN with your guest. They open the Hearthstone app, type the six digits, and land in a chat interface connected to your household's documents.

To revoke access, tap the guest's card and choose Revoke. Their next request will fail, and the app transitions to an "access revoked" screen.

## Project Structure

```
backend/            Bun/TypeScript API server
  src/              Application code
    db/             SQLite schema, migrations, connection
    routes/         HTTP route handlers
    services/       Business logic (chunking, search, AI, pins)
    middleware/     Auth middleware
  cli/              CLI tools (create-household, owner-pin)
  eval/             Evaluation harness for RAG quality
  tests/            Backend tests (bun test)

ios/                SwiftUI iOS app
  Hearthstone/
    Views/          All screens (Auth, Owner, Guest, Error)
    ViewModels/     State management
    Services/       APIClient, SSEClient, KeychainService
    Models/         Data models
```

## Running Tests

```bash
cd backend
bun test
```

Tests cover route handlers, services, database schema, and API contract conformance.

## Deploying to Fly.io

The backend runs on a single [Fly.io](https://fly.io) machine with a persistent volume for SQLite. No Postgres, no replication.

### Prerequisites

- A Fly.io account (free tier works)
- The [Fly CLI](https://fly.io/docs/flyctl/install/) installed and authenticated (`fly auth login`)

### Deploy

From the `backend/` directory:

```bash
fly launch --no-deploy
```

Accept the defaults. This creates the app from the existing `fly.toml`.

Create a 1GB persistent volume for the database:

```bash
fly volumes create hearthstone_data --size 1 --region sjc
```

Set your secrets:

```bash
fly secrets set \
  OPENAI_API_KEY="sk-..." \
  JWT_SECRET="$(openssl rand -base64 32)" \
  GOOGLE_CLIENT_ID="your-client-id" \
  GOOGLE_CLIENT_SECRET="your-client-secret" \
  APP_BASE_URL="https://your-app-name.fly.dev"
```

Deploy:

```bash
fly deploy
```

Verify the server is running:

```bash
curl https://your-app-name.fly.dev/
# {"message":"Not found"}  ← this is correct (404, but the server is up)
```

### Create a household in production

```bash
fly ssh console -C "sh -c 'cd /app && bun run create-household'"
```

### Google OAuth in production

Add your production callback URL in the Google Cloud Console under Credentials:

```
https://your-app-name.fly.dev/connections/google-drive/callback
```

Keep the `localhost:3000` one for local development.

### How it's configured

The `fly.toml` sets `auto_stop_machines = "suspend"` — the machine sleeps when idle and wakes on the first request (~2-3 seconds cold start). Fine for a household app. The database lives on a persistent NVMe volume at `/data/hearthstone.db`, which survives deploys and restarts.

## Distributing the iOS App

The iOS app is a client. It needs a running backend to talk to.

`APIClient.swift` uses a compile-time flag: debug builds connect to `localhost:3000`, release builds connect to the production URL in the `#else` branch. Update that URL to your Fly deployment before archiving.

### TestFlight (recommended)

TestFlight distributes builds to up to 100 internal testers without App Store review. You need a paid Apple Developer Program membership ($99/year).

The process: register a bundle ID in the Apple Developer portal, create an app in App Store Connect, archive the build in Xcode, and upload it. Add testers by Apple ID email — they install via the TestFlight app on their phone.

Apple's UI for this changes regularly. Search "TestFlight internal testing" for current steps.

### Other options

**Build locally:** Technical users can clone the repo, open the Xcode project, and build to their own device. They run their own backend or point at yours.

**Ad hoc:** Export a signed `.ipa` from Xcode and send it directly. Each device UDID must be registered in your developer account. TestFlight is easier for more than two people.

## Architecture Notes

- **SQLite + sqlite-vec** for vector search. Embeddings are stored alongside the data in a single file. On macOS, Homebrew's SQLite is loaded automatically for extension support.
- **Chunk storage separates concerns.** Document text is stored clean; embedding decorations (title prefix, section breadcrumb) are constructed at embed time, not baked into the stored text.
- **The API spec is the contract.** Both the backend and iOS app conform to the shapes defined in `.brainstorm/spec.md`. Contract tests in `tests/api-contract.test.ts` enforce this.
- **PIN auth is the default.** Email-based auth exists in the codebase but is dormant. A commercial fork could re-enable it without structural changes.

## License

MIT
