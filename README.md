# Hebrew Swipe Annotator

Mobile-first yes/no image annotation for Hebrew image datasets.

## Run on this dataset

```bash
cd /Users/yair/Documents/Codex/2026-06-27/assume-i-have-a-set-of/outputs/hebrew-swipe-annotator
npm run start:dataset
```

This starts a local SQLite database at `./annotations.sqlite` and a CSV export at `./annotations.csv`. Then open:

```text
http://127.0.0.1:3000
```

For iPhone on the same Wi-Fi, find your machine IP and open:

```text
http://<your-computer-ip>:3000
```

The server prints the phone URL pattern when it starts. The `start:dataset` script binds to `0.0.0.0`, which allows other devices on the local network to connect.

## Custom run

```bash
node server.js \
  --data /path/to/images \
  --db /path/to/annotations.sqlite \
  --save /path/to/annotations.csv \
  --host 0.0.0.0 \
  --port 3000
```

Optional password protection:

```bash
node server.js \
  --data /path/to/images \
  --db /path/to/annotations.sqlite \
  --save /path/to/annotations.csv \
  --host 0.0.0.0 \
  --port 3000 \
  --password "choose-a-password"
```

When password protection is enabled, the browser can use any username; only the password is checked.

## Annotation behavior

- Swipe right or tap `Yes` to write `yes`.
- Swipe left or tap `No` to write `no`.
- Tap `Skip` to write `skip`; skipped images are considered handled and will not reappear unless you remove their CSV row.
- `Undo` reverses the last annotation in the current server session.
- `CSV` downloads the current annotation CSV export.
- Existing SQLite rows are loaded on startup, so the app resumes from the next unlabeled image.
- Existing CSV rows are imported into SQLite on startup if the DB does not already contain them.

The CSV format is:

```csv
file,prompt,label,annotated_at
```

SQLite is the source of truth. The database has:

- `annotations`: the current label per file.
- `annotation_events`: an append-only event log for annotate/import/undo actions.

## Dataset-specific handling

If `batch_manifest.jsonl` exists inside the image directory, the app uses `word_hebrew` from that manifest as the displayed prompt. Otherwise it derives the prompt from the filename by removing suffixes like `__003`.

Images are served through stable internal IDs, so Hebrew filenames, spaces, and punctuation do not need to appear in image URLs.

## Simple AWS option

For a minimal remote setup, use one small EC2 or Lightsail instance:

1. Install Node.js 18+.
2. Copy this folder and the image directory to the instance.
3. Run the server with `--host 0.0.0.0 --db /path/to/annotations.sqlite --password <password>`.
4. Open only the selected port in the security group, preferably to known IPs.
5. Download `annotations.csv` when labeling is complete.

For sensitive images, put the service behind HTTPS and stronger auth before sharing it broadly.
