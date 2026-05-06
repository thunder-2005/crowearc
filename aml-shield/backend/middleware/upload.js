const multer = require('multer');

// In-memory storage — files never touch the Railway disk. The route
// handler reads req.file.buffer and ships it straight to Supabase Storage.
const storage = multer.memoryStorage();

const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'        // .xlsx
]);

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) return cb(null, true);
    cb(new Error(`File type not allowed: ${file.mimetype}`));
  }
});

module.exports = { upload };
