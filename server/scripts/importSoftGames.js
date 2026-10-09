const fs = require("fs");
const mongoose = require("mongoose");

const SoftApiGames = require(
  "../apis/softapi/softapiGames.model"
);

const path = require('path');

require("dotenv").config();

(async () => {
  try {
    await mongoose.connect(
      process.env.MONGO_HOST
    );

    const json = JSON.parse(
      fs.readFileSync(
        path.join(
            __dirname,
            "brands-with-games (1).json"
        ),
        "utf8"
      )
    );

    const games = [];

    for (const brand of json.brands) {
      for (const game of brand.games) {
        games.push({
          brandId: brand.brand_id,

          brandTitle:
            brand.brand_title,

          gameId:
            game.gameID,

          gameUid:
            game.gameID,

          gameName:
            game.gameNameEn,

          category:
            game.category,

          image:
            game.img,

          vendorId:
            game.vendorId,
        });
      }
    }

    console.log(
      "Games prepared:",
      games.length
    );

    await SoftApiGames.deleteMany({});

    await SoftApiGames.insertMany(
      games,
      {
        ordered: false,
      }
    );

    console.log(
      "Import complete"
    );

    process.exit(0);
  } catch (err) {
    console.error(err);

    process.exit(1);
  }
})();