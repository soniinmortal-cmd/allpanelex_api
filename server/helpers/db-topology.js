/**
 * MongoDB Topology Detection
 * 
 * Detects if MongoDB is running as a Replica Set or Standalone ONCE at startup.
 * All transactional code should check this flag before using sessions.
 * 
 * Usage:
 *   const { isReplicaSet, getSessionIfReplicaSet } = require('./helpers/db-topology');
 *   
 *   // Option 1: Check flag
 *   if (isReplicaSet()) { ... use session ... }
 *   
 *   // Option 2: Get session (returns null on standalone)
 *   const session = await getSessionIfReplicaSet();
 *   // session is null on standalone, so pass it and code runs without transaction
 */

const mongoose = require('mongoose');

let _isReplicaSet = false;
let _detected = false;

/**
 * Detect the MongoDB topology. Call once after mongoose.connect().
 */
async function detectTopology() {
    try {
        const admin = mongoose.connection.db.admin();
        const info = await admin.command({ replSetGetStatus: 1 });
        _isReplicaSet = true;
        _detected = true;
        console.log(`[DB-Topology] ✅ MongoDB is a REPLICA SET (${info.set}). Transactions ENABLED.`);
    } catch (err) {
        _isReplicaSet = false;
        _detected = true;
        console.log(`[DB-Topology] ⚠️ MongoDB is STANDALONE. Transactions DISABLED. All operations run non-atomic.`);
    }
}

/**
 * Returns true if the MongoDB instance supports transactions (replica set).
 */
function isReplicaSet() {
    if (!_detected) {
        console.warn('[DB-Topology] WARNING: detectTopology() has not been called yet. Defaulting to false (standalone).');
    }
    return _isReplicaSet;
}

/**
 * Returns a new Mongoose session if on a replica set, or null if standalone.
 * Callers should check for null and skip session-based logic.
 */
async function getSessionIfReplicaSet() {
    if (!_isReplicaSet) return null;
    return mongoose.startSession();
}

module.exports = {
    detectTopology,
    isReplicaSet,
    getSessionIfReplicaSet,
};
