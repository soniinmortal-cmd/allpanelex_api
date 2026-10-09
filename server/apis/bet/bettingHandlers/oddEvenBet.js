const handleOddEvenBet = async (
    req,
    findSpotsData,
    expBal,
    partnerExpBal,
    id,
    odds,
    getBets
) => {
    let spotsData = findSpotsData?.sdata ? [...findSpotsData.sdata] : [];

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
    // ✅ Fetch old bets for this section
    const findOldOddBet = await getBets({
        marketId: req?.body?.marketId,
        userId: id,
        sectionId: req?.body?.sectionId,
        betType: "lay",
        isActive: true,
        status: "pending"
    });
    const findOldEvenBet = await getBets({
        marketId: req?.body?.marketId,
        userId: id,
        sectionId: req?.body?.sectionId,
        betType: "back",
        isActive: true,
        status: "pending"
    });

    const allBets = [...(findOldOddBet || []), ...(findOldEvenBet || [])];

    // Create object for current bet
    const currentBet = {
        amount: req.body.amount,
        betType: req.body.betType,
        odds: odds?.odds,
    };
    allBets.push(currentBet);

    const calcTable = [];
    for (let outcome of ["lay", "back"]) { // lay=Odd, back=Even
        let profitLoss = 0;
        let oddPL = 0;
        let evenPL = 0;

        allBets.forEach(bet => {
            let betPL = 0;
            const betAmt = Number(bet.amount);
            const betOdds = Number(bet.odds ?? bet.uRate ?? bet.rate); // Use bet's specific odds

            if (bet.betType === "lay") { // Odd
                if (outcome === "lay") { // Outcome is Odd
                    betPL = Number(
                        ((parseFloat(betOdds) - 1) * betAmt).toFixed(2)
                    );
                } else { // Outcome is Even
                    betPL = -betAmt;
                }
                oddPL += betPL;
            } else if (bet.betType === "back") { // Even
                if (outcome === "back") { // Outcome is Even
                    betPL = Number(
                        ((parseFloat(betOdds) - 1) * betAmt).toFixed(2)
                    );
                } else { // Outcome is Odd
                    betPL = -betAmt;
                }
                evenPL += betPL;
            }
            profitLoss += betPL;
        });

        calcTable.push({
            outcome,
            odd: oddPL,
            even: evenPL,
            profitLoss,
        });
    }

    expBal -= oldAmt;
    const newMinPL = calcTable.length > 0 ? Math.min(0, ...calcTable.map((r) => r.profitLoss)) : 0;
    
    // Safety Fallback: Ensure the new total exposure for this section is at least the stake of the current bet.
    const effectiveMinPL = Math.min(newMinPL, -Number(req.body.amount || 0));
    expBal += effectiveMinPL;

    const newEntry = {
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

    return { spotsData, expBal, partnerExpBal };
};

module.exports = { handleOddEvenBet };
