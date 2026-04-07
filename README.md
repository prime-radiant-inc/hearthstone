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

To run on your iPhone, you need an Apple Developer account (free or paid). In Xcode:

1. Select the Hearthstone target
2. Under Signing & Capabilities, choose your team
3. Change the bundle identifier to something unique (e.g. `com.yourname.hearthstone`)
4. Connect your device and run

The simulator connects to `localhost:3000` automatically. For a physical device, replace `localhost` with your Mac's local IP address in `ios/Hearthstone/Services/APIClient.swift` — both devices must be on the same network.

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

## Sharing the App

You have three options for getting Hearthstone onto other people's phones.

### Option 1: Build on Their Mac

If your friend is technical, they clone the repo and build it themselves. They run their own backend, create their own household, and manage their own Google Cloud credentials. This is the full self-hosted path.

### Option 2: TestFlight (Recommended for Friends & Family)

TestFlight lets you distribute a build to up to 10,000 testers without going through App Store review. You need a paid Apple Developer account ($99/year).

1. In Xcode, set the bundle identifier to something you own (e.g. `com.yourname.hearthstone`)
2. Archive the app: Product > Archive
3. Upload to App Store Connect (Xcode walks you through this)
4. In [App Store Connect](https://appstoreconnect.apple.com), create an app record and add your build to a TestFlight group
5. Add testers by email — they get an invite to install via the TestFlight app

The app still needs a backend to talk to. Your testers either connect to your server (update `APIClient.swift` with your server's public URL before archiving) or run their own.

### Option 3: Ad Hoc Distribution

You can export a signed `.ipa` and send it directly, but each tester's device UDID must be registered in your Apple Developer account. TestFlight is easier for more than one or two people.

### What About the Backend?

The iOS app is just a client. Each household needs a running backend with an OpenAI key and (optionally) Google Drive credentials. For a small group of friends, you can run one server on [Fly.io](https://fly.io) and create a household for each person. Or each person runs their own.

## Architecture Notes

- **SQLite + sqlite-vec** for vector search. Embeddings are stored alongside the data in a single file. On macOS, Homebrew's SQLite is loaded automatically for extension support.
- **Chunk storage separates concerns.** Document text is stored clean; embedding decorations (title prefix, section breadcrumb) are constructed at embed time, not baked into the stored text.
- **The API spec is the contract.** Both the backend and iOS app conform to the shapes defined in `.brainstorm/spec.md`. Contract tests in `tests/api-contract.test.ts` enforce this.
- **PIN auth is the default.** Email-based auth exists in the codebase but is dormant. A commercial fork could re-enable it without structural changes.

## License

MIT
