const crypto = require("crypto");

const encryptPayload = (payload) => {
  const key = Buffer.from(
    process.env.NEXXAPI_SECRET,
    "utf8"
  );

  const cipher = crypto.createCipheriv(
    "aes-256-ecb",
    key,
    null
  );

  cipher.setAutoPadding(true);

  let encrypted = cipher.update(
    JSON.stringify(payload),
    "utf8",
    "base64"
  );

  encrypted += cipher.final("base64");

  return encrypted;
};

module.exports = {
  encryptPayload,
};