const mongoose = require("mongoose");
const Sport = require("../apis/front/sport.model"); // adjust if your model is elsewhere
const { data: sports } = require("./sports.json");
const path = require("path");

require("dotenv").config({
  path: path.resolve(__dirname, "../../.env"),
});

console.log(process.env.MONGO_HOST);
async function seedSports() {
  try {
    await mongoose.connect(process.env.MONGO_HOST);

    // Optional: clear existing data
    await Sport.deleteMany({});

    // Keep only eid and ename
    const formattedSports = sports.map(({ eid, ename }) => ({
      eid,
      ename,
    }));

    await Sport.insertMany(formattedSports);

    console.log(`${formattedSports.length} sports inserted successfully.`);
  } catch (err) {
    console.error(err);
  } finally {
    await mongoose.disconnect();
  }
}

seedSports();