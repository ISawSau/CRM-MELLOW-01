# CRM Mellow

**English** · [Español](README.es.md)

A personal CRM for Meta media buyers. It runs on Windows, Linux and Android, works offline and keeps all your data encrypted in a single portable folder (the _vault_). It is free, has no accounts or servers, and never writes to your ad accounts.

The interface is in Spanish (Spain) and English (UK); you pick the language on the password screen or in Settings.

## What it does

- **Clients and contacts** with pipelines, custom fields, saved views (table, list, kanban, calendar, gallery), filters, undo and a recycle bin.
- **Meta Ads, read-only:** campaigns, ad sets and ads with daily history, an Ads Manager-style table, your own calculated metrics (safe formula parser, no `eval`), breakdowns, a click-through to each ad's public preview and colour coding against each client's CPA or ROAS target.
- **Analysis:** dashboards, period comparisons, alerts, monthly spend pacing, creative fatigue detection and A/B test tracking with a significance test.
- **Tasks, briefs and notes,** with templates and a timer that logs hours per client.
- **Creative and copy library:** encrypted files with thumbnails, linked automatically to the ads that use them.
- **Billing:** invoices, payments, revenue and profit per hour, PDF reports for clients.
- **File tools** (desktop): compress and convert images, video (FFmpeg) and PDFs.
- **Gmail, read-only:** email threads per client and contact.
- **Sync between devices** through your own Google Drive or any synced folder, with automatic backups.
- **Personalisation:** theme editor, configurable home cards, section icons and custom collections.

## Privacy and security

- Everything lives in the vault folder you choose. The database is SQLite encrypted with SQLCipher 4; attached files are encrypted with AES-256-GCM. Your password goes through Argon2id and there is a recovery key in case you forget it.
- Meta and Google tokens are stored only inside the encrypted database.
- The Meta connection uses only the `ads_read` permission: the app cannot create, edit, pause or delete ads, or change budgets.
- No telemetry. The only network requests go to Meta, Google (if you connect them) and, unless you turn it off, a daily check on this repository's GitHub Releases for a new version.
- Electron hardening: context isolation, sandbox, no Node in the renderer, strict CSP, external links open in your browser.

## Install

Download the file for your system from **[Releases](https://github.com/ISawSau/CRM-MELLOW-01/releases/latest)**:

| System | File | How |
|---|---|---|
| Windows 10/11 | `CRM-Mellow-<version>-windows-x64-instalador.exe` | Double-click and follow the wizard. It is unsigned (signing costs money), so if Windows SmartScreen appears choose _More info → Run anyway_. |
| Arch Linux | `CRM-Mellow-<version>-linux-x64.pacman` | `sudo pacman -U CRM-Mellow-<version>-linux-x64.pacman` |
| Other Linux | `CRM-Mellow-<version>-linux-x86_64.AppImage` | Make it executable and run it. |
| Android 10+ (arm64) | `CRM-Mellow-<version>-android-arm64.apk` | Open it on the phone and allow installing from your browser. Built with GrapheneOS in mind; Google Play services are not needed. |

`SHA256SUMS.txt` lets you check the downloads. To update, install the new version on top: your data is in the vault, never in the app.

## Connecting your accounts

The app never ships with shared credentials: you create your own (free) keys and they stay in your vault.

- **Google Drive and Gmail:** in [Google Cloud Console](https://console.cloud.google.com/), create a project, enable the _Google Drive API_ (and the _Gmail API_ if you want email), configure the consent screen and add yourself as a test user. Then create an OAuth client of type **Desktop app** and paste its client ID (it ends in `.apps.googleusercontent.com`) and secret into the app. The same desktop client also works on Android. Drive access uses the `drive.file` scope, so the app only sees the files it creates.
- **Meta:** in Business Settings, create a system user, assign it your ad accounts with view-only access and generate a token for your app with only the `ads_read` permission and expiry set to _Never_. Paste it in _Campaigns_.

The app walks you through these steps on each settings screen.

## Building from source

Requirements: Git and Node.js 22.12 or newer (the scripts install it if missing). The install scripts set everything up and run the tests:

```bash
# Arch Linux
git clone https://github.com/ISawSau/CRM-MELLOW-01.git && cd CRM-MELLOW-01
bash scripts/instalar-arch.sh
```

```powershell
# Windows (PowerShell)
git clone https://github.com/ISawSau/CRM-MELLOW-01.git; cd CRM-MELLOW-01
powershell -ExecutionPolicy Bypass -File scripts\instalar-windows.ps1
```

| Task | Command |
|---|---|
| Install dependencies only | `npm ci` |
| Run in development | `npm run dev` |
| Lint, types, format | `npm run lint` · `npm run typecheck` · `npx prettier --check .` |
| Unit tests | `npm test` |
| UI tests (Playwright + Electron) | `npm run test:e2e` (headless Linux: `xvfb-run -a npm run test:e2e`; not as root) |
| Mobile UI tests | `npm run test:e2e:movil` |
| Windows installer | `npm run dist:win` → `release/*.exe` |
| Linux packages | `npm run dist:linux` → `release/*.pacman`, `release/*.AppImage` (needs `bsdtar`) |
| Android APK | `bash scripts/compilar-android.sh` → `release/*-android-arm64.apk` (Android SDK, NDK 28.2.13676358, JDK 17+, Gradle 9.6+) |
| Self-test of an install | `crm-mellow --autoprueba` |

GitHub Actions runs the tests on every push and builds the Windows and Linux installers and the Android APK (tested in an emulator). When the version in `package.json` goes up, the workflow publishes a release.

### Signing the Android app in your fork

Android only updates an app if the new APK is signed with the same key, so CI needs a signing key stored as repository secrets (without them it still builds and tests the APK, but does not publish it):

1. Create a key: `keytool -genkeypair -keystore crm-mellow.jks -alias crm-mellow -keyalg RSA -keysize 4096 -validity 36500` (on Windows use PowerShell and `"$HOME\crm-mellow.jks"`). Keep it and a backup outside the repository.
2. Encode it: `base64 -w0 crm-mellow.jks > crm-mellow.txt` (PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("$HOME\crm-mellow.jks")) | Set-Content "$HOME\crm-mellow.txt"`).
3. In _Settings → Secrets and variables → Actions_ add `ANDROID_KEYSTORE_B64` (the text file's content), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_PASSWORD` and `ANDROID_KEY_ALIAS` (`crm-mellow`).

## Project documents

Written in Spanish:

- [`docs/SPEC.md`](docs/SPEC.md): full specification and build phases.
- [`docs/DECISIONS.md`](docs/DECISIONS.md): every technical decision and why it was made.
- [`docs/DESIGN.md`](docs/DESIGN.md): visual design.

## Contributing

This is a personal tool shared as is. Bug reports and suggestions are welcome in [Issues](https://github.com/ISawSau/CRM-MELLOW-01/issues); for larger changes, open an issue first. Visible text goes through `t()` in Spanish with its English translation in `src/shared/i18n/en/`, and the coverage test fails if one is missing.

## Licence

[MIT](LICENSE) © yellowmellow.

The desktop installers also include FFmpeg (GPL-3.0, run as a separate program) and libheif (LGPL-3.0). Their licences and sources are listed in [`build/licencias/`](build/licencias/LEEME.txt).

CRM Mellow is not affiliated with or endorsed by Meta or Google.
