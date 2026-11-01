import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const ALLOWED_PROJECT_ID = 'demo-ayn-marketplace';
const EXPECTED_FIRESTORE = '127.0.0.1:8080';
const EXPECTED_AUTH = '127.0.0.1:9099';
const BLOCKED_PROJECT_IDS = new Set(['ayn-marketplace']);

function fail(message) {
  throw new Error(`QA safety guard blocked execution: ${message}`);
}

export function validateQaEnvironment(env = process.env) {
  const projectId = env.FIREBASE_PROJECT_ID;
  if (BLOCKED_PROJECT_IDS.has(projectId)) fail('production Firebase project is forbidden');
  if (projectId !== ALLOWED_PROJECT_ID) fail('FIREBASE_PROJECT_ID must be demo-ayn-marketplace');

  if (env.FIRESTORE_EMULATOR_HOST !== EXPECTED_FIRESTORE) {
    fail('Firestore must use 127.0.0.1:8080');
  }
  if (env.AUTH_EMULATOR_HOST !== EXPECTED_AUTH) {
    fail('Auth must use 127.0.0.1:9099');
  }

  if (!env.FIREBASE_CONFIG) fail('FIREBASE_CONFIG is required');
  let config;
  try {
    config = JSON.parse(env.FIREBASE_CONFIG);
  } catch {
    fail('FIREBASE_CONFIG must be valid JSON');
  }
  if (!config || config.projectId !== ALLOWED_PROJECT_ID) {
    fail('Firebase config projectId must be demo-ayn-marketplace');
  }

  const strings = [];
  const collectStrings = (value) => {
    if (typeof value === 'string') strings.push(value);
    else if (Array.isArray(value)) value.forEach(collectStrings);
    else if (value && typeof value === 'object') Object.values(value).forEach(collectStrings);
  };
  collectStrings(config);
  if (strings.some((value) => value.replaceAll(ALLOWED_PROJECT_ID, '').includes('ayn-marketplace'))) {
    fail('Firebase config contains a production project identifier');
  }

  return {
    projectId,
    firestoreEmulator: EXPECTED_FIRESTORE,
    authEmulator: EXPECTED_AUTH
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = validateQaEnvironment();
    process.stdout.write(`QA environment accepted: ${JSON.stringify(result)}\\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\\n`);
    process.exitCode = 1;
  }
}
