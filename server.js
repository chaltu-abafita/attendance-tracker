const express = require('express');
const cors    = require('cors');
const fs      = require('fs');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;
const DB   = process.env.DATA_PATH
  ? path.join(process.env.DATA_PATH, 'attendance.json')
  : path.join(__dirname, 'attendance.json');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- helpers ----------
function readDB() {
  if (!fs.existsSync(DB)) return { classes: [], records: [], adminPin: '1234' };
  try {
    const d = JSON.parse(fs.readFileSync(DB, 'utf8'));
    if (!d.classes) d.classes = [];
    return d;
  } catch(e) { return { classes: [], records: [], adminPin: '1234' }; }
}
function writeDB(d) {
  const dir = path.dirname(DB);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DB, JSON.stringify(d, null, 2));
}

// Calculate status based on class schedule rules
// Each class has: weekdayCutoff (e.g. "17:30") and saturdayCutoff (e.g. "12:30")
// null cutoff means that day is not a class day
function calcStatus(dateStr, timeStr, cls) {
  if (!timeStr) return 'absent';
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hour, minute]     = timeStr.split(':').map(Number);
  const dt  = new Date(year, month - 1, day);
  const dow = dt.getDay(); // 0=Sun,6=Sat

  const totalMins = hour * 60 + minute;

  if (dow === 6) {
    // Saturday
    if (!cls || !cls.saturdayCutoff) return 'absent';
    const [ch, cm] = cls.saturdayCutoff.split(':').map(Number);
    return totalMins <= ch * 60 + cm ? 'present' : 'late';
  } else if (dow === 0) {
    // Sunday — never a class day
    return 'absent';
  } else {
    // Weekday
    if (!cls || !cls.weekdayCutoff) return 'absent';
    const [ch, cm] = cls.weekdayCutoff.split(':').map(Number);
    return totalMins <= ch * 60 + cm ? 'present' : 'late';
  }
}

// ---------- classes ----------
app.get('/api/classes', (req, res) => {
  res.json(readDB().classes || []);
});

app.post('/api/classes', (req, res) => {
  const { pin, name, weekdayCutoff, saturdayCutoff } = req.body;
  const db = readDB();
  if (pin !== db.adminPin) return res.status(403).json({ error: 'Wrong PIN' });
  if (!name || !name.trim()) return res.status(400).json({ error: 'Class name required' });
  const id = Date.now().toString();
  const cls = {
    id,
    name: name.trim(),
    weekdayCutoff:  weekdayCutoff  || null,
    saturdayCutoff: saturdayCutoff || null
  };
  db.classes.push(cls);
  writeDB(db);
  res.json({ ok: true, class: cls });
});

app.put('/api/classes/:id', (req, res) => {
  const { pin, name, weekdayCutoff, saturdayCutoff } = req.body;
  const db = readDB();
  if (pin !== db.adminPin) return res.status(403).json({ error: 'Wrong PIN' });
  const idx = db.classes.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Class not found' });
  db.classes[idx] = { ...db.classes[idx], name: name.trim(), weekdayCutoff, saturdayCutoff };
  writeDB(db);
  res.json({ ok: true });
});

app.delete('/api/classes/:id', (req, res) => {
  const { pin } = req.body;
  const db = readDB();
  if (pin !== db.adminPin) return res.status(403).json({ error: 'Wrong PIN' });
  db.classes = db.classes.filter(c => c.id !== req.params.id);
  // also remove records for that class
  db.records = db.records.filter(r => r.classId !== req.params.id);
  writeDB(db);
  res.json({ ok: true });
});

// ---------- records ----------
app.get('/api/records', (req, res) => {
  const { pin, classId } = req.query;
  const db = readDB();
  if (pin !== db.adminPin) return res.status(403).json({ error: 'Wrong PIN' });
  const records = classId
    ? db.records.filter(r => r.classId === classId)
    : db.records;
  res.json(records);
});

