const handleCasinoFancy2Bet = async (
    req,
    findSpotsData,
    expBal,
    partnerExpBal,
    id,
    section,
    odds,
    getBets
) => {
    let spotsData = findSpotsData?.sdata ? [...findSpotsData.sdata] : [];
    let lRate = 0;
    let bRate = 0;
    let lsize = 0;
    let bsize = 0;

    const idx = spotsData.findIndex((s) => s.sid === req?.body?.sectionId);
    const oldAmt = idx > -1 ? spotsData[idx].amount : 0;
    if (idx > -1) {
        const maxExp = Math.max(
            0,
            ...spotsData[idx]?.calcTable
                .map((r) => r.profitLoss)
                .filter((v) => v > 0)
        );
        partnerExpBal -= maxExp;
    }
    const findOldBackBet = await getBets({
        marketId: req?.body?.marketId,
        userId: id,
        sectionId: req?.body?.sectionId,
        betType: "back",
        isActive: true,
        status: "pending"
    });
    const findOldLayBet = await getBets({
        marketId: req?.body?.marketId,
        userId: id,
        sectionId: req?.body?.sectionId,
        betType: "lay",
        isActive: true,
        status: "pending"
    });
    let backOdds = { size: section?.bbhav, odds: section?.b };
    let layOdds = { size: section?.lbhav, odds: section?.l };
    lRate = section?.l;
    bRate = section?.b;
    lsize = section?.lbhav;
    bsize = section?.bbhav;
    let newEntry = {};

    // Combine old and new bets
    const allBets = [...(findOldBackBet || []), ...(findOldLayBet || [])];

    // Create object for current bet
    const currentBet = {
        amount: req.body.amount,
        betType: req.body.betType,
        odds: Number(odds), // targetRun
        size: req.body.betType === "back" ? backOdds?.size : layOdds?.size,
    };
    allBets.push(currentBet);

    const targetRun = Number(odds);

    const calcTable = [];
    let runCount = 1;
    if (backOdds?.odds !== layOdds?.odds) {
        runCount += backOdds?.odds - layOdds?.odds;
    } // Logic seems to depend on odds range, keeping safe margin

    for (let run = targetRun - runCount; run <= targetRun + runCount; run++) {
        let profitLoss = 0;
        let backPL = 0;
        let layPL = 0;

        allBets.forEach(bet => {
            let betPL = 0;
            const betAmt = Number(bet.amount);
            // In Fancy2, odds = targetRun logic
            // But payout depends on size (bhav)
            const betOdds = Number(bet.odds ?? bet.uRate ?? bet.rate);
            // Warning: size logic for old bets might be tricky if not stored. 
            // Assuming old bets have 'size' or fall back to section defaults which might start failing if changed.
            // But placeBet stores bsize/lsize in `size` or `bRate`/`lRate`?
            // placeBet stores `size` for lay/back? Let's assume `size` on bet object.
            // But wait, fancy2 uses `backOdds.size` (bhav) for Payout. 
            // If old bet doesn't have size stored, using current `backOdds.size` is the existing bug again?
            // placeBet code: `bsize: bsize, lsize: lsize` -> This suggests it IS stored.
            // We should use `bet.bsize` or `bet.lsize` or just `bet.size` if standard.
            // Code in fancyBet use `bet.size`. Let's assume standardisation. 
            // However, placeBet logic for 'fancy2' sets lsize/bsize.

            // For Safety, let's look at `casinoFancy2Bet` original logic:
            // `profitLoss += Number(((backAmt * backOdds?.size) / 100).toFixed(2));`
            // It uses CURRENT `backOdds.size`. This confirms the bug exists for Size too.
            // We should use stored size.

            const betSize = Number(
                bet.size || 
                (bet.betType === 'back' ? (bet.bsize || bet.bRate) : (bet.lsize || bet.lRate)) || 
                (bet.betType === 'back' ? backOdds?.size : layOdds?.size)
            );

            if (bet.betType === "back") {
                if (run >= betOdds) {
                    betPL = Number(((betAmt * betSize) / 100).toFixed(2));
                } else {
                    betPL = -betAmt;
                }
                backPL += betPL;
            } else if (bet.betType === "lay") {
                if (run < betOdds) {
                    betPL = betAmt;
                } else {
                    betPL = -Number(((betAmt * betSize) / 100).toFixed(2));
                }
                layPL += betPL;
            }
            profitLoss += betPL;
        });

        calcTable.push({
            run,
            back: backPL,
            lay: layPL,
            profitLoss,
        });
    }

    // Save exposure
    if (idx > -1) expBal -= oldAmt;
    const newMinPL = Math.min(...calcTable.map((r) => r.profitLoss));
    
    // Safety Fallback: Ensure the new total exposure for this section is at least the stake of the current bet.
    const effectiveMinPL = Math.min(newMinPL, -Number(req.body.amount || 0));
    expBal += effectiveMinPL;

    const maxExp = Math.max(
        0,
        ...calcTable.map((r) => r.profitLoss).filter((v) => v > 0)
    );
    partnerExpBal += maxExp;
    newEntry = {
        sid: req?.body?.sectionId,
        amount: effectiveMinPL,
        calcTable,
    };
    if (idx > -1) {
        spotsData[idx] = newEntry;
    } else {
        spotsData.push(newEntry);
    }

    return { spotsData, expBal, partnerExpBal, lRate, bRate, lsize, bsize };
};

module.exports = { handleCasinoFancy2Bet };
