#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const IMAGE_EXTENSIONS = new Set([".apng", ".avif", ".gif", ".jpeg", ".jpg", ".png", ".webp"]);
const CONTENT_TYPES = new Map([
  [".apng", "image/apng"],
  [".avif", "image/avif"],
  [".gif", "image/gif"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".webp", "image/webp"]
]);

function parseArgs(argv) {
  const defaults = {
    data: process.env.DATA_DIR || "",
    save: process.env.ANNOTATIONS_CSV || path.join(process.cwd(), "annotations.csv"),
    db: process.env.ANNOTATIONS_DB || "",
    host: process.env.HOST || "127.0.0.1",
    port: process.env.PORT || "3000",
    manifest: process.env.MANIFEST || "",
    labelLeft: process.env.LABEL_LEFT || "no",
    labelRight: process.env.LABEL_RIGHT || "yes",
    labelSkip: process.env.LABEL_SKIP || "skip",
    password: process.env.ANNOTATOR_PASSWORD || ""
  };
  const args = { ...defaults };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }

    const next = argv[i + 1];
    const setValue = (key) => {
      if (!next || next.startsWith("--")) {
        throw new Error(`${arg} requires a value`);
      }
      args[key] = next;
      i += 1;
    };

    switch (arg) {
      case "--data":
      case "-d":
        setValue("data");
        break;
      case "--save":
      case "-s":
        setValue("save");
        break;
      case "--db":
        setValue("db");
        break;
      case "--host":
        setValue("host");
        break;
      case "--port":
      case "-p":
        setValue("port");
        break;
      case "--manifest":
      case "-m":
        setValue("manifest");
        break;
      case "--label-left":
        setValue("labelLeft");
        break;
      case "--label-right":
        setValue("labelRight");
        break;
      case "--label-skip":
        setValue("labelSkip");
        break;
      case "--password":
        setValue("password");
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return args;
}

function printHelp() {
  console.log(`
Usage:
  node server.js --data <image-dir> --db <annotations.sqlite> --save <annotations.csv> [options]

Options:
  -d, --data <dir>           Directory containing images
      --db <sqlite>          SQLite database for saved labels; defaults beside CSV
  -s, --save <csv>           CSV export path; generated from the database
  -m, --manifest <jsonl>     Optional JSONL manifest; defaults to batch_manifest.jsonl in data dir
  -p, --port <port>          Port to listen on (default: 3000)
      --host <host>          Host to bind (default: 127.0.0.1, use 0.0.0.0 for phone/LAN)
      --label-left <label>   Label for left swipe (default: no)
      --label-right <label>  Label for right swipe (default: yes)
      --label-skip <label>   Label for skip button (default: skip)
      --password <password>  Optional basic-auth password, username can be anything
  -h, --help                 Show this help
`);
}