app.post('/api/checkin', (req, res) => {
  const { firstName, lastName, date, time, classId } = req.body;
  if (!firstName || !lastName || !date || !time || !classId) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  const db  = readDB();
  const cls = db.classes.find(c => c.id === classId);
  if (!cls) return res.status(404).json({ error: 'Class not found' });

  const status = calcStatus(date, time, cls);
  const record = {
    id: Date.now(),
    classId,
    className: cls.name,
    firstName: firstName.trim(),
    lastName:  lastName.trim(),
    date,
    time,
    status,
    submittedAt: new Date().toISOString()
  };

  // Replace if same student + class + date
  const key = `${firstName.trim().toLowerCase()}_${lastName.trim().toLowerCase()}_${date}_${classId}`;
  db.records = db.records.filter(r =>
    `${r.firstName.toLowerCase()}_${r.lastName.toLowerCase()}_${r.date}_${r.classId}` !== key
  );
  db.records.push(record);
  db.records.sort((a,b) => (a.date+a.lastName) < (b.date+b.lastName) ? 1 : -1);
  writeDB(db);
  res.json({ ok: true, status });
});

app.post('/api/absent', (req, res) => {
  const { pin, firstName, lastName, date, classId } = req.body;
  const db = readDB();
  if (pin !== db.adminPin) return res.status(403).json({ error: 'Wrong PIN' });
  const cls = db.classes.find(c => c.id === classId);
  if (!cls) return res.status(404).json({ error: 'Class not found' });

  const key = `${firstName.trim().toLowerCase()}_${lastName.trim().toLowerCase()}_${date}_${classId}`;
  db.records = db.records.filter(r =>
    `${r.firstName.toLowerCase()}_${r.lastName.toLowerCase()}_${r.date}_${r.classId}` !== key
  );
  db.records.push({
    id: Date.now(),
    classId,
    className: cls.name,
    firstName: firstName.trim(),
    lastName:  lastName.trim(),
    date,
    time: null,
    status: 'absent',
    submittedAt: new Date().toISOString()
  });
  writeDB(db);
  res.json({ ok: true });
});

app.delete('/api/records/:id', (req, res) => {
  const { pin } = req.body;
  const db = readDB();
  if (pin !== db.adminPin) return res.status(403).json({ error: 'Wrong PIN' });
  db.records = db.records.filter(r => r.id !== Number(req.params.id));
  writeDB(db);
  res.json({ ok: true });
});

// ---------- PIN ----------
app.post('/api/pin', (req, res) => {
  const { currentPin, newPin } = req.body;
  const db = readDB();
  if (currentPin !== db.adminPin) return res.status(403).json({ error: 'Wrong current PIN' });
  if (!newPin || newPin.length < 4) return res.status(400).json({ error: 'PIN must be at least 4 characters' });
  db.adminPin = newPin;
  writeDB(db);
  res.json({ ok: true });
});

// ---------- export ----------
app.get('/api/export/csv', (req, res) => {
  const { pin, classId } = req.query;
  const db = readDB();
  if (pin !== db.adminPin) return res.status(403).json({ error: 'Wrong PIN' });
  let records = db.records;
  if (classId) records = records.filter(r => r.classId === classId);
  const rows = [['Class','First Name','Last Name','Date','Time','Status']];
  records.forEach(r => rows.push([r.className||'', r.firstName, r.lastName, r.date, r.time||'', r.status]));
  const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="attendance.csv"');
  res.send(csv);
});

app.get('/api/export', (req, res) => {
  const { pin, classId } = req.query;
  const db = readDB();
  if (pin !== db.adminPin) return res.status(403).json({ error: 'Wrong PIN' });
  let records = db.records;
  if (classId) records = records.filter(r => r.classId === classId);
  res.setHeader('Content-Disposition', 'attachment; filename="attendance_export.json"');
  res.json(records);
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Skillspire Attendance running on port ${PORT}`);
});
