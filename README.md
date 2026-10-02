# crohns-tracker — Gut Log

Track Crohn's symptoms during a flare. Gut Log is a small, private web app for logging bowel movements using the **Bristol stool scale**, with pain, urgency, and abnormalities (blood, mucus, etc.).

- **Private:** everything is stored in your browser on your device. Nothing is uploaded.
- **Works offline** and can be installed to your phone's home screen like an app.
- **No build step:** plain HTML/CSS/JS, so GitHub Pages serves it as-is.

## Features

- **Log** — date/time, Bristol type (1–7, illustrated), pain 0–10, urgency, abnormalities (bright red blood, dark blood, black/tarry, mucus, pus, undigested food, greasy/floating, foul smell, straining, incomplete emptying, gas), color, and notes.
- **History** — entries grouped by day; tap any entry to edit or delete it.
- **Insights** — summaries for Today, 7, 30, 90 days or all time: BMs per day (average and most in one day), average Bristol type and pain, **how many days** had pain (any / moderate / severe), blood, mucus, urgency, accidents, loose or hard stool, no BM, and each Bristol type; plus daily charts, type mix, time-of-day breakdown, abnormality counts and a daily table. Averages only count days since your first entry.
- **Data** — download a JSON backup, export a CSV for a spreadsheet or your doctor, restore/merge from a backup, light/dark theme.

## Hosting on GitHub Pages

1. Merge this branch into `main`.
2. In the repo on GitHub go to **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to *Deploy from a branch*, pick **`main`** and **`/ (root)`**, then **Save**.
4. After a minute the app is live at `https://<your-username>.github.io/crohns-tracker/`.

### Install on your phone

- **iPhone (Safari):** open the link → Share → **Add to Home Screen**.
- **Android (Chrome):** open the link → ⋮ menu → **Install app** / **Add to Home screen**.

> Your data lives in that browser/app on that device. Use **Data → Download backup** regularly, and **Restore** to move to a new phone. Clearing browser data will erase entries that haven't been backed up.

## Running locally

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

## Project layout

```
index.html            App shell and views
css/styles.css        Styles (light + dark)
js/app.js             All app logic and the data model
sw.js                 Service worker for offline use (bump CACHE when shipping changes)
manifest.webmanifest  Install metadata
icons/                App icons
```

## Roadmap: food tracking

Entries are stored with a `type` field (`'bm'` today), so meals can be added as `type: 'meal'` entries in the same log. The plan is:

1. A **Food** log: what you ate, when, and optional tags (dairy, gluten, high-fiber, spicy, fried, alcohol, caffeine…).
2. **Correlations**: for each food/tag, compare the Bristol type, pain, and blood/mucus rate of BMs in the following ~6–48 hours against your baseline.

## Disclaimer

This is a personal log, not medical advice. Contact your care team for heavy bleeding, black/tarry stool, fever, severe or worsening pain, or signs of dehydration.
