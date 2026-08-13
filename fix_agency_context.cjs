const fs = require('fs');
let code = fs.readFileSync('src/lib/AgencyContext.tsx', 'utf8');

const targetStr = `export interface AtMaster {
  id: string;
  atNumber: string;
  name: string;
  startDate: number;
  endDate: number;
  status: 'Active' | 'Closed';
  agencyId: string;
  lastJobNumbers: Record<string, number>;
  ownerId?: string;
  atPercentage?: number;
  allotments?: Record<string, Record<string, number>>;
}`;

const replacementStr = `export interface AllotmentRecord {
  id: string;
  date: string;
  letterNo: string;
  division: string;
  coreType: string;
  quantity: number;
  addedAt: number;
}

export interface AtMaster {
  id: string;
  atNumber: string;
  name: string;
  startDate: number;
  endDate: number;
  status: 'Active' | 'Closed';
  agencyId: string;
  lastJobNumbers: Record<string, number>;
  ownerId?: string;
  atPercentage?: number;
  allotments?: Record<string, Record<string, number>>;
  allotmentHistory?: AllotmentRecord[];
}`;

if (code.includes(targetStr)) {
    code = code.replace(targetStr, replacementStr);
    fs.writeFileSync('src/lib/AgencyContext.tsx', code);
    console.log("Updated AgencyContext.tsx successfully");
} else {
    console.log("Could not find target string in AgencyContext.tsx");
}
