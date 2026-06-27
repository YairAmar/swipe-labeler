# Deployment Runbook

This app is designed to run as one Node.js process on a MacBook. The images stay outside the repo, and annotations are saved to a local SQLite database on that MacBook.

## What To Copy

Copy these separately:

- Code: clone this GitHub repo.
- Data: AirDrop the image folder, for example to `~/Desktop/batch_images`.
- Results: keep the generated `annotations.sqlite` and `annotations.csv` files on the host MacBook.

Do not commit images, JSONL manifests, CSV exports, or SQLite databases. The repo `.gitignore` excludes those files.

## Requirements

- macOS
- Node.js `22.5` or newer
- Optional: `sqlite3` command-line tool for inspecting/backing up the DB

Check:

```bash
node --version
sqlite3 --version
```

If Node is missing or too old, install a current Node 22+ release from `nodejs.org` or with Homebrew:

```bash
brew install node
```

## Fresh MacBook Setup

Clone the fork:

```bash
git clone https://github.com/YairAmar/swipe-labeler.git
cd swipe-labeler
git switch codex/hebrew-swipe-annotator-sqlite
```

AirDrop the image directory to the MacBook. This guide assumes:

```text
~/Desktop/batch_images
```

Run a private local server:

```bash
./scripts/run-local.sh "$HOME/Desktop/batch_images" "$HOME/Desktop/annotator-output"
```

Open on that MacBook:

```text
http://127.0.0.1:3000
```

Outputs will be:

```text
~/Desktop/annotator-output/annotations.sqlite
~/Desktop/annotator-output/annotations.csv
```

## Public URL Access

This is the recommended workflow. It does not require the annotator to be on the same Wi-Fi, and it does not require an IP address, username, or password. Anyone with the URL can annotate.

Terminal 1:

```bash
./scripts/run-local.sh "$HOME/Desktop/batch_images" "$HOME/Desktop/annotator-output"
```

Terminal 2:

```bash
npx --yes cloudflared tunnel --url http://127.0.0.1:3000
```

Cloudflare prints a URL like:

```text
https://example-name.trycloudflare.com
```

Open that URL from any device. When prompted:

- No username is required.
- No password is required.

Keep both terminals open. If the tunnel dies, run the `cloudflared` command again and use the new URL.

## Same-Wi-Fi iPhone Access

This mode is optional. The public URL mode above avoids IP-address sharing.

Run the server on all network interfaces:

```bash
HOST=0.0.0.0 ./scripts/run-local.sh "$HOME/Desktop/batch_images" "$HOME/Desktop/annotator-output"
```

Find the MacBook Wi-Fi IP:

```bash
ipconfig getifaddr en0
```

Open this on the iPhone:

```text
http://<macbook-wifi-ip>:3000
```

Only use `HOST=0.0.0.0` on a trusted network.

## Annotation Storage

SQLite is the source of truth.

Main tables:

- `annotations`: current label per image file.
- `annotation_events`: append-only event log for annotate/import/undo actions.

Inspect counts:

```bash
sqlite3 "$HOME/Desktop/annotator-output/annotations.sqlite" \
  'select count(*) from annotations; select count(*) from annotation_events;'
```

Export CSV through the app:

```text
http://127.0.0.1:3000/api/export.csv
```

Or from the terminal:

```bash
curl http://127.0.0.1:3000/api/export.csv \
  -o "$HOME/Desktop/annotator-output/annotations.csv"
```

## Backups

Back up the SQLite DB before moving machines or stopping a long labeling session:

```bash
sqlite3 "$HOME/Desktop/annotator-output/annotations.sqlite" \
  ".backup '$HOME/Desktop/annotator-output/annotations-backup.sqlite'"
```

For a timestamped backup:

```bash
backup="$HOME/Desktop/annotator-output/annotations-backup-$(date +%Y%m%d-%H%M%S).sqlite"
sqlite3 "$HOME/Desktop/annotator-output/annotations.sqlite" ".backup '$backup'"
echo "$backup"
```

## Resume Later

Use the same output directory when restarting:

```bash
./scripts/run-local.sh "$HOME/Desktop/batch_images" "$HOME/Desktop/annotator-output"
```

The app loads existing SQLite rows and continues from the next unlabeled image.

## Safety Checklist Before Sharing

- Anyone with the public tunnel URL can annotate; share it only with intended annotators.
- Keep `HOST=127.0.0.1` when using a public tunnel so only the tunnel exposes the app.
- Do not push `batch_images`, `annotations.sqlite`, `annotations.csv`, or `batch_manifest.jsonl`.
- Back up `annotations.sqlite` periodically.
- Stop the tunnel when the labeling session is done.
