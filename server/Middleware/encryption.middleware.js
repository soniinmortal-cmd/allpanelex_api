const { decryptData, encryptData } = require("../helpers/utils");

function encryptionMiddleware(req, res, next) {
  try {
    if (res.getHeader && res.getHeader("X-Skip-Encryption") === "1") {
      return next();
    }
    if (req.body?.Payload) {

      req.body = decryptData(req.body.Payload);
    }

    const originalJson = res.json.bind(res);
    res.json = (data) => {
      return originalJson({ Payload: encryptData(data) });
    };

    next();
  } catch (error) {

    res.status(400).json({ message: "Invalid encrypted payload" });
  }
}

module.exports = encryptionMiddleware;