function isInside(childPath, parentPath) {
  const relative = path.relative(parentPath, childPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function readManifest(manifestPath) {
  const metadata = new Map();
  if (!manifestPath) {
    return metadata;
  }

  try {
    const text = await fsp.readFile(manifestPath, "utf8");
    for (const [lineNumber, rawLine] of text.split(/\r?\n/).entries()) {
      const line = rawLine.trim();
      if (!line) continue;
      try {
        const row = JSON.parse(line);
        if (row.filename) {
          metadata.set(row.filename, row);
        }
      } catch (error) {
        console.warn(`Skipping malformed manifest line ${lineNumber + 1}: ${error.message}`);
      }
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  return metadata;
}

function promptFromFilename(filename) {
  const parsed = path.parse(filename);
  return parsed.name
    .replace(/_{1,}\d+$/u, "")
    .replace(/_+$/u, "")
    .replace(/_/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function createId(relativePath) {
  return crypto.createHash("sha1").update(relativePath).digest("base64url").slice(0, 12);
}

async function scanImages(dataDir, manifestMetadata) {
  const entries = await fsp.readdir(dataDir, { withFileTypes: true });
  const images = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;

    const extension = path.extname(entry.name).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(extension)) continue;

    const absolutePath = path.resolve(dataDir, entry.name);
    if (!isInside(absolutePath, dataDir)) continue;

    const relativePath = entry.name;
    const manifest = manifestMetadata.get(entry.name) || {};
    images.push({
      id: createId(relativePath),
      filename: entry.name,
      relativePath,
      absolutePath,
      prompt: manifest.word_hebrew || promptFromFilename(entry.name),
      meaning: manifest.meaning || "",
      category: manifest.category || "",
      manifestIndex: Number.isFinite(manifest.index) ? manifest.index : Number.POSITIVE_INFINITY
    });
  }

  images.sort((a, b) => {
    if (a.manifestIndex !== b.manifestIndex) {
      return a.manifestIndex - b.manifestIndex;
    }
    return a.filename.localeCompare(b.filename, "he");
  });

  const ids = new Set();
  for (const image of images) {
    if (ids.has(image.id)) {
      throw new Error(`ID collision for image ${image.filename}`);
    }
    ids.add(image.id);
  }

  return images;
}

async function detectImageContentType(filePath) {
  const handle = await fsp.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(16);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const bytes = buffer.subarray(0, bytesRead);

    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return "image/jpeg";
    }
    if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
      return "image/png";
    }
    if (bytes.length >= 6 && (bytes.subarray(0, 6).toString("ascii") === "GIF87a" || bytes.subarray(0, 6).toString("ascii") === "GIF89a")) {
      return "image/gif";
    }
    if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") {
      return "image/webp";
    }
    if (bytes.length >= 12 && bytes.subarray(4, 12).toString("ascii") === "ftypavif") {
      return "image/avif";
    }

    return CONTENT_TYPES.get(path.extname(filePath).toLowerCase()) || "application/octet-stream";
  } finally {
    await handle.close();
  }
}

