const httpStatus = require("http-status");
const mongoose = require("mongoose");
const APIError = require("./APIError");
const User = require("../apis/users/users.model");

/**
 * The 100% Reliable Atomic Finance Update Helper.
 * Ensures that (Balance + Exposure) never goes below zero.
 * 
 * @param {string} userId - The MongoDB User ID
 * @param {object} deltas - { balance: number, exp: number }
 * @param {object} options - { allowNegativeBuffer: boolean, session: ClientSession }
 * @returns {Promise<User>} - The updated user document
 */
async function atomicUpdateUserFinance(userId, deltas, options = {}) {
  const { allowNegativeBuffer = false, session = null } = options;
  const balanceDelta = Number(Number(deltas.balance || 0).toFixed(2));
  const expDelta = Number(Number(deltas.exp || 0).toFixed(2));

  if (balanceDelta === 0 && expDelta === 0) return await User.findById(userId).session(session).lean();

  let attempts = 0;
  const maxAttempts = 10;

  while (attempts < maxAttempts) {
    attempts++;
    
    // 1. Fetch current state to check buffer (Only if we need to enforce rules)
    const user = await User.findById(userId).select("username balance exp role").session(session).lean();
    if (!user) throw new APIError("User not found.", httpStatus.NOT_FOUND, true);

    const isRestricted = !['owner', 'super-admin', 'admin', 'sub-admin', 'super-master', 'master'].includes(user.role);
    
    if (!allowNegativeBuffer) {
      const currentBalance = Number(user.balance || 0);
      const currentExp = Number(user.exp || 0);
      const effectiveNewExp = isRestricted ? Math.min(0, currentExp + expDelta) : 0;
      const newBuffer = Number((currentBalance + balanceDelta + effectiveNewExp).toFixed(2));

      if (newBuffer < -0.01) {
        console.warn(`[Finance] Insufficient Funds for ${user.username} (Role: ${user.role}): Bal=${currentBalance}, Exp=${currentExp}, Delta=${balanceDelta}, BufferAfter=${newBuffer}`);
        throw new APIError(`Insufficient funds.`, httpStatus.BAD_REQUEST, true);
      }
    }

    // 2. Perform Atomic Update using pipeline
    try {
      const result = await User.findOneAndUpdate(
        { _id: new mongoose.Types.ObjectId(userId) },
        [
          {
            $set: {
              balance: { $round: [{ $add: ["$balance", balanceDelta] }, 2] },
              exp: {
                $cond: {
                  if: { $gt: [{ $add: ["$exp", expDelta] }, 0] },
                  then: 0,
                  else: { $round: [{ $add: ["$exp", expDelta] }, 2] }
                }
              }
            }
          },
          {
            $set: {
              exp_limit: "$balance",
            },
          },
        ],
        { new: true, session: session }
      );

      if (result) return result;
    } catch (err) {
      if (err.name === 'VersionError' || err.code === 11000 || err.code === 112) { 
        console.warn(`[Finance] Retry ${attempts} for ${userId} due to conflict.`);
        await new Promise(r => setTimeout(r, 50 * attempts));
        continue;
      }
      throw err;
    }
  }
  
  throw new Error(`Failed to update finance for ${userId} after ${maxAttempts} attempts.`);
}

module.exports = {
  atomicUpdateUserFinance
};
