const httpStatus = require("http-status");
const speakeasy = require("speakeasy");
const QRCode = require("qrcode");

const APIError = require("../../helpers/APIError");
const APIResponse = require("../../helpers/APIResponse");

const GoogleAuthenticatorUser = require(
  "./googleAuthenticatorUsers.model"
);


const verifyGoogleAuthenticator =
  async (
    req,
    res,
    next
  ) => {
    try {
      const {
        userId,
        otp,
      } = req.body;

      const record =
        await GoogleAuthenticatorUser.findOne(
          {
            userId,
          }
        );

      if (!record) {
        return res.status(
          httpStatus.NOT_FOUND
        ).json(
          new APIError(
            "Google Authenticator not setup",
            httpStatus.NOT_FOUND
          )
        );
      }

      const verified =
        speakeasy.totp.verify({
          secret:
            record.secret,
          encoding:
            "base32",
          token: otp,
          window: 1,
        });

      if (!verified) {
        return res.status(
          httpStatus.BAD_REQUEST
        ).json(
          new APIError(
            "Invalid OTP",
            httpStatus.BAD_REQUEST
          )
        );
      }

      record.enabled = true;

      await record.save();

      return res.status(
        httpStatus.OK
      ).json(
        new APIResponse(
          null,
          "Google Authenticator enabled successfully",
          httpStatus.OK
        )
      );
    } catch (err) {
      next(err);
    }
  };

const disableGoogleAuthenticator =
  async (
    req,
    res,
    next
  ) => {
    try {
      const { userId } =
        req.body;

      await GoogleAuthenticatorUser.findOneAndUpdate(
        {
          userId,
        },
        {
          enabled: false,
        }
      );

      return res.status(
        httpStatus.OK
      ).json(
        new APIResponse(
          null,
          "Google Authenticator disabled successfully",
          httpStatus.OK
        )
      );
    } catch (err) {
      next(err);
    }
  };

const setupGoogleAuthenticator = async (
  req,
  res,
  next
) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .send(
          new APIError(
            "userId is required",
            httpStatus.BAD_REQUEST
          )
        );
    }

    let googleAuthRecord =
      await GoogleAuthenticatorUser.findOne({
        userId,
      });

    let secret;

    /**
     * WHAT:
     * Reuse existing secret if present.
     *
     * WHY:
     * Idempotency.
     *
     * HOW:
     * Existing user should keep the same
     * Google Authenticator configuration.
     */
    if (googleAuthRecord) {
      googleAuthRecord.enabled = true;
      await googleAuthRecord.save();
      secret = googleAuthRecord.secret;
    } else {
      const generatedSecret =
        speakeasy.generateSecret({
          name: `SecureAuth-${userId}`,
        });

      secret =
        generatedSecret.base32;

      googleAuthRecord =
        await GoogleAuthenticatorUser.create({
          userId,
          secret,
          enabled: true,
        });
    }

    /**
     * WHAT:
     * Generate QR dynamically.
     *
     * WHY:
     * QR is derived from secret.
     *
     * HOW:
     * No need to store QR in DB.
     */
    const otpAuthUrl =
      speakeasy.otpauthURL({
        secret,
        label: `SecureAuth-${userId}`,
        issuer: "SecureAuth",
        encoding: "base32",
      });

    const qrCode =
      await QRCode.toDataURL(
        otpAuthUrl
      );

    return res
      .status(httpStatus.OK)
      .send(
        new APIResponse(
          {
            qrCode,
            enabled:
              googleAuthRecord.enabled,
          },
          "QR generated successfully",
          httpStatus.OK
        )
      );
  } catch (err) {
    next(err);
  }
};

module.exports = {
  setupGoogleAuthenticator,
  verifyGoogleAuthenticator,
  disableGoogleAuthenticator,
};