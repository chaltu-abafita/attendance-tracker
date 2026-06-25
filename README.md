# Skillspire Attendance Tracker

Student attendance tracker with automatic present / late / absent status.

## Attendance rules

| Day | On-time cutoff |
|-----|---------------|
| Monday – Friday | 5:30 PM |
| Saturday | 12:30 PM |

Arriving after the cutoff → **Late**. No check-in recorded → **Absent** (mark manually).

## Setup

```bash
npm install
node server.js
```

Open `http://localhost:3000`

Default admin PIN: **1234** — change it in the Settings tab before sharing.

## Features

- **Check In tab** — students enter name, date, and arrival time; status is calculated automatically
- **Dashboard tab** — PIN-protected; filter by date, status, or name; delete records; export CSV or JSON
- **Settings tab** — mark students absent manually; change admin PIN

## Deploy to Railway

1. Push this folder to a GitHub repository
2. Connect the repo on railway.app
3. Railway detects Node.js and deploys automatically
4. Generate a public domain in Settings → Networking

## Data note

Data is stored in `attendance.json`. On Railway's free tier, export regularly via the Dashboard → Export CSV button as a backup.
