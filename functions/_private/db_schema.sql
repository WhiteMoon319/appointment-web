-- 师生预约系统 D1 建表脚本
-- 执行：wrangler d1 execute appointment-db --remote --file=functions/_private/db_schema.sql

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL,                -- student | teacher
  name TEXT NOT NULL,
  student_id TEXT,                   -- 学生学号（老师为 NULL）
  qq TEXT NOT NULL UNIQUE,           -- QQ 号，注册必填，通知定位用
  password_hash TEXT NOT NULL,       -- PBKDF2-SHA256
  password_salt TEXT NOT NULL,
  remind_minutes INTEGER NOT NULL DEFAULT 30,
  token TEXT,                        -- 会话 token，登录后写入
  created_at INTEGER NOT NULL,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS roster (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,       -- users.id（学生）
  student_name TEXT NOT NULL,
  student_qq TEXT NOT NULL,
  teacher_id INTEGER NOT NULL,       -- users.id（老师）
  teacher_name TEXT NOT NULL,
  start_time INTEGER NOT NULL,       -- 毫秒时间戳
  status TEXT NOT NULL DEFAULT 'pending',
  teacher_adjusted INTEGER NOT NULL DEFAULT 0,
  reject_reason TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  appointment_id INTEGER NOT NULL,
  receiver_qq TEXT NOT NULL,
  type TEXT NOT NULL,                -- remind | result
  channel TEXT,                      -- temporary | at | failed
  status TEXT NOT NULL,              -- sent | fallback | failed
  sent_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_appointments_status_time ON appointments(status, start_time);
CREATE INDEX IF NOT EXISTS idx_appointments_student ON appointments(student_id);
CREATE INDEX IF NOT EXISTS idx_appointments_teacher ON appointments(teacher_id);
CREATE INDEX IF NOT EXISTS idx_notifications_dedup ON notifications(appointment_id, receiver_qq, type);
