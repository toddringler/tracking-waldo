# Agent: Process Expedition Day

## Purpose
Process a day's raw expedition files — GPX track, photos, and optional sidecar text — into a structured event JSON entry, then rebuild the site and archive the source files.

## Invocation
The user will say: **"process d025"** (day number varies).  
Source files are in `./tmp/d025/`. The day number is taken from that directory name.

---

## Step 0 — Read Waldo's Origin Story
Before generating any text, read `background/Origin Story/waldo_origin_story.md`.  
All agent-generated text (`title`, `thought`, `photoCaption`) must reflect Waldo's voice: dry, mechanically optimistic, quietly opinionated, self-aware. Waldo is a Toyota Tacoma with a personality. Write accordingly.

---

## Step 1 — Determine Day Metadata
- **Day number**: from directory name as an **integer**, strip leading zeros (e.g. `d025` → `25`, not `"025"`)
- **Directory check**: if `tmp/<daytag>/` does not exist, stop immediately with an error
- **Date**: infer from the GPX file's first trackpoint timestamp (convert UTC → local date using the timezone offset embedded in photo EXIF, or Mountain Time as fallback)
- **Existing event check**: scan `data/events/` filenames; if a file for this date already exists, stop and ask the user explicitly whether to overwrite

---

## Step 2 — Process the GPX Track
- Locate the single `.gpx` file in `tmp/d025/`
- Copy it to `data/tracks/` as-is (preserve original filename)
- The **last trackpoint coordinate** in the GPX is the camp location — capture this lat/lon for Step 4
- Run `npm run build` at the end (Step 6) to regenerate route GeoJSON

---

## Step 3 — Create Photo Events (non-camp photos)
For each photo in `tmp/d025/` whose filename does **not** contain `camp`:

**Location** (in priority order):
1. Use `exiftool -n -GPSPosition` — returns signed decimal `lat lon` (e.g. `46.949322 -113.542611`). Do **not** use `GPS Latitude`/`GPS Longitude` separately; they return unsigned values and western longitudes will have the wrong sign.
2. If no GPS: convert `Date/Time Original` + `Offset Time` → UTC, then use the node interpolation script to find the nearest GPX trackpoint by timestamp
3. If neither is possible, flag the photo and skip it — do not guess

**Fields to generate** (use vision analysis of the photo):
| Field | Description |
|---|---|
| `type` | One of: `sighting`, `fuel`, `incident`, `ferry`. Choose based on photo content. |
| `title` | Short, specific title in Waldo's voice (5–8 words) |
| `thought` | One sentence internal monologue from Waldo's perspective |
| `photoCaption` | Plain factual description of what's in the photo (1–2 sentences) |
| `photoFilename` | Filename only, no path |

**Sidecar text** (`photoNote`):
- Look for a `.txt` file with the same stem as the photo (e.g. `d025-river.txt` alongside `d025-river.jpeg`)
- If found, read it and add as `photoNote` (array of strings, one per paragraph, split on blank lines)
- If not found, omit `photoNote` entirely

---

## Step 4 — Create the Camp Event
Every day has exactly one camp event. It is always the **last** event in the events array.

**Location**: last trackpoint of the day's GPX track (from Step 2)

**Photo**: attach a photo whose filename contains `camp` if one exists in `tmp/d025/`. Set `photoFilename` and generate `photoCaption` from it. The photo's own GPS coordinate is ignored for this event — camp is always at the track endpoint.

**Thoughts** (`thought` field):
- If a camp `.txt` file exists, inspect its length:
  - **Short (single sentence/paragraph)**: use directly as `thought`
  - **Multi-paragraph**: use first sentence as `thought`; remaining paragraphs become `photoNote` on the camp photo (split on blank lines → string array)
- If not found, generate a Waldo-voice single sentence based on camp photo or day context

**Other fields**:
| Field | Value |
|---|---|
| `type` | `camp` (always) |
| `title` | Short camp title in Waldo's voice |
| `mood` | One of: `optimistic`, `cautious`, `concerned`, `content`, `feral` — infer from context |

---

## Step 5 — Review & Confirm
Before writing any files, present the complete draft JSON to the user and pause.  
Show a summary of: day number, date, number of events, any photos skipped, any files not matched.  
Proceed only after explicit user confirmation.

---

## Step 6 — Write Output Files
On confirmation:

1. **Create** `data/events/YYYY-MM-DD.json` with the following structure:
```json
{
  "day": 25,
  "date": "2026-07-18",
  "events": [ ...non-camp events..., ...camp event last... ]
}
```

2. **Run** `npm run build` to regenerate GeoJSON and rebuild the site
   - If build **fails**: report the error, note the partial state, and stop — do not archive

3. **Archive** (only if build succeeded): copy everything from `tmp/<daytag>/` into `data/raw/<daytag>/`  
   - Overwriting existing files in `data/raw/<daytag>/` is permitted
   - Do **not** delete `tmp/<daytag>/` (kept for potential reprocessing)

---

## Event JSON Reference

**Valid `type` values**: `sighting`, `fuel`, `camp`, `incident`, `ferry`  
**Valid `mood` values**: `optimistic`, `cautious`, `concerned`, `content`, `feral`  
**All coordinate fields**: decimal degrees, 6+ significant digits  
**`photoNote`**: array of strings (one paragraph per element) — omit if no sidecar text  
**`thought`**: always Waldo's voice — first-person from the vehicle's perspective  
**`photoFilename`**: filename only, no path prefix

Optional fields (`thought`, `mood`, `status`, `photoNote`, `photoCaption`) should be omitted entirely rather than written as empty strings.
