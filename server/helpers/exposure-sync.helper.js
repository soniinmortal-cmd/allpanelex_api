const User = require("../apis/users/users.model");
const { Bet } = require("../apis/bet/bet.helper");
const { calculateMarketExposure } = require("./exposure.helper");
const { distributeCommissionHierarchy } = require("./utils");
const { setCache } = require("./cache");

/**
 * Universal Exposure Anchor (Source of Truth: Bet Collection)
 *
 * This function "snaps" the user's stored exposure to match the absolute sum of all their
 * pending bets in the database. This acts as the ultimate self-healing mechanism.
 *
 * It combines:
 * 1. Targeted Recalculation (sub-millisecond lookups on indexed Bet collection)
 * 2. Automatic Repair (fixing any drift)
 * 3. Hierarchy Propagation (keeping agents/admins in sync with the repair)
 *
 * @param {string} userId - ID of the user to synchronize.
 * @returns {Promise<void>}
 */
async function syncUserExposureFromSportsData(userId, options = {}) {
    const { session = null } = options;
    try {
        const user = await User.findById(userId).session(session);
        if (!user || user.role !== "user") return;

        // 1. Fetch all currently active/pending bets for this user - THE ABSOLUTE TRUTH
        const userBets = await Bet.find({
            userId,
            status: "pending",
            isActive: true,
            isDeleteBetShowUser: { $ne: true }
        }).select("gameId marketId betType amount gType eType sectionId uRate oRate marketName size sections").session(session).lean();

        // 2. Calculate Total Liability across all markets
        let totalMeasuredExp = 0;
        if (userBets.length > 0) {
            const betsByMarket = {};
            userBets.forEach(b => {
                const key = `${b.gameId}-${b.marketId}`;
                if (!betsByMarket[key]) betsByMarket[key] = [];
                betsByMarket[key].push(b);
            });

            for (const key in betsByMarket) {
                const mBets = betsByMarket[key];
                totalMeasuredExp += calculateMarketExposure(mBets[0].marketId, mBets);
            }
        }

        totalMeasuredExp = Number(Number(totalMeasuredExp).toFixed(2));
        if (totalMeasuredExp > 0) totalMeasuredExp = 0; // Liabilities are negative or zero

        const oldStoredExp = Number(user.exp) || 0;
        const diff = Number((totalMeasuredExp - oldStoredExp).toFixed(2));

        // 3. If there is a discrepancy, FIX IT ATOMICALLY
        if (Math.abs(diff) > 0.01) {
            const updatedUser = await User.findByIdAndUpdate(
                userId,
                { $set: { exp: totalMeasuredExp } },
                { new: true, session }
            );

            if (updatedUser) {
                console.log(`[Exposure Anchor] Synced User: ${user.username} | Old: ${oldStoredExp} | New: ${totalMeasuredExp} | Diff: ${diff}`);
                
                // Clear cache
                const cacheKey = `user:${userId}`;
                await setCache(cacheKey, updatedUser.toObject(), 60);

                // 4. Propagate the repair delta to agents/admins
                // This ensures the entire path remains in sync even after a repair
                await distributeCommissionHierarchy(updatedUser, { 
                    exp: diff,
                    originalExp: diff // Use the delta as the absolute change
                }, { session });
            }
            return { success: true, newExp: totalMeasuredExp, diff };
        }
        
        return { success: true, newExp: oldStoredExp, diff: 0 };
    } catch (err) {
        console.error(`[Exposure Anchor] Fatal Error for userId ${userId}:`, err.message);
        return { success: false, error: err.message };
    }
}

module.exports = {
    syncUserExposureFromSportsData
};
