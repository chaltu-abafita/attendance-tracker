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
  if (!fs.existsSync(DB)) return { classes: [], students: [], records: [], adminPin: '1234' };
  try {
    const d = JSON.parse(fs.readFileSync(DB, 'utf8'));
    if (!d.classes)  d.classes  = [];
    if (!d.students) d.students = [];
    return d;
  } catch(e) { return { classes: [], students: [], records: [], adminPin: '1234' }; }
}
function writeDB(d) {
  const dir = path.dirname(DB);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DB, JSON.stringify(d, null, 2));
}

function calcStatus(dateStr, timeStr, cls) {
  if (!timeStr) return 'absent';
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hour, minute]     = timeStr.split(':').map(Number);
  const dt  = new Date(year, month - 1, day);
  const dow = dt.getDay();
  const totalMins = hour * 60 + minute;
  if (dow === 6) {
    if (!cls || !cls.saturdayCutoff) return 'absent';
    const [ch, cm] = cls.saturdayCutoff.split(':').map(Number);
    return totalMins <= ch * 60 + cm ? 'present' : 'late';
  } else if (dow === 0) {
    return 'absent';
  } else {
    if (!cls || !cls.weekdayCutoff) return 'absent';
    const [ch, cm] = cls.weekdayCutoff.split(':').map(Number);
    return totalMins <= ch * 60 + cm ? 'present' : 'late';
  }
}

// ---------- classes ----------
app.get('/api/classes', (req, res) => res.json(readDB().classes || []));

app.post('/api/classes', (req, res) => {
  const { pin, name, weekdayCutoff, saturdayCutoff } = req.body;
  const db = readDB();
  if (pin !== db.adminPin) return res.status(403).json({ error: 'Wrong PIN' });
  if (!name || !name.trim()) return res.status(400).json({ error: 'Class name required' });
  const cls = { id: Date.now().toString(), name: name.trim(), weekdayCutoff: weekdayCutoff || null, saturdayCutoff: saturdayCutoff || null };
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
  db.classes[idx] = { ...db.classes[idx], name: name.trim(), weekdayCutoff: weekdayCutoff || null, saturdayCutoff: saturdayCutoff || null };
  writeDB(db);
  res.json({ ok: true });
});

app.delete('/api/classes/:id', (req, res) => {
  const { pin } = req.body;
  const db = readDB();
  if (pin !== db.adminPin) return res.status(403).json({ error: 'Wrong PIN' });
  db.classes  = db.classes.filter(c => c.id !== req.params.id);
  db.students = db.students.filter(s => s.classId !== req.params.id);
  db.records  = db.records.filter(r => r.classId !== req.params.id);
  writeDB(db);
  res.json({ ok: true });
});

// ---------- students ----------
app.get('/api/students', (req, res) => {
  const { classId } = req.query;
  const db = readDB();
  const students = classId
    ? db.students.filter(s => s.classId === classId)
    : db.students;
  res.json(students);
});

app.post('/api/students', (req, res) => {
  const { pin, firstName, lastName, classId } = req.body;
  const db = readDB();
  if (pin !== db.adminPin) return res.status(403).json({ error: 'Wrong PIN' });
  if (!firstName || !lastName || !classId) return res.status(400).json({ error: 'All fields required' });
  const cls = db.classes.find(c => c.id === classId);
  if (!cls) return res.status(404).json({ error: 'Class not found' });
  // prevent duplicates in same class
  const exists = db.students.some(s =>
    s.classId === classId &&
    s.firstName.toLowerCase() === firstName.trim().toLowerCase() &&
    s.lastName.toLowerCase()  === lastName.trim().toLowerCase()
  );
  if (exists) return res.status(409).json({ error: 'Student already in this class' });
  const student = {
    id: Date.now().toString(),
    classId,
    className: cls.name,
    firstName: firstName.trim(),
    lastName:  lastName.trim()
  };
  db.students.push(student);
  db.students.sort((a, b) => (a.lastName + a.firstName).localeCompare(b.lastName + b.firstName));
  writeDB(db);
  res.json({ ok: true, student });
});

app.delete('/api/students/:id', (req, res) => {
  const { pin } = req.body;
  const db = readDB();
  if (pin !== db.adminPin) return res.status(403).json({ error: 'Wrong PIN' });
  db.students = db.students.filter(s => s.id !== req.params.id);
  writeDB(db);
  res.json({ ok: true });
});

// ---------- records ----------
app.get('/api/records', (req, res) => {
  const { pin, classId } = req.query;
  const db = readDB();
  if (pin !== db.adminPin) return res.status(403).json({ error: 'Wrong PIN' });
  const records = classId ? db.records.filter(r => r.classId === classId) : db.records;
  res.json(records);
});

app.post('/api/checkin', (req, res) => {
  const { studentId, date, time } = req.body;
  if (!studentId || !date || !time) return res.status(400).json({ error: 'All fields are required' });
  const db      = readDB();
  const student = db.students.find(s => s.id === studentId);
  if (!student) return res.status(404).json({ error: 'Student not found' });
  const cls = db.classes.find(c => c.id === student.classId);
  if (!cls)  return res.status(404).json({ error: 'Class not found' });

  const status = calcStatus(date, time, cls);
  const record = {
    id: Date.now(),
    classId:   student.classId,
    className: cls.name,
    studentId,
    firstName: student.firstName,
    lastName:  student.lastName,
    date,
    time,
    status,
    submittedAt: new Date().toISOString()
  };

  // Replace if same student + date
  const key = `${studentId}_${date}`;
  db.records = db.records.filter(r => `${r.studentId}_${r.date}` !== key);
  db.records.push(record);
  db.records.sort((a, b) => (a.date + a.lastName) < (b.date + b.lastName) ? 1 : -1);
  writeDB(db);
  res.json({ ok: true, status });
});

app.post('/api/absent', (req, res) => {
  const { pin, studentId, date } = req.body;
  const db = readDB();
  if (pin !== db.adminPin) return res.status(403).json({ error: 'Wrong PIN' });
  const student = db.students.find(s => s.id === studentId);
  if (!student) return res.status(404).json({ error: 'Student not found' });
  const cls = db.classes.find(c => c.id === student.classId);

  const key = `${studentId}_${date}`;
  db.records = db.records.filter(r => `${r.studentId}_${r.date}` !== key);
  db.records.push({
    id: Date.now(),
    classId:   student.classId,
    className: cls ? cls.name : '',
    studentId,
    firstName: student.firstName,
    lastName:  student.lastName,
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
  let records = classId ? db.records.filter(r => r.classId === classId) : db.records;
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
  let records = classId ? db.records.filter(r => r.classId === classId) : db.records;
  res.setHeader('Content-Disposition', 'attachment; filename="attendance_export.json"');
  res.json(records);
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, '0.0.0.0', () => console.log(`Attendance Tracker running on port ${PORT}`));
