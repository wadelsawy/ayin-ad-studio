import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateQaEnvironment } from './qa-safety-guard.mjs';

const safeEnv = () => ({
  FIREBASE_PROJECT_ID: 'demo-ayn-marketplace',
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
  AUTH_EMULATOR_HOST: '127.0.0.1:9099',
  FIREBASE_CONFIG: JSON.stringify({ projectId: 'demo-ayn-marketplace' })
});

test('accepts only the explicitly configured demo project and local emulators', () => {
  assert.equal(validateQaEnvironment(safeEnv()).projectId, 'demo-ayn-marketplace');
});

test('rejects the production project id', () => {
  const env = safeEnv();
  env.FIREBASE_PROJECT_ID = 'ayn-marketplace';
  assert.throws(() => validateQaEnvironment(env), /production Firebase project is forbidden/);
});

test('rejects a production project hidden in Firebase config', () => {
  const env = safeEnv();
  env.FIREBASE_CONFIG = JSON.stringify({ projectId: 'ayn-marketplace' });
  assert.throws(() => validateQaEnvironment(env), /must be demo-ayn-marketplace/);
});

test('rejects non-local Firestore emulator hosts', () => {
  const env = safeEnv();
  env.FIRESTORE_EMULATOR_HOST = 'firestore.googleapis.com:443';
  assert.throws(() => validateQaEnvironment(env), /Firestore must use 127.0.0.1:8080/);
});

test('rejects non-local Auth emulator hosts', () => {
  const env = safeEnv();
  env.AUTH_EMULATOR_HOST = 'identitytoolkit.googleapis.com:443';
  assert.throws(() => validateQaEnvironment(env), /Auth must use 127.0.0.1:9099/);
});

test('rejects missing emulator configuration', () => {
  const env = safeEnv();
  delete env.FIRESTORE_EMULATOR_HOST;
  assert.throws(() => validateQaEnvironment(env), /Firestore must use 127.0.0.1:8080/);
});

test('rejects malformed Firebase config JSON', () => {
  const env = safeEnv();
  env.FIREBASE_CONFIG = '{bad json';
  assert.throws(() => validateQaEnvironment(env), /FIREBASE_CONFIG must be valid JSON/);
});
