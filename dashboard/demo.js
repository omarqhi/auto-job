// Preview the dashboard against a demo tracker (does not touch your real tracker).
//   node dashboard/demo.js   ->  http://localhost:5681
const path = require('path');
process.env.DASHBOARD_PORT = '5681';
process.env.DASHBOARD_DEMO = '1';     // simulated runs; nothing real is scraped, tailored, emailed or saved
process.env.TRACKER_FILE = path.join(__dirname, 'demo-tracker.xlsx');
process.env.JOBS_DB = path.join(__dirname, 'demo-jobs.db');      // build it with: node dashboard/seed-demo.js
require('./server.js');
