const Joi = require("joi");
const JoiMongooseObjectId = require("joi-objectid")(Joi);
const { JoiPassword } = require("joi-password");

const createUser = Joi.object().keys({
  email: Joi.string().min(6).max(150).email().required(),
  password: JoiPassword.string()
    .min(6)
    .minOfSpecialCharacters(1)
    .minOfLowercase(1)
    .minOfUppercase(1)
    .minOfNumeric(1)
    .noWhiteSpaces()
    .required(),

  name: Joi.string().required(),
  phone: Joi.string().optional().allow(""),
});

module.exports = {
  createUser,
};
