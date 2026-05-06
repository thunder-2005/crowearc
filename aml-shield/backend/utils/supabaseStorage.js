// Supabase Storage helper. All uploaded files (SAR docs, alert evidence,
// KYC review docs, L2 case docs) live in the `crowe-arc-documents` bucket.
// The bucket is PRIVATE — every download is served via a short-lived signed
// URL. We never store public URLs in the DB; only the storage path.

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const BUCKET = process.env.SUPABASE_BUCKET || 'crowe-arc-documents';
const SIGNED_URL_TTL_SECONDS = 3600;

let _client = null;
function client() {
  if (_client) return _client;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error('Supabase Storage not configured: missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  }
  _client = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  return _client;
}

function safeName(name) {
  return String(name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
}

// Upload a buffer. Returns the storage path (used for both signed-URL
// retrieval and deletion). The `prefix` arg lets callers segregate by
// type (e.g. 'sar/', 'alerts/', 'kyc/', 'l2/') for easier audit.
async function uploadFile(fileBuffer, fileName, mimeType, prefix = '') {
  const stamp = Date.now();
  const cleanPrefix = prefix ? `${prefix.replace(/^\/+|\/+$/g, '')}/` : '';
  const filePath = `${cleanPrefix}${stamp}_${safeName(fileName)}`;
  const { error } = await client()
    .storage
    .from(BUCKET)
    .upload(filePath, fileBuffer, {
      contentType: mimeType || 'application/octet-stream',
      upsert: false
    });
  if (error) throw error;
  return { filePath };
}

async function deleteFile(filePath) {
  if (!filePath) return;
  const { error } = await client().storage.from(BUCKET).remove([filePath]);
  if (error) throw error;
}

async function getSignedUrl(filePath, ttl = SIGNED_URL_TTL_SECONDS) {
  if (!filePath) throw new Error('filePath required');
  const { data, error } = await client()
    .storage
    .from(BUCKET)
    .createSignedUrl(filePath, ttl);
  if (error) throw error;
  return data.signedUrl;
}

// Stream the bytes back as a Node Readable. Used by the SAR zip route
// which bundles every supporting doc into a single archive.
async function downloadStream(filePath) {
  const { data, error } = await client().storage.from(BUCKET).download(filePath);
  if (error) throw error;
  // supabase-js returns a Blob in Node — convert to Buffer/stream.
  const arrayBuf = await data.arrayBuffer();
  return Buffer.from(arrayBuf);
}

module.exports = { uploadFile, deleteFile, getSignedUrl, downloadStream, BUCKET };
