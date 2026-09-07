import { MongoClient } from 'mongodb';

// Lazy, reused MongoDB connection. Without MONGODB_URI the API still runs; the
// enquiry endpoints report that storage is unconfigured instead of crashing.
const uri = process.env.MONGODB_URI?.trim() || '';
const dbName = process.env.MONGODB_DB?.trim() || 'centrepoint';

let client = null;
let connecting = null;
let lastError = '';

export const isConfigured = () => Boolean(uri);

export async function getDb() {
  if (!uri) throw new Error('MONGODB_URI is not set');
  if (client) return client.db(dbName);
  if (!connecting) {
    const pending = new MongoClient(uri, { serverSelectionTimeoutMS: 8000, maxPoolSize: 5 });
    connecting = pending.connect().then(
      connected => { client = connected; lastError = ''; return client; },
      error => { connecting = null; lastError = error.message; throw error; },
    );
  }
  await connecting;
  return client.db(dbName);
}

export async function dbHealth() {
  if (!uri) return { configured: false, connected: false };
  try {
    await (await getDb()).command({ ping: 1 });
    return { configured: true, connected: true };
  } catch (error) {
    return { configured: true, connected: false, error: error.message || lastError };
  }
}

export async function closeDb() {
  const open = client;
  client = null;
  connecting = null;
  if (open) await open.close();
}
