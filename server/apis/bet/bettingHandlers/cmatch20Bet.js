const { getBets } = require("../bet.helper");

const handleCmatch20Bet = async (
    req,
    findSpotsData,
    expBal,
    partnerExpBal,
    id
) => {
    let spotsData = [];
    const sportBet = [];
    const findOldBackBet =
        (await getBets({
            marketId: req?.body?.marketId,
            userId: id,
            isActive: true,
        })) ?? [];
    const bets = findOldBackBet;
    bets?.push(req.body);
    for (let sid = 1; sid <= 10; sid++) {
        let totalAmt = 0;
        bets.forEach(({ sectionName, uRate, amount, betType }) => {
            const selectedRun = parseInt(sectionName.replace("Run ", ""), 10);
            let result = 0;

            if (betType === "back") {
                result = -amount;
                if (selectedRun + sid >= 12) {
                    result = amount * (uRate - 1);
                }
            } else if (betType === "lay") {
                result = amount;
                if (selectedRun + sid >= 12) {
                    result = -amount * (uRate - 1);
                }
            }

            totalAmt += result;
        });

        sportBet.push({
            sid,
            subId: 0,
            amount: Math.round(totalAmt),
        });
    }
    spotsData = sportBet;
    if (findSpotsData?.sdata?.length > 0) {
        const oldMaxMinusAmt = Math.min(
            ...findSpotsData?.sdata.map((item) => item.amount)
        );
        expBal -= oldMaxMinusAmt;

        const maxExp = Math.max(
            0,
            ...findSpotsData?.sdata.map((r) => r.amount).filter((v) => v > 0)
        );
        partnerExpBal -= maxExp;
    }
    const maxMinusAmt = Math.min(...sportBet.map((item) => item.amount));
    expBal += maxMinusAmt;

    const maxExp = Math.max(
        0,
        ...sportBet.map((r) => r.amount).filter((v) => v > 0)
    );
    // CRITICAL: Hierarchy liability, must be negative when risk increases.
    partnerExpBal -= maxExp; 

    return { spotsData, expBal, partnerExpBal };
};

module.exports = { handleCmatch20Bet };
