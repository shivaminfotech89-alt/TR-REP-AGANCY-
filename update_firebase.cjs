const fs = require('fs');
let code = fs.readFileSync('src/lib/firebase.ts', 'utf8');

if (!code.includes('initializeFirestore')) {
  code = code.replace(
    /import \{ getFirestore \} from 'firebase\/firestore';/,
    `import { initializeFirestore, getFirestore } from 'firebase/firestore';`
  );
  code = code.replace(
    /export const db = getFirestore\(app, firebaseConfig\.firestoreDatabaseId\);/,
    `export const db = initializeFirestore(app, { experimentalAutoDetectLongPolling: true }, firebaseConfig.firestoreDatabaseId);`
  );
  fs.writeFileSync('src/lib/firebase.ts', code);
}
console.log("Updated firebase.ts");