function csvEscape(value) {
  const stringValue = String(value ?? "");
  if (/[",\r\n]/u.test(stringValue)) {
    return `"${stringValue.replace(/"/gu, "\"\"")}"`;
  }
  return stringValue;
}

function csvLine(values) {
  return values.map(csvEscape).join(",");
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (char === "\"" && next === "\"") {
        field += "\"";
        i += 1;
      } else if (char === "\"") {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === "\"") {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

async function loadCsvAnnotations(savePath, imagesByFilename) {
  const annotations = new Map();
  try {
    const text = await fsp.readFile(savePath, "utf8");
    const rows = parseCsv(text).filter((row) => row.some((field) => field.trim() !== ""));
    const header = rows.shift() || [];
    const fileIndex = header.indexOf("file");
    const labelIndex = header.indexOf("label");
    const promptIndex = header.indexOf("prompt");
    const atIndex = header.indexOf("annotated_at");

    if (fileIndex === -1 || labelIndex === -1) {
      console.warn(`Ignoring ${savePath}: expected CSV columns file,label`);
      return annotations;
    }

    for (const row of rows) {
      const filename = row[fileIndex];
      const label = row[labelIndex];
      if (!filename || !imagesByFilename.has(filename)) continue;
      annotations.set(filename, {
        file: filename,
        prompt: row[promptIndex] || imagesByFilename.get(filename).prompt,
        label,
        annotated_at: row[atIndex] || ""
      });
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
  return annotations;
}

class AnnotationStore {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS annotations (
        file TEXT PRIMARY KEY,
        prompt TEXT NOT NULL,
        label TEXT NOT NULL,
        annotated_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS annotation_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file TEXT NOT NULL,
        prompt TEXT NOT NULL,
        label TEXT,
        action TEXT NOT NULL,
        happened_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS annotation_events_file_idx
        ON annotation_events(file);
    `);

    this.selectAnnotations = this.db.prepare(`
      SELECT file, prompt, label, annotated_at
      FROM annotations
      ORDER BY rowid
    `);
    this.upsertAnnotation = this.db.prepare(`
      INSERT INTO annotations (file, prompt, label, annotated_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(file) DO UPDATE SET
        prompt = excluded.prompt,
        label = excluded.label,
        annotated_at = excluded.annotated_at,
        updated_at = excluded.updated_at
    `);
    this.insertAnnotationIfMissing = this.db.prepare(`
      INSERT OR IGNORE INTO annotations (file, prompt, label, annotated_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    this.deleteAnnotation = this.db.prepare(`
      DELETE FROM annotations
      WHERE file = ?
    `);
    this.insertEvent = this.db.prepare(`
      INSERT INTO annotation_events (file, prompt, label, action, happened_at)
      VALUES (?, ?, ?, ?, ?)
    `);
  }

  loadCurrent(imagesByFilename) {
    const annotations = new Map();
    for (const row of this.selectAnnotations.all()) {
      if (!imagesByFilename.has(row.file)) continue;
      annotations.set(row.file, {
        file: row.file,
        prompt: row.prompt,
        label: row.label,
        annotated_at: row.annotated_at
      });
    }
    return annotations;
  }

  importCsvAnnotations(csvAnnotations) {
    if (csvAnnotations.size === 0) return 0;

    let imported = 0;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const annotation of csvAnnotations.values()) {
        const annotatedAt = annotation.annotated_at || new Date().toISOString();
        const result = this.insertAnnotationIfMissing.run(
          annotation.file,
          annotation.prompt,
          annotation.label,
          annotatedAt,
          annotatedAt
        );
        if (result.changes > 0) {
          imported += 1;
          this.insertEvent.run(annotation.file, annotation.prompt, annotation.label, "import", annotatedAt);
        }
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return imported;
  }

  saveAnnotation(annotation) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.upsertAnnotation.run(
        annotation.file,
        annotation.prompt,
        annotation.label,
        annotation.annotated_at,
        annotation.annotated_at
      );
      this.insertEvent.run(annotation.file, annotation.prompt, annotation.label, "annotate", annotation.annotated_at);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  restoreAnnotation(filename, previous) {
    const happenedAt = new Date().toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (previous) {
        this.upsertAnnotation.run(
          previous.file,
          previous.prompt,
          previous.label,
          previous.annotated_at,
          happenedAt
        );
        this.insertEvent.run(previous.file, previous.prompt, previous.label, "undo_restore", happenedAt);
      } else {
        this.deleteAnnotation.run(filename);
        this.insertEvent.run(filename, "", null, "undo_delete", happenedAt);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  close() {
    this.db.close();
  }
}

async function writeAnnotationsCsv(savePath, images, annotations) {
  await fsp.mkdir(path.dirname(savePath), { recursive: true });
  const lines = [csvLine(["file", "prompt", "label", "annotated_at"])];

  for (const image of images) {
    const annotation = annotations.get(image.filename);
    if (!annotation) continue;
    lines.push(csvLine([
      annotation.file,
      annotation.prompt,
      annotation.label,
      annotation.annotated_at
    ]));
  }

  const tempPath = `${savePath}.${process.pid}.tmp`;
  await fsp.writeFile(tempPath, `${lines.join("\n")}\n`, "utf8");
  await fsp.rename(tempPath, savePath);
}

function sendJson(response, statusCode, body) {
  const payload = JSON.stringify(body);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store"
  });
  response.end(payload);
}

function sendText(response, statusCode, body, contentType = "text/plain; charset=utf-8") {
  response.writeHead(statusCode, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store"
  });
  response.end(body);
}

async function readRequestJson(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks).toString("utf8");
  return body ? JSON.parse(body) : {};
}

function safePublicPath(urlPath) {
  const relativePath = urlPath === "/" ? "index.html" : decodeURIComponent(urlPath.slice(1));
  const absolutePath = path.resolve(__dirname, "public", relativePath);
  const publicDir = path.resolve(__dirname, "public");
  if (!isInside(absolutePath, publicDir)) {
    return null;
  }
  return absolutePath;
}

function createBasicAuthChecker(password) {
  if (!password) {
    return () => true;
  }

  return (request, response) => {
    const header = request.headers.authorization || "";
    const prefix = "Basic ";
    if (!header.startsWith(prefix)) {
      response.writeHead(401, {
        "WWW-Authenticate": "Basic realm=\"Hebrew Swipe Annotator\"",
        "Content-Type": "text/plain; charset=utf-8"
      });
      response.end("Authentication required\n");
      return false;
    }

    const decoded = Buffer.from(header.slice(prefix.length), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    const provided = separator === -1 ? decoded : decoded.slice(separator + 1);
    if (provided !== password) {
      response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Forbidden\n");
      return false;
    }

    return true;
  };
}

function publicImage(image) {
  return {
    id: image.id,
    filename: image.filename,
    prompt: image.prompt,
    meaning: image.meaning,
    category: image.category,
    imageUrl: `/api/image/${image.id}`
  };
}

function statusPayload(images, annotations, labels, history = []) {
  const annotated = annotations.size;
  return {
    total: images.length,
    annotated,
    remaining: images.length - annotated,
    labels,
    canUndo: history.length > 0,
    done: annotated >= images.length
  };
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (!args.data) {
    printHelp();
    throw new Error("Missing required --data <image-dir>");
  }

  const dataDir = path.resolve(args.data);
  const savePath = path.resolve(args.save);
  const saveBase = path.basename(savePath, path.extname(savePath));
  const dbPath = path.resolve(args.db || path.join(path.dirname(savePath), `${saveBase || "annotations"}.sqlite`));
  const port = Number.parseInt(args.port, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${args.port}`);
  }

  const dataStat = await fsp.stat(dataDir);
  if (!dataStat.isDirectory()) {
    throw new Error(`Data path is not a directory: ${dataDir}`);
  }

  const defaultManifest = path.join(dataDir, "batch_manifest.jsonl");
  const manifestPath = args.manifest ? path.resolve(args.manifest) : defaultManifest;
  const manifestMetadata = await readManifest(manifestPath);
  const images = await scanImages(dataDir, manifestMetadata);
  if (images.length === 0) {
    throw new Error(`No supported images found in ${dataDir}`);
  }

  const imagesById = new Map(images.map((image) => [image.id, image]));
  const imagesByFilename = new Map(images.map((image) => [image.filename, image]));
  const labels = { left: args.labelLeft, right: args.labelRight, skip: args.labelSkip };
  await fsp.mkdir(path.dirname(dbPath), { recursive: true });
  const store = new AnnotationStore(dbPath);
  const csvAnnotations = await loadCsvAnnotations(savePath, imagesByFilename);
  const imported = store.importCsvAnnotations(csvAnnotations);
  const annotations = store.loadCurrent(imagesByFilename);
  const history = [];
  const checkAuth = createBasicAuthChecker(args.password);

  await writeAnnotationsCsv(savePath, images, annotations);

  const shutdown = () => {
    store.close();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  const server = http.createServer(async (request, response) => {
    try {
      if (!checkAuth(request, response)) return;

      const requestUrl = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

      if (request.method === "GET" && requestUrl.pathname === "/api/status") {
        sendJson(response, 200, statusPayload(images, annotations, labels, history));
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/next") {
        const nextImage = images.find((image) => !annotations.has(image.filename));
        sendJson(response, 200, {
          ...statusPayload(images, annotations, labels, history),
          image: nextImage ? publicImage(nextImage) : null
        });
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/annotate") {
        const body = await readRequestJson(request);
        const image = imagesById.get(body.id);
        const validLabels = new Set([labels.left, labels.right, labels.skip]);

        if (!image) {
          sendJson(response, 404, { error: "Unknown image id" });
          return;
        }
        if (!validLabels.has(body.label)) {
          sendJson(response, 400, { error: "Unknown label" });
          return;
        }

        const previous = annotations.get(image.filename) || null;
        const annotation = {
          file: image.filename,
          prompt: image.prompt,
          label: body.label,
          annotated_at: new Date().toISOString()
        };
        store.saveAnnotation(annotation);
        annotations.set(image.filename, annotation);
        history.push({ filename: image.filename, previous });
        await writeAnnotationsCsv(savePath, images, annotations);

        sendJson(response, 200, {
          annotation,
          ...statusPayload(images, annotations, labels, history)
        });
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/undo") {
        const last = history.pop();
        if (!last) {
          sendJson(response, 200, {
            undone: false,
            ...statusPayload(images, annotations, labels, history)
          });
          return;
        }

        if (last.previous) {
          store.restoreAnnotation(last.filename, last.previous);
          annotations.set(last.filename, last.previous);
        } else {
          store.restoreAnnotation(last.filename, null);
          annotations.delete(last.filename);
        }
        await writeAnnotationsCsv(savePath, images, annotations);
        sendJson(response, 200, {
          undone: true,
          ...statusPayload(images, annotations, labels, history)
        });
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/export.csv") {
        await writeAnnotationsCsv(savePath, images, annotations);
        const csv = await fsp.readFile(savePath, "utf8");
        response.writeHead(200, {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": "attachment; filename=\"annotations.csv\"",
          "Cache-Control": "no-store"
        });
        response.end(csv);
        return;
      }

      if ((request.method === "GET" || request.method === "HEAD") && requestUrl.pathname.startsWith("/api/image/")) {
        const id = decodeURIComponent(requestUrl.pathname.slice("/api/image/".length));
        const image = imagesById.get(id);
        if (!image) {
          sendText(response, 404, "Image not found\n");
          return;
        }

        const contentType = await detectImageContentType(image.absolutePath);
        response.writeHead(200, {
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=3600"
        });
        if (request.method === "HEAD") {
          response.end();
        } else {
          fs.createReadStream(image.absolutePath).pipe(response);
        }
        return;
      }

      if (request.method === "GET" || request.method === "HEAD") {
        const staticPath = safePublicPath(requestUrl.pathname);
        if (!staticPath) {
          sendText(response, 403, "Forbidden\n");
          return;
        }

        try {
          const stat = await fsp.stat(staticPath);
          if (!stat.isFile()) {
            sendText(response, 404, "Not found\n");
            return;
          }
          const contentType = CONTENT_TYPES.get(path.extname(staticPath).toLowerCase()) || "application/octet-stream";
          response.writeHead(200, {
            "Content-Type": contentType,
            "Content-Length": stat.size,
            "Cache-Control": "no-store"
          });
          if (request.method === "HEAD") {
            response.end();
          } else {
            fs.createReadStream(staticPath).pipe(response);
          }
        } catch (error) {
          if (error.code === "ENOENT") {
            sendText(response, 404, "Not found\n");
          } else {
            throw error;
          }
        }
        return;
      }

      sendText(response, 405, "Method not allowed\n");
    } catch (error) {
      console.error(error);
      sendJson(response, 500, { error: error.message || "Internal server error" });
    }
  });

  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      console.error(`Port ${port} is already in use on ${args.host}. Set PORT to another value, for example: PORT=3001 scripts/run-local.sh <image-directory>`);
    } else {
      console.error(error);
    }
    store.close();
    process.exit(1);
  });

  server.listen(port, args.host, () => {
    const lanHint = args.host === "0.0.0.0" ? "http://<your-computer-ip>:" : `http://${args.host}:`;
    console.log(`Hebrew Swipe Annotator`);
    console.log(`Images: ${images.length}`);
    console.log(`Database: ${dbPath}`);
    console.log(`CSV export: ${savePath}`);
    if (imported > 0) {
      console.log(`Imported ${imported} existing CSV rows into the database.`);
    }
    console.log(`Local URL: http://127.0.0.1:${port}`);
    console.log(`Phone URL: ${lanHint}${port}`);
    if (args.password) {
      console.log("Basic auth is enabled; username can be any value.");
    }
  });
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
