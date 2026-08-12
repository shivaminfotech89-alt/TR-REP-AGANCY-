import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, doc, updateDoc } from "firebase/firestore";
import fs from "fs";

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function run() {
  console.log("Fetching agencies...");
  const agencies = await getDocs(collection(db, 'agencies'));
  const agencyList = agencies.docs.map(d => ({id: d.id, name: d.data().name}));
  console.log("Agencies:", agencyList);

  console.log("Fetching jobs...");
  const jobs = await getDocs(collection(db, 'jobs'));
  const jobList = jobs.docs.map(d => ({id: d.id, mrNo: d.data().mrNo, agencyId: d.data().agencyId}));
  
  const agencyGroups = {};
  for (const j of jobList) {
    if (j.agencyId) {
      agencyGroups[j.agencyId] = (agencyGroups[j.agencyId] || 0) + 1;
    }
  }
  console.log("Jobs per agencyId:", agencyGroups);
}
run();
