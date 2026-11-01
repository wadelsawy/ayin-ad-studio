import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds
} from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';

const projectId = 'demo-ayn-marketplace';
let testEnv;

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080
    }
  });
});

after(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, 'users/owner'), { role: 'advertiser' }),
      setDoc(doc(db, 'users/artist'), { role: 'artist' }),
      setDoc(doc(db, 'users/attacker'), { role: 'advertiser' }),
      setDoc(doc(db, 'users/admin'), { role: 'advertiser' }),
      setDoc(doc(db, 'admins/admin'), { enabled: true }),
      setDoc(doc(db, 'ads/ad-owner'), {
        ownerUid: 'owner', status: 'done', hiddenBy: { existingUser: true }, price: 100
      }),
      setDoc(doc(db, 'ads/ad-open'), {
        ownerUid: 'owner', status: 'new', price: 100
      }),
      setDoc(doc(db, 'topups/top-owner'), {
        uid: 'artist', status: 'done', hiddenBy: { existingUser: true }, points: 20
      }),
      setDoc(doc(db, 'topups/top-pending'), {
        uid: 'artist', status: 'pending', points: 20
      }),
      setDoc(doc(db, 'artistWorks/work-pending'), {
        ownerUid: 'artist', status: 'pending'
      }),
      setDoc(doc(db, 'artistWorks/work-rejected'), {
        ownerUid: 'artist', status: 'rejected'
      }),
      setDoc(doc(db, 'artistWorks/work-approved'), {
        ownerUid: 'artist', status: 'approved'
      }),
      setDoc(doc(db, 'artistWorks/work-other'), {
        ownerUid: 'owner', status: 'pending'
      })
    ]);
  });
});

const dbFor = (uid, token = {}) => testEnv.authenticatedContext(uid, token).firestore();
const adminDb = () => dbFor('admin', { email_verified: true });

test('an advertiser can hide only their own completed ad record', async () => {
  const ownerDb = dbFor('owner');
  const attackerDb = dbFor('attacker');

  await assertSucceeds(updateDoc(doc(ownerDb, 'ads/ad-owner'), {
    'hiddenBy.owner': true
  }));
  await assertFails(updateDoc(doc(attackerDb, 'ads/ad-owner'), {
    'hiddenBy.attacker': true
  }));
  await assertFails(updateDoc(doc(ownerDb, 'ads/ad-owner'), { price: 1 }));
  await assertFails(updateDoc(doc(ownerDb, 'ads/ad-open'), {
    'hiddenBy.owner': true
  }));
});

test('an artist can hide only their own completed top-up record', async () => {
  const artistDb = dbFor('artist');
  const attackerDb = dbFor('attacker');

  await assertSucceeds(updateDoc(doc(artistDb, 'topups/top-owner'), {
    'hiddenBy.artist': true
  }));
  await assertFails(updateDoc(doc(attackerDb, 'topups/top-owner'), {
    'hiddenBy.attacker': true
  }));
  await assertFails(updateDoc(doc(artistDb, 'topups/top-owner'), { points: 999 }));
  await assertFails(updateDoc(doc(artistDb, 'topups/top-pending'), {
    'hiddenBy.artist': true
  }));
});

test('an artist can delete only their own pending or rejected work', async () => {
  const artistDb = dbFor('artist');
  const ownerDb = dbFor('owner');

  await assertSucceeds(deleteDoc(doc(artistDb, 'artistWorks/work-pending')));
  await assertSucceeds(deleteDoc(doc(artistDb, 'artistWorks/work-rejected')));
  await assertFails(deleteDoc(doc(artistDb, 'artistWorks/work-approved')));
  await assertFails(deleteDoc(doc(artistDb, 'artistWorks/work-other')));
});

test('admin moderation permissions remain available', async () => {
  const db = adminDb();

  await assertSucceeds(updateDoc(doc(db, 'ads/ad-open'), { status: 'in_progress' }));
  await assertSucceeds(updateDoc(doc(db, 'topups/top-pending'), { status: 'done' }));
  await assertSucceeds(deleteDoc(doc(db, 'artistWorks/work-approved')));
});
