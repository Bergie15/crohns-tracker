# crohns-tracker — Gut Log

Track Crohn's symptoms during a flare. Gut Log is a small, private web app for logging bowel movements using the **Bristol stool scale** (pain, urgency, blood, mucus, etc.), plus **food, drinks, stress and sleep** — and it points out foods that tend to come before bad days.

- **Private:** everything is stored in your browser on your device. Nothing is uploaded.
- **Works offline** and can be installed to your phone's home screen like an app.
- **No build step:** plain HTML/CSS/JS, so GitHub Pages serves it as-is.

## Features

- **Log** — switch between four kinds of entry:
  - **Bowel** — date/time, Bristol type (1–7, illustrated), pain 0–10, urgency, abnormalities (bright red blood, dark blood, black/tarry, mucus, pus, undigested food, greasy/floating, foul smell, straining, incomplete emptying, gas), color, notes. Shows what you ate in the hours before.
  - **Food** — time, meal, foods (with suggestions from past entries), tags (dairy, gluten, high fiber, beans, onion/garlic, spicy, fried/fatty, red meat, processed, sugar, caffeine, alcohol) auto-filled from what you type, portion, notes.
  - **Drink** — type and amount in oz, with today's running total.
  - **Check-in** — once a day: stress (1–5), hours slept, sleep quality.
- **History** — everything grouped by day with a filter; tap any entry to edit or delete it.
- **Triggers** — for every food, tag and drink, compares bowel movements in the hours after having it with all other bowel movements, and lists possible triggers, foods that look fine, and foods without enough data yet. Also compares high-stress and poor-sleep days.
- **Insights** — summaries for Today, 7, 30, 90 days or all time: BMs per day (average and most in one day), average Bristol type and pain, **how many days** had pain (any / moderate / severe), blood, mucus, urgency, accidents, loose or hard stool, no BM, and each Bristol type; plus daily charts, type mix, time-of-day breakdown, abnormality counts, food & fluid totals and a daily table. Averages only count days since your first entry.
- **Data** — download a JSON backup, export a CSV for a spreadsheet or your doctor, restore/merge from a backup, set the food reaction window, light/dark theme.

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

## How trigger analysis works

- **Reaction window:** a bowel movement counts as "after" a food if it happened **2–24 hours** after eating it (adjustable on the Data tab). Food-related symptoms such as diarrhea from fermentation typically show up 2–8 hours after eating and FODMAP-type reactions 4–24 hours after, while symptoms in the first hour are usually the gastrocolic reflex moving *earlier* food along. Whole-gut transit (food appearing in stool) is longer, about 24–72 hours.
- **Problem bowel movement:** loose (type 6–7), pain 4+, blood or mucus, or urgent/accident.
- For each food/tag/drink, the share of problem BMs after it is compared with the share at other times, using only the period while food was being logged. A food is a **possible trigger** when it's been had 3+ times and its rate is at least 15 points higher; **probably fine** when it's been had 5+ times and isn't higher.
- These are patterns, not proof: flares, foods eaten together, and small numbers can all mislead.

## Disclaimer

This is a personal log, not medical advice. Contact your care team for heavy bleeding, black/tarry stool, fever, severe or worsening pain, or signs of dehydration.
