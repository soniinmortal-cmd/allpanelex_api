const handleFancy1Bet = async (
    req,
    findSpotsData,
    expBal,
    partnerExpBal,
    id,
    section,
    getBets
) => {
    let spotsData = findSpotsData?.sdata ? [...findSpotsData.sdata] : [];
    let lRate = 0;
    let bRate = 0;
    let lsize = 0;
    let bsize = 0;

    const targetSidStr = String(req?.body?.sectionId);
    const matchingEntries = spotsData.filter((s) => String(s.sid) === targetSidStr);
    const oldAmt = matchingEntries.reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0);
    matchingEntries.forEach((entry) => {
        if (entry.calcTable) {
            const maxExp = Math.max(
                0,
                ...entry.calcTable
                    .map((r) => r.profitLoss)
                    .filter((v) => v > 0)
            );
            partnerExpBal -= maxExp;
        }
    });
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
    const oddsRunLine = Number(req?.body?.oRate || req?.body?.uRate);
    let backOdds = section?.odds?.findLast((o) => o.otype === "back" && Number(o.odds) === oddsRunLine);
    if (!backOdds) {
        backOdds = section?.odds?.findLast((o) => o.otype === "back");
    }
    let layOdds = section?.odds?.find((o) => o.otype === "lay" && Number(o.odds) === oddsRunLine);
    if (!layOdds) {
        layOdds = section?.odds?.find((o) => o.otype === "lay");
    }
    let newEntry = {};
    lRate = layOdds?.l;
    bRate = backOdds?.b;
    lsize = layOdds?.size;
    bsize = backOdds?.size;

    // Combine old and new bets
    const allBets = [...(findOldBackBet || []), ...(findOldLayBet || [])];

    // Create object for current bet to unify processing
    const currentBet = {
        amount: req.body.amount,
        betType: req.body.betType,
        odds: oddsRunLine,
        // Ensure we handle case where odds might be missing slightly gracefully, 
        // though strictly they should exist for a new bet.
    };
    allBets.push(currentBet);

    const targetRun = 1;
    const calcTable = [];
    let runCount = 1;

    for (let run = targetRun - runCount; run <= targetRun + runCount; run++) {
        let profitLoss = 0;
        let backPL = 0;
        let layPL = 0;

        allBets.forEach(bet => {
            let betPL = 0;
            const betAmt = Number(bet.amount);
            const betOdds = Number(bet.odds ?? bet.uRate ?? bet.rate);

            if (bet.betType === "back") {
                if (run >= targetRun) {
                    betPL = Number((parseFloat(betOdds - 1) * betAmt).toFixed(2));
                } else {
                    betPL = -betAmt;
                }
                backPL += betPL;
            } else if (bet.betType === "lay") {
                if (run < targetRun) {
                    betPL = betAmt;
                } else {
                    betPL = -Number((parseFloat(betOdds - 1) * betAmt).toFixed(2));
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
    expBal -= oldAmt;
    const newMinPL = calcTable.length > 0 ? Math.min(0, ...calcTable.map((r) => r.profitLoss)) : 0;
    
    // Safety Fallback: Ensure the new total exposure for this section is at least the stake of the current bet.
    const effectiveMinPL = Math.min(newMinPL, -Number(req.body.amount || 0));
    expBal += effectiveMinPL;
    
    newEntry = {
        sid: req?.body?.sectionId,
        amount: effectiveMinPL,
        calcTable,
    };
    spotsData = spotsData.filter((s) => String(s.sid) !== targetSidStr);
    spotsData.push(newEntry);

    const pd = calcTable.map((r) => r.profitLoss).filter((v) => v > 0);
    const maxExp = pd.length > 0 ? Math.max(0, ...pd) : 0;
    // CRITICAL: Hierarchy liability, must be negative when risk increases.
    partnerExpBal -= maxExp; 

    return { spotsData, expBal, partnerExpBal, lRate, bRate, lsize, bsize };
};

module.exports = { handleFancy1Bet };
