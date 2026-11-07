// The checklist reads pages written by agents, so it runs off the main thread with a clock on it. A page built to make a regex crawl stalls this worker, not the building.
import { parentPort, workerData } from 'node:worker_threads';
import { checkSite } from './launch-check.js';

parentPort.postMessage(checkSite(workerData));
