const httpStatus = require("http-status");
const APIError = require("../helpers/APIError");
const Domain = require("../apis/domain/domain.model");

const transactionPassword = async (req, res, next) => {
  try {
     
    const userId = req?.user?._id;


    const userDomain = Array.isArray(req?.user?.domain)
      ? req.user.domain[0]
      : req?.user?.domain;

    // Domain setting check
    if (userDomain) {
      const domainData = await Domain.findOne({
        domain: userDomain,
        isActive: true,
      })
        .select("isTransactionpassword")
        .lean();
      
      console.log("domainData:", domainData);
      console.log(
        "isTransactionpassword:",
        domainData?.isTransactionpassword,
        "type:",
        typeof domainData?.isTransactionpassword
      );
      
        
      if (domainData?.isTransactionpassword === false) {
        return next();
      }
    }

    const inputPin = String(req?.body?.transaction_pin ?? "");
    const userPin = String(req?.user?.transaction_pin ?? "");

    if (req?.user?.role !== "user" && (!userId || !inputPin)) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .send(
          new APIError(
            "Missing transaction PIN or user ID.",
            httpStatus.BAD_REQUEST
          )
        );
    }

    if (req?.user?.role !== "user" && userPin !== inputPin) {
      return res
        .status(httpStatus.FORBIDDEN)
        .send(new APIError("Invalid transaction PIN.", httpStatus.FORBIDDEN));
    }
    next();
  } catch (err) {
    console.error("Transaction password check error:", err);
    return res
      .status(httpStatus.INTERNAL_SERVER_ERROR)
      .send(
        new APIError("Internal server error.", httpStatus.INTERNAL_SERVER_ERROR)
      );
  }
};

module.exports = {
  transactionPassword,
};
