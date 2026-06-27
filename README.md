# Hebrew Swipe Annotator

Mobile-first yes/no/skip image annotation for Hebrew image datasets. The app serves images from a local folder, shows the Hebrew prompt, and saves every action to a local SQLite database on the host laptop.

## Quick Start

```bash
git clone https://github.com/YairAmar/swipe-labeler.git
cd swipe-labeler
git switch codex/hebrew-swipe-annotator-sqlite

./scripts/run-local.sh "$HOME/Desktop/batch_images" "$HOME/Desktop/annotator-output"
```

Open:

```text
http://127.0.0.1:3000
```

The image folder should be copied separately, for example by AirDrop. Do not commit image data to the repo.

## Recommended Hosting Mode: Public URL

Start the server on the MacBook:

```bash
./scripts/run-local.sh "$HOME/Desktop/batch_images" "$HOME/Desktop/annotator-output"
```

In another terminal, create the public URL:

```bash
npx --yes cloudflared tunnel --url http://127.0.0.1:3000
```

Cloudflare prints a URL like:

```text
https://example-name.trycloudflare.com
```

Share that URL. No IP address, username, or password is required.

Keep both terminals open while annotating. If the tunnel dies, run the `cloudflared` command again and use the new URL.

## Other Hosting Modes

Private on the MacBook:

```bash
./scripts/run-local.sh "$HOME/Desktop/batch_images" "$HOME/Desktop/annotator-output"
```

iPhone on the same Wi-Fi, if you do not want a public URL:

```bash
HOST=0.0.0.0 ./scripts/run-local.sh "$HOME/Desktop/batch_images" "$HOME/Desktop/annotator-output"
ipconfig getifaddr en0
```

Then open `http://<macbook-wifi-ip>:3000` on the iPhone.

See [DEPLOYMENT.md](DEPLOYMENT.md) for the full MacBook-to-MacBook runbook, backup commands, tunnel instructions, and safety checklist.

## Annotation Behavior

- Swipe right or tap `Yes` to write `yes`.
- Swipe left or tap `No` to write `no`.
- Tap `Skip` to write `skip`.
- `Undo` reverses the last annotation in the current server session.
- `CSV` downloads the current CSV export.
- Existing SQLite rows are loaded on startup, so the app resumes from the next unlabeled image.
- Existing CSV rows are imported into SQLite on startup if the DB does not already contain them.

## Storage

SQLite is the source of truth.

Default output from `scripts/run-local.sh`:

```text
run-data/annotations.sqlite
run-data/annotations.csv
```

Recommended output on another MacBook:

```text
~/Desktop/annotator-output/annotations.sqlite
~/Desktop/annotator-output/annotations.csv
```

Database tables:

- `annotations`: current label per image file.
- `annotation_events`: append-only event log for annotate/import/undo actions.

CSV format:

```csv
file,prompt,label,annotated_at
```

## Direct Server Command

The helper script is preferred, but the raw command is:

```bash
node --no-warnings server.js \
  --data /path/to/images \
  --db /path/to/annotations.sqlite \
  --save /path/to/annotations.csv \
  --host 127.0.0.1 \
  --port 3000
```

## Dataset Handling

If `batch_manifest.jsonl` exists inside the image directory, the app uses `word_hebrew` from that manifest as the displayed prompt. Otherwise it derives the prompt from the filename by removing suffixes like `__003`.

Images are served through stable internal IDs, so Hebrew filenames, spaces, apostrophes, and punctuation do not appear in image URLs.

The server detects image MIME type from file bytes. This matters when files have `.png` names but contain JPEG bytes.

## Development Checks

```bash
npm run check
```

Generated data is ignored by git:

- image folders and image files
- `*.jsonl`
- `*.csv`
- `*.sqlite`
- SQLite WAL/SHM files
